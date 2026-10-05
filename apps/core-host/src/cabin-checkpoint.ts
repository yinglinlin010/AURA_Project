import {
  existsSync,
  readFileSync,
  mkdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  CabinSnapshot,
  CabinTrip,
  CabinPlace,
} from "../../../contracts/protocol/src/cabin.js";
import type { JourneyState } from "../../../contracts/protocol/src/types.js";
import { validPoint } from "../../../adapters/maps/cabin-maps.js";
export interface CabinCheckpoint {
  version: 1;
  count: number;
  trip: CabinTrip;
  journey: JourneyState;
}
export function readCabinCheckpoint(
  path = resolve("data/aura-cabin-state.json"),
): CabinCheckpoint | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const raw = JSON.parse(readFileSync(path, "utf8")) as CabinCheckpoint;
    const validPlace = (p: CabinPlace | null): boolean =>
      p === null ||
      !!(
        p &&
        typeof p.id === "string" &&
        p.id.length <= 256 &&
        typeof p.name === "string" &&
        typeof p.address === "string" &&
        p.provider === "osm" &&
        validPoint(p.latitude, p.longitude)
      );
    if (
      raw.version !== 1 ||
      !Number.isInteger(raw.count) ||
      raw.count < 1 ||
      raw.count > 6 ||
      !raw.trip ||
      !Number.isInteger(raw.trip.version) ||
      raw.trip.version < 0 ||
      !validPlace(raw.trip.origin) ||
      !validPlace(raw.trip.destination) ||
      !Array.isArray(raw.trip.stops) ||
      raw.trip.stops.length > 8 ||
      !raw.trip.stops.every(validPlace) ||
      !Array.isArray(raw.journey?.stops) ||
      raw.journey.stops.length !== raw.trip.stops.length
    )
      return undefined;
    if (raw.trip.route) {
      const r = raw.trip.route;
      if (
        r.provider !== "osm" ||
        !Number.isFinite(r.distanceMeters) ||
        r.distanceMeters < 0 ||
        !Number.isFinite(r.durationSeconds) ||
        r.durationSeconds < 0 ||
        !Array.isArray(r.coordinates) ||
        r.coordinates.length > 30000 ||
        r.coordinates.some(
          (p) => !Array.isArray(p) || !validPoint(p[1], p[0]),
        ) ||
        !Array.isArray(r.order) ||
        r.order.length !== raw.trip.stops.length
      )
        return undefined;
    }
    return raw;
  } catch {
    return undefined;
  }
}
/** Store only approved trip and seat count. Images, speech, captions, votes and keys are excluded. */
export function saveCabinCheckpoint(
  state: CabinSnapshot,
  journey: JourneyState,
  path = resolve("data/aura-cabin-state.json"),
): void {
  const stops = state.trip.stops
    .map((place) =>
      [...journey.stops].reverse().find((stop) => stop.placeId === place.id),
    )
    .filter((stop): stop is JourneyState["stops"][number] => !!stop);
  if (stops.length !== state.trip.stops.length)
    throw new Error("CHECKPOINT_JOURNEY_MISMATCH");
  const data: CabinCheckpoint = {
    version: 1,
    count: state.people.length,
    trip: state.trip,
    journey: { stops },
  };
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + ".tmp";
  writeFileSync(temporary, JSON.stringify(data));
  renameSync(temporary, path);
}
