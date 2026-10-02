import { MapboxDirectionsAdapter } from "../../../adapters/maps/mapbox-directions-adapter.js";
import { MapboxSearchBoxAdapter } from "../../../adapters/maps/mapbox-search-box-adapter.js";
import { SqliteJourneyStore } from "../../../adapters/persistence/sqlite-journey-store.js";
import { MockWeatherAdapter } from "../../../adapters/weather/mock-weather-adapter.js";
import type { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";
import type { TraceSink } from "../../../packages/core-runtime/src/tracing.js";
import { StructuredTraceSink } from "../../../packages/core-runtime/src/tracing.js";

export interface ExternalAdapterStack {
  places: MapboxSearchBoxAdapter;
  routing: MapboxDirectionsAdapter;
  weather: MockWeatherAdapter;
  journeys: SqliteJourneyStore;
  close(): void;
}

export function createExternalAdapterStack(runtime: CoreRuntime, trace: TraceSink = new StructuredTraceSink()): ExternalAdapterStack {
  const journeys = new SqliteJourneyStore();
  return {
    places: new MapboxSearchBoxAdapter({ sessionId: runtime.sessionId, trace, eventSink: runtime }),
    routing: new MapboxDirectionsAdapter({ sessionId: runtime.sessionId, trace, eventSink: runtime }),
    weather: new MockWeatherAdapter({ sessionId: runtime.sessionId, trace, eventSink: runtime }),
    journeys,
    close: () => journeys.close(),
  };
}
