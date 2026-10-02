import { randomUUID } from "node:crypto";
import type { SignalFreshness } from "../../contracts/protocol/src/types.js";
import type { TraceSink } from "../../packages/core-runtime/src/tracing.js";
import { StructuredTraceSink } from "../../packages/core-runtime/src/tracing.js";
import { asRecord, fetchJson, recordIntegrationSignal } from "../shared/http.js";
import type { WeatherObservation } from "./mock-weather-adapter.js";

const FREE_FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const CURRENT_MAX_AGE_MS = 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8_000;

export interface WeatherPoint {
  latitude: number;
  longitude: number;
}

export interface OpenMeteoWeatherInput extends WeatherPoint {
  signal?: AbortSignal;
  traceId?: string;
}

export interface OpenMeteoWeatherAdapterOptions {
  /** Customer API mode requires both an explicit HTTPS endpoint and API key. */
  endpoint?: string;
  apiKey?: string;
  /** Explicit opt-in for the public, non-commercial endpoint; defaults to false. */
  allowNonCommercialFreeEndpoint?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  sessionId?: string;
  trace?: TraceSink;
  now?: () => number;
  eventSink?: Parameters<typeof recordIntegrationSignal>[0];
}

export interface WeatherAdapterAvailability {
  available: boolean;
  mode: "customer_api" | "non_commercial_free" | "unavailable";
  reasonCode?: string;
}

interface HourlyWeather {
  time: string[];
  weather_code: number[];
  temperature_2m: number[];
  precipitation_probability: number[];
  precipitation: number[];
}

/** Open-Meteo adapter. It performs no network request until a method is explicitly called. */
export class OpenMeteoWeatherAdapter {
  private readonly availabilityState: WeatherAdapterAvailability;
  private endpoint: string | undefined;
  private apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly timeoutMs: number;
  private readonly sessionId: string;
  private readonly trace: TraceSink;
  private readonly now: () => number;
  private readonly eventSink: OpenMeteoWeatherAdapterOptions["eventSink"];

  constructor(options: OpenMeteoWeatherAdapterOptions = {}) {
    const endpoint = options.endpoint ?? process.env.OPEN_METEO_CUSTOMER_ENDPOINT;
    const apiKey = options.apiKey ?? process.env.OPEN_METEO_API_KEY;
    const freeOptIn = options.allowNonCommercialFreeEndpoint ??
      process.env.OPEN_METEO_NON_COMMERCIAL_OPT_IN === "true";
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sessionId = options.sessionId ?? "external-adapters";
    this.trace = options.trace ?? new StructuredTraceSink();
    this.now = options.now ?? Date.now;
    this.eventSink = options.eventSink;
    this.endpoint = undefined;
    this.apiKey = undefined;

    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 60_000) {
      throw new Error("INVALID_WEATHER_TIMEOUT");
    }

    if (endpoint || apiKey) {
      if (!endpoint || !apiKey?.trim() || apiKey.length > 512) {
        this.availabilityState = { available: false, mode: "unavailable", reasonCode: "OPEN_METEO_CUSTOMER_CONFIGURATION_INCOMPLETE" };
        return;
      }
      let normalizedEndpoint: string;
      try {
        normalizedEndpoint = validateCustomerEndpoint(endpoint);
      } catch {
        this.availabilityState = { available: false, mode: "unavailable", reasonCode: "INVALID_OPEN_METEO_CUSTOMER_ENDPOINT" };
        return;
      }
      this.endpoint = normalizedEndpoint;
      this.apiKey = apiKey.trim();
      this.availabilityState = { available: true, mode: "customer_api" };
      return;
    }

    if (freeOptIn) {
      this.endpoint = FREE_FORECAST_ENDPOINT;
      this.apiKey = undefined;
      this.availabilityState = { available: true, mode: "non_commercial_free" };
      return;
    }

    this.availabilityState = { available: false, mode: "unavailable", reasonCode: "OPEN_METEO_NOT_CONFIGURED" };
  }

  availability(): WeatherAdapterAvailability {
    return { ...this.availabilityState };
  }

  async getCurrentConditions(input: OpenMeteoWeatherInput): Promise<WeatherObservation> {
    const startedAt = this.now();
    const traceId = input.traceId ?? randomUUID();
    try {
      const url = this.createUrl(input, 2);
      const root = await this.fetchForecast(url, input.signal);
      validateWeatherUnits(root);
      const current = asRecord(root.current);
      const hourly = normalizeHourly(root.hourly);
      if (!current) throw new Error("OPEN_METEO_CURRENT_RESPONSE_INVALID");
      const observedAt = parseTime(current.time);
      const weatherCode = requireNumber(current.weather_code, "OPEN_METEO_CURRENT_RESPONSE_INVALID", { integer: true, minimum: 0, maximum: 99 });
      const temperatureCelsius = requireNumber(current.temperature_2m, "OPEN_METEO_CURRENT_RESPONSE_INVALID", { minimum: -100, maximum: 70 });
      const precipitationMillimeters = requireNumber(current.precipitation, "OPEN_METEO_CURRENT_RESPONSE_INVALID", { minimum: 0, maximum: 1000 });
      const hourIndex = nearestHourIndex(hourly.time, observedAt);
      const precipitationProbability = normalizeProbability(hourly.precipitation_probability[hourIndex]);
      const observation = this.createObservation({
        observedAt,
        temperatureCelsius,
        weatherCode,
        precipitationMillimeters,
        precipitationProbability,
      });
      this.recordObservation(traceId, observation, startedAt, "current");
      return observation;
    } catch (error) {
      this.recordFailure(traceId, startedAt, error, "get-current-conditions");
      throw toWeatherError(error);
    }
  }

  async getForecast(input: OpenMeteoWeatherInput, hours = 24): Promise<WeatherObservation[]> {
    const startedAt = this.now();
    const traceId = input.traceId ?? randomUUID();
    try {
      if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error("INVALID_FORECAST_HOURS");
      // Open-Meteo's hourly series starts at 00:00 UTC for the current day.
      // Fetch an extra day so filtering elapsed hours still leaves the full requested window.
      const forecastDays = Math.min(16, Math.ceil(hours / 24) + 1);
      const url = this.createUrl(input, forecastDays);
      const root = await this.fetchForecast(url, input.signal);
      validateWeatherUnits(root);
      const hourly = normalizeHourly(root.hourly);
      const retrievedAt = this.now();
      const currentHour = Math.floor(retrievedAt / 3_600_000) * 3_600_000;
      const futureIndexes = hourly.time
        .map((time, index) => ({ validAt: parseTime(time), index }))
        .filter(({ validAt }) => validAt >= currentHour)
        .slice(0, hours);
      if (futureIndexes.length !== hours || futureIndexes.some((item, index) =>
        index > 0 && item.validAt - futureIndexes[index - 1]!.validAt !== 60 * 60 * 1000)) {
        throw new Error("OPEN_METEO_FORECAST_WINDOW_INCOMPLETE");
      }
      const observations = futureIndexes.map(({ validAt, index }) => this.createObservation({
        observedAt: retrievedAt,
        validAt,
        temperatureCelsius: requireNumber(hourly.temperature_2m[index], "OPEN_METEO_HOURLY_RESPONSE_INVALID", { minimum: -100, maximum: 70 }),
        weatherCode: requireNumber(hourly.weather_code[index], "OPEN_METEO_HOURLY_RESPONSE_INVALID", { integer: true, minimum: 0, maximum: 99 }),
        precipitationMillimeters: requireNumber(hourly.precipitation[index], "OPEN_METEO_HOURLY_RESPONSE_INVALID", { minimum: 0, maximum: 1000 }),
        precipitationProbability: normalizeProbability(hourly.precipitation_probability[index]),
        freshness: "fresh",
      }));
      this.recordObservation(traceId, observations[0]!, startedAt, "forecast");
      return observations;
    } catch (error) {
      this.recordFailure(traceId, startedAt, error, "get-forecast");
      throw toWeatherError(error);
    }
  }

  private createUrl(input: OpenMeteoWeatherInput, forecastDays: number): URL {
    validatePoint(input);
    if (input.traceId !== undefined && !isTraceId(input.traceId)) {
      throw new Error("INVALID_TRACE_ID");
    }
    if (input.signal?.aborted) throw new Error("REQUEST_ABORTED");
    if (!this.availabilityState.available || !this.endpoint) {
      throw new Error(this.availabilityState.reasonCode ?? "WEATHER_PROVIDER_UNAVAILABLE");
    }
    const url = new URL(this.endpoint);
    url.searchParams.set("latitude", String(input.latitude));
    url.searchParams.set("longitude", String(input.longitude));
    url.searchParams.set("current", "weather_code,temperature_2m,precipitation");
    url.searchParams.set("hourly", "weather_code,temperature_2m,precipitation_probability,precipitation");
    url.searchParams.set("forecast_days", String(forecastDays));
    url.searchParams.set("timezone", "UTC");
    url.searchParams.set("temperature_unit", "celsius");
    if (this.apiKey) url.searchParams.set("apikey", this.apiKey);
    return url;
  }

  private async fetchForecast(url: URL, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (!this.availabilityState.available) throw new Error(this.availabilityState.reasonCode ?? "WEATHER_PROVIDER_UNAVAILABLE");
    const result = await fetchJson(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      ...(signal === undefined ? {} : { signal }),
    }, { ...(this.fetchImpl === undefined ? {} : { fetchImpl: this.fetchImpl }), timeoutMs: this.timeoutMs });
    const root = asRecord(result);
    if (!root) throw new Error("OPEN_METEO_RESPONSE_INVALID");
    validateResponseCoordinates(root);
    return root;
  }

  private createObservation(input: {
    observedAt: number;
    validAt?: number;
    temperatureCelsius: number;
    weatherCode: number;
    precipitationMillimeters: number;
    precipitationProbability: number;
    freshness?: SignalFreshness;
  }): WeatherObservation {
    const freshness: SignalFreshness = input.freshness ?? (this.now() - input.observedAt <= CURRENT_MAX_AGE_MS && input.observedAt <= this.now()
      ? "fresh"
      : "stale");
    const provider = this.availabilityState.mode === "customer_api" ? "open-meteo-customer-api" : "open-meteo-public-api";
    const observedAt = new Date(input.observedAt).toISOString();
    return {
      location: "requested coordinates",
      observedAt,
      ...(input.validAt === undefined ? {} : { validAt: new Date(input.validAt).toISOString() }),
      ...(input.validAt === undefined ? {} : { retrievedAt: observedAt }),
      temperatureCelsius: input.temperatureCelsius,
      condition: weatherCodeToCondition(input.weatherCode),
      precipitationProbability: input.precipitationProbability,
      precipitationMillimeters: input.precipitationMillimeters,
      weatherCode: input.weatherCode,
      provider,
      source: "api",
      freshness,
      attribution: "© Open-Meteo",
      attributionUrl: "https://open-meteo.com/",
      provenance: { provider, observedAt, ...(input.validAt === undefined ? {} : { validAt: new Date(input.validAt).toISOString() }), source: "api" },
    };
  }

  private recordObservation(traceId: string, observation: WeatherObservation, startedAt: number, operation: "current" | "forecast"): void {
    const signalValue = operation === "current" ? observation : {
      provider: observation.provider,
      observedAt: observation.observedAt,
      validAt: observation.validAt,
      source: observation.source,
      freshness: observation.freshness,
      weatherCode: observation.weatherCode,
    };
    recordIntegrationSignal(this.eventSink, "weather.observation.received", signalValue, traceId, this.now, "api");
    this.trace.record({
      sessionId: this.sessionId,
      traceId,
      component: "open-meteo-weather-adapter",
      operation: operation === "current" ? "get-current-conditions" : "get-forecast",
      startedAt,
      durationMs: Math.max(0, this.now() - startedAt),
      outcome: "ok",
      ...(observation.provider === undefined ? {} : { model: observation.provider }),
      rawAudioDropped: true,
    });
  }

  private recordFailure(traceId: string, startedAt: number, error: unknown, operation: string): void {
    const reason = toWeatherError(error).message;
    this.trace.record({
      sessionId: this.sessionId,
      traceId,
      component: "open-meteo-weather-adapter",
      operation,
      startedAt,
      durationMs: Math.max(0, this.now() - startedAt),
      outcome: "error",
      fallbackReason: reason,
      rawAudioDropped: true,
    });
  }
}

function validateCustomerEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("INVALID_OPEN_METEO_CUSTOMER_ENDPOINT");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("INVALID_OPEN_METEO_CUSTOMER_ENDPOINT");
  }
  return url.toString().replace(/\/$/, "");
}

function validatePoint(point: WeatherPoint): void {
  if (!Number.isFinite(point.latitude) || point.latitude < -90 || point.latitude > 90 ||
      !Number.isFinite(point.longitude) || point.longitude < -180 || point.longitude > 180) {
    throw new Error("INVALID_WEATHER_COORDINATES");
  }
}

function validateResponseCoordinates(root: Record<string, unknown>): void {
  if (root.latitude !== undefined && (typeof root.latitude !== "number" || !Number.isFinite(root.latitude) || root.latitude < -90 || root.latitude > 90)) {
    throw new Error("OPEN_METEO_RESPONSE_INVALID");
  }
  if (root.longitude !== undefined && (typeof root.longitude !== "number" || !Number.isFinite(root.longitude) || root.longitude < -180 || root.longitude > 180)) {
    throw new Error("OPEN_METEO_RESPONSE_INVALID");
  }
}

function validateWeatherUnits(root: Record<string, unknown>): void {
  const currentUnits = asRecord(root.current_units);
  const hourlyUnits = asRecord(root.hourly_units);
  if (!currentUnits || !hourlyUnits ||
      currentUnits.temperature_2m !== "°C" || currentUnits.precipitation !== "mm" ||
      hourlyUnits.temperature_2m !== "°C" || hourlyUnits.precipitation !== "mm" ||
      hourlyUnits.precipitation_probability !== "%") {
    throw new Error("OPEN_METEO_RESPONSE_UNITS_INVALID");
  }
}

function normalizeHourly(value: unknown): HourlyWeather {
  const root = asRecord(value);
  if (!root) throw new Error("OPEN_METEO_HOURLY_RESPONSE_INVALID");
  const times = root.time;
  const weatherCodes = root.weather_code;
  const temperatures = root.temperature_2m;
  const precipitationProbabilities = root.precipitation_probability;
  const precipitations = root.precipitation;
  if (!Array.isArray(times) || !Array.isArray(weatherCodes) ||
      !Array.isArray(temperatures) || !Array.isArray(precipitationProbabilities) || !Array.isArray(precipitations)) {
    throw new Error("OPEN_METEO_HOURLY_RESPONSE_INVALID");
  }
  const lengths = [weatherCodes.length, temperatures.length, precipitationProbabilities.length, precipitations.length];
  if (times.length === 0 || lengths.some((length) => length !== times.length) ||
      !times.every((time) => typeof time === "string" && Number.isFinite(parseTime(time)))) {
    throw new Error("OPEN_METEO_HOURLY_RESPONSE_INVALID");
  }
  return {
    time: times as string[],
    weather_code: weatherCodes as number[],
    temperature_2m: temperatures as number[],
    precipitation_probability: precipitationProbabilities as number[],
    precipitation: precipitations as number[],
  };
}

function nearestHourIndex(times: string[], observedAt: number): number {
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < times.length; index += 1) {
    const candidateDistance = Math.abs(parseTime(times[index]!) - observedAt);
    if (candidateDistance < distance) {
      nearest = index;
      distance = candidateDistance;
    }
  }
  if (distance > 90 * 60 * 1000) throw new Error("OPEN_METEO_HOURLY_TIME_MISMATCH");
  return nearest;
}

function parseTime(value: unknown): number {
  if (typeof value !== "string") throw new Error("OPEN_METEO_RESPONSE_INVALID");
  const timestamp = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) throw new Error("OPEN_METEO_RESPONSE_INVALID");
  return parsed;
}

function requireNumber(value: unknown, reason: string, options: { integer?: boolean; minimum: number; maximum?: number }): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < options.minimum ||
      (options.maximum !== undefined && value > options.maximum) || (options.integer && !Number.isInteger(value))) {
    throw new Error(reason);
  }
  return value;
}

function normalizeProbability(value: unknown): number {
  const percent = requireNumber(value, "OPEN_METEO_HOURLY_RESPONSE_INVALID", { minimum: 0, maximum: 100 });
  return percent / 100;
}

function weatherCodeToCondition(code: number): string {
  if (code === 0) return "clear";
  if ([1, 2].includes(code)) return "partly cloudy";
  if (code === 3) return "overcast";
  if ([45, 48].includes(code)) return "fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([95, 96, 99].includes(code)) return "thunderstorm";
  return "unknown";
}

function isTraceId(value: string): boolean {
  return value.length > 0 && value.length <= 128;
}

function toWeatherError(error: unknown): Error {
  const message = error instanceof Error ? error.message : "OPEN_METEO_REQUEST_FAILED";
  return new Error(/^[A-Z0-9_:-]{1,96}$/.test(message) ? message : "OPEN_METEO_REQUEST_FAILED");
}
