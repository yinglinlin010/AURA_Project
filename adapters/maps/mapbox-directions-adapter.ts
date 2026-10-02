import { randomUUID } from "node:crypto";
import type { TraceSink } from "../../packages/core-runtime/src/tracing.js";
import { StructuredTraceSink } from "../../packages/core-runtime/src/tracing.js";
import { asRecord, fetchJson, recordIntegrationSignal } from "../shared/http.js";
import type { MapboxGeoPoint } from "./mapbox-search-box-adapter.js";

export interface MapboxRouteInput {
  origin: MapboxGeoPoint;
  destination: MapboxGeoPoint;
  profile?: "mapbox/driving" | "mapbox/driving-traffic" | "mapbox/walking" | "mapbox/cycling";
  alternatives?: boolean;
  signal?: AbortSignal;
  traceId?: string;
}
export interface MapboxComputedRoute {
  provider: "mapbox-directions-v5";
  distanceMeters: number;
  durationSeconds: number;
  source: "api";
  geometry?: unknown;
  observedAt: number;
  freshness: "fresh";
  attribution: "© Mapbox";
  attributionUrl: "https://www.mapbox.com/about/maps/";
  provenance: { provider: "mapbox-directions-v5"; profile: string; observedAt: number };
}
export interface MapboxDirectionsOptions {
  accessToken?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  sessionId?: string;
  trace?: TraceSink;
  now?: () => number;
  eventSink?: Parameters<typeof recordIntegrationSignal>[0];
}

/** Server-side Directions API v5 adapter. Parking and other unavailable data are not inferred here. */
export class MapboxDirectionsAdapter {
  private readonly accessToken: string | undefined;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly timeoutMs: number;
  private readonly sessionId: string;
  private readonly trace: TraceSink;
  private readonly now: () => number;
  private readonly eventSink: MapboxDirectionsOptions["eventSink"];
  constructor(options: MapboxDirectionsOptions = {}) {
    this.accessToken = options.accessToken ?? process.env.MAPBOX_ACCESS_TOKEN;
    this.endpoint = options.endpoint ?? "https://api.mapbox.com/directions/v5";
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.sessionId = options.sessionId ?? "external-adapters";
    this.trace = options.trace ?? new StructuredTraceSink();
    this.now = options.now ?? Date.now;
    this.eventSink = options.eventSink;
  }

  async computeRoute(input: MapboxRouteInput): Promise<MapboxComputedRoute[]> {
    const startedAt = this.now();
    const traceId = input.traceId ?? randomUUID();
    try {
      if (!this.accessToken) throw new Error("MAPBOX_ACCESS_TOKEN_MISSING");
      validatePoint(input.origin); validatePoint(input.destination);
      const profile = input.profile ?? "mapbox/driving-traffic";
      if (!["mapbox/driving", "mapbox/driving-traffic", "mapbox/walking", "mapbox/cycling"].includes(profile)) {
        throw new Error("INVALID_DIRECTIONS_PROFILE");
      }
      const coordinates = `${input.origin.longitude},${input.origin.latitude};${input.destination.longitude},${input.destination.latitude}`;
      const url = new URL(`${this.endpoint}/${profile}/${coordinates}`);
      url.searchParams.set("access_token", this.accessToken);
      url.searchParams.set("overview", "full");
      url.searchParams.set("geometries", "geojson");
      if (input.alternatives !== undefined) url.searchParams.set("alternatives", String(input.alternatives));
      const result = await fetchJson(url, {
        method: "GET", headers: { Accept: "application/json" },
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }, { ...(this.fetchImpl === undefined ? {} : { fetchImpl: this.fetchImpl }), timeoutMs: this.timeoutMs });
      const root = asRecord(result);
      if (!root || root.code !== "Ok" || !Array.isArray(root.routes)) throw new Error("MAPBOX_DIRECTIONS_RESPONSE_INVALID");
      const observedAt = this.now();
      const routes = root.routes.map((route) => normalizeRoute(route, profile, observedAt))
        .filter((route): route is MapboxComputedRoute => route !== undefined);
      recordIntegrationSignal(this.eventSink, "routing.route.computed", {
        requestId: traceId, provider: "mapbox-directions-v5", routeCount: routes.length, observedAt,
      }, traceId, this.now);
      this.recordTrace(traceId, startedAt, "ok");
      return routes;
    } catch (error) {
      const reason = reasonCode(error, "MAPBOX_DIRECTIONS_FAILED");
      this.recordTrace(traceId, startedAt, "error", reason);
      throw new Error(reason);
    }
  }
  private recordTrace(traceId: string, startedAt: number, outcome: "ok" | "error", fallbackReason?: string): void {
    this.trace.record({ sessionId: this.sessionId, traceId, component: "mapbox-directions-adapter", operation: "compute-route",
      startedAt, durationMs: Math.max(0, this.now() - startedAt), outcome,
      ...(fallbackReason === undefined ? {} : { fallbackReason }), rawAudioDropped: true });
  }
}

function normalizeRoute(value: unknown, profile: string, observedAt: number): MapboxComputedRoute | undefined {
  const route = asRecord(value);
  if (!route || typeof route.distance !== "number" || !Number.isFinite(route.distance) || route.distance < 0 ||
      typeof route.duration !== "number" || !Number.isFinite(route.duration) || route.duration < 0) return undefined;
  return {
    provider: "mapbox-directions-v5", distanceMeters: route.distance, durationSeconds: route.duration,
    source: "api", ...(route.geometry === undefined ? {} : { geometry: route.geometry }), observedAt, freshness: "fresh",
    attribution: "© Mapbox", attributionUrl: "https://www.mapbox.com/about/maps/",
    provenance: { provider: "mapbox-directions-v5", profile, observedAt },
  };
}
function validatePoint(point: MapboxGeoPoint): void {
  if (!Number.isFinite(point.latitude) || point.latitude < -90 || point.latitude > 90 ||
      !Number.isFinite(point.longitude) || point.longitude < -180 || point.longitude > 180) throw new Error("INVALID_GEO_POINT");
}
function reasonCode(error: unknown, fallback: string): string {
  return error instanceof Error && /^[A-Z0-9_:-]{1,96}$/.test(error.message) ? error.message : fallback;
}
