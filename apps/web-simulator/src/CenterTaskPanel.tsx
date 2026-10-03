import { useState, type FormEvent } from 'react';
import type { ActiveTask, TaskCondition, TaskLifecycleCommand } from '../../../contracts/protocol/src/types';

type TaskReceipt = { commandId: string; status: string; reasonCode?: string } | null;
const SCENARIO_GOAL = 'Find a place where Mom can get out, with charging nearby';

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
      <label>Goal<input value={goal} maxLength={500} onChange={(event) => setGoal(event.target.value)} disabled={!editable}/></label>
      <label>Current step<input value={step} maxLength={500} onChange={(event) => setStep(event.target.value)} placeholder="Next known step" disabled={!editable}/></label>
      <div className="task-form-row"><label>Condition key<input value={conditionKey} maxLength={100} placeholder="entrance_proximity" onChange={(event) => setConditionKey(event.target.value)} disabled={!editable}/></label>
        <label>Evidence class<select value={classification} onChange={(event) => setClassification(event.target.value as TaskCondition['classification'])} disabled={!editable}><option value="unknown">Unknown</option><option value="confirmed">Confirmed by user</option><option value="inferred">Inferred (explicit evidence)</option></select></label></div>
      <label>Condition value<input value={conditionValue} maxLength={500} onChange={(event) => setConditionValue(event.target.value)} placeholder="Leave blank when unknown" disabled={!editable || classification === 'unknown'}/></label>
      <small>Condition source: simulated input. Editing one condition preserves the others and advances the task version.</small>
      <button type="submit" disabled={!editable}>Update task</button>
    </form>
    <div className="task-control-row">
      <button type="button" disabled={!editable || !actionLabel.trim()} onClick={() => send({ type: 'task.action', payload: { taskId: task.taskId, expectedVersion: version, actionId: `${actionLabel.trim()}-${crypto.randomUUID()}`, status: actionStatus } })}>Record simulator outcome</button>
      <input aria-label="Action label" value={actionLabel} maxLength={80} onChange={(event) => setActionLabel(event.target.value)} disabled={!editable}/>
      <select aria-label="Action result" value={actionStatus} onChange={(event) => setActionStatus(event.target.value as typeof actionStatus)} disabled={!editable}><option value="succeeded">Succeeded</option><option value="failed">Failed</option></select>
    </div>
    <small>Ledger record only. No vehicle action is sent or retried.</small>
    <div className="task-control-row">
      <button type="button" disabled={disabled || task.status !== 'running' || task.actionRecords?.some((action) => action.status === 'unknown' || action.status === 'running')} onClick={() => send({ type: 'task.cancel', payload: { taskId: task.taskId, expectedVersion: version, reasonCode: 'CANCELLED_BY_USER' } })}>Cancel task</button>
      <button type="button" disabled={disabled || task.status !== 'interrupted'} onClick={() => send({ type: 'task.resume', payload: { taskId: task.taskId, expectedVersion: version } })}>Request resume</button>
    </div>
    <small>Resume is unavailable without fresh candidate, capability, authorization, and outcome revalidation. Requests fail closed here.</small>
  </>;
}

export function CenterTaskPanel({ tasks, connected, available, receipt, send }: { tasks: ActiveTask[]; connected: boolean; available: boolean; receipt: TaskReceipt; send: (command: TaskLifecycleCommand) => boolean }) {
  const [startGoal, setStartGoal] = useState(SCENARIO_GOAL);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const task = tasks.find((item) => item.taskId === selectedTaskId) ?? tasks.at(-1);
  const disabled = !connected || !available || receipt?.status === 'PENDING';
  return <details className="center-task-panel">
    <summary><span>Task · simulator only</span><b>{task ? `${task.status} · v${task.version ?? 1}` : 'Start a task'}</b></summary>
    <div className="center-task-content">
      <p className="task-boundary">Simulator task state and ledger. No live vehicle capability or control is connected.</p>
      {tasks.length > 1 && <label className="task-selector">Task<select value={task?.taskId ?? ''} onChange={(event) => setSelectedTaskId(event.target.value)}>{tasks.map((item) => <option key={item.taskId} value={item.taskId}>{item.goal ?? item.taskId} · {item.status}</option>)}</select></label>}
      {task && <>
        <dl className="task-facts"><div><dt>Goal</dt><dd>{task.goal ?? 'Unspecified'}</dd></div><div><dt>Version / status</dt><dd>v{task.version ?? 1} · {task.status}</dd></div><div><dt>Current step</dt><dd>{task.currentStep ?? 'Not set'}</dd></div><div><dt>Pause / reason</dt><dd>{task.pauseReason ?? task.interruptionReason ?? 'None'}</dd></div></dl>
        <h3>Conditions · class / source</h3>
        {task.conditions?.length ? <ul className="task-list">{task.conditions.map((condition) => <li key={condition.key}><b>{condition.key}</b> · {condition.classification} · {condition.source ?? 'source unknown'} · {condition.value ?? 'value unknown'}{condition.expiresAt ? ` · expires ${new Date(condition.expiresAt).toLocaleString()}` : ''}</li>)}</ul> : <p>No conditions recorded.</p>}
        <h3>Action ledger</h3>
        {task.actionRecords?.length ? <ul className="task-list">{task.actionRecords.map((action) => <li key={action.idempotencyKey}><b>{action.actionId}</b> · {action.status} · {new Date(action.updatedAt).toLocaleTimeString()}{action.reasonCode ? ` · ${action.reasonCode}` : ''}</li>)}</ul> : <p>No action outcomes recorded.</p>}
        <TaskEditor key={task.taskId} task={task} disabled={disabled} send={send}/>
      </>}
      <form className="task-edit-form" onSubmit={(event) => { event.preventDefault(); if (startGoal.trim()) { const taskId = crypto.randomUUID(); if (send({ type: 'task.start', payload: { taskId, priority: 'primary', goal: startGoal.trim(), conditions: startGoal.trim() === SCENARIO_GOAL ? [
        { key: 'charging_nearby', classification: 'confirmed', value: 'requested', source: 'simulated', observedAt: Date.now() },
        { key: 'entrance_proximity', classification: 'unknown', source: 'simulated', observedAt: Date.now() },
        { key: 'passenger_dropoff_space', classification: 'unknown', source: 'simulated', observedAt: Date.now() },
      ] : [] } })) setSelectedTaskId(taskId); } }}>
        <label>New task goal<input value={startGoal} maxLength={500} onChange={(event) => setStartGoal(event.target.value)} disabled={disabled}/></label>
        <button type="submit" disabled={disabled || !startGoal.trim()}>Start simulator task</button>
      </form>
      {receipt && <p className={`task-receipt ${receipt.status === 'REJECTED' ? 'rejected' : ''}`} role="status">Task command {receipt.status.toLowerCase()}{receipt.reasonCode ? ` · ${receipt.reasonCode}` : ''}{receipt.reasonCode === 'TASK_RECOVERY_REVALIDATION_REQUIRED' ? ' · Resume unavailable without revalidation.' : ''}</p>}
    </div>
  </details>;
}
