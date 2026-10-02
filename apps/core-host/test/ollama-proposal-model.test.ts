import assert from "node:assert/strict";
import { test } from "node:test";
import { OllamaProposalModel } from "../../../adapters/local/ollama-proposal-model.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function withFetch(response: Response, run: (request: Record<string, unknown>) => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return response;
  };
  try {
    await run(new Proxy({}, {
      get(_target, key: string) {
        if (key === "requestBody") return requestBody;
        return undefined;
      },
    }) as Record<string, unknown>);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("Qwen3 request suppresses reasoning and receives narrow examples under the structured label schema", async () => {
  const label = {
    decision: "proposal",
    candidate: {
      kind: "CHANGE_CABIN_SETTING",
      summary: "Decrease cabin audio volume",
      targetRole: "center",
      priority: "normal",
      requiresConsent: true,
      payload: { setting: "volume", direction: "down" },
    },
  };
  await withFetch({
    json: async () => ({ response: JSON.stringify(label) }),
    ok: true,
    status: 200,
  } as Response, async (captured) => {
    const model = new OllamaProposalModel({ model: "qwen3:4b" });
    const candidate = await model.proposeStudentCandidate({
      text: "Turn the cabin volume down",
      traceId: "private-trace-id",
    });
    assert.deepEqual(candidate, {
      kind: "CHANGE_CABIN_SETTING",
      summary: "Decrease cabin audio volume",
      targetRole: "center",
      priority: "normal",
      requiresConsent: true,
      payload: { setting: "volume", direction: "down" },
    });
    const body = captured.requestBody as Record<string, unknown>;
    assert.equal(body.think, false);
    assert.equal(body.stream, false);
    assert.equal((body.format as { oneOf?: unknown[] }).oneOf?.length, 2);
    assert.doesNotMatch(String(body.prompt), /private-trace-id/);
    assert.match(String(body.prompt), /Brake now and steer left/);
    assert.match(String(body.system), /safety requests/);
  });
});

test("valid model abstention becomes no proposal", async () => {
  await withFetch({
    json: async () => ({ response: JSON.stringify({ decision: "abstain", reason: "out_of_scope" }) }),
    ok: true,
    status: 200,
  } as Response, async () => {
    const model = new OllamaProposalModel({ model: "qwen3:4b" });
    assert.equal(await model.proposeStudentCandidate({ text: "Brake now", traceId: "trace" }), undefined);
  });
});

test("invalid constrained output fails closed", async () => {
  await withFetch({
    json: async () => ({ response: "not JSON" }),
    ok: true,
    status: 200,
  } as Response, async () => {
    const model = new OllamaProposalModel({ model: "qwen3:4b" });
    await assert.rejects(
      model.proposeStudentCandidate({ text: "Turn volume down", traceId: "trace" }),
      /OLLAMA_LABEL_INVALID_JSON/,
    );
  });
});
