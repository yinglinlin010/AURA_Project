/**
 * Read-only loopback probe. Run only against a coordinator-owned isolated Gateway:
 * registering an existing display ID can replace an active logical client.
 * No commands, vehicle control, provider calls, automatic retries or raw payload logs.
 * Compile with its transport/tests into a dedicated temporary directory (CommonJS).
 */
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import type { DisplayRegistry } from '../../../contracts/protocol/src/types.js';
import {
  createIndependentClientTransport, type IndependentClientState,
  type TransportListener, type TransportSocket,
} from '../src/core/independent-client-transport.js';

const usage = 'Usage: independent-client-smoke --url ws://127.0.0.1:8080/ws --display-id cluster-main [--reconnect-once] [--timeout-ms 3000]\nSimulator transport evidence only; use an isolated Gateway, never an active display session.';
function parseArgs(args: string[]) {
  let address: string | undefined;
  let displayId: string | undefined;
  let reconnect = false;
  let timeoutMs = 3_000;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--reconnect-once') { if (reconnect) throw new Error('DUPLICATE_OPTION'); reconnect = true; }
    else if (arg === '--url' || arg === '--display-id' || arg === '--timeout-ms') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error('MISSING_OPTION_VALUE');
      if (arg === '--url') { if (address) throw new Error('DUPLICATE_OPTION'); address = value; }
      else if (arg === '--display-id') { if (displayId) throw new Error('DUPLICATE_OPTION'); displayId = value; }
      else timeoutMs = Number(value);
    } else throw new Error('UNKNOWN_OPTION');
  }
  if (!address || !displayId) throw new Error('URL_AND_DISPLAY_REQUIRED');
  let url: URL;
  try { url = new URL(address); } catch { throw new Error('INVALID_URL'); }
  if (url.protocol !== 'ws:' || !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      !url.port || url.pathname !== '/ws' || url.username || url.password || url.search || url.hash) throw new Error('LOOPBACK_ONLY');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('INVALID_TIMEOUT');
  return { address: url.href, displayId, reconnect, timeoutMs };
}
function nodeSocket(address: string): TransportSocket {
  const socket = new WebSocket(address, { maxPayload: 1_048_576, followRedirects: false });
  // Closing a connecting ws may emit an error after transport listeners detach.
  socket.on('error', () => undefined);
  const callbacks = new Map<TransportListener, (...args: any[]) => void>();
  return {
    get readyState() { return socket.readyState; },
    send: (data) => socket.send(data),
    close: () => { if (socket.readyState === WebSocket.CONNECTING) socket.terminate(); else socket.close(); },
    addEventListener(type, listener) {
      const callback = type === 'message'
        ? (data: WebSocket.RawData, binary: boolean) => listener({ data: binary ? data : data.toString() })
        : () => listener({});
      callbacks.set(listener, callback); socket.on(type, callback);
    },
    removeEventListener(type, listener) {
      const callback = callbacks.get(listener);
      if (callback) socket.off(type, callback);
      callbacks.delete(listener);
    },
  };
}
async function main() {
  if (process.argv.slice(2).length === 1 && process.argv[2] === '--help') { console.log(usage); return; }
  const args = parseArgs(process.argv.slice(2));
  const registry = JSON.parse(readFileSync('apps/core-host/config/display-registry.json', 'utf8')) as DisplayRegistry;
  const registration = registry.displays.find((display) => display.enabled && display.displayId === args.displayId);
  if (!registration || registry.version !== 1) throw new Error('UNKNOWN_OR_DISABLED_DISPLAY');
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  let lastStatus: IndependentClientState['status'] | undefined;
  const client = createIndependentClientTransport({ registration, timeoutMs: args.timeoutMs,
    socketFactory: () => nodeSocket(args.address),
    onState(state) {
      if (state.status !== lastStatus) {
        console.log(JSON.stringify({ simulatorOnly: true, displayId: registration.displayId, role: registration.role,
          status: state.status, sessionId: state.sessionId, sequence: state.sequence, error: state.error }));
        lastStatus = state.status;
      }
      if (state.status === 'ready') resolveReady?.();
      if (state.status === 'error' || state.status === 'disconnected') rejectReady?.(new Error(state.error ?? 'CONNECTION_CLOSED'));
    },
  });
  const connectOnce = async () => {
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    client.connect();
    try { await ready; } finally { resolveReady = undefined; rejectReady = undefined; }
  };
  const interrupted = () => { rejectReady?.(new Error('INTERRUPTED')); client.disconnect(); };
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  try {
    await connectOnce();
    if (args.reconnect) { client.disconnect(); await connectOnce(); }
    console.log(JSON.stringify({ simulatorOnly: true, result: 'passed', displayId: registration.displayId,
      checks: ['welcome-identity', 'protocol-version', 'session-snapshot', ...(args.reconnect ? ['explicit-reconnect'] : [])] }));
  } finally {
    client.disconnect(); process.off('SIGINT', interrupted); process.off('SIGTERM', interrupted);
  }
}
void main().catch((error: unknown) => {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'PROBE_FAILED';
  console.error(JSON.stringify({ simulatorOnly: true, result: 'failed', code }));
  process.exitCode = 1;
});
