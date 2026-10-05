import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CabinCoordinator,
  parseVoiceVote,
  parseTripEdit,
  voteOutcome,
} from "../src/cabin-coordinator.js";
import { CoreRuntime } from "../../../packages/core-runtime/src/core-runtime.js";
import type { DisplayRegistry } from "../../../contracts/protocol/src/types.js";
import type {
  CabinPlace,
  CabinRole,
} from "../../../contracts/protocol/src/cabin.js";
import type { CabinMaps } from "../../../adapters/maps/cabin-maps.js";
import type { CabinIntelligence } from "../../../adapters/voice/cabin-intelligence.js";
const registry = JSON.parse(
  readFileSync("apps/core-host/config/display-registry.json", "utf8"),
) as DisplayRegistry;
const registration = (role: CabinRole) =>
  registry.displays.find((d) => d.role === role)!;
const place = (id: string): CabinPlace => ({
  id,
  name: id,
  address: "fixture test",
  latitude: 24,
  longitude: 121,
  provider: "osm",
  observedAt: Date.now(),
  mapsUrl: "https://www.openstreetmap.org",
});
function fixture(
  options: {
    failRoute?: () => boolean;
    failSearch?: boolean;
    cache?: Pick<
      ConstructorParameters<typeof CabinCoordinator>[0],
      "initialPlaces" | "initialQueries" | "savePlaces"
    >;
    timeout?: number;
    slowRoute?: () => Promise<void>;
    transcript?: string;
  } = {},
) {
  const runtime = new CoreRuntime({ registry });
  runtime.ingestSignal(
    {
      signalId: "load",
      type: "driver.cognitive_load",
      value: { level: "normal" },
      source: "simulated",
      timestamp: Date.now(),
      confidence: 1,
    },
    "load",
  );
  runtime.updateConnectivity({
    mode: "online",
    source: "derived",
    evidence: "fixture",
    traceId: "fixture",
  });
  const maps: CabinMaps = {
    provider: "osm",
    async search(query) {
      if (options.failSearch) throw new Error("EXTERNAL_SEARCH_UNAVAILABLE");
      return [place(query)];
    },
    async route(_origin, _destination, stops) {
      if (options.slowRoute) await options.slowRoute();
      if (options.failRoute?.()) throw new Error("ROUTE_UNAVAILABLE");
      return {
        distanceMeters: 10000 + stops.length * 1000,
        durationSeconds: 600 + stops.length * 60,
        coordinates: [
          [121, 24],
          [121.1, 24.1],
        ],
        order: stops.map((p) => p.id).reverse(),
        provider: "osm",
        observedAt: Date.now(),
        mapsUrl: "https://www.openstreetmap.org",
      };
    },
  };
  const intelligence: CabinIntelligence = {
    cloudAvailable: true,
    localSpeechAvailable: true,
    async transcribe() {
      return options.transcript ?? "我同意加入行程";
    },
    async recommend(query) {
      return { query, reason: "fixture", provider: "fixture" };
    },
    async identify() {
      return { query: "mountain lake", description: "test image" };
    },
    async matchImages() {
      return [];
    },
  };
  const coordinator = new CabinCoordinator({
    runtime,
    registry,
    maps,
    intelligence,
    ...options.cache,
    ...(options.timeout ? { voteTimeoutMs: options.timeout } : {}),
  });
  const send = (
    role: CabinRole,
    command: Parameters<CabinCoordinator["command"]>[0],
  ) => coordinator.command(command, registration(role));
  const setup = async () => {
    await send("center", {
      type: "trip.configure",
      origin: "origin",
      destination: "destination",
    });
    await send("rear", {
      type: "place.search",
      query: "lake",
      recommend: false,
    });
  };
  return { coordinator, runtime, send, setup };
}
test("photo reaches mother; only mother can acknowledge; cluster never receives image bytes", async () => {
  const f = fixture();
  try {
    await f.send("rear", {
      type: "photo.share",
      personId: "rear-1",
      dataUrl: "data:image/png;base64,aGVsbG8=",
    });
    const photo = f.coordinator.snapshot("front_passenger").photos[0]!;
    assert.equal(photo.sender, "後座小孩");
    assert.equal(f.coordinator.snapshot("cluster").photos.length, 0);
    await assert.rejects(
      f.send("rear", { type: "photo.ack", photoId: photo.id }),
      /PHOTO_RECEIVER_ONLY/,
    );
    await f.send("front_passenger", { type: "photo.ack", photoId: photo.id });
    assert.equal(f.coordinator.snapshot("rear").photos.length, 0);
  } finally {
    f.coordinator.close();
  }
});
test("front/rear subtitles cross screens and reject a spoofed person", async () => {
  const f = fixture();
  try {
    await f.send("front_passenger", {
      type: "caption.send",
      personId: "mother",
      text: "你看到什麼？",
    });
    assert.equal(
      f.coordinator.snapshot("rear").captions[0]?.text,
      "你看到什麼？",
    );
    assert.equal(f.coordinator.snapshot("front_passenger").captions.length, 0);
    await f.send("rear", {
      type: "caption.send",
      personId: "rear-1",
      text: "我看到湖",
    });
    assert.equal(
      f.coordinator.snapshot("front_passenger").captions[0]?.text,
      "我看到湖",
    );
    await assert.rejects(
      f.send("rear", {
        type: "caption.send",
        personId: "driver",
        text: "pretend driver",
      }),
      /ROLE_MISMATCH/,
    );
  } finally {
    f.coordinator.close();
  }
});
test("majority alone cannot insert; driver voice approval updates route and core exactly once", async () => {
  const f = fixture();
  try {
    await f.setup();
    await f.send("rear", {
      type: "trip.propose",
      personId: "rear-1",
      placeId: "lake",
    });
    const id = f.coordinator.snapshot("rear").ballot!.id;
    await f.send("rear", {
      type: "vote.cast",
      personId: "rear-1",
      ballotId: id,
      approve: true,
    });
    await f.send("front_passenger", {
      type: "vote.cast",
      personId: "mother",
      ballotId: id,
      approve: true,
    });
    assert.equal(f.coordinator.snapshot("center").ballot?.status, "pending");
    assert.equal(f.runtime.getState().journey.stops.length, 0);
    await f.send("center", {
      type: "speech.transcribe",
      personId: "driver",
      data: "aGVsbG8=",
      mimeType: "audio/wav",
      purpose: "vote",
    });
    assert.equal(f.coordinator.snapshot("center").ballot?.status, "passed");
    assert.equal(f.coordinator.snapshot("center").trip.stops[0]?.id, "lake");
    assert.equal(f.runtime.getState().journey.stops.length, 1);
    await assert.rejects(
      f.send("center", {
        type: "vote.cast",
        personId: "driver",
        ballotId: id,
        approve: true,
      }),
      /NOT_PENDING/,
    );
    assert.equal(f.runtime.getState().journey.stops.length, 1);
  } finally {
    f.coordinator.close();
  }
});
test("driver veto fails on every screen without adding a stop", async () => {
  const f = fixture();
  try {
    await f.setup();
    await f.send("rear", {
      type: "trip.propose",
      personId: "rear-1",
      placeId: "lake",
    });
    const id = f.coordinator.snapshot("rear").ballot!.id;
    await f.send("center", {
      type: "vote.cast",
      personId: "driver",
      ballotId: id,
      approve: false,
    });
    for (const role of [
      "center",
      "rear",
      "front_passenger",
      "cluster",
      "interactive_window",
    ] as CabinRole[])
      assert.equal(f.coordinator.snapshot(role).ballot?.status, "failed");
    assert.equal(f.runtime.getState().journey.stops.length, 0);
  } finally {
    f.coordinator.close();
  }
});
test("occupancy change cancels electorate and declines Core consent", async () => {
  const f = fixture();
  try {
    await f.setup();
    await f.send("rear", {
      type: "trip.propose",
      personId: "rear-1",
      placeId: "lake",
    });
    await f.send("center", {
      type: "people.set",
      count: 4,
      policy: "majority_driver",
    });
    assert.equal(f.coordinator.snapshot("rear").ballot?.status, "cancelled");
    assert.equal(f.coordinator.snapshot("rear").people.length, 4);
    assert.equal(
      f.runtime.getState().activeProposals.at(-1)?.status,
      "declined",
    );
    await assert.rejects(
      f.send("rear", {
        type: "people.set",
        count: 2,
        policy: "majority_driver",
      }),
      /DRIVER_ONLY/,
    );
  } finally {
    f.coordinator.close();
  }
});
test("failed route is retryable and never mutates Core before valid route", async () => {
  let fail = false;
  const f = fixture({ failRoute: () => fail });
  try {
    await f.setup();
    fail = true;
    await f.send("rear", {
      type: "trip.propose",
      personId: "rear-1",
      placeId: "lake",
    });
    const id = f.coordinator.snapshot("rear").ballot!.id;
    await f.send("rear", {
      type: "vote.cast",
      personId: "rear-1",
      ballotId: id,
      approve: true,
    });
    await f.send("center", {
      type: "vote.cast",
      personId: "driver",
      ballotId: id,
      approve: true,
    });
    assert.equal(f.coordinator.snapshot("rear").ballot?.status, "error");
    assert.equal(f.runtime.getState().journey.stops.length, 0);
    fail = false;
    await f.send("center", { type: "vote.retry", ballotId: id });
    assert.equal(f.coordinator.snapshot("rear").ballot?.status, "passed");
    assert.equal(f.runtime.getState().journey.stops.length, 1);
  } finally {
    f.coordinator.close();
  }
});
test("timeout leaves trip unchanged", async () => {
  const f = fixture({ timeout: 15 });
  try {
    await f.setup();
    await f.send("rear", {
      type: "trip.propose",
      personId: "rear-1",
      placeId: "lake",
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(f.coordinator.snapshot("rear").ballot?.status, "expired");
    assert.equal(f.runtime.getState().journey.stops.length, 0);
  } finally {
    f.coordinator.close();
  }
});
test("voice confirmation requires unambiguous intent; threshold counts abstentions", () => {
  assert.equal(parseVoiceVote("我同意加入行程。"), true);
  assert.equal(parseVoiceVote("不同意"), false);
  for (const text of [
    "我同意嗎",
    "如果我同意",
    "我沒有不同意",
    "我可能同意",
    "你是不是同意",
  ])
    assert.equal(parseVoiceVote(text), null);
  assert.equal(
    voteOutcome({
      electorate: [{ id: "driver", name: "driver", seat: "driver" }],
      votes: { driver: true },
      policy: "majority_driver",
    }),
    "passed",
  );
});
test("ambiguous speech does not cast a vote or change route", async () => {
  const f = fixture({ transcript: "我同意嗎？" });
  try {
    await f.setup();
    await f.send("rear", {
      type: "trip.propose",
      personId: "rear-1",
      placeId: "lake",
    });
    await assert.rejects(
      f.send("center", {
        type: "speech.transcribe",
        personId: "driver",
        data: "aGVsbG8=",
        mimeType: "audio/wav",
        purpose: "vote",
      }),
      /VOICE_VOTE_UNCLEAR/,
    );
    assert.equal(
      Object.keys(f.coordinator.snapshot("center").ballot!.votes).length,
      0,
    );
    assert.equal(f.runtime.getState().journey.stops.length, 0);
  } finally {
    f.coordinator.close();
  }
});
test("recording tied to a previous ballot cannot confirm a new one", async () => {
  const f = fixture();
  try {
    await f.setup();
    await f.send("rear", {
      type: "trip.propose",
      personId: "rear-1",
      placeId: "lake",
    });
    await assert.rejects(
      f.send("center", {
        type: "speech.transcribe",
        personId: "driver",
        data: "aGVsbG8=",
        mimeType: "audio/wav",
        purpose: "vote",
        ballotId: "stale",
      }),
      /BALLOT_CHANGED/,
    );
    assert.equal(f.runtime.getState().journey.stops.length, 0);
    assert.equal(parseVoiceVote("我同意將入形成。"), true);
  } finally {
    f.coordinator.close();
  }
});
test("occupancy change while route is optimizing prevents a late route from being applied", async () => {
  let calls = 0;
  let release: () => void = () => {};
  const f = fixture({
    slowRoute: async () => {
      if (++calls > 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
    },
  });
  try {
    await f.setup();
    await f.send("rear", {
      type: "trip.propose",
      personId: "rear-1",
      placeId: "lake",
    });
    const id = f.coordinator.snapshot("rear").ballot!.id;
    await f.send("rear", {
      type: "vote.cast",
      personId: "rear-1",
      ballotId: id,
      approve: true,
    });
    const pending = f.send("center", {
      type: "vote.cast",
      personId: "driver",
      ballotId: id,
      approve: true,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.coordinator.snapshot("rear").ballot?.status, "optimizing");
    await f.send("center", {
      type: "people.set",
      count: 4,
      policy: "majority_driver",
    });
    release();
    await pending;
    assert.equal(f.coordinator.snapshot("rear").ballot?.status, "cancelled");
    assert.equal(f.runtime.getState().journey.stops.length, 0);
    assert.equal(f.coordinator.snapshot("rear").trip.stops.length, 0);
  } finally {
    release();
    f.coordinator.close();
  }
});
test("checkpoint saves only approved trip and count; photos, captions and votes do not survive restart", async () => {
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { saveCabinCheckpoint, readCabinCheckpoint } =
    await import("../src/cabin-checkpoint.js");
  const dir = await mkdtemp(join(tmpdir(), "aura-checkpoint-test-"));
  const path = join(dir, "state.json");
  const f = fixture();
  try {
    await f.setup();
    await f.send("rear", {
      type: "photo.share",
      personId: "rear-1",
      dataUrl: "data:image/png;base64,aGVsbG8=",
    });
    await f.send("rear", {
      type: "caption.send",
      personId: "rear-1",
      text: "private text",
    });
    saveCabinCheckpoint(
      f.coordinator.snapshot("rear"),
      f.runtime.getState().journey,
      path,
    );
    const raw = await readFile(path, "utf8");
    assert.doesNotMatch(
      raw,
      /aGVsbG8|private text|photos|captions|ballot|GEMINI/,
    );
    const saved = readCabinCheckpoint(path)!;
    assert.equal(saved.trip.origin?.name, "origin");
    const restored = new CabinCoordinator({
      runtime: f.runtime,
      registry,
      initialTrip: saved.trip,
      initialCount: saved.count,
      intelligence: {
        cloudAvailable: false,
        localSpeechAvailable: false,
        async transcribe() {
          return "";
        },
        async recommend() {
          return { query: "", reason: "", provider: "" };
        },
        async identify() {
          return { query: "", description: "" };
        },
        async matchImages() {
          return [];
        },
      },
    });
    assert.equal(restored.snapshot("rear").photos.length, 0);
    assert.equal(restored.snapshot("rear").captions.length, 0);
    assert.equal(restored.snapshot("rear").trip.origin?.name, "origin");
    restored.close();
  } finally {
    f.coordinator.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("front seat removes an approved stop, updating Core and route; stale and rear edits rejected", async () => {
  const f = fixture();
  try {
    await f.setup();
    await f.send("rear", {
      type: "trip.propose",
      personId: "rear-1",
      placeId: "lake",
    });
    const ballotId = f.coordinator.snapshot("rear").ballot!.id;
    await f.send("rear", {
      type: "vote.cast",
      personId: "rear-1",
      ballotId,
      approve: true,
    });
    await f.send("center", {
      type: "vote.cast",
      personId: "driver",
      ballotId,
      approve: true,
    });
    const version = f.coordinator.snapshot("rear").trip.version;
    await assert.rejects(
      f.send("rear", { type: "trip.remove", placeId: "lake", version }),
      /TRIP_EDIT_FORBIDDEN/,
    );
    await assert.rejects(
      f.send("front_passenger", {
        type: "trip.remove",
        placeId: "lake",
        version: version - 1,
      }),
      /TRIP_CHANGED/,
    );
    await f.send("front_passenger", {
      type: "trip.remove",
      placeId: "lake",
      version,
    });
    assert.equal(f.coordinator.snapshot("rear").trip.stops.length, 0);
    assert.equal(f.runtime.getState().journey.stops.length, 0);
    assert.equal(
      f.coordinator.snapshot("rear").trip.route?.distanceMeters,
      10000,
    );
  } finally {
    f.coordinator.close();
  }
});
test("failed removal route retains the approved trip and Core stop", async () => {
  let fail = false;
  const f = fixture({ failRoute: () => fail });
  try {
    await f.setup();
    await f.send("rear", {
      type: "trip.propose",
      personId: "rear-1",
      placeId: "lake",
    });
    const ballotId = f.coordinator.snapshot("rear").ballot!.id;
    await f.send("rear", {
      type: "vote.cast",
      personId: "rear-1",
      ballotId,
      approve: true,
    });
    await f.send("center", {
      type: "vote.cast",
      personId: "driver",
      ballotId,
      approve: true,
    });
    const before = f.coordinator.snapshot("rear").trip;
    fail = true;
    await assert.rejects(
      f.send("front_passenger", {
        type: "trip.remove",
        placeId: "lake",
        version: before.version,
      }),
      /ROUTE_UNAVAILABLE/,
    );
    assert.deepEqual(f.coordinator.snapshot("rear").trip, before);
    assert.equal(f.runtime.getState().journey.stops.length, 1);
  } finally {
    f.coordinator.close();
  }
});
test("clear trip cancels a pending ballot and prevents late vote adding a stop", async () => {
  const f = fixture();
  try {
    await f.setup();
    await f.send("rear", {
      type: "trip.propose",
      personId: "rear-1",
      placeId: "lake",
    });
    const ballotId = f.coordinator.snapshot("rear").ballot!.id;
    await f.send("center", {
      type: "trip.clear",
      version: f.coordinator.snapshot("rear").trip.version,
    });
    assert.equal(f.coordinator.snapshot("rear").trip.origin, null);
    assert.equal(f.coordinator.snapshot("rear").ballot, null);
    assert.equal(
      f.runtime.getState().activeProposals.find((p) => p.payload?.cabinBallot)
        ?.status,
      "declined",
    );
    await assert.rejects(
      f.send("center", {
        type: "vote.cast",
        personId: "driver",
        ballotId,
        approve: true,
      }),
    );
    assert.equal(f.runtime.getState().journey.stops.length, 0);
  } finally {
    f.coordinator.close();
  }
});

test("explicit voice deletion removes the named stop and syncs Core; voice clear empties trip", async () => {
  const f = fixture({ transcript: "請幫我刪除lake" });
  try {
    await f.setup();
    await f.send("rear", {
      type: "trip.propose",
      personId: "rear-1",
      placeId: "lake",
    });
    const ballotId = f.coordinator.snapshot("rear").ballot!.id;
    await f.send("rear", {
      type: "vote.cast",
      personId: "rear-1",
      ballotId,
      approve: true,
    });
    await f.send("center", {
      type: "vote.cast",
      personId: "driver",
      ballotId,
      approve: true,
    });
    const version = f.coordinator.snapshot("rear").trip.version;
    await assert.rejects(
      f.send("rear", {
        type: "speech.transcribe",
        personId: "rear-1",
        data: "aGVsbG8=",
        mimeType: "audio/wav",
        purpose: "trip_edit",
        tripVersion: version,
      }),
      /TRIP_EDIT_FORBIDDEN/,
    );
    const result = await f.send("center", {
      type: "speech.transcribe",
      personId: "driver",
      data: "aGVsbG8=",
      mimeType: "audio/wav",
      purpose: "trip_edit",
      tripVersion: version,
    });
    assert.match(result.text!, /已刪除 lake/);
    assert.equal(f.runtime.getState().journey.stops.length, 0);
    assert.equal(f.coordinator.snapshot("rear").trip.stops.length, 0);
    await assert.rejects(
      f.send("center", {
        type: "speech.transcribe",
        personId: "driver",
        data: "aGVsbG8=",
        mimeType: "audio/wav",
        purpose: "trip_edit",
        tripVersion: version,
      }),
      /TRIP_CHANGED/,
    );
  } finally {
    f.coordinator.close();
  }
  const g = fixture({ transcript: "清空行程" });
  try {
    await g.setup();
    await g.send("front_passenger", {
      type: "speech.transcribe",
      personId: "mother",
      data: "aGVsbG8=",
      mimeType: "audio/wav",
      purpose: "trip_edit",
      tripVersion: g.coordinator.snapshot("rear").trip.version,
    });
    assert.equal(g.coordinator.snapshot("rear").trip.origin, null);
  } finally {
    g.coordinator.close();
  }
});
test("voice deletion parser rejects questions and negative commands", () => {
  for (const phrase of [
    "不要刪除鯉魚潭",
    "可以刪除鯉魚潭嗎",
    "如果刪除鯉魚潭",
    "也許清空行程",
    "刪除鯉魚潭以及七星潭",
  ]) {
    assert.equal(parseTripEdit(phrase), null);
  }
  assert.deepEqual(parseTripEdit("請幫我刪除福和橋"), {
    type: "remove",
    name: "福和橋",
  });
  assert.deepEqual(parseTripEdit("清空全部行程"), { type: "clear" });
});

test("front passenger configures the shared route; rear cannot reset it", async () => {
  const f = fixture();
  try {
    await f.send("front_passenger", {
      type: "trip.configure",
      origin: "front origin",
      destination: "front destination",
    });
    const trip = f.coordinator.snapshot("rear").trip;
    assert.equal(trip.origin?.name, "front origin");
    assert.equal(trip.destination?.name, "front destination");
    assert.ok(trip.route);
    await assert.rejects(
      f.send("rear", {
        type: "trip.configure",
        origin: "wrong",
        destination: "wrong",
      }),
      /TRIP_EDIT_FORBIDDEN/,
    );
    assert.deepEqual(f.coordinator.snapshot("rear").trip, trip);
  } finally {
    f.coordinator.close();
  }
});

test("no passenger vote requires only driver confirmation, while other riders cannot cast", async () => {
  const f = fixture();
  try {
    await f.setup();
    await f.send("rear", {
      type: "trip.propose",
      personId: "rear-1",
      placeId: "lake",
      votingEnabled: false,
      voteDurationSeconds: 30,
    });
    const ballot = f.coordinator.snapshot("rear").ballot!;
    assert.equal(ballot.votingEnabled, false);
    assert.equal(f.coordinator.snapshot("rear").trip.stops.length, 0);
    await assert.rejects(
      f.send("rear", {
        type: "vote.cast",
        personId: "rear-1",
        ballotId: ballot.id,
        approve: true,
      }),
      /DRIVER_CONFIRMATION_ONLY/,
    );
    await f.send("center", {
      type: "vote.cast",
      personId: "driver",
      ballotId: ballot.id,
      approve: true,
    });
    assert.equal(f.coordinator.snapshot("rear").ballot?.status, "passed");
    assert.equal(f.runtime.getState().journey.stops.length, 1);
  } finally {
    f.coordinator.close();
  }
});
test("scheduled vote opens at chosen time; voting duration starts at opening", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  const f = fixture();
  try {
    await f.setup();
    await f.send("rear", {
      type: "trip.propose",
      personId: "rear-1",
      placeId: "lake",
      startDelaySeconds: 30,
      voteDurationSeconds: 20,
    });
    const b = f.coordinator.snapshot("rear").ballot!;
    assert.equal(b.status, "scheduled");
    assert.equal(b.deadline - b.opensAt!, 20000);
    await assert.rejects(
      f.send("center", {
        type: "vote.cast",
        personId: "driver",
        ballotId: b.id,
        approve: true,
      }),
      /BALLOT_NOT_PENDING/,
    );
    t.mock.timers.tick(29999);
    assert.equal(f.coordinator.snapshot("rear").ballot?.status, "scheduled");
    t.mock.timers.tick(1);
    assert.equal(f.coordinator.snapshot("rear").ballot?.status, "pending");
    t.mock.timers.tick(19999);
    assert.equal(f.coordinator.snapshot("rear").ballot?.status, "pending");
    t.mock.timers.tick(1);
    assert.equal(f.coordinator.snapshot("rear").ballot?.status, "expired");
    assert.equal(f.runtime.getState().journey.stops.length, 0);
  } finally {
    f.coordinator.close();
  }
});
test("occupancy cancels a scheduled vote; its timer cannot revive it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  const f = fixture();
  try {
    await f.setup();
    await f.send("rear", {
      type: "trip.propose",
      personId: "rear-1",
      placeId: "lake",
      startDelaySeconds: 10,
    });
    await f.send("center", {
      type: "people.set",
      count: 4,
      policy: "majority_driver",
    });
    assert.equal(f.coordinator.snapshot("rear").ballot?.status, "cancelled");
    t.mock.timers.tick(10000);
    assert.equal(f.coordinator.snapshot("rear").ballot, null);
    assert.equal(f.runtime.getState().journey.stops.length, 0);
  } finally {
    f.coordinator.close();
  }
});
test("invalid vote timing rejected without creating a Core proposal", async () => {
  const f = fixture();
  try {
    await f.setup();
    for (const timing of [
      { startDelaySeconds: -1 },
      { voteDurationSeconds: 0 },
      { votingEnabled: false, startDelaySeconds: 1 },
    ]) {
      await assert.rejects(
        f.send("rear", {
          type: "trip.propose",
          personId: "rear-1",
          placeId: "lake",
          ...timing,
        }),
        /VOTE_TIMING_INVALID/,
      );
    }
    assert.equal(f.runtime.getState().activeProposals.length, 0);
  } finally {
    f.coordinator.close();
  }
});

test("editing endpoints preserves approved stops and Core journey", async () => {
  const f = fixture();
  try {
    await f.setup();
    await f.send("rear", {
      type: "trip.propose",
      personId: "rear-1",
      placeId: "lake",
    });
    const ballotId = f.coordinator.snapshot("rear").ballot!.id;
    await f.send("rear", {
      type: "vote.cast",
      personId: "rear-1",
      ballotId,
      approve: true,
    });
    await f.send("center", {
      type: "vote.cast",
      personId: "driver",
      ballotId,
      approve: true,
    });
    await f.send("front_passenger", {
      type: "trip.configure",
      origin: "new origin",
      destination: "new destination",
    });
    assert.equal(f.coordinator.snapshot("rear").trip.stops[0]?.id, "lake");
    assert.equal(f.runtime.getState().journey.stops[0]?.placeId, "lake");
    assert.equal(
      f.coordinator.snapshot("rear").trip.origin?.name,
      "new origin",
    );
  } finally {
    f.coordinator.close();
  }
});
test("closed ballot voice cannot approve an unrelated pending Core action", async () => {
  const f = fixture();
  try {
    await f.setup();
    await f.send("rear", {
      type: "trip.propose",
      personId: "rear-1",
      placeId: "lake",
    });
    const ballotId = f.coordinator.snapshot("rear").ballot!.id;
    await f.send("center", {
      type: "vote.cast",
      personId: "driver",
      ballotId,
      approve: false,
    });
    f.runtime.proposeAction(
      {
        proposalId: "unrelated",
        kind: "SHOW_INFORMATION",
        summary: "unrelated",
        targetRole: "center",
        priority: "normal",
        requiresConsent: true,
        payload: { message: "unrelated" },
      },
      "front_passenger",
      "unrelated",
    );
    await assert.rejects(
      f.send("center", {
        type: "speech.transcribe",
        personId: "driver",
        purpose: "vote",
        ballotId,
        data: "aGVsbG8=",
        mimeType: "audio/wav",
      }),
      /BALLOT_NOT_PENDING/,
    );
    assert.equal(
      f.runtime
        .getState()
        .activeProposals.find((p) => p.proposalId === "unrelated")?.status,
      "awaiting_consent",
    );
  } finally {
    f.coordinator.close();
  }
});

test("demo navigation advances shared position, ends at destination and stops when route changes", async (t) => {
  t.mock.timers.enable({
    apis: ["setTimeout", "setInterval", "Date"],
    now: Date.now(),
  });
  const f = fixture();
  try {
    await f.setup();
    const version = f.coordinator.snapshot("rear").trip.version;
    await f.send("center", { type: "navigation.start", mode: "demo", version });
    t.mock.timers.tick(1000);
    const nav = f.coordinator.snapshot("rear").navigation!;
    assert.equal(nav.status, "active");
    assert.ok(nav.traveledMeters > 0);
    assert.ok(nav.remainingMeters < 10000);
    assert.ok(nav.position);
    await f.send("front_passenger", {
      type: "trip.configure",
      origin: "other",
      destination: "other destination",
    });
    assert.equal(f.coordinator.snapshot("rear").navigation?.status, "stopped");
    t.mock.timers.tick(1000);
    assert.equal(f.coordinator.snapshot("rear").navigation?.status, "stopped");
    await f.send("center", {
      type: "navigation.start",
      mode: "demo",
      version: f.coordinator.snapshot("rear").trip.version,
    });
    t.mock.timers.tick(31000);
    assert.equal(f.coordinator.snapshot("rear").navigation?.status, "arrived");
    assert.equal(f.coordinator.snapshot("rear").navigation?.remainingMeters, 0);
  } finally {
    f.coordinator.close();
  }
});
test("GPS navigation validates driver, accuracy, old samples and off-route position", async () => {
  const f = fixture();
  try {
    await f.setup();
    const version = f.coordinator.snapshot("rear").trip.version;
    await assert.rejects(
      f.send("rear", { type: "navigation.start", mode: "demo", version }),
      /DRIVER_ONLY/,
    );
    await f.send("center", { type: "navigation.start", mode: "gps", version });
    const sample = {
      type: "navigation.position" as const,
      version,
      latitude: 24.05,
      longitude: 121.05,
      accuracy: 10,
      speed: 10,
      observedAt: Date.now(),
    };
    await f.send("center", sample);
    assert.ok(f.coordinator.snapshot("rear").navigation!.traveledMeters > 0);
    await assert.rejects(
      f.send("center", { ...sample, observedAt: sample.observedAt - 1000 }),
      /GPS_POSITION_STALE/,
    );
    await f.send("center", {
      ...sample,
      accuracy: 300,
      observedAt: Date.now() + 1,
    });
    assert.match(
      f.coordinator.snapshot("rear").navigation!.instruction,
      /精度不足/,
    );
    await f.send("center", {
      ...sample,
      latitude: 25,
      longitude: 122,
      observedAt: Date.now() + 2,
    });
    assert.match(
      f.coordinator.snapshot("rear").navigation!.instruction,
      /偏離路線/,
    );
    await f.send("center", { type: "navigation.stop" });
    await assert.rejects(
      f.send("center", { ...sample, observedAt: Date.now() + 3 }),
      /NAVIGATION_NOT_ACTIVE/,
    );
  } finally {
    f.coordinator.close();
  }
});

test("GPS near the route endpoint but away from destination does not report arrival", async () => {
  const f = fixture();
  try {
    await f.setup();
    const version = f.coordinator.snapshot("rear").trip.version;
    await f.send("center", { type: "navigation.start", mode: "gps", version });
    await f.send("center", {
      type: "navigation.position",
      version,
      latitude: 24.1005,
      longitude: 121.1005,
      accuracy: 10,
      speed: 0,
      observedAt: Date.now(),
    });
    assert.equal(f.coordinator.snapshot("rear").navigation?.status, "active");
    assert.ok(f.coordinator.snapshot("rear").navigation!.remainingMeters > 25);
  } finally {
    f.coordinator.close();
  }
});

test("failed vote notification disappears from every display after exactly five seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  const f = fixture();
  try {
    await f.setup();
    await f.send("rear", {
      type: "trip.propose",
      personId: "rear-1",
      placeId: "lake",
    });
    const ballotId = f.coordinator.snapshot("rear").ballot!.id;
    await f.send("center", {
      type: "vote.cast",
      personId: "driver",
      ballotId,
      approve: false,
    });
    const roles: CabinRole[] = [
      "center",
      "cluster",
      "front_passenger",
      "rear",
      "interactive_window",
    ];
    t.mock.timers.tick(4999);
    for (const role of roles)
      assert.equal(f.coordinator.snapshot(role).ballot?.status, "failed");
    let notifications = 0;
    const unsubscribe = f.coordinator.subscribe(() => notifications++);
    t.mock.timers.tick(1);
    assert.equal(notifications, 1);
    for (const role of roles)
      assert.equal(f.coordinator.snapshot(role).ballot, null);
    assert.equal(f.coordinator.snapshot("rear").trip.stops.length, 0);
    assert.equal(
      f.runtime.getState().activeProposals.find((p) => p.payload?.cabinBallot)
        ?.status,
      "declined",
    );
    unsubscribe();
  } finally {
    f.coordinator.close();
  }
});

test("queried places persist and can be searched offline after a cold restart", async () => {
  const { mkdtemp, rm, readFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readPlaceCache, savePlaceCache } =
    await import("../src/cabin-place-cache.js");
  const folder = await mkdtemp(join(tmpdir(), "aura-poi-test-")),
    path = join(folder, "places.json");
  const f = fixture({
    cache: {
      savePlaces: (places, queries) => savePlaceCache(path, places, queries),
    },
  });
  let g: ReturnType<typeof fixture> | undefined;
  try {
    await f.setup();
    const saved = readPlaceCache(path);
    assert.ok(saved.places.some((p) => p.name === "lake"));
    f.coordinator.close();
    g = fixture({
      failSearch: true,
      cache: { initialPlaces: saved.places, initialQueries: saved.queries },
    });
    g.runtime.updateConnectivity({
      mode: "offline",
      source: "simulated",
      evidence: "test",
      traceId: "offline-cache",
    });
    const result = await g.send("rear", {
      type: "place.search",
      query: "lake",
      recommend: false,
    });
    assert.equal(result.source, "cache");
    assert.equal(result.places?.[0]?.name, "lake");
    const recent = await g.send("rear", { type: "place.cached" });
    assert.ok(recent.places?.length);
    assert.doesNotMatch(
      await readFile(path, "utf8"),
      /photos|captions|GEMINI|navigation|data:image/,
    );
  } finally {
    f.coordinator.close();
    g?.coordinator.close();
    await rm(folder, { recursive: true, force: true });
  }
});
test("stored query aliases and live service failures both use honest cached results", async () => {
  const f = fixture({
    failSearch: true,
    cache: {
      initialPlaces: [place("lake")],
      initialQueries: { 看湖: ["lake"] },
    },
  });
  try {
    const result = await f.send("rear", {
      type: "place.search",
      query: "看湖",
      recommend: false,
    });
    assert.equal(result.places?.[0]?.id, "lake");
    assert.equal(result.source, "cache");
    assert.match(result.provider ?? "", /本機快取/);
  } finally {
    f.coordinator.close();
  }
});
test("all terminal voting results disappear after five seconds while trip outcomes remain", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  for (const outcome of ["passed", "expired", "cancelled"] as const) {
    const f = fixture({ timeout: 10 });
    try {
      await f.setup();
      await f.send("rear", {
        type: "trip.propose",
        personId: "rear-1",
        placeId: "lake",
      });
      const ballotId = f.coordinator.snapshot("rear").ballot!.id;
      if (outcome === "passed") {
        await f.send("rear", {
          type: "vote.cast",
          personId: "rear-1",
          ballotId,
          approve: true,
        });
        await f.send("center", {
          type: "vote.cast",
          personId: "driver",
          ballotId,
          approve: true,
        });
      } else if (outcome === "expired") t.mock.timers.tick(10);
      else
        await f.send("center", {
          type: "people.set",
          count: 4,
          policy: "majority_driver",
        });
      t.mock.timers.tick(4999);
      for (const role of [
        "center",
        "cluster",
        "rear",
        "front_passenger",
        "interactive_window",
      ] as CabinRole[])
        assert.equal(f.coordinator.snapshot(role).ballot?.status, outcome);
      t.mock.timers.tick(1);
      for (const role of [
        "center",
        "cluster",
        "rear",
        "front_passenger",
        "interactive_window",
      ] as CabinRole[])
        assert.equal(f.coordinator.snapshot(role).ballot, null);
      assert.equal(
        f.runtime.getState().journey.stops.length,
        outcome === "passed" ? 1 : 0,
      );
    } finally {
      f.coordinator.close();
    }
  }
});

test("offline recommendations rank cached places even before trip setup; no invented-name lookup", async () => {
  const calls: string[] = [];
  const runtime = new CoreRuntime({ registry });
  runtime.updateConnectivity({
    mode: "offline",
    source: "simulated",
    evidence: "test",
    traceId: "offline",
  });
  const f = new CabinCoordinator({
    runtime,
    registry,
    initialPlaces: [place("lake")],
    maps: {
      provider: "osm",
      async search() {
        throw Error("must not search");
      },
      async route() {
        throw Error("must not route");
      },
    },
    intelligence: {
      cloudAvailable: false,
      localSpeechAvailable: false,
      async transcribe() {
        return "";
      },
      async recommend() {
        throw Error("must not invent a query");
      },
      async identify() {
        return { query: "", description: "" };
      },
      async matchImages() {
        return [];
      },
      async rankPlaces(query, _trip, places, online) {
        calls.push(query);
        assert.equal(online, false);
        return {
          ids: [places[0]!.id],
          reason: "cached recommendation",
          provider: "local-test",
        };
      },
    },
  });
  try {
    const r = await f.command(
      {
        type: "place.search",
        query: "小孩累了想找休息的地方",
        recommend: true,
      },
      registration("rear"),
    );
    assert.equal(r.places?.[0]?.id, "lake");
    assert.equal(calls.length, 1);
  } finally {
    f.close();
  }
});

test("cluster can cast only the driver's ballot and cannot edit the trip", async () => {
  const f = fixture();
  try {
    await f.setup();
    await f.send("rear", {type:"trip.propose",personId:"rear-1",placeId:"lake"});
    const ballotId = f.coordinator.snapshot("cluster").ballot!.id;
    await assert.rejects(f.send("cluster", {type:"vote.cast",personId:"mother",ballotId,approve:true}), /PERSON_ROLE_MISMATCH/);
    await f.send("cluster", {type:"vote.cast",personId:"driver",ballotId,approve:false});
    assert.equal(f.coordinator.snapshot("center").ballot!.status,"failed");
    await assert.rejects(f.send("cluster", {type:"trip.configure",origin:"other",destination:"destination"}), /DISPLAY_READ_ONLY/);
  } finally { f.coordinator.close(); }
});

test("approved insertion continues GPS on new trip version; rejection preserves navigation", async () => {
  const f = fixture();
  try {
    await f.setup();
    await f.send("center", {type:"navigation.start",mode:"gps",version:f.coordinator.snapshot("center").trip.version});
    await f.send("rear", {type:"trip.propose",personId:"rear-1",placeId:"lake"});
    let ballotId=f.coordinator.snapshot("rear").ballot!.id;
    await f.send("rear", {type:"vote.cast",personId:"rear-1",ballotId,approve:true});
    await f.send("center", {type:"vote.cast",personId:"driver",ballotId,approve:true});
    const approved=f.coordinator.snapshot("center");
    assert.equal(approved.ballot!.status,"passed");
    assert.equal(approved.trip.stops.length,1);
    assert.equal(approved.navigation!.status,"active");
    assert.equal(approved.navigation!.tripVersion,approved.trip.version);
    await f.send("rear", {type:"place.search",query:"museum",recommend:false});
    await f.send("rear", {type:"trip.propose",personId:"rear-1",placeId:"museum"});
    ballotId=f.coordinator.snapshot("rear").ballot!.id;
    await f.send("center", {type:"vote.cast",personId:"driver",ballotId,approve:false});
    const rejected=f.coordinator.snapshot("center");
    assert.equal(rejected.ballot!.status,"failed");
    assert.deepEqual(rejected.trip,approved.trip);
    assert.deepEqual(rejected.navigation,approved.navigation);
  } finally { f.coordinator.close(); }
});

test("colloquial voice instructions preserve denial and reject uncertainty", () => {
  for(const phrase of ["好的，我同意加入行程","嗯，可以加入","我確定加入"]) assert.equal(parseVoiceVote(phrase),true,phrase);
  for(const phrase of ["先不要","好，我不同意","不要加"]) assert.equal(parseVoiceVote(phrase),false,phrase);
  for(const phrase of ["應該可以加入","我不是不同意","同意但不要加入","我同意如果免費"]) assert.equal(parseVoiceVote(phrase),null,phrase);
  assert.deepEqual(parseTripEdit("麻煩幫我把鯉魚潭刪掉"),{type:"remove",name:"鯉魚潭"});
  assert.deepEqual(parseTripEdit("取消鯉魚潭"),{type:"remove",name:"鯉魚潭"});
  assert.equal(parseTripEdit("不要把鯉魚潭刪掉"),null);
});
