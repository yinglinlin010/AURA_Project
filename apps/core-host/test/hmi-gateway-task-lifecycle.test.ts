import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { SqliteTaskStore } from "../../../adapters/persistence/sqlite-task-store.js";
import type { DisplayRegistration, DisplayRegistry, TaskLifecycleCommand, TaskLifecycleMessage } from "../../../contracts/protocol/src/types.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";
import { HmiGateway } from "../src/hmi-gateway.js";

const registry: DisplayRegistry = {
  version: 1,
  displays: [
    { displayId: "center-main", deviceId: "center-device", role: "center", protocolVersion: 1, enabled: true },
    { displayId: "passenger-main", deviceId: "passenger-device", role: "front_passenger", protocolVersion: 1, enabled: true },
    { displayId: "cluster-main", deviceId: "cluster-device", role: "cluster", protocolVersion: 1, enabled: true },
  ],
};

type Client = { socket: WebSocket; registration: DisplayRegistration };

test("Gateway task lifecycle is Center-only, versioned, private, replayable, durable, and fail-closed on resume", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aura-task-command-"));
  const databasePath = join(directory, "tasks.sqlite");
  let store = new SqliteTaskStore({ databasePath });
  let runtime = new CoreRuntime({ registry, initialTasks: store.get(), persistTasks: (tasks) => store.save(tasks) });
  let gateway = new HmiGateway({ runtime, registry, host: "127.0.0.1", port: 0 });
  const clients: Client[] = [];
  await gateway.start();
  try {
    const address = gateway.address();
    assert.ok(address);
    for (const registration of registry.displays) clients.push(await connect(address, registration));
    const center = byRole("center");
    const passenger = byRole("front_passenger");
    const cluster = byRole("cluster");

    const rejectedRole = await sendTaskCommand(passenger, runtime.sessionId, "passenger-start", {
      type: "task.start", payload: { taskId: "protected-task", priority: "primary", goal: "Private goal" },
    });
    assert.equal(rejectedRole.status, "REJECTED");
    assert.equal(rejectedRole.reasonCode, "TASK_COMMAND_CENTER_ONLY");
    assert.equal(runtime.getState().activeTasks.length, 0);

    const invalidMessage = waitFor(cluster.socket, (message) => message.kind === "error" && message.code === "INVALID_MESSAGE");
    cluster.socket.send(JSON.stringify({
      kind: "task.command", protocolVersion: 1, commandId: "invalid", sessionId: runtime.sessionId,
      traceId: "invalid-trace", sentAt: Date.now(), sender: { displayId: "cluster-main", deviceId: "cluster-device" },
      command: { type: "task.start", payload: { taskId: "invalid-task", priority: "primary", forbidden: true } },
    }));
    await invalidMessage;
    assert.equal(runtime.getState().activeTasks.length, 0);

    const centerRegistered = waitFor(center.socket, isTaskEvent("task.registered"));
    const clusterRegistered = waitFor(cluster.socket, isTaskEvent("task.registered"));
    const start = await sendTaskCommand(center, runtime.sessionId, "center-start", {
      type: "task.start", payload: {
        taskId: "family-charge-search", priority: "primary", goal: "Find a convenient family drop-off with nearby charging",
        conditions: [{ key: "dropoff", classification: "confirmed", value: "near entrance", source: "simulated", observedAt: Date.now() }],
      },
    });
    assert.equal(start.status, "RECEIVED");
    const [privateRegistered, publicRegistered] = await Promise.all([centerRegistered, clusterRegistered]);
    const privateTask = getEventTask(privateRegistered);
    const publicTask = getEventTask(publicRegistered);
    assert.equal(privateTask.goal, "Find a convenient family drop-off with nearby charging");
    assert.equal(publicTask.taskId, "family-charge-search");
    assert.equal("goal" in publicTask, false);
    assert.equal("conditions" in publicTask, false);

    const update = await sendTaskCommand(center, runtime.sessionId, "center-update", {
      type: "task.update", payload: {
        taskId: "family-charge-search", expectedVersion: 1, currentStep: "Compare candidate evidence",
        conditions: [{ key: "charging", classification: "unknown" }],
      },
    });
    assert.equal(update.status, "RECEIVED");
    const updated = runtime.getState().activeTasks[0]!;
    assert.equal(updated.version, 2);
    assert.equal(updated.conditions?.length, 2, "condition patch preserves confirmed requirements");

    const stale = await sendTaskCommand(center, runtime.sessionId, "stale-update", {
      type: "task.update", payload: { taskId: "family-charge-search", expectedVersion: 1, currentStep: "Overwrite" },
    });
    assert.equal(stale.status, "REJECTED");
    assert.equal(stale.reasonCode, "TASK_VERSION_CONFLICT");

    const record = await sendTaskCommand(center, runtime.sessionId, "record-unknown-action", {
      type: "task.action", payload: {
        taskId: "family-charge-search", expectedVersion: 2, actionId: "candidate-query", status: "unknown",
        reasonCode: "PROVIDER_RESULT_NOT_CONFIRMED",
      },
    });
    assert.equal(record.status, "RECEIVED");
    assert.equal(runtime.getState().activeTasks[0]?.actionRecords?.[0]?.status, "unknown");

    const afterSequence = runtime.eventBus.sequence;
    const replayClient = await connect(address, cluster.registration);
    clients.push(replayClient);
    const replay = waitFor(replayClient.socket, (message) => message.kind === "event" &&
      (message.event as Record<string, unknown> | undefined)?.type === "task.updated");
    replayClient.socket.send(JSON.stringify({
      kind: "resync", protocolVersion: 1, sessionId: runtime.sessionId, traceId: "task-replay", afterSequence: afterSequence - 1,
    }));
    const replayedEvent = await replay;
    assert.equal(((replayedEvent.event as Record<string, unknown>).payload as { task: Record<string, unknown> }).task.actionRecords, undefined);

    const unsafeCancel = await sendTaskCommand(center, runtime.sessionId, "cancel-unknown-action", {
      type: "task.cancel", payload: { taskId: "family-charge-search", expectedVersion: 3, reasonCode: "USER_CANCELLED" },
    });
    assert.equal(unsafeCancel.status, "REJECTED");
    assert.equal(unsafeCancel.reasonCode, "TASK_ACTION_OUTCOME_REQUIRES_RECONCILIATION");
    assert.equal(runtime.getState().activeTasks[0]?.status, "running");

    await sendTaskCommand(center, runtime.sessionId, "start-running-cancel-check", {
      type: "task.start", payload: { taskId: "running-cancel-check", priority: "secondary" },
    });
    await sendTaskCommand(center, runtime.sessionId, "record-running-action", {
      type: "task.action", payload: { taskId: "running-cancel-check", expectedVersion: 1, actionId: "adapter-work", status: "running" },
    });
    const adapterCancel = await sendTaskCommand(center, runtime.sessionId, "cancel-running-action", {
      type: "task.cancel", payload: { taskId: "running-cancel-check", expectedVersion: 2, reasonCode: "USER_CANCELLED" },
    });
    assert.equal(adapterCancel.status, "REJECTED");
    assert.equal(adapterCancel.reasonCode, "TASK_ACTION_CANCELLATION_REQUIRES_ADAPTER");

    const cancelStart = await sendTaskCommand(center, runtime.sessionId, "start-cancel-check", {
      type: "task.start", payload: { taskId: "cancel-check", priority: "secondary", goal: "Cancel without active adapter work" },
    });
    assert.equal(cancelStart.status, "RECEIVED");
    const cancel = await sendTaskCommand(center, runtime.sessionId, "center-cancel", {
      type: "task.cancel", payload: { taskId: "cancel-check", expectedVersion: 1, reasonCode: "USER_CANCELLED" },
    });
    assert.equal(cancel.status, "RECEIVED");
    assert.equal(runtime.getState().activeTasks.find((task) => task.taskId === "cancel-check")?.status, "cancelled");
    const duplicateCancel = await sendTaskCommand(center, runtime.sessionId, "center-cancel", {
      type: "task.cancel", payload: { taskId: "cancel-check", expectedVersion: 1, reasonCode: "USER_CANCELLED" },
    });
    assert.equal(duplicateCancel.replayed, true);

    // A separate task demonstrates the resume route without fabricating fresh evidence.
    await sendTaskCommand(center, runtime.sessionId, "start-resume-check", {
      type: "task.start", payload: { taskId: "resume-check", priority: "secondary", goal: "Recover safely" },
    });
    runtime.ingestSignal({ signalId: "task-lifecycle-critical", type: "safety.critical", value: { severity: "critical" }, source: "simulated", timestamp: Date.now() }, "task-lifecycle-safety");
    const failClosedResume = await sendTaskCommand(center, runtime.sessionId, "resume-no-evidence", {
      type: "task.resume", payload: { taskId: "resume-check", expectedVersion: 1 },
    });
    assert.equal(failClosedResume.status, "REJECTED");
    assert.equal(failClosedResume.reasonCode, "TASK_RECOVERY_REVALIDATION_REQUIRED");
    assert.equal(runtime.getState().activeTasks.find((task) => task.taskId === "resume-check")?.status, "interrupted");
    assert.equal(store.get().find((task) => task.taskId === "resume-check")?.status, "interrupted");
  } finally {
    await Promise.all(clients.map((client) => close(client.socket)));
    await gateway.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }

  function byRole(role: string): Client {
    const client = clients.find((entry) => entry.registration.role === role);
    assert.ok(client, `missing ${role}`);
    return client;
  }
});

test("task command survives SQLite host restart as interrupted and remains non-resumable without revalidation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aura-task-restart-"));
  const databasePath = join(directory, "tasks.sqlite");
  let store = new SqliteTaskStore({ databasePath });
  let runtime = new CoreRuntime({ registry, initialTasks: store.get(), persistTasks: (tasks) => store.save(tasks) });
  runtime.startTask({ taskId: "restart-task", traceId: "start", priority: "primary", goal: "Preserve task state" });
  runtime.updateTaskProgress({ taskId: "restart-task", traceId: "step", currentStep: "Step A", conditions: [{ key: "destination", classification: "confirmed", value: "site", source: "simulated", observedAt: Date.now() }] });
  runtime.recordTaskAction({ taskId: "restart-task", traceId: "action", actionId: "lookup", idempotencyKey: "lookup-1", status: "unknown", reasonCode: "OUTCOME_UNKNOWN" });
  store.close();

  store = new SqliteTaskStore({ databasePath });
  runtime = new CoreRuntime({ registry, initialTasks: store.get(), persistTasks: (tasks) => store.save(tasks) });
  const recovered = runtime.getState().activeTasks[0]!;
  assert.equal(recovered.status, "interrupted");
  assert.equal(recovered.goal, "Preserve task state");
  assert.equal(recovered.currentStep, "Step A");
  assert.equal(recovered.conditions?.[0]?.classification, "confirmed");
  assert.equal(recovered.actionRecords?.[0]?.status, "unknown");

  const gateway = new HmiGateway({ runtime, registry, host: "127.0.0.1", port: 0 });
  await gateway.start();
  let client: Client | undefined;
  try {
    const address = gateway.address();
    assert.ok(address);
    client = await connect(address, registry.displays[0]!);
    const response = await sendTaskCommand(client, runtime.sessionId, "resume-unknown-recovered", {
      type: "task.resume", payload: { taskId: "restart-task", expectedVersion: recovered.version ?? 1 },
    });
    assert.equal(response.status, "REJECTED");
    assert.equal(response.reasonCode, "TASK_ACTION_RECONCILIATION_REQUIRED");
  } finally {
    if (client) await close(client.socket);
    await gateway.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

async function connect(address: string, registration: DisplayRegistration): Promise<Client> {
  const socket = new WebSocket(address);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const welcome = waitFor(socket, (message) => message.kind === "welcome");
  const snapshot = waitFor(socket, (message) => message.kind === "snapshot");
  socket.send(JSON.stringify({ kind: "register", protocolVersion: 1, displayId: registration.displayId, deviceId: registration.deviceId, traceId: `register-${registration.role}` }));
  await Promise.all([welcome, snapshot]);
  return { socket, registration };
}

function sendTaskCommand(client: Client, sessionId: string, commandId: string, command: TaskLifecycleCommand): Promise<Record<string, unknown>> {
  const response = waitFor(client.socket, (message) => message.kind === "ack" &&
    (message.receipt as Record<string, unknown> | undefined)?.commandId === commandId);
  const message: TaskLifecycleMessage = {
    kind: "task.command", protocolVersion: 1, commandId, sessionId, traceId: `trace-${commandId}`, sentAt: Date.now(),
    sender: { displayId: client.registration.displayId, deviceId: client.registration.deviceId }, command,
  };
  client.socket.send(JSON.stringify(message));
  return response.then((message) => message.receipt as Record<string, unknown>);
}

function isTaskEvent(type: string): (message: Record<string, unknown>) => boolean {
  return (message) => message.kind === "event" && (message.event as Record<string, unknown> | undefined)?.type === type;
}

function getEventTask(message: Record<string, unknown>): Record<string, unknown> {
  return ((message.event as Record<string, unknown>).payload as { task: Record<string, unknown> }).task;
}

function waitFor(socket: WebSocket, predicate: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off("message", onMessage); reject(new Error("TEST_MESSAGE_TIMEOUT")); }, 3000);
    const onMessage = (raw: WebSocket.RawData) => {
      let message: Record<string, unknown>;
      try { message = JSON.parse(raw.toString()) as Record<string, unknown>; }
      catch (error) { clearTimeout(timer); socket.off("message", onMessage); reject(error); return; }
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

async function close(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => { socket.once("close", () => resolve()); socket.close(); });
}
