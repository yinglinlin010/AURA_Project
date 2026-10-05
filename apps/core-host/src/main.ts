import { createCabinCoordinator } from './cabin-coordinator.js';
import { createJourneyAnalysis } from './journey-ai.js';
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertDisplayRegistry } from "../../../contracts/protocol/src/registry.js";
import type { DisplayRegistry } from "../../../contracts/protocol/src/types.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/index.js";
import { SimulatedJourneyRecommendationEvidenceSource } from "../../../packages/core-runtime/src/journey-recommendation-fixture.js";
import { HmiGateway } from "./hmi-gateway.js";
import { GatewayVoiceOutput } from "./gateway-voice-output.js";
import { createIntelligenceStack } from "./intelligence.js";
import { createExternalAdapterStack, hasWeatherConfiguration } from "./external-adapters.js";
import { SqliteJourneyStore } from "../../../adapters/persistence/sqlite-journey-store.js";
import { ACTIVE_JOURNEY_ID, persistJourney, restoreJourney } from "./journey-persistence.js";
import { brandFromEnvironment } from "../../../packages/core-domain/src/brand.js";
import { HttpConnectivityMonitor } from "../../../adapters/connectivity/http-connectivity-monitor.js";
import { SqliteTaskStore } from "../../../adapters/persistence/sqlite-task-store.js";
import type { HostTaskRecoveryEvidenceProvider } from "./task-recovery-evidence.js";
import { configureTaskRecovery } from "./simulated-task-recovery.js";

function loadRegistry(): DisplayRegistry {
  const configPath = process.env.AURA_DISPLAY_REGISTRY ??
    resolve(process.cwd(), "apps/core-host/config/display-registry.json");
  const registry: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  assertDisplayRegistry(registry);
  return registry;
}

export async function main(taskRecoveryEvidenceProvider?: HostTaskRecoveryEvidenceProvider): Promise<void> {
  const brand = brandFromEnvironment(process.env);
  const registry = loadRegistry();
  const recovery = configureTaskRecovery(process.env, taskRecoveryEvidenceProvider);
  if (recovery.diagnostic) process.stdout.write(`${recovery.diagnostic}\n`);
  const journeys = new SqliteJourneyStore();
  const tasks = new SqliteTaskStore(recovery.databasePath === undefined ? {} : { databasePath: recovery.databasePath });
  const revalidateTask = recovery.revalidateTask;
  const runtime = new CoreRuntime({
    registry,
    initialJourney: restoreJourney(journeys.get(ACTIVE_JOURNEY_ID)),
    persistJourney: (journey) => persistJourney(journeys, ACTIVE_JOURNEY_ID, journey),
    initialTasks: tasks.get(),
    persistTasks: (activeTasks) => tasks.save(activeTasks),
    ...(revalidateTask === undefined ? {} : { revalidateTask }),
  });
  // The deterministic demo is deliberately opt-in and always reports simulated fixture evidence.
  const journeyRecommendations = process.env.AURA_SIMULATED_JOURNEY_RECOMMENDATION === "true"
    ? new SimulatedJourneyRecommendationEvidenceSource()
    : undefined;
  // Build server-side providers only when configured; adapter construction makes no requests.
  const externalAdapters = process.env.MAPBOX_ACCESS_TOKEN?.trim() || hasWeatherConfiguration()
    ? createExternalAdapterStack(runtime, undefined, journeys)
    : undefined;
  const audioOutput = new GatewayVoiceOutput((socket, message) => {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  });
  const intelligence = createIntelligenceStack(runtime, audioOutput);
  const journeyAnalysis = createJourneyAnalysis();
  const gateway = new HmiGateway({
    runtime,
    registry,
    cabin: createCabinCoordinator(runtime, registry),
    host: process.env.AURA_HOST ?? "127.0.0.1",
    port: Number(process.env.AURA_PORT ?? 8080),
    path: process.env.AURA_WS_PATH ?? "/ws",
    ...(journeyAnalysis ? { journeyAnalysis } : {}),
    voice: intelligence.voice,
    voiceOutput: audioOutput,
    ...(journeyRecommendations === undefined ? {} : { journeyRecommendations }),
    ...(externalAdapters === undefined ? {} : { places: externalAdapters.places, routing: externalAdapters.routing }),
  });
  const connectivityMonitor = process.env.AURA_CONNECTIVITY_PROBE_URL?.trim()
    ? new HttpConnectivityMonitor({
        endpoint: process.env.AURA_CONNECTIVITY_PROBE_URL.trim(),
        report: (update) => runtime.updateConnectivity(update),
        ...(process.env.AURA_CONNECTIVITY_PROBE_INTERVAL_MS?.trim()
          ? { intervalMs: Number(process.env.AURA_CONNECTIVITY_PROBE_INTERVAL_MS) }
          : {}),
      })
    : undefined;
  await gateway.start();
  connectivityMonitor?.start();
  process.stdout.write(`${brand.productName} Core HMI Gateway listening at ${gateway.address()}\n`);

  const shutdown = async () => {
    try {
      if (connectivityMonitor) await connectivityMonitor.stop();
      await gateway.close();
    } finally {
      if (externalAdapters) externalAdapters.close();
      else journeys.close();
      tasks.close();
      process.exit(0);
    }
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "CORE_HOST_START_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
