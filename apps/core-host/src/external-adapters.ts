import { MapboxDirectionsAdapter } from "../../../adapters/maps/mapbox-directions-adapter.js";
import { MapboxSearchBoxAdapter } from "../../../adapters/maps/mapbox-search-box-adapter.js";
import { SqliteJourneyStore } from "../../../adapters/persistence/sqlite-journey-store.js";
import { MockWeatherAdapter } from "../../../adapters/weather/mock-weather-adapter.js";
import { OpenMeteoWeatherAdapter } from "../../../adapters/weather/open-meteo-weather-adapter.js";
import type { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";
import type { TraceSink } from "../../../packages/core-runtime/src/tracing.js";
import { StructuredTraceSink } from "../../../packages/core-runtime/src/tracing.js";

export interface ExternalAdapterStack {
  places: MapboxSearchBoxAdapter;
  routing: MapboxDirectionsAdapter;
  /** Live provider seam; no network requests occur until a caller invokes it. */
  weather: OpenMeteoWeatherAdapter;
  /** Explicit fixture adapter; never substituted for a live provider. */
  mockWeather: MockWeatherAdapter;
  journeys: SqliteJourneyStore;
  close(): void;
}

export function createExternalAdapterStack(
  runtime: CoreRuntime,
  trace: TraceSink = new StructuredTraceSink(),
  journeys = new SqliteJourneyStore(),
): ExternalAdapterStack {
  return {
    places: new MapboxSearchBoxAdapter({ sessionId: runtime.sessionId, trace, eventSink: runtime }),
    routing: new MapboxDirectionsAdapter({ sessionId: runtime.sessionId, trace, eventSink: runtime }),
    weather: new OpenMeteoWeatherAdapter({ sessionId: runtime.sessionId, trace, eventSink: runtime }),
    mockWeather: new MockWeatherAdapter({ sessionId: runtime.sessionId, trace, eventSink: runtime }),
    journeys,
    close: () => journeys.close(),
  };
}

export function hasWeatherConfiguration(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OPEN_METEO_CUSTOMER_ENDPOINT?.trim() || env.OPEN_METEO_API_KEY?.trim() || env.OPEN_METEO_NON_COMMERCIAL_OPT_IN === "true");
}
