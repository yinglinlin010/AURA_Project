import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertDisplayRegistry } from "../../../contracts/protocol/src/registry.js";
import type { DisplayRegistry } from "../../../contracts/protocol/src/types.js";
import { CoreRuntime, IntelligenceRouter, StructuredTraceSink } from "../../../packages/core-runtime/src/index.js";
import { Gemma2BOfflineSimulator } from "../../local/gemma2b-offline-simulator.js";
import { createScenarioVoiceHarness } from "./voice-harness.js";
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
  const scenario = loadScenarioFile(scenarioPath);
  const resumeFixtures = new Map(scenario.timeline.filter((step) => step.kind === "task.resume").map((step) => [step.taskId, step.revalidation]));
  // This test-only callback exposes scenario fixture claims to the same runtime
  // used by the router. It is never imported by apps/core-host or vehicle adapters.
  const runtime = new CoreRuntime({
    registry,
    revalidateTask(task) {
      const fixture = resumeFixtures.get(task.taskId);
      if (!fixture || fixture.reality !== "simulated" || !fixture.sourceLabel.startsWith("scenario-fixture:")) {
        return { candidateFresh: false, capabilityConfirmed: false, authorizationCurrent: false, priorActionOutcomeKnown: false };
      }
      return {
        candidateFresh: fixture.candidateFresh,
        capabilityConfirmed: fixture.capabilityConfirmed,
        authorizationCurrent: fixture.authorizationCurrent,
        priorActionOutcomeKnown: fixture.priorActionOutcomeKnown,
      };
    },
  });
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
  const hasVoiceSteps = scenario.timeline.some((step) => step.kind.startsWith("voice."));
  const voiceHarness = hasVoiceSteps ? createScenarioVoiceHarness(runtime, router) : undefined;
  try {
    const result = await new ScenarioRunner({
      runtime,
      registry,
      timeScale,
      router,
      ...(voiceHarness === undefined ? {} : { voice: voiceHarness.voice }),
    }).run(scenario);
    process.stdout.write(
      `${JSON.stringify({
        ...(voiceHarness === undefined ? {} : {
          voiceSimulation: "mock provider path; no wake-word detection, real STT/TTS, microphone, device, or HMI WebSocket transport evidence",
        }),
        ...(resumeFixtures.size === 0 ? {} : {
          taskRevalidationSimulation: "scenario-fixture evidence only; not provider, vehicle capability, or production authorization evidence",
        }),
        result,
        finalState: runtime.getState(),
      }, null, 2)}\n`,
    );
  } finally {
    voiceHarness?.voice.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "SCENARIO_RUN_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
