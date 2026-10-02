import { randomUUID } from "node:crypto";
import type { TraceSink } from "../../packages/core-runtime/src/tracing.js";
import { StructuredTraceSink } from "../../packages/core-runtime/src/tracing.js";
import { asRecord, fetchJson, recordIntegrationSignal, requireText } from "../shared/http.js";

export interface MapboxGeoPoint { latitude: number; longitude: number }

export interface MapboxSearchInput {
  query: string;
  locationBias?: { center: MapboxGeoPoint };
  includedType?: string;
  maxResults?: number;
  language?: string;
  signal?: AbortSignal;
  traceId?: string;
}

export interface MapboxPlaceResult {
  provider: "mapbox-search-box";
  placeId: string;
  displayName: string;
  formattedAddress?: string;
  location?: MapboxGeoPoint;
  types: string[];
  attribution: string;
  source: "api";
  observedAt: number;
  freshness: "fresh";
  provenance: { provider: "mapbox-search-box"; observedAt: number; use: "temporary" };
}

export interface MapboxSearchBoxOptions {
  accessToken?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  sessionId?: string;
  trace?: TraceSink;
  now?: () => number;
  eventSink?: Parameters<typeof recordIntegrationSignal>[0];
}

/** Server-side, non-persistent Search Box /forward adapter. Do not cache or store its results. */
export class MapboxSearchBoxAdapter {
  private readonly accessToken: string | undefined;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly timeoutMs: number;
  private readonly sessionId: string;
  private readonly trace: TraceSink;
  private readonly now: () => number;
  private readonly eventSink: MapboxSearchBoxOptions["eventSink"];

  constructor(options: MapboxSearchBoxOptions = {}) {
    this.accessToken = options.accessToken ?? process.env.MAPBOX_ACCESS_TOKEN;
    this.endpoint = options.endpoint ?? "https://api.mapbox.com/search/searchbox/v1/forward";
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.sessionId = options.sessionId ?? "external-adapters";
    this.trace = options.trace ?? new StructuredTraceSink();
    this.now = options.now ?? Date.now;
    this.eventSink = options.eventSink;
  }

  async search(input: MapboxSearchInput): Promise<MapboxPlaceResult[]> {
    const startedAt = this.now();
    const traceId = input.traceId ?? randomUUID();
    try {
      if (!this.accessToken) throw new Error("MAPBOX_ACCESS_TOKEN_MISSING");
      const query = requireText(input.query, "PLACE_QUERY_REQUIRED");
      if (query.length > 256) throw new Error("PLACE_QUERY_TOO_LONG");
      if (input.maxResults !== undefined && (!Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 10)) {
        throw new Error("INVALID_PLACE_RESULT_LIMIT");
      }
      if (input.locationBias) validatePoint(input.locationBias.center);
      const url = new URL(this.endpoint);
      url.searchParams.set("q", query);
      url.searchParams.set("access_token", this.accessToken);
      if (input.maxResults !== undefined) url.searchParams.set("limit", String(input.maxResults));
      if (input.includedType !== undefined) url.searchParams.set("types", requireText(input.includedType, "INVALID_PLACE_TYPE"));
      if (input.language !== undefined) url.searchParams.set("language", requireText(input.language, "INVALID_LANGUAGE"));
      if (input.locationBias) url.searchParams.set("proximity", `${input.locationBias.center.longitude},${input.locationBias.center.latitude}`);

      const result = await fetchJson(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }, { ...(this.fetchImpl === undefined ? {} : { fetchImpl: this.fetchImpl }), timeoutMs: this.timeoutMs });
      const root = asRecord(result);
      if (!root || !Array.isArray(root.features) || typeof root.attribution !== "string" || !root.attribution.trim() || root.attribution.length > 512) throw new Error("MAPBOX_SEARCH_RESPONSE_INVALID");
      const observedAt = this.now();
      const places = root.features.map((feature) => normalizeFeature(feature, root.attribution as string, observedAt))
        .filter((place): place is MapboxPlaceResult => place !== undefined);
      recordIntegrationSignal(this.eventSink, "places.search.completed", {
        requestId: traceId, provider: "mapbox-search-box", resultCount: places.length, observedAt,
      }, traceId, this.now);
      this.recordTrace(traceId, startedAt, "ok");
      return places;
    } catch (error) {
      const reason = reasonCode(error, "MAPBOX_SEARCH_FAILED");
      this.recordTrace(traceId, startedAt, "error", reason);
      throw new Error(reason);
    }
  }

  private recordTrace(traceId: string, startedAt: number, outcome: "ok" | "error", fallbackReason?: string): void {
    this.trace.record({ sessionId: this.sessionId, traceId, component: "mapbox-search-box-adapter", operation: "forward-search",
      startedAt, durationMs: Math.max(0, this.now() - startedAt), outcome,
      ...(fallbackReason === undefined ? {} : { fallbackReason }), rawAudioDropped: true });
  }
}

function normalizeFeature(value: unknown, attribution: string, observedAt: number): MapboxPlaceResult | undefined {
  const feature = asRecord(value);
  const properties = asRecord(feature?.properties);
  if (!properties || typeof properties.mapbox_id !== "string" || properties.mapbox_id.length === 0 || properties.mapbox_id.length > 256) return undefined;
  const geometry = asRecord(feature?.geometry);
  const coordinates = asRecord(properties.coordinates);
  const rawCoordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : undefined;
  const longitude = typeof coordinates?.longitude === "number" ? coordinates.longitude : rawCoordinates?.[0];
  const latitude = typeof coordinates?.latitude === "number" ? coordinates.latitude : rawCoordinates?.[1];
  const location = typeof longitude === "number" && typeof latitude === "number" && validPoint({ longitude, latitude })
    ? { longitude, latitude }
    : undefined;
  const name = typeof properties.name_preferred === "string" ? properties.name_preferred : properties.name;
  if (typeof name === "string" && name.length > 256) return undefined;
  if (typeof properties.full_address === "string" && properties.full_address.length > 512) return undefined;
  const categories = Array.isArray(properties.poi_category)
    ? properties.poi_category.filter((category): category is string => typeof category === "string" && category.length <= 128).slice(0, 31)
    : [];
  return {
    provider: "mapbox-search-box",
    placeId: properties.mapbox_id,
    displayName: typeof name === "string" ? name : "Unnamed place",
    ...(typeof properties.full_address === "string" ? { formattedAddress: properties.full_address } : {}),
    ...(location === undefined ? {} : { location }),
    types: [...(typeof properties.feature_type === "string" && properties.feature_type.length <= 128 ? [properties.feature_type] : []), ...categories],
    attribution,
    source: "api",
    observedAt,
    freshness: "fresh",
    provenance: { provider: "mapbox-search-box", observedAt, use: "temporary" },
  };
}

function validPoint(point: MapboxGeoPoint): boolean {
  return Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90 &&
    Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180;
}
function validatePoint(point: MapboxGeoPoint): void { if (!validPoint(point)) throw new Error("INVALID_GEO_POINT"); }
function reasonCode(error: unknown, fallback: string): string {
  return error instanceof Error && /^[A-Z0-9_:-]{1,96}$/.test(error.message) ? error.message : fallback;
}
