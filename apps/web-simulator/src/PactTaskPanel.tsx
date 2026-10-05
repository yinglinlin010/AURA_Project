import { cabinTasks, cancelRequest } from '../../../packages/core-domain/src/pact/engine';
import type { Cabin, Role, TaskStatus } from '../../../packages/core-domain/src/pact/engine';
import { intentLabel, occupantNames } from './PactRequests';
import type { UpdateCabin } from './PactRequests';

const statuses: Record<TaskStatus, string> = { PENDING: '待處理', APPLIED: '已完成', REJECTED: '已拒絕', CANCELLED: '已撤回', SUPERSEDED: '已取代' };
export default function PactTaskPanel({ cabin, role, onRoleChange, onUpdate }: { cabin: Cabin; role: Role; onRoleChange: (role: Role) => void; onUpdate: UpdateCabin }) {
  const tasks = cabinTasks(cabin).filter(t => role === 'driver' || t.role === role);
  return <details className="pact-tasks">
    <summary>任務管理 · {cabin.pending.length} 項待處理</summary>
    <label>任務操作乘員<select value={role} onChange={e => onRoleChange(e.target.value as Role)}>
      {Object.entries(occupantNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
    </select></label>
    <ul aria-live="polite">{tasks.length ? tasks.map(t => <li key={t.id}>
      <span><strong>{occupantNames[t.role]} · {intentLabel(t.result.request.intent)}</strong><small>{t.result.reason}</small></span>
      <b>{statuses[t.status]}</b>
      {t.status === 'PENDING' && <button onClick={() => onUpdate(c => cancelRequest(c, t.id, role))}>撤回此需求</button>}
    </li>) : <li>目前沒有這位乘員的需求。</li>}</ul>
  </details>;
}
