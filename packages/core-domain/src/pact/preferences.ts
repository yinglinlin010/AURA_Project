import { initialCabin } from './engine.js';
import type { Cabin } from './engine.js';

/** Persist only applied settings. Consent and attention never survive a restart. */
export function serializePreferences(c: Cabin): string {
  return JSON.stringify({ version: 1, destination: c.destination, temperatures: c.temperatures, dualZone: c.dualZone, hudCompact: c.hudCompact });
}
export function restorePreferences(raw: string | null): Cabin {
  const fallback = initialCabin();
  if (!raw) return fallback;
  try {
    const p = JSON.parse(raw);
    if (!p || p.version !== 1 || typeof p.destination !== 'string' || !p.destination.trim() || p.destination.length > 200 || typeof p.dualZone !== 'boolean' || typeof p.hudCompact !== 'boolean') return fallback;
    const temps = p.temperatures;
    if (!temps || !['driver', 'passenger', 'rear'].every(r => typeof temps[r] === 'number' && Number.isFinite(temps[r]) && temps[r] >= 16 && temps[r] <= 30)) return fallback;
    if (!p.dualZone && (temps.driver !== temps.passenger || temps.driver !== temps.rear)) return fallback;
    return { ...fallback, destination: p.destination, dualZone: p.dualZone, hudCompact: p.hudCompact, temperatures: { driver: temps.driver, passenger: temps.passenger, rear: temps.rear } };
  } catch { return fallback; }
}
