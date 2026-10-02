import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertDisplayRegistry } from "../../../contracts/protocol/src/registry.js";
import type { DisplayRegistry } from "../../../contracts/protocol/src/types.js";
import { CoreRuntime, IntelligenceRouter, StructuredTraceSink } from "../../../packages/core-runtime/src/index.js";
import { Gemma2BOfflineSimulator } from "../../local/gemma2b-offline-simulator.js";
import { loadScenarioFile, ScenarioRunner } from "./scenario.js";

function loadRegistry(): DisplayRegistry {
  const path = process.env.AURA_DISPLAY_REGISTRY ??
    resolve(process.cwd(), "apps/core-host/config/display-registry.json");
  const registry: unknown = JSON.parse(readFileSync(path, "utf8"));
  assertDisplayRegistry(registry);
  return registry;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scenarioPath = args.find((arg) => !arg.startsWith("--"));
  if (!scenarioPath || args.includes("--help") || args.includes("-h")) {
    process.stdout.write("Usage: npm run scenario -- <scenario.yaml> [--fast | --time-scale <0..1>]\n");
    return;
  }
  const scaleIndex = args.indexOf("--time-scale");
  const timeScale = args.includes("--fast") ? 0 : scaleIndex >= 0 ? Number(args[scaleIndex + 1]) : 1;
  if (!Number.isFinite(timeScale) || timeScale < 0 || timeScale > 1) {
    throw new Error("INVALID_SCENARIO_TIME_SCALE: expected a number from 0 to 1");
  }
  const registry = loadRegistry();
  const runtime = new CoreRuntime({ registry });
  const router = new IntelligenceRouter({
    runtime,
    cloud: {
      modelName: "simulated-cloud-provider",
      async proposeFromText(input) {
        return {
          kind: "SHOW_INFORMATION",
          summary: `Simulated cloud response for: ${input.text}`,
          targetRole: "center",
          priority: "normal",
          requiresConsent: false,
          payload: { provider: "simulated", query: input.text },
        };
      },
    },
    local: new Gemma2BOfflineSimulator(),
    trace: new StructuredTraceSink(() => {}),
  });
  const scenario = loadScenarioFile(scenarioPath);
  const result = await new ScenarioRunner({ runtime, registry, timeScale, router }).run(scenario);
  process.stdout.write(
    `${JSON.stringify({ result, finalState: runtime.getState() }, null, 2)}\n`,
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "SCENARIO_RUN_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
