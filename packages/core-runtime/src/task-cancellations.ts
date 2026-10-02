export class TaskCancellationRegistry {
  private readonly controllers = new Map<string, AbortController>();

  register(taskId: string): AbortSignal {
    const existing = this.controllers.get(taskId);
    if (existing && !existing.signal.aborted) throw new Error("TASK_ALREADY_RUNNING");
    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    return controller.signal;
  }

  cancel(taskId: string, reason: string): boolean {
    const controller = this.controllers.get(taskId);
    if (!controller || controller.signal.aborted) return false;
    controller.abort(new Error(reason));
    this.controllers.delete(taskId);
    return true;
  }

  complete(taskId: string): void {
    this.controllers.delete(taskId);
  }

  getSignal(taskId: string): AbortSignal | undefined {
    return this.controllers.get(taskId)?.signal;
  }
}
