# Phase 8 Mapbox External Adapters

## Implemented

Core Host conditionally constructs the server-side external adapter stack when `MAPBOX_ACCESS_TOKEN` is configured and passes its Search Box and Directions adapters to `HmiGateway`. Constructing the stack makes no request; the HMI Gateway invokes the adapters only for explicit registered front-passenger discovery messages. The token is read only by Core Host adapters from its environment and is not returned to, logged, or sent to frontend code. Core Host closes the stack's SQLite resource during shutdown.

The passenger flow uses additive protocol v1 messages in [`contracts/protocol/src/types.ts`](../../contracts/protocol/src/types.ts) and [`protocol.schema.json`](../../contracts/protocol/schemas/protocol.schema.json). A passenger explicitly searches for a route origin and a place; the browser receives request-scoped Search Box results with attribution, `source=api`, observed time, freshness, and `use=temporary`. The passenger selects a result pair and requests a route preview; Directions distance/duration and attribution/provenance return only to that registered passenger socket. No current vehicle coordinates are inferred.

After reviewing a successful route estimate, the passenger can submit a `SHOW_INFORMATION` proposal targeted at Center with `requiresConsent=true`. It follows the existing Action Gate, HIGH/CRITICAL deferral, and Center consent route. The proposal carries only a bounded review summary (place label, route distance/duration and provider provenance); the place ID, address, coordinates, and geometry are excluded. Approving records that the driver reviewed the estimate and does not add a journey stop or cause a vehicle action. Declining makes no change. Provider-not-configured, provider-error, and empty-result states are returned explicitly; an unavailable/error response has `source=unknown` and `freshness=unknown`.

Mapbox Search Box `/forward` returns in-memory search results with Mapbox's response attribution, provider label, and observation timestamp. Its results are not written to the journey SQLite store, and event/trace metadata excludes result IDs and response bodies. Search Box output is temporary-use data: callers must not cache or persist it. The external adapter factory keeps the existing SQLite journey store for user-authored journey state; it is not a Search Box result cache.

Directions API v5 returns route distance, duration, geometry, provider/profile provenance, observation timestamp, and Mapbox attribution. Both adapters use the shared timeout/abort-aware HTTP helper and emit metadata-only integration signals. Mapbox is the default export from `adapters/maps`; Google adapter source remains available only by explicit imports from `adapters/maps/legacy`.

## Limits and evidence

Search Box `/forward` is a one-off request endpoint; Mapbox documents per-request billing, temporary-use-only results, and a default 10 requests/second rate limit. Search Box does not supply live parking availability, parking type/cost, or every journey-quality factor, so this integration leaves those unavailable rather than fabricating them. Directions `driving-traffic` uses traffic-aware routing where supported and falls back to driving results where traffic coverage is absent. Search Box coverage is documented for the US, Canada, and Europe.

This flow returns a direct route estimate from the passenger-selected origin to the selected place. It is not a detour calculation against the current journey: shared state has no verified current position or structured current destination. The deterministic `scoreJourneyOptions` API is not used to rank a single route estimate; missing parking, weather, preference, deadline, and follow-up evidence remains unavailable instead of being fabricated. This does not complete the full whole-journey recommendation described in §61.15/M4.

The UI holds search results in component memory only. Search Box result IDs, addresses, coordinates and geometry are not sent into shared state or written to the SQLite journey store. Adapter observability retains metadata only (provider, count, timestamp, request trace); it excludes query/result content. The governed proposal carries a temporary review summary (selected display name, route estimate, source/time and attribution) in the in-memory shared proposal/event path until driver decision; it carries no provider ID, address, coordinates, or geometry, and is never written as a journey stop or SQLite record.

This integration does not add Mapbox Android SDK map rendering, offline tile caching, or a vehicle device link. No live API request, browser flow, build, or runtime verification was performed for this change; no live-provider or hardware demonstration is claimed. A configured provider key and authorized runtime exercise remain necessary to verify operation.

## Official API references

- [Mapbox Search Box API, `/forward` and restrictions](https://docs.mapbox.com/api/search/search-box/)
- [Mapbox Directions API v5](https://docs.mapbox.com/api/navigation/directions/)
