# Phase 7 Journey Recommendation

## Implemented

`scoreJourneyOptions` in Core Runtime is a pure, deterministic ranker over typed journey options. Each provided factor carries source, source label, observation time, and freshness. Stale and unknown evidence is excluded; fresh and cached evidence can contribute. The scorer considers POI quality, detour, parking availability/type/cost, traffic delay, weather impact, arrival deadline margin, walking distance, preference fit, and nearby follow-up options. It returns a score, evidence coverage, alternatives, and a rationale that exposes the tradeoffs. Inputs from the `simulated` source mark the recommendation as simulated.

`recommendationStopProposal` converts a selected option into the existing `ADD_TRIP_STOP` contract with a fixed Center target, secondary priority, and mandatory consent. It creates only a proposal request; Core Runtime's existing Action Gate and consent path remain responsible for defer/route/approval and shared journey mutation. A high-load-to-low-load scenario demonstrates the existing DEFER then consent behavior. The comparison fixture demonstrates the higher-rating versus shorter-detour/parking/deadline/follow-up tradeoff, with all illustrative provider-like values explicitly marked simulated.

## Dependencies and limits

The scorer does not call map, parking, traffic, weather, or POI providers and does not infer missing values. Existing map adapters do not supply all recommendation dimensions, and this change does not wire a provider enrichment pipeline or a new HMI surface. Arrival deadline, parking, weather, preference, and follow-up evidence therefore require trustworthy upstream inputs before production use. The scenario runner demonstrates policy behavior, not actual provider-backed ranking or vehicle hardware integration.
