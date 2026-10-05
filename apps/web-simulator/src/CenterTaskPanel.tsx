import { uiText } from './core/ui-copy';
import { useState, type FormEvent } from 'react';
import type { ActiveTask, TaskCondition, TaskLifecycleCommand } from '../../../contracts/protocol/src/types';

type TaskReceipt = { commandId: string; status: string; reasonCode?: string } | null;
const SCENARIO_GOAL = "找一個方便媽媽下車、附近可以充電的地點";

function TaskEditor({ task, disabled, send }: { task: ActiveTask; disabled: boolean; send: (command: TaskLifecycleCommand) => boolean }) {
  const [goal, setGoal] = useState(task.goal ?? '');
  const [step, setStep] = useState(task.currentStep ?? '');
  const [conditionKey, setConditionKey] = useState('');
  const [classification, setClassification] = useState<TaskCondition['classification']>('unknown');
  const [conditionValue, setConditionValue] = useState('');
  const [actionLabel, setActionLabel] = useState('simulated-review');
  const [actionStatus, setActionStatus] = useState<'succeeded' | 'failed'>('succeeded');
  const version = task.version ?? 1;
  const editable = !disabled && task.status !== 'completed' && task.status !== 'cancelled';
  const update = (event: FormEvent) => {
    event.preventDefault();
    const key = conditionKey.trim();
    const condition: TaskCondition | null = key ? {
      key, classification, source: 'simulated', observedAt: Date.now(),
      ...(classification !== 'unknown' && conditionValue.trim() ? { value: conditionValue.trim() } : {}),
    } : null;
    const changes = {
      ...(goal.trim() && goal.trim() !== task.goal ? { goal: goal.trim() } : {}),
      ...(step.trim() && step.trim() !== task.currentStep ? { currentStep: step.trim() } : {}),
      ...(condition ? { conditions: [condition] } : {}),
    };
    if (Object.keys(changes).length) send({ type: 'task.update', payload: { taskId: task.taskId, expectedVersion: version, ...changes } });
  };
  return <>
    <form className="task-edit-form" onSubmit={update}>
      <label>目標<input value={goal} maxLength={500} onChange={(event) => setGoal(event.target.value)} disabled={!editable}/></label>
      <label>目前步驟<input value={step} maxLength={500} onChange={(event) => setStep(event.target.value)} placeholder="下一個已知步驟" disabled={!editable}/></label>
      <div className="task-form-row"><label>條件識別碼<input value={conditionKey} maxLength={100} placeholder="entrance_proximity" onChange={(event) => setConditionKey(event.target.value)} disabled={!editable}/></label>
        <label>依據類別<select value={classification} onChange={(event) => setClassification(event.target.value as TaskCondition['classification'])} disabled={!editable}><option value="unknown">未知</option><option value="confirmed">使用者已確認</option><option value="inferred">推斷（明確依據）</option></select></label></div>
      <label>條件值<input value={conditionValue} maxLength={500} onChange={(event) => setConditionValue(event.target.value)} placeholder="未知時請留白" disabled={!editable || classification === 'unknown'}/></label>
      <small>來源為模擬輸入；修改單一條件會保留其他條件並更新任務版本。</small>
      <button type="submit" disabled={!editable}>更新任務</button>
    </form>
    <div className="task-control-row">
      <button type="button" disabled={!editable || !actionLabel.trim()} onClick={() => send({ type: 'task.action', payload: { taskId: task.taskId, expectedVersion: version, actionId: `${actionLabel.trim()}-${crypto.randomUUID()}`, status: actionStatus } })}>記錄模擬結果</button>
      <input aria-label="動作名稱" value={actionLabel} maxLength={80} onChange={(event) => setActionLabel(event.target.value)} disabled={!editable}/>
      <select aria-label="動作結果" value={actionStatus} onChange={(event) => setActionStatus(event.target.value as typeof actionStatus)} disabled={!editable}><option value="succeeded">成功</option><option value="failed">失敗</option></select>
    </div>
    <small>僅記錄結果，不送出或重試車輛動作。</small>
    <div className="task-control-row">
      <button type="button" disabled={disabled || task.status !== 'running' || task.actionRecords?.some((action) => action.status === 'unknown' || action.status === 'running')} onClick={() => send({ type: 'task.cancel', payload: { taskId: task.taskId, expectedVersion: version, reasonCode: 'CANCELLED_BY_USER' } })}>取消任務</button>
      <button type="button" disabled={disabled || task.status !== 'interrupted'} onClick={() => send({ type: 'task.resume', payload: { taskId: task.taskId, expectedVersion: version } })}>請求恢復</button>
    </div>
    <small>候選、能力、授權與結果未重新驗證前，不允許恢復。</small>
  </>;
}

export function CenterTaskPanel({ tasks, connected, available, receipt, send }: { tasks: ActiveTask[]; connected: boolean; available: boolean; receipt: TaskReceipt; send: (command: TaskLifecycleCommand) => boolean }) {
  const [startGoal, setStartGoal] = useState(SCENARIO_GOAL);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const task = tasks.find((item) => item.taskId === selectedTaskId) ?? tasks.at(-1);
  const disabled = !connected || !available || receipt?.status === 'PENDING';
  return <details className="center-task-panel">
    <summary><span>任務 · 僅供模擬</span><b>{task ? `${uiText(task.status)} · v${task.version ?? 1}` : "建立任務"}</b></summary>
    <div className="center-task-content">
      <p className="task-boundary">模擬任務與操作紀錄；尚未接入實車能力或控制。</p>
      {tasks.length > 1 && <label className="task-selector">任務<select value={task?.taskId ?? ''} onChange={(event) => setSelectedTaskId(event.target.value)}>{tasks.map((item) => <option key={item.taskId} value={item.taskId}>{item.goal ?? item.taskId} · {item.status}</option>)}</select></label>}
      {task && <>
        <dl className="task-facts"><div><dt>目標</dt><dd>{task.goal ?? '未指定'}</dd></div><div><dt>版本／狀態</dt><dd>v{task.version ?? 1} · {uiText(task.status)}</dd></div><div><dt>目前步驟</dt><dd>{task.currentStep ?? '尚未設定'}</dd></div><div><dt>暫停／原因</dt><dd>{task.pauseReason ?? task.interruptionReason ?? '無'}</dd></div></dl>
        <h3>條件 · 類別／來源</h3>
        {task.conditions?.length ? <ul className="task-list">{task.conditions.map((condition) => <li key={condition.key}><b>{condition.key}</b> · {uiText(condition.classification)} · {condition.source ?? 'source unknown'} · {condition.value ?? 'value unknown'}{condition.expiresAt ? ` · expires ${new Date(condition.expiresAt).toLocaleString()}` : ''}</li>)}</ul> : <p>尚無條件紀錄。</p>}
        <h3>動作紀錄</h3>
        {task.actionRecords?.length ? <ul className="task-list">{task.actionRecords.map((action) => <li key={action.idempotencyKey}><b>{action.actionId}</b> · {action.status} · {new Date(action.updatedAt).toLocaleTimeString()}{action.reasonCode ? ` · ${action.reasonCode}` : ''}</li>)}</ul> : <p>尚無動作結果。</p>}
        <TaskEditor key={task.taskId} task={task} disabled={disabled} send={send}/>
      </>}
      <form className="task-edit-form" onSubmit={(event) => { event.preventDefault(); if (startGoal.trim()) { const taskId = crypto.randomUUID(); if (send({ type: 'task.start', payload: { taskId, priority: 'primary', goal: startGoal.trim(), conditions: startGoal.trim() === SCENARIO_GOAL ? [
        { key: 'charging_nearby', classification: 'confirmed', value: 'requested', source: 'simulated', observedAt: Date.now() },
        { key: 'entrance_proximity', classification: 'unknown', source: 'simulated', observedAt: Date.now() },
        { key: 'passenger_dropoff_space', classification: 'unknown', source: 'simulated', observedAt: Date.now() },
      ] : [] } })) setSelectedTaskId(taskId); } }}>
        <label>新任務目標<input value={startGoal} maxLength={500} onChange={(event) => setStartGoal(event.target.value)} disabled={disabled}/></label>
        <button type="submit" disabled={disabled || !startGoal.trim()}>建立模擬任務</button>
      </form>
      {receipt && <p className={`task-receipt ${receipt.status === 'REJECTED' ? 'rejected' : ''}`} role="status">任務指令 {receipt.status.toLowerCase()}{receipt.reasonCode ? ` · ${receipt.reasonCode}` : ''}{receipt.reasonCode === 'TASK_RECOVERY_REVALIDATION_REQUIRED' ? ' · Resume unavailable without revalidation.' : ''}</p>}
    </div>
  </details>;
}
