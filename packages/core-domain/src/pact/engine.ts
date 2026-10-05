/** Standalone simulated cabin. No vehicle or cloud side effects. */
export type Role = 'driver' | 'passenger' | 'rear';
export type Decision = 'EXECUTE' | 'ASK' | 'ROUTE' | 'DEFER' | 'REJECT';
export type Intent = { kind: 'climate'; temperature: number } | { kind: 'navigation'; destination: string } | { kind: 'search' | 'entertainment' | 'hud' | 'unknown' };
export interface Request { id: number; role: Role; intent: Intent }
export interface Compromise { temperature: number; baseline: number; revision: number; accepted: boolean }
export interface Result { compromise?: Compromise; lifecycle?: 'CANCELLED' | 'SUPERSEDED'; request: Request; decision: Decision; reason: string; target: Role; conflict: boolean; scope: 'Zone' | 'Shared' | 'Driver Critical' | 'Personal' }
export interface Cabin {
  online: boolean; dualZone: boolean; climateRevision: number; speed: number; complexity: number; gazeAway: boolean; hmiTasks: number;
  temperatures: Record<Role, number>; destination: string; search: boolean; entertainment: boolean; hudCompact: boolean;
  pending: Result[]; history: Result[]; nextId: number;
}
export const initialCabin = (): Cabin => ({ online: true, dualZone: true, climateRevision: 0, speed: 40, complexity: 10, gazeAway: false, hmiTasks: 0, temperatures: { driver: 22, passenger: 22, rear: 22 }, destination: '花蓮車站', search: false, entertainment: false, hudCompact: false, pending: [], history: [], nextId: 1 });
export function attention(c: Cabin): number {
  return Math.min(100, Math.max(0, Math.round(c.speed * .25 + c.complexity * .6 + (c.gazeAway ? 25 : 0) + c.hmiTasks * 10)));
}
export function parseIntent(text: string): Intent {
  const t = text.trim();
  const nav = t.match(/^(?:導航到|導航去|導航|改去|帶我去|navigate to)\s*(.*)$/i);
  if (nav) return nav[1]!.trim() ? { kind: 'navigation', destination: nav[1]!.trim() } : { kind: 'unknown' };
  if (/空調|溫度|冷氣|temperature/i.test(t)) {
    const n = t.match(/-?\d+(?:\.\d+)?/);
    return n ? { kind: 'climate', temperature: Number(n[0]) } : { kind: 'unknown' };
  }
  if (/HUD|抬頭/i.test(t)) return { kind: 'hud' };
  if (/找.*餐廳|搜尋.*餐廳|restaurant/i.test(t)) return { kind: 'search' };
  if (/娛樂|電影|影片|播放|entertainment/i.test(t)) return { kind: 'entertainment' };
  return { kind: 'unknown' };
}
export function decide(c: Cabin, request: Request): Result {
  const { role, intent } = request;
  const scope = intent.kind === 'climate' ? (c.dualZone ? 'Zone' : 'Shared') : intent.kind === 'navigation' ? 'Shared' : intent.kind === 'hud' ? 'Driver Critical' : 'Personal';
  const conflict = intent.kind === 'climate' && Object.entries(c.temperatures).some(([occupant, value]) => occupant !== role && value !== intent.temperature);
  const result = (decision: Decision, reason: string, target: Role = role): Result => ({ request, decision, reason, target, scope, conflict });
  if (intent.kind === 'unknown') return result('REJECT', '無法辨識指令，請使用下方範例。');
  if (intent.kind === 'climate' && (!Number.isFinite(intent.temperature) || intent.temperature < 16 || intent.temperature > 30)) return result('REJECT', '空調範圍為 16–30°C。');
  if (intent.kind === 'navigation' && !intent.destination.trim()) return result('REJECT', '請提供目的地。');
  if (intent.kind === 'hud' && role !== 'driver') return result('REJECT', '乘員不能修改駕駛 HUD。', 'driver');
  const consent = (intent.kind === 'navigation' || (intent.kind === 'climate' && !c.dualZone)) && role !== 'driver';
  if (consent) return attention(c) >= 70 ? result('DEFER', '駕駛注意力負荷高，安全後再詢問。', 'driver') : result('ASK', '共享資源變更需要駕駛確認。', 'driver');
  if (intent.kind === 'search') return result('ROUTE', c.online ? '餐廳範例送往副駕螢幕；雲端增強為模擬。' : '離線餐廳範例送往副駕螢幕。', 'passenger');
  if (intent.kind === 'entertainment') return result('ROUTE', '娛樂送往後座，不占用駕駛螢幕。', 'rear');
  if (intent.kind === 'hud' && attention(c) >= 70) return result('DEFER', 'Focus Mode 延後非必要 HUD 修改。');
  return result('EXECUTE', intent.kind === 'climate' && c.dualZone ? (conflict ? '偵測溫度衝突，使用分區空調同時滿足需求。' : '分區空調，各自保留乘員的溫度需求。') : '權限與情境允許，直接執行。');
}
function apply(c: Cabin, r: Result): Cabin {
  const i = r.request.intent;
  if (r.decision !== 'EXECUTE' && r.decision !== 'ROUTE') return c;
  if (i.kind === 'climate') return { ...c, climateRevision: c.climateRevision + 1, temperatures: c.dualZone ? { ...c.temperatures, [r.request.role]: i.temperature } : { driver: i.temperature, passenger: i.temperature, rear: i.temperature } };
  if (i.kind === 'navigation') return { ...c, destination: i.destination };
  if (i.kind === 'search') return { ...c, search: true };
  if (i.kind === 'entertainment') return { ...c, entertainment: true };
  if (i.kind === 'hud') return { ...c, hudCompact: !c.hudCompact };
  return c;
}
function record(c: Cabin, r: Result): Cabin {
  return { ...apply(c, r), history: [r, ...c.history].slice(0, 40), pending: ['ASK', 'DEFER'].includes(r.decision) ? [...c.pending, r] : c.pending };
}
export function submit(c: Cabin, role: Role, text: string): Cabin {
  const request = { id: c.nextId, role, intent: parseIntent(text) };
  const result = decide(c, request);
  let next = { ...c, nextId: c.nextId + 1 };
  if (result.decision !== 'REJECT') {
    for (const old of c.pending.filter(p => p.request.role === role && p.request.intent.kind === request.intent.kind)) {
      next = replacePending(next, old.request.id, { ...old, decision: 'REJECT', lifecycle: 'SUPERSEDED', reason: '已由同一乘員的新需求取代。' });
    }
  }
  return record(next, result);
}
export function updateContext(c: Cabin, patch: Partial<Pick<Cabin, 'online' | 'speed' | 'complexity' | 'gazeAway' | 'hmiTasks' | 'dualZone'>>): Cabin {
  let next = { ...c, ...patch, pending: [] as Result[] };
  if (patch.dualZone !== undefined && patch.dualZone !== c.dualZone) next.climateRevision++;
  if (patch.dualZone === false) next.temperatures = { driver: c.temperatures.driver, passenger: c.temperatures.driver, rear: c.temperatures.driver };
  for (const old of c.pending) {
    if (old.compromise && !next.dualZone) {
      if (old.compromise.baseline !== next.temperatures.driver || old.compromise.revision !== next.climateRevision) {
        next = record(next, { ...old, decision: 'REJECT', lifecycle: 'SUPERSEDED', reason: '全車空調已變更，折衷同意失效，請重新提出需求。' });
      } else if (old.compromise.accepted && attention(next) < 70) {
        next = record(next, agreedCompromise(old));
      } else next.pending.push(old);
      continue;
    }
    const r = decide(next, old.request);
    if (r.decision !== old.decision || r.target !== old.target || r.scope !== old.scope) next = record(next, r);
    else if (r.decision === 'ASK' || r.decision === 'DEFER') next.pending.push(r);
    else next = record(next, r);
  }
  return next;
}
export function confirm(c: Cabin, id: number, actor: Role, approved: boolean): Cabin {
  const pending = c.pending.find(r => r.request.id === id);
  if (!pending || actor !== 'driver' || pending.decision !== 'ASK' || pending.compromise || attention(c) >= 70) return c;
  const r: Result = { ...pending, decision: approved ? 'EXECUTE' : 'REJECT', reason: approved ? '駕駛同意共享資源變更。' : '駕駛拒絕變更，保留目前設定。' };
  return record({ ...c, pending: c.pending.filter(p => p.request.id !== id) }, r);
}


function replacePending(c: Cabin, id: number, result: Result): Cabin {
  return record({ ...c, pending: c.pending.filter(p => p.request.id !== id) }, result);
}
export function cancelRequest(c: Cabin, id: number, actor: Role): Cabin {
  const pending = c.pending.find(p => p.request.id === id);
  if (!pending || (actor !== pending.request.role && actor !== 'driver')) return c;
  return replacePending(c, id, { ...pending, decision: 'REJECT', lifecycle: 'CANCELLED', reason: actor === pending.request.role ? '提出者已撤回需求。' : '駕駛已取消待處理需求。' });
}
export function suggestedCompromise(c: Cabin, result: Result): number | null {
  if (c.dualZone || result.compromise || result.decision !== 'ASK' || result.request.intent.kind !== 'climate' || result.target !== 'driver' || !result.conflict) return null;
  return Math.round(c.temperatures.driver + result.request.intent.temperature) / 2;
}
export function offerCompromise(c: Cabin, id: number, actor: Role): Cabin {
  const pending = c.pending.find(p => p.request.id === id);
  if (!pending || actor !== 'driver' || attention(c) >= 70) return c;
  const temperature = suggestedCompromise(c, pending);
  if (temperature === null) return c;
  return replacePending(c, id, { ...pending, target: pending.request.role, compromise: { temperature, baseline: c.temperatures.driver, revision: c.climateRevision, accepted: false }, reason: `駕駛提議全車 ${temperature}°C，等待提出者同意。` });
}
function agreedCompromise(result: Result): Result {
  return { ...result, decision: 'EXECUTE', target: 'driver', request: { ...result.request, intent: { kind: 'climate', temperature: result.compromise!.temperature } }, reason: `駕駛與提出者同意全車 ${result.compromise!.temperature}°C。` };
}
export function respondCompromise(c: Cabin, id: number, actor: Role, accepted: boolean): Cabin {
  const pending = c.pending.find(p => p.request.id === id);
  if (!pending?.compromise || pending.compromise.accepted || actor !== pending.request.role) return c;
  if (c.dualZone || c.temperatures.driver !== pending.compromise.baseline || c.climateRevision !== pending.compromise.revision) {
    return replacePending(c, id, { ...pending, decision: 'REJECT', lifecycle: 'SUPERSEDED', reason: '空調情境已變更，折衷同意失效。' });
  }
  if (!accepted) {
    const { compromise: _proposal, ...original } = pending;
    return replacePending(c, id, { ...original, target: 'driver', decision: attention(c) >= 70 ? 'DEFER' : 'ASK', reason: '提出者未接受折衷，原需求等待駕駛決定。' });
  }
  const agreed = { ...pending, compromise: { ...pending.compromise, accepted: true } };
  return replacePending(c, id, attention(c) >= 70 ? { ...agreed, decision: 'DEFER', target: 'driver', reason: '雙方已同意折衷，安全後再套用。' } : agreedCompromise(agreed));
}
export type TaskStatus = 'PENDING' | 'APPLIED' | 'REJECTED' | 'CANCELLED' | 'SUPERSEDED';
export interface CabinTask { id: number; role: Role; status: TaskStatus; result: Result }
export function cabinTasks(c: Cabin): CabinTask[] {
  const latest = new Map<number, Result>();
  for (const r of [...c.history, ...c.pending]) if (!latest.has(r.request.id)) latest.set(r.request.id, r);
  return [...latest.values()].map(result => ({ id: result.request.id, role: result.request.role, result, status: result.lifecycle ?? (c.pending.some(p => p.request.id === result.request.id) ? 'PENDING' : result.decision === 'REJECT' ? 'REJECTED' : 'APPLIED') }));
}
