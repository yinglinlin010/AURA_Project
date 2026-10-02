import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DisplayRegistry } from "../contracts/protocol/src/types.js";
import { assertDisplayRegistry } from "../contracts/protocol/src/registry.js";
import {
  IntelligenceRouter,
  StructuredTraceSink,
  type ProposalSource,
} from "../packages/core-runtime/src/index.js";
import { CoreRuntime } from "../packages/core-runtime/src/core-runtime.js";
import { Gemma2BOfflineSimulator } from "../adapters/local/gemma2b-offline-simulator.js";

const registryPath = resolve(process.cwd(), "apps/core-host/config/display-registry.json");
const registryValue: unknown = JSON.parse(readFileSync(registryPath, "utf8"));
assertDisplayRegistry(registryValue);
const registry: DisplayRegistry = registryValue;
const runtime = new CoreRuntime({ registry });

const simulatedGeminiLive: ProposalSource = {
  async proposeFromText() {
    return {
      kind: "ADD_TRIP_STOP",
      summary: "Find a quiet cafe with parking along the route",
      targetRole: "center",
      priority: "secondary",
      requiresConsent: true,
      payload: {
        category: "cafe",
        routePreference: "along_current_route",
        features: ["quiet", "parking"],
      },
    };
  },
};

const router = new IntelligenceRouter({
  runtime,
  cloud: simulatedGeminiLive,
  local: new Gemma2BOfflineSimulator(),
  trace: new StructuredTraceSink(),
});

const result = await router.handle({
  requestId: "demo-voice-request-001",
  traceId: "demo-voice-trace-001",
  text: "Find a quiet cafe with parking on our way home.",
  requestedByRole: "front_passenger",
});

if (!result.proposal) {
  throw new Error("SIMULATED_VOICE_QUERY_DID_NOT_RETURN_PROPOSAL");
}

process.stdout.write(
  `${JSON.stringify({
    simulatedInput: "Find a quiet cafe with parking on our way home.",
    route: result.route,
    proposal: result.proposal,
    policyDecision: result.policyDecision,
  }, null, 2)}\n`,
);
