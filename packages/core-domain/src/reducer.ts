import type {
  ActiveTask,
  ActionProposal,
  AuraDomainEvent,
  AuraSharedState,
  DisplayConnectionState,
} from "../../../contracts/protocol/src/types.js";

export function reduceState(state: AuraSharedState, event: AuraDomainEvent): AuraSharedState {
  const next = reduceDomainState(state, event);
  return { ...next, revision: state.revision + 1 };
}

function reduceDomainState(state: AuraSharedState, event: AuraDomainEvent): AuraSharedState {
  switch (event.type) {
    case "context.signal.received":
      return {
        ...state,
        latestSignals: {
          ...state.latestSignals,
          [event.payload.signal.type]: event.payload.signal,
        },
      };
    case "vehicle.state.updated":
      return { ...state, vehicle: { ...state.vehicle, ...event.payload.vehicle } };
    case "driver.load.updated":
      {
        const driver = { ...state.driver };
        delete driver.loadConfidence;
        return {
          ...state,
          driver: {
            ...driver,
            currentLoad: event.payload.level,
            ...(event.payload.confidence === undefined
              ? {}
              : { loadConfidence: event.payload.confidence }),
            loadObservedAt: event.payload.timestamp,
          },
        };
      }
    case "proposal.created":
      return {
        ...state,
        activeProposals: upsertById(
          state.activeProposals,
          event.payload.proposal,
          (proposal) => proposal.proposalId,
        ),
      };
    case "proposal.status.changed":
      return {
        ...state,
        activeProposals: state.activeProposals.map((proposal) =>
          proposal.proposalId === event.payload.proposalId
            ? {
                ...proposal,
                status: event.payload.status,
                lastReasonCode: event.payload.reasonCode,
              }
            : proposal,
        ),
      };
    case "task.registered":
      return {
        ...state,
        activeTasks: upsertById(state.activeTasks, event.payload.task, (task) => task.taskId),
      };
    case "task.interrupted":
      return {
        ...state,
        activeTasks: state.activeTasks.map((task) =>
          task.taskId === event.payload.taskId
            ? {
                ...task,
                status: "interrupted",
                interruptionReason: event.payload.reasonCode,
              }
            : task,
        ),
      };
    case "task.completed":
      return {
        ...state,
        activeTasks: state.activeTasks.map((task) =>
          task.taskId === event.payload.taskId ? { ...task, status: "completed" } : task,
        ),
      };
    case "display.connection.changed": {
      const connection: DisplayConnectionState = {
        displayId: event.payload.displayId,
        connected: event.payload.connected,
        lastSeenAt: event.payload.lastSeenAt,
        sessionId: event.sessionId,
      };
      return {
        ...state,
        displayConnections: {
          ...state.displayConnections,
          [event.payload.displayId]: connection,
        },
      };
    }
    case "journey.stop.added":
      return {
        ...state,
        journey: {
          ...state.journey,
          stops: upsertById(state.journey.stops, event.payload.stop, (stop) => stop.stopId),
        },
      };
    case "proposal.policy.decided":
    case "safety.override.activated":
      return state;
    case "proposal.consent.recorded":
      return event.payload.decision === "approve"
        ? {
            ...state,
            activeProposals: state.activeProposals.map((proposal) =>
              proposal.proposalId === event.payload.proposalId
                ? { ...proposal, consentGranted: true }
                : proposal,
            ),
          }
        : state;
  }
}

function upsertById<T>(items: T[], item: T, idOf: (value: T) => string): T[] {
  const targetId = idOf(item);
  const index = items.findIndex((candidate) => idOf(candidate) === targetId);
  if (index < 0) return [...items, item];
  return items.map((candidate, candidateIndex) => (candidateIndex === index ? item : candidate));
}

export function findTask(state: AuraSharedState, taskId: string): ActiveTask | undefined {
  return state.activeTasks.find((task) => task.taskId === taskId);
}

export function findProposal(state: AuraSharedState, proposalId: string): ActionProposal | undefined {
  return state.activeProposals.find((proposal) => proposal.proposalId === proposalId);
}
