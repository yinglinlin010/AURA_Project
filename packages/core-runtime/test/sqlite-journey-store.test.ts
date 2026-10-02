import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JOURNEY_RETENTION_MS, SqliteJourneyStore } from "../../../adapters/persistence/sqlite-journey-store.js";

test("SQLite Journey store survives reopen and only replaces user-authored state", () => {
  const directory = mkdtempSync(join(tmpdir(), "aura-journey-store-"));
  const databasePath = join(directory, "journeys.sqlite");
  let now = 1_000;
  const journey = {
    journeyId: "trip-1",
    origin: { userSuppliedText: "Home" },
    destination: { userSuppliedText: "Hotel" },
    stops: [{ placeId: "user-confirmed-place-id" }],
  };

  try {
    const firstStore = new SqliteJourneyStore({ databasePath, now: () => now });
    const firstWrite = firstStore.save(journey);
    assert.equal(firstWrite.expiresAt, now + JOURNEY_RETENTION_MS);
    firstStore.close();

    now += 60_000;
    const reopenedStore = new SqliteJourneyStore({ databasePath, now: () => now });
    try {
      assert.deepEqual(reopenedStore.get("trip-1"), {
        ...journey,
        createdAt: 1_000,
        updatedAt: 1_000,
        expiresAt: 1_000 + JOURNEY_RETENTION_MS,
      });

      const updated = reopenedStore.save({ ...journey, destination: { userSuppliedText: "Updated hotel" } });
      assert.equal(updated.createdAt, 1_000);
      assert.equal(updated.updatedAt, now);
      assert.equal(updated.expiresAt, now + JOURNEY_RETENTION_MS);
      assert.equal(reopenedStore.list().length, 1);
      assert.equal(reopenedStore.delete("trip-1"), true);
      assert.equal(reopenedStore.get("trip-1"), undefined);
    } finally {
      reopenedStore.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite Journey store expires records and rejects provider response fields", () => {
  const directory = mkdtempSync(join(tmpdir(), "aura-journey-expiry-"));
  const databasePath = join(directory, "journeys.sqlite");
  let now = 5_000;
  const store = new SqliteJourneyStore({ databasePath, now: () => now });
  try {
    store.save({
      journeyId: "trip-expiring",
      destination: { userSuppliedText: "Hotel" },
      stops: [{ placeId: "user-confirmed-place-id" }],
    });
    assert.throws(() => store.save({
      journeyId: "provider-content",
      destination: { userSuppliedText: "Hotel", provider: "maps", displayName: "Provider response" } as never,
      stops: [{ placeId: "user-confirmed-place-id" }],
    }), /UNSUPPORTED_JOURNEY_LOCATION_FIELD/);

    now += JOURNEY_RETENTION_MS;
    assert.equal(store.get("trip-expiring"), undefined);
    assert.equal(store.list().length, 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
