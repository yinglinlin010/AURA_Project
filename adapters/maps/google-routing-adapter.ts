import { randomUUID } from "node:crypto";
import type { TraceSink } from "../../packages/core-runtime/src/tracing.js";
import { StructuredTraceSink } from "../../packages/core-runtime/src/tracing.js";
import { asRecord, fetchJson, recordIntegrationSignal } from "../shared/http.js";
import type { GeoPoint } from "./google-places-adapter.js";

export type RouteLocation =
  | { placeId: string }
  | { point: GeoPoint };

export interface ComputeRouteInput {
  origin: RouteLocation;
  destination: RouteLocation;
  avoidTolls?: boolean;
  avoidHighways?: boolean;
  avoidFerries?: boolean;
  trafficAware?: boolean;
  signal?: AbortSignal;
  traceId?: string;
}

export interface ComputedRoute {
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline?: string;
}

export interface GoogleRoutingAdapterOptions {
  sessionId?: string;
  apiKey?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  trace?: TraceSink;
  now?: () => number;
  eventSink?: Parameters<typeof recordIntegrationSignal>[0];
}

export class GoogleRoutingAdapter {
  private readonly sessionId: string;
  private readonly apiKey: string | undefined;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly timeoutMs: number;
  private readonly trace: TraceSink;
  private readonly now: () => number;
  private readonly eventSink: GoogleRoutingAdapterOptions["eventSink"];

  constructor(options: GoogleRoutingAdapterOptions = {}) {
    this.sessionId = options.sessionId ?? "external-adapters";
    this.apiKey = options.apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
    this.endpoint = options.endpoint ?? "https://routes.googleapis.com/directions/v2:computeRoutes";
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.trace = options.trace ?? new StructuredTraceSink();
    this.now = options.now ?? Date.now;
    this.eventSink = options.eventSink;
  }

  async computeRoute(input: ComputeRouteInput): Promise<ComputedRoute[]> {
    const startedAt = this.now();
    const traceId = input.traceId ?? randomUUID();
    try {
      if (!this.apiKey) throw new Error("GOOGLE_MAPS_API_KEY_MISSING");
      const result = await fetchJson(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
        },
        body: JSON.stringify({
          origin: toWaypoint(input.origin),
          destination: toWaypoint(input.destination),
          travelMode: "DRIVE",
          ...(input.trafficAware === false ? {} : { routingPreference: "TRAFFIC_AWARE" }),
          computeAlternativeRoutes: false,
          routeModifiers: {
            avoidTolls: input.avoidTolls ?? false,
            avoidHighways: input.avoidHighways ?? false,
            avoidFerries: input.avoidFerries ?? false,
          },
          units: "METRIC",
        }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }, {
        ...(this.fetchImpl === undefined ? {} : { fetchImpl: this.fetchImpl }),
        timeoutMs: this.timeoutMs,
      });
      const root = asRecord(result);
      if (!root || (root.routes !== undefined && !Array.isArray(root.routes))) throw new Error("ROUTES_RESPONSE_INVALID");
      const routes = (root.routes ?? []).map(normalizeRoute).filter((route): route is ComputedRoute => route !== undefined);
      recordIntegrationSignal(this.eventSink, "routing.route.computed", {
        requestId: traceId,
        routeCount: routes.length,
        observedAt: this.now(),
      }, traceId, this.now);
      this.recordTrace(traceId, startedAt, "ok");
      return routes;
    } catch (error) {
      const reason = reasonCode(error, "ROUTE_COMPUTE_FAILED");
      this.recordTrace(traceId, startedAt, "error", reason);
      throw new Error(reason);
    }
  }

  private recordTrace(traceId: string, startedAt: number, outcome: "ok" | "error", fallbackReason?: string): void {
    this.trace.record({
      sessionId: this.sessionId,
      traceId,
      component: "google-routing-adapter",
      operation: "compute-route",
      startedAt,
      durationMs: Math.max(0, this.now() - startedAt),
      outcome,
      ...(fallbackReason === undefined ? {} : { fallbackReason }),
      rawAudioDropped: true,
    });
  }
}

function toWaypoint(location: RouteLocation): Record<string, unknown> {
  if ("placeId" in location) {
    if (location.placeId.trim().length === 0) throw new Error("INVALID_PLACE_ID");
    return { placeId: location.placeId };
  }
  const { latitude, longitude } = location.point;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error("INVALID_GEO_POINT");
  }
  return { location: { latLng: { latitude, longitude } } };
}

function normalizeRoute(value: unknown): ComputedRoute | undefined {
  const route = asRecord(value);
  if (!route || typeof route.distanceMeters !== "number" || !Number.isFinite(route.distanceMeters) || route.distanceMeters < 0) return undefined;
  const seconds = typeof route.duration === "string" ? Number.parseFloat(route.duration.replace(/s$/, "")) : NaN;
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  const polyline = asRecord(route.polyline)?.encodedPolyline;
  return {
    distanceMeters: route.distanceMeters,
    durationSeconds: seconds,
    ...(typeof polyline === "string" ? { encodedPolyline: polyline } : {}),
  };
}

function reasonCode(error: unknown, fallback: string): string {
  return error instanceof Error && /^[A-Z0-9_:-]{1,96}$/.test(error.message) ? error.message : fallback;
}
