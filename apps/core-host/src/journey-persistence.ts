import { createHash } from "node:crypto";
import type { JourneyState, JourneyStop } from "../../../contracts/protocol/src/types.js";
import type { SqliteJourneyStore, StoredJourney } from "../../../adapters/persistence/sqlite-journey-store.js";

export const ACTIVE_JOURNEY_ID = "aura-active-journey";

/** Restore only fields allowed by the Phase 5 persistence policy. Place IDs
 * survive restart; provider labels/categories are intentionally not retained. */
export function restoreJourney(record: StoredJourney | undefined): JourneyState {
  if (!record) return { stops: [] };
  const locations = record.stops ?? [];
  return {
    stops: locations.flatMap((location, index): JourneyStop[] => {
      if (!location.placeId && !location.userSuppliedText) return [];
      const stableId = createHash("sha256")
        .update(`${index}:${location.placeId ?? location.userSuppliedText}`)
        .digest("hex")
        .slice(0, 20);
      return [{
        stopId: `restored-${stableId}`,
        sourceProposalId: `restored-${stableId}`,
        label: location.userSuppliedText ?? `Saved stop ${index + 1}`,
        ...(location.placeId === undefined ? {} : { placeId: location.placeId }),
        addedAt: record.updatedAt,
      }];
    }),
  };
}

/** Persist Place IDs only: a JourneyStop label may originate from a Maps
 * response and is not safe to store without explicit source provenance. */
export function persistJourney(store: SqliteJourneyStore, journeyId: string, journey: JourneyState): void {
  const stops = journey.stops.flatMap((stop) => stop.placeId ? [{ placeId: stop.placeId }] : []);
  if (stops.length === 0) {
    store.delete(journeyId);
    return;
  }
  store.save({ journeyId, destination: stops[stops.length - 1]!, stops });
}
