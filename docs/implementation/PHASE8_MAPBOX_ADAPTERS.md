# Phase 8 Mapbox External Adapters

## Implemented

Core Host now conditionally constructs the server-side external adapter stack when `MAPBOX_ACCESS_TOKEN` is configured. Constructing the stack does not make a network request; Search Box `/forward` and Directions API v5 calls occur only when their adapter methods are invoked. The token is read only by Core Host adapters from its environment and is not returned, logged, or sent to frontend code. Core Host closes the stack's SQLite resource during shutdown. At present `main.ts` retains the stack only for shutdown cleanup; the HMI Gateway, journey scorer, and web simulator do not call its `places` or `routing` methods. This is an adapter/factory integration, not an end-to-end live-provider feature.

Mapbox Search Box `/forward` returns in-memory search results with Mapbox's response attribution, provider label, and observation timestamp. Its results are not written to the journey SQLite store, and event/trace metadata excludes result IDs and response bodies. Search Box output is temporary-use data: callers must not cache or persist it. The external adapter factory keeps the existing SQLite journey store for user-authored journey state; it is not a Search Box result cache.

Directions API v5 returns route distance, duration, geometry, provider/profile provenance, observation timestamp, and Mapbox attribution. Both adapters use the shared timeout/abort-aware HTTP helper and emit metadata-only integration signals. Mapbox is the default export from `adapters/maps`; Google adapter source remains available only by explicit imports from `adapters/maps/legacy`.

## Limits and evidence

Search Box `/forward` is a one-off request endpoint; Mapbox documents per-request billing, temporary-use-only results, and a default 10 requests/second rate limit. Search Box does not supply live parking availability, parking type/cost, or every journey-quality factor, so this integration leaves those unavailable rather than fabricating them. Directions `driving-traffic` uses traffic-aware routing where supported and falls back to driving results where traffic coverage is absent. Search Box coverage is documented for the US, Canada, and Europe.

This integration does not add Mapbox Android SDK map rendering, offline tile caching, or a vehicle device link. No live API request was made and no configured Mapbox key or device evidence was available during this implementation; adapter presence must not be reported as a verified live-provider or hardware demonstration. No protocol/schema change was required.

## Official API references

- [Mapbox Search Box API, `/forward` and restrictions](https://docs.mapbox.com/api/search/search-box/)
- [Mapbox Directions API v5](https://docs.mapbox.com/api/navigation/directions/)
