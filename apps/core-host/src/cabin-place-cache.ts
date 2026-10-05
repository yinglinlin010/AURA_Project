import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";
import type { CabinPlace } from "../../../contracts/protocol/src/cabin.js";
export interface CabinPlaceCache {
  version: 1;
  places: CabinPlace[];
  queries: Record<string, string[]>;
}
export function readPlaceCache(path: string): CabinPlaceCache {
  const empty: CabinPlaceCache = { version: 1, places: [], queries: {} };
  try {
    if (!existsSync(path) || statSync(path).size > 5000000) return empty;
    const raw = JSON.parse(readFileSync(path, "utf8")) as CabinPlaceCache;
    if (
      raw.version !== 1 ||
      !Array.isArray(raw.places) ||
      !raw.queries ||
      typeof raw.queries !== "object"
    )
      return empty;
    const places = raw.places
      .filter(
        (p) =>
          p &&
          typeof p.id === "string" &&
          p.id.length <= 256 &&
          typeof p.name === "string" &&
          p.name.length <= 500 &&
          typeof p.address === "string" &&
          p.address.length <= 2000 &&
          p.provider === "osm" &&
          Number.isFinite(p.latitude) &&
          Math.abs(p.latitude) <= 90 &&
          Number.isFinite(p.longitude) &&
          Math.abs(p.longitude) <= 180 &&
          Number.isFinite(p.observedAt) &&
          p.observedAt >= 0 &&
          typeof p.mapsUrl === "string" &&
          (p.mapsUrl === "https://www.openstreetmap.org" ||
            p.mapsUrl.startsWith("https://www.openstreetmap.org/")),
      )
      .slice(-500);
    const ids = new Set(places.map((p) => p.id));
    const queries = Object.fromEntries(
      Object.entries(raw.queries)
        .filter(([query, value]) => query.length <= 300 && Array.isArray(value))
        .slice(-200)
        .map(([query, value]) => [
          query,
          value
            .filter((id) => typeof id === "string" && ids.has(id))
            .slice(0, 5),
        ]),
    );
    return { version: 1, places, queries };
  } catch {
    return empty;
  }
}
/** Persist public POI facts only, excluding photos, recordings, GPS positions and keys. */
export function savePlaceCache(
  path: string,
  places: CabinPlace[],
  queries: Record<string, string[]>,
): void {
  const saved = places
    .filter((p) => p.provider === "osm")
    .slice(-500)
    .map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address,
      latitude: p.latitude,
      longitude: p.longitude,
      provider: p.provider,
      observedAt: p.observedAt,
      mapsUrl: p.mapsUrl,
      ...(p.category ? { category: p.category } : {}),
    }));
  const ids = new Set(saved.map((p) => p.id));
  const filtered = Object.fromEntries(
    Object.entries(queries)
      .slice(-200)
      .map(([query, value]) => [
        query,
        value.filter((id) => ids.has(id)).slice(0, 5),
      ]),
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path + ".tmp",
    JSON.stringify({ version: 1, places: saved, queries: filtered }),
  );
  renameSync(path + ".tmp", path);
}
