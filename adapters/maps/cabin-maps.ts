import type {
  CabinPlace,
  CabinRoute,
} from "../../contracts/protocol/src/cabin.js";
import { fetchJson } from "../shared/http.js";
export interface CabinMaps {
  readonly provider: "google" | "mapbox" | "osm";
  search(query: string, bias?: CabinPlace): Promise<CabinPlace[]>;
  route(
    origin: CabinPlace,
    destination: CabinPlace,
    stops: CabinPlace[],
  ): Promise<CabinRoute>;
  nearby?(origin: CabinPlace): Promise<CabinPlace[]>;
  photos?(places: CabinPlace[]): Promise<CabinPlace[]>;
}
export class GoogleCabinMaps implements CabinMaps {
  readonly provider = "google" as const;
  private photoNames = new Map<string, { name: string; attribution: string }>();
  constructor(
    private readonly key: string,
    private readonly embedKey?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async search(query: string, bias?: CabinPlace): Promise<CabinPlace[]> {
    const raw = await fetchJson(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.key,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.photos",
        },
        body: JSON.stringify({
          textQuery: query,
          pageSize: 5,
          languageCode: "zh-TW",
          ...(bias
            ? {
                locationBias: {
                  circle: {
                    center: {
                      latitude: bias.latitude,
                      longitude: bias.longitude,
                    },
                    radius: 30000,
                  },
                },
              }
            : {}),
        }),
      },
      { fetchImpl: this.fetchImpl },
    );
    const data = raw as {
      places?: Array<{
        id?: string;
        displayName?: { text?: string };
        formattedAddress?: string;
        location?: { latitude: number; longitude: number };
        googleMapsUri?: string;
        photos?: Array<{
          name: string;
          authorAttributions?: Array<{ displayName?: string; uri?: string }>;
        }>;
      }>;
    };
    if (data.places !== undefined && !Array.isArray(data.places))
      throw new Error("MAP_RESPONSE_INVALID");
    const results: CabinPlace[] = [];
    for (const p of data.places ?? []) {
      if (
        !p.id ||
        !p.displayName?.text ||
        !p.location ||
        !validPoint(p.location.latitude, p.location.longitude)
      )
        continue;
      const photo = p.photos?.[0];
      if (photo?.name && /^places\/[^/]+\/photos\/[^/]+$/.test(photo.name))
        this.photoNames.set(p.id, {
          name: photo.name,
          attribution: (photo.authorAttributions ?? [])
            .map((a) => a.displayName ?? "")
            .filter(Boolean)
            .join("、"),
        });
      results.push({
        id: p.id,
        name: p.displayName.text,
        address: p.formattedAddress ?? "",
        latitude: p.location.latitude,
        longitude: p.location.longitude,
        provider: "google",
        observedAt: Date.now(),
        mapsUrl:
          p.googleMapsUri ??
          `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.displayName.text)}&query_place_id=${encodeURIComponent(p.id)}`,
      });
    }
    while (this.photoNames.size > 100)
      this.photoNames.delete(this.photoNames.keys().next().value!);
    return results;
  }
  async photos(places: CabinPlace[]): Promise<CabinPlace[]> {
    return Promise.all(
      places.map(async (place) => {
        const record = this.photoNames.get(place.id);
        if (!record) return place;
        try {
          const url = new URL(
            `https://places.googleapis.com/v1/${record.name}/media`,
          );
          url.searchParams.set("maxWidthPx", "320");
          url.searchParams.set("skipHttpRedirect", "true");
          const media = (await fetchJson(
            url,
            { headers: { "X-Goog-Api-Key": this.key } },
            { fetchImpl: this.fetchImpl },
          )) as { photoUri?: string };
          if (!media.photoUri || new URL(media.photoUri).protocol !== "https:")
            return place;
          const host = new URL(media.photoUri).hostname;
          if (
            !host.endsWith(".googleusercontent.com") &&
            !host.endsWith(".ggpht.com")
          )
            return place;
          const response = await this.fetchImpl(media.photoUri, {
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) return place;
          const data = Buffer.from(await response.arrayBuffer());
          if (data.length > 500000) return place;
          const type =
            response.headers.get("content-type")?.split(";")[0] ?? "";
          if (!["image/jpeg", "image/png", "image/webp"].includes(type))
            return place;
          return {
            ...place,
            photo: `data:${type};base64,${data.toString("base64")}`,
            photoAttribution: record.attribution,
          };
        } catch {
          return place;
        }
      }),
    );
  }
  async route(
    origin: CabinPlace,
    destination: CabinPlace,
    stops: CabinPlace[],
  ): Promise<CabinRoute> {
    const waypoint = (p: CabinPlace) => ({ placeId: p.id });
    const raw = await fetchJson(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.key,
          "X-Goog-FieldMask":
            "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.optimizedIntermediateWaypointIndex",
        },
        body: JSON.stringify({
          origin: waypoint(origin),
          destination: waypoint(destination),
          intermediates: stops.map(waypoint),
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
          optimizeWaypointOrder: stops.length > 1,
          languageCode: "zh-TW",
        }),
      },
      { fetchImpl: this.fetchImpl },
    );
    const r = (
      raw as {
        routes?: Array<{
          distanceMeters: number;
          duration: string;
          polyline?: { encodedPolyline: string };
          optimizedIntermediateWaypointIndex?: number[];
        }>;
      }
    ).routes?.[0];
    if (
      !r ||
      !Number.isFinite(r.distanceMeters) ||
      r.distanceMeters < 0 ||
      !/^\d+(?:\.\d+)?s$/.test(r.duration)
    )
      throw new Error("ROUTE_UNAVAILABLE");
    const indices =
      stops.length > 1
        ? r.optimizedIntermediateWaypointIndex
        : stops.map((_, i) => i);
    if (
      !indices ||
      indices.length !== stops.length ||
      new Set(indices).size !== indices.length ||
      indices.some((i) => !Number.isInteger(i) || i < 0 || i >= stops.length)
    )
      throw new Error("ROUTE_ORDER_INVALID");
    const ordered = indices.map((i) => stops[i]!);
    const params = new URLSearchParams({
      api: "1",
      origin: origin.name,
      origin_place_id: origin.id,
      destination: destination.name,
      destination_place_id: destination.id,
      travelmode: "driving",
    });
    if (ordered.length) {
      params.set("waypoints", ordered.map((p) => p.name).join("|"));
      params.set("waypoint_place_ids", ordered.map((p) => p.id).join("|"));
    }
    const result: CabinRoute = {
      distanceMeters: r.distanceMeters,
      durationSeconds: parseFloat(r.duration),
      coordinates: r.polyline ? decodePolyline(r.polyline.encodedPolyline) : [],
      order: ordered.map((p) => p.id),
      provider: "google",
      observedAt: Date.now(),
      mapsUrl: `https://www.google.com/maps/dir/?${params}`,
    };
    if (this.embedKey) {
      const embed = new URLSearchParams({
        key: this.embedKey,
        origin: `place_id:${origin.id}`,
        destination: `place_id:${destination.id}`,
        mode: "driving",
      });
      if (ordered.length)
        embed.set(
          "waypoints",
          ordered.map((p) => `place_id:${p.id}`).join("|"),
        );
      result.embedUrl = `https://www.google.com/maps/embed/v1/directions?${embed}`;
    }
    return result;
  }
}
export function validPoint(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}
export function decodePolyline(encoded: string): Array<[number, number]> {
  let index = 0,
    lat = 0,
    lng = 0;
  const points: Array<[number, number]> = [];
  const next = () => {
    let shift = 0,
      result = 0,
      b = 0;
    do {
      if (index >= encoded.length || shift > 30)
        throw new Error("POLYLINE_INVALID");
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 31) << shift;
      shift += 5;
    } while (b >= 32);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    if (points.length > 30000) throw new Error("POLYLINE_TOO_LARGE");
    points.push([lng / 1e5, lat / 1e5]);
  }
  return points;
}

export class MapboxCabinMaps implements CabinMaps {
  readonly provider = "mapbox" as const;
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async search(query: string, bias?: CabinPlace): Promise<CabinPlace[]> {
    const url = new URL("https://api.mapbox.com/search/searchbox/v1/forward");
    url.searchParams.set("access_token", this.token);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "5");
    url.searchParams.set("language", "zh");
    if (bias)
      url.searchParams.set("proximity", `${bias.longitude},${bias.latitude}`);
    const raw = (await fetchJson(
      url,
      { method: "GET" },
      { fetchImpl: this.fetchImpl },
    )) as {
      features?: Array<{
        geometry?: { coordinates?: number[] };
        properties?: {
          mapbox_id?: string;
          name?: string;
          name_preferred?: string;
          full_address?: string;
          place_formatted?: string;
        };
      }>;
    };
    if (!Array.isArray(raw.features)) throw new Error("MAP_RESPONSE_INVALID");
    return raw.features.flatMap((feature) => {
      const p = feature.properties;
      const c = feature.geometry?.coordinates;
      if (!p?.mapbox_id || !p.name || !c || !validPoint(c[1]!, c[0]!))
        return [];
      return [
        {
          id: p.mapbox_id,
          name: p.name_preferred ?? p.name,
          address: p.full_address ?? p.place_formatted ?? "",
          longitude: c[0]!,
          latitude: c[1]!,
          provider: "mapbox" as const,
          observedAt: Date.now(),
          mapsUrl: `https://www.openstreetmap.org/?mlat=${c[1]}&mlon=${c[0]}#map=16/${c[1]}/${c[0]}`,
        },
      ];
    });
  }
  async route(
    origin: CabinPlace,
    destination: CabinPlace,
    stops: CabinPlace[],
  ): Promise<CabinRoute> {
    const points = [origin, ...stops, destination];
    if (points.length > 12) throw new Error("TOO_MANY_STOPS");
    const optimized = stops.length > 1;
    const coords = points.map((p) => `${p.longitude},${p.latitude}`).join(";");
    const url = new URL(
      optimized
        ? `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coords}`
        : `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}`,
    );
    url.searchParams.set("access_token", this.token);
    url.searchParams.set("geometries", "geojson");
    url.searchParams.set("overview", "full");
    if (optimized) {
      url.searchParams.set("source", "first");
      url.searchParams.set("destination", "last");
      url.searchParams.set("roundtrip", "false");
    }
    const raw = (await fetchJson(
      url,
      { method: "GET" },
      { fetchImpl: this.fetchImpl },
    )) as {
      code?: string;
      routes?: Array<{
        distance: number;
        duration: number;
        geometry?: { coordinates: Array<[number, number]> };
      }>;
      trips?: Array<{
        distance: number;
        duration: number;
        geometry?: { coordinates: Array<[number, number]> };
      }>;
      waypoints?: Array<{ waypoint_index: number; trips_index: number }>;
    };
    const route = (optimized ? raw.trips : raw.routes)?.[0];
    if (
      raw.code !== "Ok" ||
      !route ||
      !Number.isFinite(route.distance) ||
      !Number.isFinite(route.duration) ||
      route.distance < 0 ||
      route.duration < 0
    )
      throw new Error("ROUTE_UNAVAILABLE");
    let order = stops.map((p) => p.id);
    if (optimized) {
      if (
        !raw.waypoints ||
        raw.waypoints.length !== points.length ||
        raw.waypoints.some((p) => p.trips_index !== 0)
      )
        throw new Error("ROUTE_ORDER_INVALID");
      const sorted = raw.waypoints
        .map((p, i) => ({ index: i, rank: p.waypoint_index }))
        .sort((a, b) => a.rank - b.rank);
      if (
        new Set(sorted.map((p) => p.rank)).size !== points.length ||
        sorted[0]?.index !== 0 ||
        sorted.at(-1)?.index !== points.length - 1
      )
        throw new Error("ROUTE_ORDER_INVALID");
      order = sorted.slice(1, -1).map((p) => points[p.index]!.id);
    }
    return {
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      coordinates: route.geometry?.coordinates ?? [],
      order,
      provider: "mapbox",
      observedAt: Date.now(),
      mapsUrl: destination.mapsUrl,
    };
  }
}

export class OsmCabinMaps implements CabinMaps {
  readonly provider = "osm" as const;
  private readonly searchEndpoint: string;
  private readonly routeEndpoint: string;
  private readonly fetchImpl: typeof fetch;
  private cache = new Map<string, { at: number; places: CabinPlace[] }>();
  private inflight = new Map<string, Promise<CabinPlace[]>>();
  private queue: Promise<unknown> = Promise.resolve();
  private nextRequestAt = 0;
  constructor(
    options: {
      searchEndpoint?: string | undefined;
      routeEndpoint?: string | undefined;
      fetchImpl?: typeof fetch;
    } = {},
  ) {
    this.searchEndpoint =
      options.searchEndpoint ?? "https://nominatim.openstreetmap.org/search";
    this.routeEndpoint =
      options.routeEndpoint ?? "https://router.project-osrm.org";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }
  async search(query: string, bias?: CabinPlace): Promise<CabinPlace[]> {
    const key = `${query.trim()}:${bias?.id ?? ""}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < 3600000)
      return structuredClone(cached.places);
    const existing = this.inflight.get(key);
    if (existing) return existing;
    if (this.inflight.size >= 6) throw new Error("MAP_SEARCH_BUSY");
    const job = this.queue
      .catch(() => {})
      .then(async () => {
        const wait = Math.max(0, this.nextRequestAt - Date.now());
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        this.nextRequestAt = Date.now() + 1100;
        const url = new URL(this.searchEndpoint);
        url.searchParams.set("q", query.trim());
        url.searchParams.set("format", "jsonv2");
        url.searchParams.set("limit", "5");
        url.searchParams.set("addressdetails", "1");
        url.searchParams.set("accept-language", "zh-TW,en");
        if (bias) {
          const lat = 0.4,
            lon = 0.4;
          url.searchParams.set(
            "viewbox",
            `${bias.longitude - lon},${Math.min(90, bias.latitude + lat)},${bias.longitude + lon},${Math.max(-90, bias.latitude - lat)}`,
          );
        }
        const raw = await fetchJson(
          url,
          {
            headers: {
              "User-Agent":
                "AURA-Cabin/1.0 (+https://github.com/yinglinlin010/AURA_Project)",
              Accept: "application/json",
            },
          },
          { fetchImpl: this.fetchImpl, timeoutMs: 12000 },
        );
        if (!Array.isArray(raw)) throw new Error("MAP_RESPONSE_INVALID");
        const places: CabinPlace[] = raw.flatMap((value: unknown) => {
          const p = value as {
            osm_type?: string;
            osm_id?: number;
            lat?: string;
            lon?: string;
            display_name?: string;
            name?: string;
            category?: string;
            type?: string;
          };
          const latitude = Number(p.lat),
            longitude = Number(p.lon);
          if (
            !p.osm_id ||
            !p.osm_type ||
            !p.display_name ||
            !validPoint(latitude, longitude)
          )
            return [];
          const type =
            p.osm_type === "way"
              ? "way"
              : p.osm_type === "relation"
                ? "relation"
                : "node";
          return [
            {
              id: `osm:${type}:${p.osm_id}`,
              name: p.name || p.display_name.split(",")[0]!,
              address: p.display_name,
              latitude,
              longitude,
              provider: "osm" as const,
              ...(p.type
                ? { category: p.type }
                : p.category
                  ? { category: p.category }
                  : {}),
              observedAt: Date.now(),
              mapsUrl: `https://www.openstreetmap.org/${type}/${p.osm_id}`,
            },
          ];
        });
        this.cache.set(key, { at: Date.now(), places });
        while (this.cache.size > 100)
          this.cache.delete(this.cache.keys().next().value!);
        return places;
      });
    this.inflight.set(key, job);
    this.queue = job;
    try {
      return await job;
    } finally {
      this.inflight.delete(key);
    }
  }
  async nearby(origin: CabinPlace): Promise<CabinPlace[]> {
    const key = `nearby:${origin.id}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < 3600000)
      return structuredClone(cached.places);
    const query = `[out:json][timeout:15];nwr["tourism"~"^(attraction|viewpoint|museum|zoo|theme_park)$"](around:20000,${origin.latitude},${origin.longitude});out center tags 25;`;
    const raw = (await fetchJson(
      process.env.AURA_OSM_POI_URL ?? "https://overpass-api.de/api/interpreter",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "AURA-Cabin/1.0 (user-requested attraction search)",
        },
        body: new URLSearchParams({ data: query }).toString(),
      },
      { fetchImpl: this.fetchImpl, timeoutMs: 18000 },
    )) as {
      elements?: Array<{
        type: string;
        id: number;
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
        tags?: Record<string, string>;
      }>;
    };
    if (!Array.isArray(raw.elements)) throw new Error("MAP_RESPONSE_INVALID");
    const places: CabinPlace[] = raw.elements.flatMap((p) => {
      const latitude = p.lat ?? p.center?.lat,
        longitude = p.lon ?? p.center?.lon;
      const name = p.tags?.["name:zh"] ?? p.tags?.name;
      if (
        !name ||
        latitude === undefined ||
        longitude === undefined ||
        !validPoint(latitude, longitude)
      )
        return [];
      return [
        {
          id: `osm:${p.type}:${p.id}`,
          name,
          address: p.tags?.["addr:full"] ?? p.tags?.["addr:city"] ?? "",
          latitude,
          longitude,
          provider: "osm" as const,
          observedAt: Date.now(),
          mapsUrl: `https://www.openstreetmap.org/${p.type}/${p.id}`,
          category: p.tags?.tourism ?? "attraction",
        },
      ];
    });
    this.cache.set(key, { at: Date.now(), places });
    return places;
  }
  async route(
    origin: CabinPlace,
    destination: CabinPlace,
    stops: CabinPlace[],
  ): Promise<CabinRoute> {
    const points = [origin, ...stops, destination];
    if (points.length > 10) throw new Error("TOO_MANY_STOPS");
    for (const point of points)
      if (!validPoint(point.latitude, point.longitude))
        throw new Error("INVALID_GEO_POINT");
    const optimized = stops.length > 1;
    const coords = points.map((p) => `${p.longitude},${p.latitude}`).join(";");
    const url = new URL(
      `/${optimized ? "trip" : "route"}/v1/driving/${coords}`,
      this.routeEndpoint,
    );
    url.searchParams.set("geometries", "geojson");
    url.searchParams.set("overview", "full");
    url.searchParams.set("steps", "true");
    if (optimized) {
      url.searchParams.set("roundtrip", "false");
      url.searchParams.set("source", "first");
      url.searchParams.set("destination", "last");
    }
    const raw = (await fetchJson(
      url,
      {
        headers: {
          "User-Agent": "AURA-Cabin/1.0 (interactive route planning)",
        },
      },
      { fetchImpl: this.fetchImpl, timeoutMs: 15000 },
    )) as {
      code?: string;
      routes?: Array<{
        distance: number;
        duration: number;
        geometry?: { coordinates: Array<[number, number]> };
        legs?: Array<{
          steps: Array<{
            distance: number;
            name?: string;
            maneuver: { type: string; modifier?: string };
          }>;
        }>;
      }>;
      trips?: Array<{
        distance: number;
        duration: number;
        geometry?: { coordinates: Array<[number, number]> };
        legs?: Array<{
          steps: Array<{
            distance: number;
            name?: string;
            maneuver: { type: string; modifier?: string };
          }>;
        }>;
      }>;
      waypoints?: Array<{ waypoint_index: number; trips_index: number }>;
    };
    const route = (optimized ? raw.trips : raw.routes)?.[0];
    if (
      raw.code !== "Ok" ||
      !route ||
      !Number.isFinite(route.distance) ||
      !Number.isFinite(route.duration) ||
      route.distance < 0 ||
      route.duration < 0
    )
      throw new Error("ROUTE_UNAVAILABLE");
    const geometry = route.geometry?.coordinates;
    if (
      !geometry?.length ||
      geometry.some((p) => !Array.isArray(p) || !validPoint(p[1], p[0]))
    )
      throw new Error("ROUTE_GEOMETRY_INVALID");
    let order = stops.map((p) => p.id);
    if (optimized) {
      if (
        !raw.waypoints ||
        raw.waypoints.length !== points.length ||
        raw.waypoints.some((p) => p.trips_index !== 0)
      )
        throw new Error("ROUTE_ORDER_INVALID");
      const sorted = raw.waypoints
        .map((p, i) => ({ index: i, rank: p.waypoint_index }))
        .sort((a, b) => a.rank - b.rank);
      if (
        new Set(sorted.map((p) => p.rank)).size !== points.length ||
        sorted[0]?.index !== 0 ||
        sorted.at(-1)?.index !== points.length - 1
      )
        throw new Error("ROUTE_ORDER_INVALID");
      order = sorted.slice(1, -1).map((p) => points[p.index]!.id);
    }
    let offset = 0;
    const turns: Record<string, string> = {
      left: "左轉",
      right: "右轉",
      straight: "直行",
      "slight left": "向左前方行駛",
      "slight right": "向右前方行駛",
      "sharp left": "向左急轉",
      "sharp right": "向右急轉",
      uturn: "迴轉",
    };
    const steps = (route.legs ?? [])
      .flatMap((leg) => leg.steps ?? [])
      .flatMap((step) => {
        if (
          !Number.isFinite(step.distance) ||
          step.distance < 0 ||
          !step.maneuver?.type
        )
          return [];
        const type = step.maneuver.type;
        const action =
          type === "arrive"
            ? "抵達停靠點"
            : type === "depart"
              ? "出發"
              : type === "roundabout"
                ? "進入圓環"
                : type === "merge"
                  ? "匯入車道"
                  : (turns[step.maneuver.modifier ?? ""] ?? "繼續前進");
        const result = {
          offsetMeters: offset,
          instruction: action + (step.name ? ` · ${step.name}` : ""),
          type,
        };
        offset += step.distance;
        return [result];
      });
    return {
      steps,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      coordinates: geometry,
      order,
      provider: "osm",
      observedAt: Date.now(),
      mapsUrl: `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${origin.latitude},${origin.longitude};${destination.latitude},${destination.longitude}`,
    };
  }
}
