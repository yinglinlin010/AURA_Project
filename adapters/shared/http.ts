import { randomUUID } from "node:crypto";

export interface JsonRequestOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function fetchJson(
  input: string | URL,
  init: RequestInit,
  options: JsonRequestOptions = {},
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("REQUEST_TIMEOUT")), options.timeoutMs ?? 10_000);
  const externalSignal = init.signal;
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const response = await fetchImpl(input, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return await response.json() as unknown;
  } catch (error) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      if (reason instanceof Error && reason.message === "REQUEST_TIMEOUT") {
        throw new Error("REQUEST_TIMEOUT");
      }
      throw new Error("REQUEST_ABORTED");
    }
    if (error instanceof Error && /^HTTP_\d{3}$/.test(error.message)) throw error;
    throw new Error("UPSTREAM_REQUEST_FAILED");
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function requireText(value: unknown, reasonCode: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(reasonCode);
  return value.trim();
}

export function recordIntegrationSignal(
  sink: { ingestSignal(signal: {
    signalId: string;
    type: string;
    value: unknown;
    source: "api" | "derived";
    timestamp: number;
  }, traceId?: string): unknown } | undefined,
  type: string,
  value: unknown,
  traceId: string,
  now: () => number,
  source: "api" | "derived" = "api",
): void {
  if (!sink) return;
  const timestamp = now();
  sink.ingestSignal({ signalId: `external:${randomUUID()}`, type, value, source, timestamp }, traceId);
}
