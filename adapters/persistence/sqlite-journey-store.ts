import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const JOURNEY_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export interface JourneyLocationInput {
  /** Text supplied by the user, never copied from a Maps response. */
  userSuppliedText?: string;
  /** Place IDs are exempt from Google Maps content caching restrictions. */
  placeId?: string;
  userLatitude?: number;
  userLongitude?: number;
}

export interface SaveJourneyInput {
  journeyId: string;
  origin?: JourneyLocationInput;
  destination: JourneyLocationInput;
  stops?: JourneyLocationInput[];
}

export interface StoredJourney extends SaveJourneyInput {
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface SqliteJourneyStoreOptions {
  databasePath?: string;
  now?: () => number;
}

/** Persists user-authored journey inputs and Place IDs locally; provider response content is intentionally excluded. */
export class SqliteJourneyStore {
  private readonly database: Database.Database;
  private readonly now: () => number;
  private readonly selectStatement: Database.Statement;
  private readonly upsertStatement: Database.Statement;
  private readonly deleteStatement: Database.Statement;
  private readonly listStatement: Database.Statement;
  private readonly pruneTimer: ReturnType<typeof setInterval>;

  constructor(options: SqliteJourneyStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    const databasePath = options.databasePath ?? process.env.AURA_JOURNEY_DB ?? resolve(process.cwd(), "data/aura-journeys.sqlite");
    if (databasePath !== ":memory:") mkdirSync(dirname(resolve(databasePath)), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("synchronous = FULL");
    this.database.pragma("secure_delete = ON");
    this.database.pragma("busy_timeout = 5000");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS journeys (
        journey_id TEXT PRIMARY KEY NOT NULL,
        journey_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        CHECK (expires_at_ms > updated_at_ms)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS journeys_expiry_idx ON journeys(expires_at_ms);
    `);
    this.selectStatement = this.database.prepare(
      "SELECT journey_json, created_at_ms, updated_at_ms, expires_at_ms FROM journeys WHERE journey_id = ? AND expires_at_ms > ?",
    );
    this.upsertStatement = this.database.prepare(`
      INSERT INTO journeys (journey_id, journey_json, created_at_ms, updated_at_ms, expires_at_ms)
      VALUES (@journeyId, @journeyJson, @createdAt, @updatedAt, @expiresAt)
      ON CONFLICT(journey_id) DO UPDATE SET
        journey_json = excluded.journey_json,
        updated_at_ms = excluded.updated_at_ms,
        expires_at_ms = excluded.expires_at_ms
    `);
    this.deleteStatement = this.database.prepare("DELETE FROM journeys WHERE journey_id = ?");
    this.listStatement = this.database.prepare(
      "SELECT journey_id, journey_json, created_at_ms, updated_at_ms, expires_at_ms FROM journeys WHERE expires_at_ms > ? ORDER BY updated_at_ms DESC",
    );
    this.pruneExpired();
    this.pruneTimer = setInterval(() => this.pruneExpired(), 60_000);
    this.pruneTimer.unref();
  }

  save(input: SaveJourneyInput): StoredJourney {
    validateJourney(input);
    this.pruneExpired();
    const now = this.now();
    const existing = this.selectStatement.get(input.journeyId, now) as JourneyRow | undefined;
    const stored: StoredJourney = {
      ...structuredClone(input),
      createdAt: existing?.created_at_ms ?? now,
      updatedAt: now,
      expiresAt: now + JOURNEY_RETENTION_MS,
    };
    this.upsertStatement.run({
      journeyId: stored.journeyId,
      journeyJson: JSON.stringify(input),
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      expiresAt: stored.expiresAt,
    });
    return stored;
  }

  get(journeyId: string): StoredJourney | undefined {
    const now = this.now();
    const row = this.selectStatement.get(journeyId, now) as JourneyRow | undefined;
    if (!row) {
      this.deleteStatement.run(journeyId);
      return undefined;
    }
    return fromRow(journeyId, row);
  }

  list(): StoredJourney[] {
    this.pruneExpired();
    const now = this.now();
    return (this.listStatement.all(now) as JourneyListRow[]).map((row) =>
      fromRow(row.journey_id, row),
    );
  }

  pruneExpired(): number {
    const result = this.database.prepare("DELETE FROM journeys WHERE expires_at_ms <= ?").run(this.now());
    return result.changes;
  }

  delete(journeyId: string): boolean {
    return this.deleteStatement.run(journeyId).changes > 0;
  }

  close(): void {
    clearInterval(this.pruneTimer);
    this.database.close();
  }
}

interface JourneyRow {
  journey_json: string;
  created_at_ms: number;
  updated_at_ms: number;
  expires_at_ms: number;
}

interface JourneyListRow extends JourneyRow {
  journey_id: string;
}

function fromRow(journeyId: string, row: JourneyRow): StoredJourney {
  return {
    ...JSON.parse(row.journey_json) as SaveJourneyInput,
    journeyId,
    createdAt: row.created_at_ms,
    updatedAt: row.updated_at_ms,
    expiresAt: row.expires_at_ms,
  };
}

function validateJourney(input: SaveJourneyInput): void {
  rejectExtraKeys(input, ["journeyId", "origin", "destination", "stops"], "UNSUPPORTED_JOURNEY_FIELD");
  if (typeof input.journeyId !== "string" || input.journeyId.trim().length === 0 || input.journeyId.length > 128) {
    throw new Error("INVALID_JOURNEY_ID");
  }
  if (!input.destination || (input.origin === undefined && (!input.stops || input.stops.length === 0))) {
    throw new Error("JOURNEY_REQUIRES_DESTINATION_AND_ORIGIN_OR_STOPS");
  }
  for (const location of [input.origin, input.destination, ...(input.stops ?? [])]) {
    if (location) validateLocation(location);
  }
  if ((input.stops?.length ?? 0) > 20) throw new Error("TOO_MANY_JOURNEY_STOPS");
}

function validateLocation(location: JourneyLocationInput): void {
  rejectExtraKeys(location, ["userSuppliedText", "placeId", "userLatitude", "userLongitude"], "UNSUPPORTED_JOURNEY_LOCATION_FIELD");
  if (location.userSuppliedText !== undefined && (typeof location.userSuppliedText !== "string" || location.userSuppliedText.length > 500)) {
    throw new Error("INVALID_JOURNEY_LOCATION_LABEL");
  }
  if (location.placeId !== undefined && (typeof location.placeId !== "string" || location.placeId.trim().length === 0 || location.placeId.length > 512)) {
    throw new Error("INVALID_JOURNEY_PLACE_ID");
  }
  const hasLat = location.userLatitude !== undefined;
  const hasLng = location.userLongitude !== undefined;
  if (hasLat !== hasLng) throw new Error("INCOMPLETE_JOURNEY_COORDINATES");
  if (hasLat && (!Number.isFinite(location.userLatitude) || location.userLatitude! < -90 || location.userLatitude! > 90 ||
      !Number.isFinite(location.userLongitude) || location.userLongitude! < -180 || location.userLongitude! > 180)) {
    throw new Error("INVALID_JOURNEY_COORDINATES");
  }
  if (!location.userSuppliedText && !location.placeId && !hasLat) throw new Error("EMPTY_JOURNEY_LOCATION");
}

function rejectExtraKeys(value: object, allowed: readonly string[], reasonCode: string): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new Error(reasonCode);
}
