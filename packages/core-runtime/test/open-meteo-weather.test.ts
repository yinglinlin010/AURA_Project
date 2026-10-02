import assert from "node:assert/strict";
import test from "node:test";
import { OpenMeteoWeatherAdapter } from "../../../adapters/weather/open-meteo-weather-adapter.js";

const now = Date.UTC(2026, 9, 3, 17, 35);
const currentHour = Date.UTC(2026, 9, 3, 17);

function forecastPayload(startAt = Date.UTC(2026, 9, 3, 0), count = 48): Record<string, unknown> {
  const time = Array.from({ length: count }, (_, index) => new Date(startAt + index * 60 * 60 * 1000).toISOString().slice(0, 16));
  return {
    latitude: 48.14,
    longitude: 11.58,
    current_units: { temperature_2m: "°C", precipitation: "mm" },
    current: { time: new Date(now).toISOString().slice(0, 16), weather_code: 2, temperature_2m: 18, precipitation: 0 },
    hourly_units: { temperature_2m: "°C", precipitation: "mm", precipitation_probability: "%" },
    hourly: {
      time,
      weather_code: time.map((_, index) => index % 100),
      temperature_2m: time.map((_, index) => 10 + index),
      precipitation_probability: time.map((_, index) => index % 101),
      precipitation: time.map((_, index) => index / 10),
    },
  };
}

function configuredAdapter(payload: Record<string, unknown>, onRequest?: (url: URL) => void): OpenMeteoWeatherAdapter {
  return new OpenMeteoWeatherAdapter({
    endpoint: "https://customer-api.open-meteo.com/v1/forecast",
    apiKey: "test-key",
    now: () => now,
    fetchImpl: async (input) => {
      onRequest?.(new URL(input.toString()));
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
}

test("hourly forecast begins at the current UTC hour and returns the requested future window", async () => {
  let requestUrl: URL | undefined;
  const adapter = configuredAdapter(forecastPayload(), (url) => { requestUrl = url; });
  const result = await adapter.getForecast({ latitude: 48.14, longitude: 11.58 }, 5);

  assert.equal(result.length, 5);
  assert.equal(Date.parse(result[0]!.validAt!), currentHour);
  assert.equal(Date.parse(result[4]!.validAt!), currentHour + 4 * 60 * 60 * 1000);
  assert.ok(result.every((item) => Date.parse(item.validAt!) >= currentHour));
  assert.ok(result.every((item) => item.observedAt === new Date(now).toISOString()));
  assert.equal(requestUrl?.searchParams.get("forecast_days"), "2");
});

test("current conditions preserve units, attribution, and API provenance", async () => {
  const adapter = configuredAdapter(forecastPayload());
  const result = await adapter.getCurrentConditions({ latitude: 48.14, longitude: 11.58 });

  assert.equal(result.temperatureCelsius, 18);
  assert.equal(result.condition, "partly cloudy");
  assert.equal(result.precipitationMillimeters, 0);
  assert.equal(result.precipitationProbability, 0.18);
  assert.equal(result.source, "api");
  assert.equal(result.freshness, "fresh");
  assert.equal(result.attribution, "© Open-Meteo");
  assert.equal(result.provenance?.provider, "open-meteo-customer-api");
});

test("forecast fails closed when the response does not contain the requested future window", async () => {
  const onlyElapsedHours = forecastPayload(Date.UTC(2026, 9, 2, 0), 24);
  const adapter = configuredAdapter(onlyElapsedHours);
  await assert.rejects(
    adapter.getForecast({ latitude: 48.14, longitude: 11.58 }, 1),
    { message: "OPEN_METEO_FORECAST_WINDOW_INCOMPLETE" },
  );
});

test("forecast fails closed when future hourly slots are discontinuous", async () => {
  const payload = forecastPayload();
  const hourly = payload.hourly as { time: string[] };
  hourly.time[19] = new Date(currentHour + 3 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const adapter = configuredAdapter(payload);

  await assert.rejects(
    adapter.getForecast({ latitude: 48.14, longitude: 11.58 }, 5),
    { message: "OPEN_METEO_FORECAST_WINDOW_INCOMPLETE" },
  );
});

test("unconfigured weather adapter abstains without making a network request", async () => {
  let requestCount = 0;
  const adapter = new OpenMeteoWeatherAdapter({
    now: () => now,
    fetchImpl: async () => {
      requestCount += 1;
      return new Response("{}", { status: 200 });
    },
  });

  assert.deepEqual(adapter.availability(), { available: false, mode: "unavailable", reasonCode: "OPEN_METEO_NOT_CONFIGURED" });
  await assert.rejects(adapter.getForecast({ latitude: 48.14, longitude: 11.58 }, 1), { message: "OPEN_METEO_NOT_CONFIGURED" });
  assert.equal(requestCount, 0);
});
