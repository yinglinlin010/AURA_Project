import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import WebSocket from "ws";
import type { DisplayRegistration, DisplayRegistry } from "../../../contracts/protocol/src/types.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";
import { HmiGateway } from "../src/hmi-gateway.js";

const registry = JSON.parse(readFileSync("apps/core-host/config/display-registry.json", "utf8")) as DisplayRegistry;
const markers = ["PRIVATE_GOAL_914", "PRIVATE_CONDITION_258", "PRIVATE_STEP_663", "PRIVATE_PAUSE_427", "PRIVATE_ACTION_531"] as const;

test("task plan and action details are Center-only in snapshots, fanout and replay", async () => {
  const runtime = new CoreRuntime({
    revalidateTask: () => ({ candidateFresh: true, capabilityConfirmed: true, authorizationCurrent: true, priorActionOutcomeKnown: true }),
  });
  const gateway = new HmiGateway({ runtime, registry, host: "127.0.0.1", port: 0 });
  await gateway.start();
  const clients: Client[] = [];
  try {
    for (const registration of registry.displays.filter((display) => display.enabled)) {
      clients.push(await connect(gateway.address()!, registration));
    }
    const center = clients.find((client) => client.registration.role === "center")!;
    const nonCenters = clients.filter((client) => client.registration.role !== "center");
    assert.ok(nonCenters.length > 0);

    const taskId = "private-task";
    const capture = async (type: string, mutate: () => void) => {
      const waits = clients.map((client) => waitForMessage(client.socket, (message) => message.kind === "event" && message.event?.type === type));
      mutate();
      const events = await Promise.all(waits);
      const centerEvent = events[clients.indexOf(center)]!.event;
      for (const client of nonCenters) {
        const event = events[clients.indexOf(client)]!.event;
        assert.equal(event.type, type);
        assertNoPrivateMarkers(event);
        if (type === "task.registered" || type === "task.updated") {
          assert.deepEqual(Object.keys(event.payload.task).sort(), ["priority", "startedAt", "status", "taskId", "traceId", "version"]);
          assert.equal(typeof event.payload.task.taskId, "string");
        }
        if (type === "task.interrupted" || type === "task.cancelled") assert.equal(event.payload.reasonCode, "TASK_STATE_CHANGED");
      }
      return centerEvent;
    };

    const registered = await capture("task.registered", () => runtime.startTask({
      taskId, traceId: "private-trace", priority: "secondary", goal: markers[0],
      conditions: [{ key: "need", classification: "inferred", value: markers[1], source: "simulated", observedAt: 1 }],
    }));
    assert.equal(registered.payload.task.goal, markers[0]);
    assert.equal(registered.payload.task.conditions[0].value, markers[1]);

    const updated = await capture("task.updated", () => runtime.updateTaskProgress({ taskId, traceId: "update-trace", currentStep: markers[2], pauseReason: markers[3] }));
    assert.equal(updated.payload.task.currentStep, markers[2]);
    assert.equal(updated.payload.task.pauseReason, markers[3]);
    const actionUpdated = await capture("task.updated", () => runtime.recordTaskAction({
      taskId, traceId: "action-trace", actionId: "private-action", idempotencyKey: "private-idempotency", status: "running", reasonCode: markers[4],
    }));
    assert.equal(actionUpdated.payload.task.actionRecords[0].reasonCode, markers[4]);

    await capture("task.interrupted", () => runtime.ingestSignal({
      signalId: "critical-private-task", type: "safety.critical", value: { severity: "critical" }, source: "sensor", timestamp: 2,
    }, "interrupt-trace"));
    // Safety interruption makes an in-flight action outcome unresolved until
    // an explicit reconciliation arrives.
    runtime.recordTaskAction({
      taskId, traceId: "reconcile-trace", actionId: "private-action",
      idempotencyKey: "private-idempotency", status: "succeeded", reasonCode: markers[4],
    });
    await capture("task.resumed", () => runtime.resumeTask({ taskId, traceId: "resume-trace" }));
    await capture("task.cancelled", () => runtime.cancelTask(taskId, "cancel-trace", "PRIVATE_CANCEL_DETAIL"));

    await capture("task.registered", () => runtime.startTask({
      taskId: "completed-task", traceId: "completed-trace", priority: "secondary", goal: markers[0],
    }));
    const completed = await capture("task.completed", () => runtime.completeTask("completed-task", "complete-trace"));
    assert.equal(completed.payload.taskId, "completed-task");

    const cluster = nonCenters.find((client) => client.registration.role === "cluster")!;
    await closeSocket(cluster.socket);
    const reconnected = await connect(gateway.address()!, cluster.registration);
    clients.push(reconnected);
    assertNoPrivateMarkers(reconnected.snapshot.snapshot.state.activeTasks);
    assert.deepEqual(Object.keys(reconnected.snapshot.snapshot.state.activeTasks[0]).sort(), ["priority", "startedAt", "status", "taskId", "traceId", "version"]);

    const replayWait = waitForMessage(center.socket, (message) => message.kind === "event" && message.event?.type === "task.updated");
    center.socket.send(JSON.stringify({ kind: "resync", protocolVersion: 1, sessionId: runtime.sessionId, traceId: "task-replay", afterSequence: 2 }));
    const replayed = await replayWait;
    assert.equal(replayed.event.type, "task.updated");
    assert.ok(markers.some((marker) => JSON.stringify(replayed.event).includes(marker)));
    const publicReplayWait = waitForMessage(reconnected.socket, (message) => message.kind === "event" && message.event?.type === "task.updated");
    reconnected.socket.send(JSON.stringify({ kind: "resync", protocolVersion: 1, sessionId: runtime.sessionId, traceId: "public-task-replay", afterSequence: 2 }));
    const publicReplay = await publicReplayWait;
    assertNoPrivateMarkers(publicReplay.event);
  } finally {
    await Promise.all(clients.map((client) => closeSocket(client.socket)));
    await gateway.close();
  }
});

interface Client {
  socket: WebSocket;
  registration: DisplayRegistration;
  snapshot: Record<string, any>;
}

async function connect(address: string, registration: DisplayRegistration): Promise<Client> {
  const socket = new WebSocket(address);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const snapshotPromise = waitForMessage(socket, (message) => message.kind === "snapshot");
  const welcomePromise = waitForMessage(socket, (message) => message.kind === "welcome");
  socket.send(JSON.stringify({ kind: "register", protocolVersion: 1, displayId: registration.displayId, deviceId: registration.deviceId, traceId: `register-${registration.displayId}` }));
  const [snapshot] = await Promise.all([snapshotPromise, welcomePromise]);
  return { socket, registration, snapshot };
}

function waitForMessage(socket: WebSocket, predicate: (message: Record<string, any>) => boolean): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off("message", onMessage); reject(new Error("TEST_MESSAGE_TIMEOUT")); }, 3_000);
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as Record<string, any>;
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

function assertNoPrivateMarkers(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const marker of markers) assert.equal(serialized.includes(marker), false, `non-Center projection leaked ${marker}`);
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  if (socket.readyState !== WebSocket.OPEN) { socket.terminate(); return; }
  await new Promise<void>((resolve) => { socket.once("close", () => resolve()); socket.close(1000, "test complete"); });
}
