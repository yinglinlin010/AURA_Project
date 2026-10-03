import type { CoreRuntime } from "../../packages/core-runtime/src/core-runtime.js";
import { SimulatedParkingAdapter } from "./simulated-parking-adapter.js";
import type { SimulatedParkingRequest, SimulatedParkingOutcomeReport, SimulatedParkingAction } from "./types.js";

/** Bridges simulator outcomes into Runtime's durable, idempotent task ledger. */
export class SimulatedParkingTaskCoordinator {
  private readonly cancellationHandlers = new Map<string, () => void>();

  constructor(private readonly runtime: CoreRuntime, private readonly parking: SimulatedParkingAdapter) {}

  start(request: SimulatedParkingRequest, traceId: string): SimulatedParkingAction {
    const task = this.runtime.getState().activeTasks.find((candidate) => candidate.taskId === request.taskId);
    if (!task || task.status !== "running") throw new Error("PARKING_TASK_NOT_RUNNING");
    const { action } = this.parking.start(request);
    try {
      this.record(action, traceId);
    } catch (error) {
      if (action.status === "running") this.parking.cancel(action.actionId);
      throw error;
    }
    this.observeTaskCancellation(action, traceId);
    return action;
  }

  pause(actionId: string, traceId: string, reasonCode?: string): SimulatedParkingAction {
    const action = this.parking.pause(actionId, reasonCode);
    this.record(action, traceId);
    return action;
  }

  resume(request: SimulatedParkingRequest, traceId: string): SimulatedParkingAction {
    const task = this.runtime.getState().activeTasks.find((candidate) => candidate.taskId === request.taskId);
    if (!task || task.status !== "running") throw new Error("PARKING_TASK_NOT_RUNNING");
    const action = this.parking.resume(request);
    try {
      this.record(action, traceId);
    } catch (error) {
      // Keep adapter and durable ledger aligned if write-through rejects the
      // resumed state. The caller can retry after persistence recovers.
      try { this.parking.pause(action.actionId, "TASK_LEDGER_WRITE_FAILED"); }
      catch { /* Preserve the original failure; unresolved ledger still blocks completion. */ }
      throw error;
    }
    return action;
  }

  cancel(actionId: string, traceId: string): SimulatedParkingAction {
    const action = this.parking.cancel(actionId);
    this.record(action, traceId);
    return action;
  }

  reportOutcome(report: SimulatedParkingOutcomeReport, traceId: string): SimulatedParkingAction {
    const action = this.parking.reportOutcome(report);
    this.record(action, traceId);
    return action;
  }

  query(actionId: string, traceId: string): SimulatedParkingAction | undefined {
    const action = this.parking.query(actionId);
    if (action) this.record(action, traceId);
    return action;
  }

  private record(action: SimulatedParkingAction, traceId: string): void {
    const status = action.status === "completed" ? "succeeded" : action.status === "cancelled" ? "cancelled" : action.status;
    this.runtime.recordTaskAction({
      taskId: action.taskId,
      traceId,
      actionId: action.actionId,
      idempotencyKey: action.actionId,
      status,
      reasonCode: action.reasonCode,
    });
  }

  private observeTaskCancellation(action: SimulatedParkingAction, traceId: string): void {
    if (this.cancellationHandlers.has(action.actionId) || action.status !== "running") return;
    const signal = this.runtime.taskCancellations.getSignal(action.taskId);
    if (!signal) return;
    const onAbort = () => {
      this.cancellationHandlers.delete(action.actionId);
      try {
        const current = this.parking.query(action.actionId);
        if (!current || !["running", "paused"].includes(current.status)) return;
        const cancelled = this.parking.cancel(action.actionId);
        // Safety interruption aborts before persistence. If recording this
        // fails, resume remains blocked by the still-running action ledger.
        this.record(cancelled, traceId);
      } catch {
        // Never let telemetry/persistence failures prevent the Runtime's
        // safety interruption from finishing its fail-safe path.
      }
    };
    this.cancellationHandlers.set(action.actionId, onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  }
}
