import { PROTOCOL_VERSION } from '../../../../contracts/protocol/src/types.js';

/** Development entry selection, not authentication; Gateway policy remains authoritative. */
export const DISPLAY_REGISTRATIONS = [
  { displayId: 'cluster-main', deviceId: 'main-computer', role: 'cluster' },
  { displayId: 'center-main', deviceId: 'main-computer', role: 'center' },
  { displayId: 'front-passenger-main', deviceId: 'main-computer', role: 'front_passenger' },
  { displayId: 'rear-tablet', deviceId: 'rear-tablet-device', role: 'rear' },
  { displayId: 'window-tablet', deviceId: 'rear-tablet-device', role: 'interactive_window' },
] as const;
export type DisplayId = (typeof DISPLAY_REGISTRATIONS)[number]['displayId'];
export type BrowserDisplaySelection =
  | { mode: 'overview' }
  | { mode: 'single'; displayId: DisplayId }
  | { mode: 'invalid' };
export const OVERVIEW_SELECTION: BrowserDisplaySelection = { mode: 'overview' };

export function parseBrowserDisplaySelection(search: string): BrowserDisplaySelection {
  const values = new URLSearchParams(search).getAll('display');
  if (values.length === 0) return { mode: 'overview' };
  if (values.length !== 1) return { mode: 'invalid' };
  const registration = DISPLAY_REGISTRATIONS.find((item) => item.displayId === values[0]);
  return registration ? { mode: 'single', displayId: registration.displayId } : { mode: 'invalid' };
}
export function selectedDisplayRegistrations(selection: BrowserDisplaySelection) {
  if (selection.mode === 'overview') return [...DISPLAY_REGISTRATIONS];
  if (selection.mode === 'invalid') return [];
  return DISPLAY_REGISTRATIONS.filter((item) => item.displayId === selection.displayId);
}
export function canUseDisplay(selection: BrowserDisplaySelection, displayId: DisplayId): boolean {
  return selectedDisplayRegistrations(selection).some((item) => item.displayId === displayId);
}
/** Local guard mirrors only simulator commands used by current UI; it grants no server authority. */
export function canSendDisplayCommand(selection: BrowserDisplaySelection, displayId: DisplayId, type: string): boolean {
  if (!canUseDisplay(selection, displayId)) return false;
  if (type === 'rear.mode.set') return displayId === 'rear-tablet';
  if (type === 'demo.reset') return displayId === 'center-main';
  if (type === 'action.propose') return displayId === 'center-main' || displayId === 'front-passenger-main' || displayId === 'rear-tablet' || displayId === 'window-tablet';
  return displayId === 'center-main' && ['action.consent', 'vehicle.telemetry.report', 'driver.cognitive_load.report', 'connectivity.mode.report'].includes(type);
}

/** Validate the existing Gateway welcome contract; presence is optional on welcome. */
export function isTrustedDisplayWelcome(registration: (typeof DISPLAY_REGISTRATIONS)[number], candidate: unknown): boolean {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const message = candidate as Record<string, unknown>;
  return message.kind === 'welcome' && message.protocolVersion === PROTOCOL_VERSION &&
    message.displayId === registration.displayId && message.role === registration.role &&
    typeof message.sessionId === 'string' && message.sessionId.length > 0 &&
    Number.isSafeInteger(message.sequence) && (message.sequence as number) >= 0;
}
