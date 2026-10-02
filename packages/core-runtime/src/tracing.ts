export interface RuntimeTraceRecord {
  sessionId: string;
  traceId: string;
  component: string;
  operation: string;
  startedAt: number;
  durationMs: number;
  outcome: "ok" | "error" | "fallback" | "cancelled";
  model?: string;
  route?: "local" | "cloud";
  fallbackReason?: string;
  policyOutcome?: string;
  rawAudioDropped?: true;
}

export interface TraceSink {
  record(record: RuntimeTraceRecord): void;
}

export class StructuredTraceSink implements TraceSink {
  constructor(private readonly write: (line: string) => void = (line) => console.info(line)) {}

  record(record: RuntimeTraceRecord): void {
    this.write(JSON.stringify(record));
  }
}
