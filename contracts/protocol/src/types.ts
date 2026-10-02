export const PROTOCOL_VERSION = 1 as const;

export const STANDARD_DISPLAY_ROLES = [
  "cluster",
  "center",
  "front_passenger",
  "rear",
  "interactive_window",
] as const;

export type StandardDisplayRole = (typeof STANDARD_DISPLAY_ROLES)[number];
export type DisplayRole = StandardDisplayRole | (string & {});

export type SignalSource = "sensor" | "simulated" | "api" | "derived" | "cache";
export type SignalFreshness = "fresh" | "cached" | "stale" | "unknown";
export type Gear = "P" | "R" | "N" | "D" | "UNKNOWN";
export type CognitiveLoadLevel = "low" | "normal" | "high" | "critical";
export type PolicyOutcome = "EXECUTE" | "ASK" | "ROUTE" | "DEFER" | "REJECT";
export type ProposalPriority = "secondary" | "normal" | "urgent";
export type ActionKind =
  | "SPEAK"
  | "SHOW_INFORMATION"
  | "SHOW_GUIDANCE"
  | "SEARCH_PLACE"
  | "CALCULATE_ROUTE"
  | "ADD_TRIP_STOP"
  | "START_PARKING_GUIDANCE"
  | "HANDOFF_DISPLAY"
  | "SUPPRESS_NOTIFICATION"
  | "CHANGE_CABIN_SETTING"
  | "PREPARE_OFFLINE_CONTEXT"
  | "REQUEST_CONFIRMATION"
  | "WARN";
export type ProposalStatus =
  | "proposed"
  | "routed"
  | "awaiting_consent"
  | "deferred"
  | "executing"
  | "declined"
  | "rejected"
  | "interrupted"
  | "completed";

export interface VehicleState {
  speedKph: number;
  gear: Gear;
  steeringAngleDeg?: number;
  drivingState?: "parked" | "driving" | "reversing" | "unknown";
}

export interface DriverState {
  currentLoad?: CognitiveLoadLevel;
  loadConfidence?: number;
  loadObservedAt?: number;
}

export interface ContextSignal<T = unknown> {
  signalId: string;
  type: string;
  value: T;
  source: SignalSource;
  timestamp: number;
  confidence?: number;
  freshness?: SignalFreshness;
}

export interface ActionProposalRequest {
  proposalId: string;
  kind: ActionKind;
  summary: string;
  targetRole: DisplayRole;
  priority: ProposalPriority;
  requiresConsent: boolean;
  payload: Record<string, unknown>;
}

export interface ActionProposal extends ActionProposalRequest {
  requestedByRole: DisplayRole;
  createdAt: number;
  status: ProposalStatus;
  traceId: string;
  consentGranted?: boolean;
  lastReasonCode?: string;
}

export type DeferCondition =
  | {
      type: "driver_load_below";
      currentThreshold: "high";
      reevaluateOn: "driver.cognitive_load";
    };

export interface PolicyDecision {
  decisionId: string;
  proposalId: string;
  traceId: string;
  outcome: PolicyOutcome;
  reasonCode: string;
  consentRequired: boolean;
  targetRole?: DisplayRole;
  deferUntil?: DeferCondition;
  policyVersion: string;
  decidedAt: number;
}

export interface ActiveTask {
  taskId: string;
  traceId: string;
  priority: "primary" | "secondary" | "critical";
  status: "running" | "interrupted" | "completed";
  startedAt: number;
  interruptionReason?: string;
}

export interface DisplayConnectionState {
  displayId: string;
  connected: boolean;
  lastSeenAt: number;
  sessionId: string;
}

export interface JourneyStop {
  stopId: string;
  sourceProposalId: string;
  label: string;
  category?: string;
  placeId?: string;
  addedAt: number;
}

export interface JourneyState {
  stops: JourneyStop[];
}

export interface AuraSharedState {
  revision: number;
  vehicle: VehicleState;
  driver: DriverState;
  activeProposals: ActionProposal[];
  activeTasks: ActiveTask[];
  latestSignals: Record<string, ContextSignal>;
  displayConnections: Record<string, DisplayConnectionState>;
  journey: JourneyState;
}

export interface StateSnapshot {
  protocolVersion: typeof PROTOCOL_VERSION;
  sessionId: string;
  stateRevision: number;
  sequence: number;
  generatedAt: number;
  displayId?: string;
  state: AuraSharedState;
}

export type AuraCommand =
  | {
      type: "vehicle.telemetry.report";
      payload: { vehicle: Partial<VehicleState> };
    }
  | {
      type: "driver.cognitive_load.report";
      payload: {
        level: CognitiveLoadLevel;
        confidence?: number;
        timestamp: number;
      };
    }
  | {
      type: "action.propose";
      payload: { proposal: ActionProposalRequest };
    }
  | {
      type: "action.consent";
      payload: { proposalId: string; decision: "approve" | "decline" };
    };

export interface CommandEnvelope {
  protocolVersion: typeof PROTOCOL_VERSION;
  kind: "command";
  messageId: string;
  commandId: string;
  sessionId: string;
  traceId: string;
  sentAt: number;
  sender: {
    deviceId: string;
    displayId: string;
  };
  command: AuraCommand;
}

export interface CommandReceipt {
  commandId: string;
  traceId: string;
  status: "RECEIVED" | "REJECTED";
  stateRevision: number;
  replayed: boolean;
  reasonCode?: string;
}

export interface DisplayRegistration {
  displayId: string;
  deviceId: string;
  role: DisplayRole;
  protocolVersion: typeof PROTOCOL_VERSION;
  enabled: boolean;
  capabilities?: string[];
}

export interface DisplayRegistry {
  version: 1;
  displays: DisplayRegistration[];
}

export interface EventBase {
  eventId: string;
  sequence: number;
  sessionId: string;
  traceId: string;
  commandId: string | null;
  occurredAt: number;
}

export type AuraDomainEvent =
  | (EventBase & {
      type: "context.signal.received";
      payload: { signal: ContextSignal };
    })
  | (EventBase & {
      type: "vehicle.state.updated";
      payload: { vehicle: Partial<VehicleState> };
    })
  | (EventBase & {
      type: "driver.load.updated";
      payload: {
        level: CognitiveLoadLevel;
        confidence?: number;
        timestamp: number;
      };
    })
  | (EventBase & {
      type: "proposal.created";
      payload: { proposal: ActionProposal };
    })
  | (EventBase & {
      type: "proposal.policy.decided";
      payload: { decision: PolicyDecision };
    })
  | (EventBase & {
      type: "proposal.consent.recorded";
      payload: {
        proposalId: string;
        decision: "approve" | "decline";
        responderRole: DisplayRole;
      };
    })
  | (EventBase & {
      type: "proposal.status.changed";
      payload: {
        proposalId: string;
        status: ProposalStatus;
        reasonCode: string;
      };
    })
  | (EventBase & {
      type: "safety.override.activated";
      payload: {
        signal: ContextSignal;
        decision: PolicyDecision;
        interruptedTaskIds: string[];
      };
    })
  | (EventBase & {
      type: "task.registered";
      payload: { task: ActiveTask };
    })
  | (EventBase & {
      type: "task.interrupted";
      payload: { taskId: string; reasonCode: string };
    })
  | (EventBase & {
      type: "task.completed";
      payload: { taskId: string };
    })
  | (EventBase & {
      type: "display.connection.changed";
      payload: { displayId: string; connected: boolean; lastSeenAt: number };
    })
  | (EventBase & {
      type: "journey.stop.added";
      payload: { stop: JourneyStop };
    });

type EventDraftOf<T> = T extends AuraDomainEvent
  ? Omit<T, "sequence" | "eventId"> & { eventId?: string }
  : never;

export type AuraDomainEventDraft = EventDraftOf<AuraDomainEvent>;

export interface RegisterMessage {
  kind: "register";
  protocolVersion: typeof PROTOCOL_VERSION;
  displayId: string;
  deviceId: string;
  traceId: string;
}

export interface CommandMessage {
  kind: "command";
  envelope: CommandEnvelope;
}

export interface ResyncMessage {
  kind: "resync";
  protocolVersion: typeof PROTOCOL_VERSION;
  sessionId: string;
  traceId: string;
  afterSequence?: number;
}

export interface PingMessage {
  kind: "ping";
  protocolVersion: typeof PROTOCOL_VERSION;
  pingId: string;
}

export interface VoiceStartMessage {
  kind: "voice.start";
  protocolVersion: typeof PROTOCOL_VERSION;
  traceId: string;
  encoding: "pcm_s16le";
  sampleRateHz: 16000;
  channels: 1;
}

export interface VoiceStopMessage {
  kind: "voice.stop";
  protocolVersion: typeof PROTOCOL_VERSION;
  traceId: string;
}

export interface VoiceTextMessage {
  kind: "voice.text";
  protocolVersion: typeof PROTOCOL_VERSION;
  traceId: string;
  text: string;
}

export type ClientMessage = RegisterMessage | CommandMessage | ResyncMessage | PingMessage | VoiceStartMessage | VoiceStopMessage | VoiceTextMessage;

export interface WelcomeMessage {
  kind: "welcome";
  protocolVersion: typeof PROTOCOL_VERSION;
  sessionId: string;
  sequence: number;
  displayId: string;
  role: DisplayRole;
}

export interface AckMessage {
  kind: "ack";
  protocolVersion: typeof PROTOCOL_VERSION;
  receipt: CommandReceipt;
}

export interface SnapshotMessage {
  kind: "snapshot";
  snapshot: StateSnapshot;
}

export interface EventMessage {
  kind: "event";
  event: AuraDomainEvent;
}

export interface ErrorMessage {
  kind: "error";
  protocolVersion: typeof PROTOCOL_VERSION;
  code: string;
  message: string;
  traceId?: string;
}

export interface PongMessage {
  kind: "pong";
  protocolVersion: typeof PROTOCOL_VERSION;
  pingId: string;
  serverTime: number;
}

export interface VoiceStatusMessage {
  kind: "voice.status";
  protocolVersion: typeof PROTOCOL_VERSION;
  traceId: string;
  state: "IDLE" | "LISTENING" | "TRANSCRIBING" | "THINKING" | "SPEAKING";
}

export interface VoiceTranscriptMessage {
  kind: "voice.transcript";
  protocolVersion: typeof PROTOCOL_VERSION;
  traceId: string;
  direction: "input" | "output";
  text: string;
  isFinal: boolean;
}

export interface VoiceAudioMessage {
  kind: "voice.audio";
  protocolVersion: typeof PROTOCOL_VERSION;
  traceId: string;
  phase: "start" | "end";
  mimeType: string;
}

export type ServerMessage =
  | WelcomeMessage
  | AckMessage
  | SnapshotMessage
  | EventMessage
  | ErrorMessage
  | PongMessage
  | VoiceStatusMessage
  | VoiceTranscriptMessage
  | VoiceAudioMessage;

export interface ContextIngestReceipt {
  signalId: string;
  traceId: string;
  stateRevision: number;
  sequence: number;
  policyDecision?: PolicyDecision;
}
