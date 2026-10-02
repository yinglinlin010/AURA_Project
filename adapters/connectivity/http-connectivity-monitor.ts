import { randomUUID } from "node:crypto";
import type { ConnectivityMode } from "../../contracts/protocol/src/types.js";

export interface HttpConnectivityMonitorOptions {
  endpoint: string;
  report(update: CoreConnectivityUpdate): void;
  fetchImplementation?: typeof fetch;
  intervalMs?: number;
  timeoutMs?: number;
  successThreshold?: number;
  failureThreshold?: number;
}

export interface CoreConnectivityUpdate {
  mode: ConnectivityMode;
  source: "api";
  evidence: string;
  freshness: "fresh";
  traceId: string;
}

/** Probes one explicitly configured, side-effect-free HTTP health endpoint. */
export class HttpConnectivityMonitor {
  private readonly endpoint: string;
  private readonly report: (update: CoreConnectivityUpdate) => void;
  private readonly fetchImplementation: typeof fetch;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private readonly successThreshold: number;
  private readonly failureThreshold: number;
  private interval: ReturnType<typeof setInterval> | undefined;
  private activeController: AbortController | undefined;
  private activeProbe: Promise<void> | undefined;
  private successCount = 0;
  private networkFailureCount = 0;
  private stopped = false;

  constructor(options: HttpConnectivityMonitorOptions) {
    this.endpoint = validateEndpoint(options.endpoint);
    this.report = options.report;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.intervalMs = boundedInteger(options.intervalMs, 15_000, 1_000, 300_000, "INVALID_CONNECTIVITY_INTERVAL");
    this.timeoutMs = boundedInteger(options.timeoutMs, 3_000, 250, 60_000, "INVALID_CONNECTIVITY_TIMEOUT");
    this.successThreshold = boundedInteger(options.successThreshold, 2, 1, 10, "INVALID_CONNECTIVITY_SUCCESS_THRESHOLD");
    this.failureThreshold = boundedInteger(options.failureThreshold, 3, 1, 10, "INVALID_CONNECTIVITY_FAILURE_THRESHOLD");
  }

  start(): void {
    if (this.interval || this.stopped) return;
    void this.probeOnce().catch(() => undefined);
    this.interval = setInterval(() => void this.probeOnce().catch(() => undefined), this.intervalMs);
    this.interval.unref?.();
  }

  probeOnce(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.activeProbe) return this.activeProbe;
    const pending = this.performProbe();
    this.activeProbe = pending;
    const clearActiveProbe = () => {
      if (this.activeProbe === pending) this.activeProbe = undefined;
    };
    void pending.then(clearActiveProbe, clearActiveProbe);
    return pending;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
    this.activeController?.abort();
    await this.activeProbe;
  }

  private async performProbe(): Promise<void> {
    const controller = new AbortController();
    this.activeController = controller;
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let mode: ConnectivityMode;
    let evidence: string;
    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: "HEAD",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
      });
      this.networkFailureCount = 0;
      if (response.status >= 200 && response.status < 300) {
        this.successCount++;
        mode = this.successCount >= this.successThreshold ? "online" : "degraded";
        evidence = mode === "online" ? "HTTP_PROBE_HEALTHY" : "HTTP_PROBE_RECOVERING";
      } else {
        this.successCount = 0;
        mode = "degraded";
        evidence = "HTTP_PROBE_UNHEALTHY";
      }
    } catch {
      this.successCount = 0;
      this.networkFailureCount++;
      mode = this.networkFailureCount >= this.failureThreshold ? "offline" : "degraded";
      evidence = mode === "offline" ? "HTTP_PROBE_UNREACHABLE" : "HTTP_PROBE_FAILURE_PENDING";
    } finally {
      clearTimeout(timeout);
      if (this.activeController === controller) this.activeController = undefined;
    }
    if (this.stopped) return;
    this.report({
      mode,
      source: "api",
      evidence,
      freshness: "fresh",
      traceId: `connectivity-probe:${randomUUID()}`,
    });
  }
}

function validateEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("INVALID_CONNECTIVITY_ENDPOINT");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username || url.password || url.search || url.hash
  ) {
    throw new Error("INVALID_CONNECTIVITY_ENDPOINT");
  }
  return url.toString();
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number, reason: string): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(reason);
  return result;
}
