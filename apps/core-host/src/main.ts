import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertDisplayRegistry } from "../../../contracts/protocol/src/registry.js";
import type { DisplayRegistry } from "../../../contracts/protocol/src/types.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/index.js";
import { HmiGateway } from "./hmi-gateway.js";
import { GatewayVoiceOutput } from "./gateway-voice-output.js";
import { createIntelligenceStack } from "./intelligence.js";
import { createExternalAdapterStack } from "./external-adapters.js";

function loadRegistry(): DisplayRegistry {
  const configPath = process.env.AURA_DISPLAY_REGISTRY ??
    resolve(process.cwd(), "apps/core-host/config/display-registry.json");
  const registry: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  assertDisplayRegistry(registry);
  return registry;
}

async function main(): Promise<void> {
  const registry = loadRegistry();
  const runtime = new CoreRuntime({ registry });
  // Build server-side providers only when configured; adapter construction makes no requests.
  const externalAdapters = process.env.MAPBOX_ACCESS_TOKEN?.trim()
    ? createExternalAdapterStack(runtime)
    : undefined;
  const audioOutput = new GatewayVoiceOutput((socket, message) => {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  });
  const intelligence = createIntelligenceStack(runtime, audioOutput);
  const gateway = new HmiGateway({
    runtime,
    registry,
    host: process.env.AURA_HOST ?? "127.0.0.1",
    port: Number(process.env.AURA_PORT ?? 8080),
    path: process.env.AURA_WS_PATH ?? "/ws",
    voice: intelligence.voice,
    voiceOutput: audioOutput,
    ...(externalAdapters === undefined ? {} : { places: externalAdapters.places, routing: externalAdapters.routing }),
  });
  await gateway.start();
  process.stdout.write(`AURA Core HMI Gateway listening at ${gateway.address()}\n`);

  const shutdown = async () => {
    try {
      await gateway.close();
    } finally {
      externalAdapters?.close();
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
