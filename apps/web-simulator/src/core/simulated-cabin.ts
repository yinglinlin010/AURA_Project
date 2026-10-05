import { useSyncExternalStore } from 'react';

type Cabin = { temperature: number; rearTemperature: number; fan: number; sync: boolean; call: boolean; brightness: number; volume: number };
const initial: Cabin = { temperature: 22, rearTemperature: 21.5, fan: 3, sync: false, call: false, brightness: 100, volume: 50 };
let cabin = initial;
const listeners = new Set<() => void>();
const key = 'aura.simulated-controls.v1';
function read() {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (value && ['temperature', 'rearTemperature', 'fan', 'brightness', 'volume'].every(k => typeof value[k] === 'number' && Number.isFinite(value[k])) && typeof value.sync === 'boolean' && typeof value.call === 'boolean') {
      cabin = { temperature: Math.max(16, Math.min(28, value.temperature)), rearTemperature: Math.max(16, Math.min(28, value.rearTemperature)), fan: Math.max(1, Math.min(5, value.fan)), sync: value.sync, call: value.call, brightness: Math.max(40, Math.min(100, value.brightness)), volume: Math.max(0, Math.min(100, value.volume)) };
    }
  } catch { /* Storage unavailable: keep functional in-memory controls. */ }
}
read();
window.addEventListener('storage', event => { if (event.key === key || event.key === null) { cabin = initial; read(); listeners.forEach(listener => listener()); } });
function update(patch: Partial<Cabin>) {
  read();
  cabin = { ...cabin, ...patch };
  if (cabin.sync) cabin.rearTemperature = cabin.temperature;
  try { localStorage.setItem(key, JSON.stringify(cabin)); } catch { /* In-memory fallback. */ }
  listeners.forEach(listener => listener());
}
export function useSimulatedCabin() {
  return [useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => cabin), update] as const;
}
