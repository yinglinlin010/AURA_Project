import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ContextSignal, SignalFreshness, SignalSource } from "../../contracts/protocol/src/types.js";
import type { TraceSink } from "../../packages/core-runtime/src/tracing.js";
import { StructuredTraceSink } from "../../packages/core-runtime/src/tracing.js";
import { asRecord, recordIntegrationSignal } from "../shared/http.js";

export interface WeatherObservation {
  location: string;
  observedAt: string;
  validAt?: string;
  retrievedAt?: string;
  temperatureCelsius: number;
  condition: string;
  precipitationProbability: number;
  precipitationMillimeters?: number;
  weatherCode?: number;
  provider?: string;
  source?: SignalSource;
  freshness?: SignalFreshness;
  attribution?: string;
  attributionUrl?: string;
  provenance?: { provider: string; observedAt: string; validAt?: string; source: SignalSource };
}

export interface MockWeatherAdapterOptions {
  sessionId?: string;
  fixturePath?: string;
  fixture?: unknown;
  trace?: TraceSink;
  now?: () => number;
  eventSink?: Parameters<typeof recordIntegrationSignal>[0];
}

/** Reads a local JSON fixture so weather calls require no outside service or credentials. */
export class MockWeatherAdapter {
  private readonly sessionId: string;
  private readonly fixture: unknown;
  private readonly trace: TraceSink;
  private readonly now: () => number;
  private readonly eventSink: MockWeatherAdapterOptions["eventSink"];

  constructor(options: MockWeatherAdapterOptions = {}) {
    this.sessionId = options.sessionId ?? "external-adapters";
    const fixturePath = options.fixturePath ?? resolve(process.cwd(), "adapters/weather/fixtures/current-conditions.json");
    this.fixture = options.fixture ?? JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
    this.trace = options.trace ?? new StructuredTraceSink();
    this.now = options.now ?? Date.now;
    this.eventSink = options.eventSink;
  }

  async getCurrentConditions(traceId: string): Promise<WeatherObservation> {
    const startedAt = this.now();
    try {
      const observation = normalizeObservation(this.fixture);
      recordIntegrationSignal(this.eventSink, "weather.observation.received", observation, traceId, this.now, "derived");
      this.trace.record({
        sessionId: this.sessionId,
        traceId,
        component: "mock-weather-adapter",
        operation: "get-current-conditions",
        startedAt,
        durationMs: Math.max(0, this.now() - startedAt),
        outcome: "ok",
        model: "local-json-fixture",
        rawAudioDropped: true,
      });
      return observation;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "WEATHER_FIXTURE_INVALID";
      this.trace.record({
        sessionId: this.sessionId,
        traceId,
        component: "mock-weather-adapter",
        operation: "get-current-conditions",
        startedAt,
        durationMs: Math.max(0, this.now() - startedAt),
        outcome: "error",
        fallbackReason: reason,
        rawAudioDropped: true,
      });
      throw new Error(reason);
    }
  }
}

function normalizeObservation(value: unknown): WeatherObservation {
  const record = asRecord(value);
  if (!record || typeof record.location !== "string" || typeof record.observedAt !== "string" ||
      typeof record.temperatureCelsius !== "number" || !Number.isFinite(record.temperatureCelsius) ||
      typeof record.condition !== "string" || typeof record.precipitationProbability !== "number" ||
      !Number.isFinite(record.precipitationProbability) || record.precipitationProbability < 0 ||
      record.precipitationProbability > 1 || !Number.isFinite(Date.parse(record.observedAt))) {
    throw new Error("WEATHER_FIXTURE_INVALID");
  }
  return {
    location: record.location,
    observedAt: record.observedAt,
    temperatureCelsius: record.temperatureCelsius,
    condition: record.condition,
    precipitationProbability: record.precipitationProbability,
  };
}

export function weatherAsContextSignal(observation: WeatherObservation, signalId: string): ContextSignal<WeatherObservation> {
  return {
    signalId,
    type: "weather.observation",
    value: observation,
    source: observation.source ?? "derived",
    timestamp: Date.parse(observation.observedAt),
    ...(observation.freshness === undefined ? {} : { freshness: observation.freshness }),
  };
}
