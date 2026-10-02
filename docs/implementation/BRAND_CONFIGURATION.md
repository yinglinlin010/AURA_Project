# Brand configuration

The working identity defaults to `AURA` and is configuration data, not a policy input. Server processes read:

| Environment variable | Default | Meaning |
|---|---|---|
| `AURA_PRODUCT_NAME` | `AURA` | Product name shown by the Core Host startup message and web simulator |
| `AURA_ASSISTANT_NAME` | `AURA` | Assistant name shown in the simulator and provided to the live voice model's identity instruction |
| `AURA_WAKE_WORD` | `Hey AURA` | Reserved wake phrase configuration for a future wake detector |

The web simulator uses matching `VITE_AURA_PRODUCT_NAME`, `VITE_AURA_ASSISTANT_NAME`, and `VITE_AURA_WAKE_WORD` values at build time. Set both sets to the same values when building a renamed simulator and running its host. The simulator's current Listen control remains a user initiated voice session; setting a wake phrase does not enable wake word detection.

Brand strings must not affect routing, safety, consent, or other business decisions. The default identity remains unchanged and therefore preserves the frozen Section 64 visual design.
