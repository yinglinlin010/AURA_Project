import type { DisplayRegistration, DisplayRegistry } from "./types.js";

const ROLE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export function assertDisplayRegistry(value: unknown): asserts value is DisplayRegistry {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.displays)) {
    throw new Error("INVALID_DISPLAY_REGISTRY");
  }

  const displayIds = new Set<string>();
  for (const candidate of value.displays) {
    if (!isDisplayRegistration(candidate)) {
      throw new Error("INVALID_DISPLAY_REGISTRATION");
    }
    if (displayIds.has(candidate.displayId)) {
      throw new Error(`DUPLICATE_DISPLAY_ID:${candidate.displayId}`);
    }
    displayIds.add(candidate.displayId);
  }

  if (value.displays.length === 0) {
    throw new Error("DISPLAY_REGISTRY_EMPTY");
  }
}

export function findEnabledDisplay(
  registry: DisplayRegistry,
  displayId: string,
): DisplayRegistration | undefined {
  return registry.displays.find((display) => display.displayId === displayId && display.enabled);
}

export function findRegisteredSender(
  registry: DisplayRegistry,
  displayId: string,
  deviceId: string,
): DisplayRegistration | undefined {
  return registry.displays.find(
    (display) =>
      display.displayId === displayId &&
      display.deviceId === deviceId &&
      display.enabled,
  );
}

function isDisplayRegistration(value: unknown): value is DisplayRegistration {
  if (!isRecord(value)) return false;
  return (
    isId(value.displayId) &&
    isId(value.deviceId) &&
    typeof value.role === "string" &&
    ROLE_PATTERN.test(value.role) &&
    value.protocolVersion === 1 &&
    typeof value.enabled === "boolean" &&
    (value.capabilities === undefined ||
      (Array.isArray(value.capabilities) &&
        value.capabilities.every((item) => typeof item === "string" && item.length > 0)))
  );
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
