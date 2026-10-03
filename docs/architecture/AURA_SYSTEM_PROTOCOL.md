# AURA HMI Gateway & Event Bus Protocol

## 1. Absolute Truth
The Backend (`apps/core-host`) is the single source of truth. All domain events and state mutations happen here.

## 2. WebSocket Registry
Clients MUST register to receive data.
```json
{
  "kind": "register",
  "protocolVersion": 1,
  "displayId": "cluster-main",
  "deviceId": "main-computer"
}
```

## 3. Critical Events
- `vehicle.state.updated`: Payload contains `vehicle: { speedKph: number, gear: string }`.
- `safety.override.activated`: A deterministic Safety Supervisor decision activates a typed warning in shared state. HMI clients render the active warning according to the Master Spec's safety priority. This contract does not establish an AEB signal or physical brake engagement.
- `safety.warning.cleared`: A matching Safety Supervisor event clears the active warning. The current protocol/reducer has this event shape; the end-to-end runtime clear producer and HMI restoration lifecycle remain unverified. Generic model proposals cannot activate or clear safety warnings.
