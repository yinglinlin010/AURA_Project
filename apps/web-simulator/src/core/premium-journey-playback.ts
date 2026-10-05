/** Playback drives existing commands and waits for observed shared state. */
export interface PlaybackSnapshot {
  ready: boolean;
  reset: boolean;
  proposal: string | undefined;
  decision: string | undefined;
  added: boolean;
  load: string | null;
  cloud: string;
  rearMode: string;
  intelligence: string;
  requestId?: string;
  traceId?: string;
  reasonCode?: string;
}
export type PlaybackAction = 'reset' | 'request' | 'high' | 'normal' | 'accept' | 'offline' | 'quiet' | 'restore' | 'resume';
export const PLAYBACK_STEPS: ReadonlyArray<{ action: PlaybackAction; label: string; reached: (s: PlaybackSnapshot) => boolean }> = [
  { action: 'reset', label: 'NORMAL DRIVE · Donghu available', reached: s => s.reset },
  { action: 'high', label: 'Driver Load HIGH · confirmed before request', reached: s => s.load === 'high' && !s.proposal && !s.added },
  { action: 'request', label: 'ADD TO JOURNEY · PACT DEFER', reached: s => s.load === 'high' && s.proposal === 'deferred' && s.decision === 'DEFER' && !s.added },
  { action: 'normal', label: 'Driver Load NORMAL · PACT ASK', reached: s => s.load === 'normal' && s.proposal === 'awaiting_consent' && s.decision === 'ASK' },
  { action: 'accept', label: 'DRIVER ACCEPT · Journey updated', reached: s => s.added && s.proposal === 'completed' },
  { action: 'offline', label: 'CLOUD OFFLINE · Local Core active', reached: s => s.cloud === 'offline' && s.intelligence === 'unavailable' && s.added },
  { action: 'quiet', label: 'QUIET MODE · Journey preserved', reached: s => s.rearMode === 'quiet' && s.added },
  { action: 'restore', label: 'CLOUD RESTORED · Quiet remains · HELD', reached: s => s.cloud === 'online' && s.rearMode === 'quiet' && s.intelligence === 'available_but_held' },
  { action: 'resume', label: 'RESUME · Journey Intelligence returns', reached: s => s.rearMode === 'normal' && s.intelligence === 'presented' && s.added },
];

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Playback stopped')); return; }
    const stop = () => { clearTimeout(timer); signal.removeEventListener('abort', stop); reject(new Error('Playback stopped')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, ms);
    signal.addEventListener('abort', stop, { once: true });
  });
}

export async function playPremiumJourney(options: {
  read: () => PlaybackSnapshot;
  execute: (action: PlaybackAction) => boolean;
  signal: AbortSignal;
  film: boolean;
  onStep: (index: number, label: string) => void;
  waitForManual?: (action: 'accept' | 'resume') => void;
  onObserved?: (action: PlaybackAction, snapshot: PlaybackSnapshot) => void;
  timeoutMs?: number;
  holdMs?: number;
}) {
  for (const [index, step] of PLAYBACK_STEPS.entries()) {
    if (options.signal.aborted) throw new Error('Playback stopped');
    if (!options.read().ready) throw new Error('Gateway disconnected; playback stopped');
    options.onStep(index + 1, step.label);
    if (step.action === 'request' && options.read().load !== 'high') throw new Error('Driver Load HIGH required before journey request; playback stopped');
    const manual = !options.film && (step.action === 'accept' || step.action === 'resume');
    if (manual) options.waitForManual?.(step.action as 'accept' | 'resume');
    else if (!options.execute(step.action)) throw new Error(`Command not sent: ${step.label}`);
    const deadline = manual ? Infinity : Date.now() + (options.timeoutMs ?? 10000);
    while (true) {
      if (options.signal.aborted) throw new Error('Playback stopped');
      const snapshot = options.read();
      if (!snapshot.ready) throw new Error('Gateway disconnected; playback stopped');
      if (index >= 1 && index <= 3 && snapshot.added) throw new Error('Journey changed before driver consent; playback stopped');
      if (step.reached(snapshot)) break;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for shared state: ${step.label}`);
      await pause(100, options.signal);
    }
    options.onObserved?.(step.action, options.read());
    const hold = step.action === 'high' ? 0 : options.holdMs ?? (options.film ? 4000 : step.action === 'normal' || step.action === 'accept' || step.action === 'restore' ? 3000 : 2000);
    await pause(hold, options.signal);
  }
}
