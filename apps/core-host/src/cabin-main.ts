import { readPlaceCache, savePlaceCache } from "./cabin-place-cache.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DisplayRegistry } from "../../../contracts/protocol/src/types.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";
import { HmiGateway } from "./hmi-gateway.js";
import { createCabinCoordinator } from "./cabin-coordinator.js";
import {
  readCabinCheckpoint,
  saveCabinCheckpoint,
} from "./cabin-checkpoint.js";
const registry = JSON.parse(
  readFileSync(
    process.env.AURA_DISPLAY_REGISTRY ??
      "apps/core-host/config/display-registry.json",
    "utf8",
  ),
) as DisplayRegistry;
const path =
  process.env.AURA_CABIN_STATE_FILE ?? resolve("data/aura-cabin-state.json");
const saved = readCabinCheckpoint(path);
const cachePath =
  process.env.AURA_PLACE_CACHE_FILE ?? resolve("data/aura-place-cache.json");
const cache = readPlaceCache(cachePath);
const runtime = new CoreRuntime({
  registry,
  ...(saved ? { initialJourney: saved.journey } : {}),
});
const cabin = createCabinCoordinator(runtime, registry, process.env, {
  initialPlaces: cache.places,
  initialQueries: cache.queries,
  savePlaces: (places, queries) => savePlaceCache(cachePath, places, queries),
  ...(saved ? { initialTrip: saved.trip, initialCount: saved.count } : {}),
  checkpoint: (state) =>
    saveCabinCheckpoint(state, runtime.getState().journey, path),
});
const gateway = new HmiGateway({
  runtime,
  registry,
  cabin,
  host: process.env.AURA_HOST ?? "127.0.0.1",
  port: Number(process.env.AURA_PORT ?? 8198),
  path: "/ws",
});
await gateway.start();
console.log(`AURA functional cabin ready: ${gateway.address()}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => void gateway.close().then(() => process.exit(0)));
