# Phase 8 Open-Meteo Weather Adapter

## Implemented source path

`OpenMeteoWeatherAdapter` is available from `adapters/weather`. It supports current conditions and hourly forecasts through Open-Meteo's generic Forecast API shape. Construction performs no request. A caller must explicitly invoke `getCurrentConditions` or `getForecast` with validated latitude/longitude.

The current request asks for `current=weather_code,temperature_2m,precipitation` and hourly weather code, temperature, precipitation probability, and precipitation. The adapter validates echoed coordinate ranges, required units and response arrays, WMO code bounds, temperatures, precipitation, probability percentages, and timestamps. It maps WMO codes to a bounded condition label and probability percentages to `[0,1]`.

Each observation retains provider, `source=api`, freshness, Open-Meteo attribution, weather code, precipitation in millimeters, and provenance. Forecast target time is `validAt`; `observedAt`/`retrievedAt` describe when the API data was fetched. Current data older than 60 minutes is marked stale. Forecast output is marked fresh for the just-completed fetch while preserving its separate target time. `weatherAsContextSignal` carries the observation's source and freshness into the shared ContextSignal shape.

The adapter validates coordinate bounds, uses an 8-second default timeout with caller AbortSignal propagation, validates configured HTTPS customer endpoints, and records trace IDs, durations, provider, operation, outcome, and bounded error codes. It never traces coordinates, API keys, query URLs, or response bodies. Integration signals include the observation/provenance but no requested coordinates.

## Explicit endpoint and licensing configuration

- Customer API mode requires both `OPEN_METEO_CUSTOMER_ENDPOINT` (an explicit HTTPS Forecast endpoint without embedded credentials/query) and `OPEN_METEO_API_KEY`. The API key is sent as the `apikey` query parameter and is not included in traces.
- The public `https://api.open-meteo.com/v1/forecast` endpoint is selected only when `OPEN_METEO_NON_COMMERCIAL_OPT_IN=true` and no partial customer API configuration is present.
- With no configuration, `availability()` reports `OPEN_METEO_NOT_CONFIGURED`; calls return that unavailable reason without making a request. Partial customer configuration is unavailable and does not fall back to the public endpoint.
- Commercial authorization for the public endpoint is not assumed. Customer API terms, credentials, and endpoint must be supplied by the project owner for commercial use.

`ExternalAdapterStack.weather` exposes the live adapter. `ExternalAdapterStack.mockWeather` separately exposes the local fixture adapter; the fixture is never substituted for a missing live configuration. Core Host constructs the stack when Maps or weather configuration is present, but Main/Gateway have no weather caller and do not invoke weather methods. The adapter is available/configured but is not runtime-connected yet.

## Verification limits

No build, automated tests, browser flow, API call, or provider request was run for this change. The adapter implementation and Core Host wiring are present, but runtime response compatibility remains unverified. A customer API key/endpoint or approved non-commercial opt-in, an authorized request/response capture, and a consumer that handles stale/unavailable results are still required acceptance evidence. Commercial terms and attribution compliance remain unverified.
