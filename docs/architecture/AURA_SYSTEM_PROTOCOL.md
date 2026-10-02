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
- `safety.override.activated`: Payload contains AEB engagement data. Frontend MUST flash CRITICAL RED immediately.
