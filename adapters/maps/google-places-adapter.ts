import { randomUUID } from "node:crypto";
import type { TraceSink } from "../../packages/core-runtime/src/tracing.js";
import { StructuredTraceSink } from "../../packages/core-runtime/src/tracing.js";
import { asRecord, fetchJson, recordIntegrationSignal, requireText } from "../shared/http.js";

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface PlaceSearchInput {
  query: string;
  locationBias?: { center: GeoPoint; radiusMeters: number };
  includedType?: string;
  maxResults?: number;
  languageCode?: string;
  signal?: AbortSignal;
  traceId?: string;
}

export interface PlaceCandidate {
  placeId: string;
  displayName: string;
  formattedAddress?: string;
  location?: GeoPoint;
  types: string[];
  googleMapsUri?: string;
  thirdPartyAttributions: Array<{ provider: string; providerUri?: string }>;
  requiresGoogleMapsAttribution: true;
}

export interface GooglePlacesAdapterOptions {
  sessionId?: string;
  apiKey?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  trace?: TraceSink;
  now?: () => number;
  eventSink?: Parameters<typeof recordIntegrationSignal>[0];
}

export class GooglePlacesAdapter {
  private readonly sessionId: string;
  private readonly apiKey: string | undefined;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly timeoutMs: number;
  private readonly trace: TraceSink;
  private readonly now: () => number;
  private readonly eventSink: GooglePlacesAdapterOptions["eventSink"];

  constructor(options: GooglePlacesAdapterOptions = {}) {
    this.sessionId = options.sessionId ?? "external-adapters";
    this.apiKey = options.apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
    this.endpoint = options.endpoint ?? "https://places.googleapis.com/v1/places:searchText";
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.trace = options.trace ?? new StructuredTraceSink();
    this.now = options.now ?? Date.now;
    this.eventSink = options.eventSink;
  }

  async searchText(input: PlaceSearchInput): Promise<PlaceCandidate[]> {
    const startedAt = this.now();
    const traceId = input.traceId ?? randomUUID();
    try {
      if (!this.apiKey) throw new Error("GOOGLE_MAPS_API_KEY_MISSING");
      const query = requireText(input.query, "PLACE_QUERY_REQUIRED");
      if (query.length > 1_000) throw new Error("PLACE_QUERY_TOO_LONG");
      if (input.maxResults !== undefined && (!Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 20)) {
        throw new Error("INVALID_PLACE_RESULT_LIMIT");
      }
      if (input.locationBias) validateGeoPoint(input.locationBias.center);
      const body = {
        textQuery: query,
        ...(input.maxResults === undefined ? {} : { pageSize: input.maxResults }),
        ...(input.includedType === undefined ? {} : { includedType: input.includedType }),
        ...(input.languageCode === undefined ? {} : { languageCode: input.languageCode }),
        ...(input.locationBias === undefined ? {} : {
          locationBias: {
            circle: {
              center: input.locationBias.center,
              radius: validRadius(input.locationBias.radiusMeters),
            },
          },
        }),
      };
      const result = await fetchJson(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.googleMapsUri,places.attributions",
        },
        body: JSON.stringify(body),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }, {
        ...(this.fetchImpl === undefined ? {} : { fetchImpl: this.fetchImpl }),
        timeoutMs: this.timeoutMs,
      });
      const root = asRecord(result);
      if (!root || (root.places !== undefined && !Array.isArray(root.places))) throw new Error("PLACES_RESPONSE_INVALID");
      const places = (root.places ?? []).map(normalizePlace).filter((place): place is PlaceCandidate => place !== undefined);
      recordIntegrationSignal(this.eventSink, "places.search.completed", {
        requestId: traceId,
        resultCount: places.length,
        placeIds: places.map((place) => place.placeId),
        observedAt: this.now(),
      }, traceId, this.now);
      this.recordTrace(traceId, startedAt, "ok");
      return places;
    } catch (error) {
      const reason = reasonCode(error, "PLACES_SEARCH_FAILED");
      this.recordTrace(traceId, startedAt, "error", reason);
      throw new Error(reason);
    }
  }

  private recordTrace(traceId: string, startedAt: number, outcome: "ok" | "error", fallbackReason?: string): void {
    this.trace.record({
      sessionId: this.sessionId,
      traceId,
      component: "google-places-adapter",
      operation: "search-text",
      startedAt,
      durationMs: Math.max(0, this.now() - startedAt),
      outcome,
      ...(fallbackReason === undefined ? {} : { fallbackReason }),
      rawAudioDropped: true,
    });
  }
}

function normalizePlace(value: unknown): PlaceCandidate | undefined {
  const place = asRecord(value);
  if (!place || typeof place.id !== "string" || place.id.length === 0) return undefined;
  const displayName = asRecord(place.displayName)?.text;
  const location = asRecord(place.location);
  const normalizedLocation = location && typeof location.latitude === "number" && typeof location.longitude === "number"
    ? { latitude: location.latitude, longitude: location.longitude }
    : undefined;
  return {
    placeId: place.id,
    displayName: typeof displayName === "string" ? displayName : "Unnamed place",
    ...(typeof place.formattedAddress === "string" ? { formattedAddress: place.formattedAddress } : {}),
    ...(normalizedLocation === undefined ? {} : { location: normalizedLocation }),
    types: Array.isArray(place.types) ? place.types.filter((type): type is string => typeof type === "string") : [],
    ...(typeof place.googleMapsUri === "string" ? { googleMapsUri: place.googleMapsUri } : {}),
    thirdPartyAttributions: Array.isArray(place.attributions)
      ? place.attributions.flatMap((entry) => {
          const attribution = asRecord(entry);
          if (!attribution || typeof attribution.provider !== "string") return [];
          return [{
            provider: attribution.provider,
            ...(typeof attribution.providerUri === "string" ? { providerUri: attribution.providerUri } : {}),
          }];
        })
      : [],
    requiresGoogleMapsAttribution: true,
  };
}

function validateGeoPoint(point: GeoPoint): void {
  if (!Number.isFinite(point.latitude) || point.latitude < -90 || point.latitude > 90 ||
      !Number.isFinite(point.longitude) || point.longitude < -180 || point.longitude > 180) {
    throw new Error("INVALID_GEO_POINT");
  }
}

function validRadius(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 50_000) throw new Error("INVALID_LOCATION_BIAS_RADIUS");
  return value;
}

function reasonCode(error: unknown, fallback: string): string {
  return error instanceof Error && /^[A-Z0-9_:-]{1,96}$/.test(error.message) ? error.message : fallback;
}
