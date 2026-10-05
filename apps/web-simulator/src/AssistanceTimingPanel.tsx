import { uiText } from './core/ui-copy';
import { useState } from 'react';
import { decideAssistanceTiming, type InformationValue, type AssistanceUrgency, type InterruptionCost, type DriverLoad, type Sensitivity } from '../../../packages/core-domain/src/assistance-timing';

export function AssistanceTimingPanel() {
  const [informationValue, setInformationValue] = useState<InformationValue>('useful');
  const [urgency, setUrgency] = useState<AssistanceUrgency>('normal');
  const [interruptionCost, setInterruptionCost] = useState<InterruptionCost>('low');
  const [driverLoad, setDriverLoad] = useState<DriverLoad>('normal');
  const [passengerHandoffAuthorized, setPassengerHandoffAuthorized] = useState<boolean>(false);
  const [sensitivity, setSensitivity] = useState<Sensitivity>('ordinary');

  const decision = decideAssistanceTiming({
    informationValue,
    urgency,
    interruptionCost,
    driverLoad,
    passengerHandoffAuthorized,
    sensitivity
  });

  return (
    <section className="timing-panel" aria-label="介入時機預覽（僅供模擬）">
      <header>
        <h3>介入時機預覽（僅供模擬）</h3>
        <p>此工具僅在本機計算介入時機，不傳送內容或協定指令。</p>
      </header>

      <div className="timing-controls">
        <label>
          模擬資訊價值：
          <select value={informationValue} onChange={(e) => setInformationValue(e.target.value as InformationValue)}>
            <option value="negligible">可忽略</option>
            <option value="useful">有幫助</option>
            <option value="important">重要</option>
          </select>
        </label>

        <label>
          模擬緊急程度：
          <select value={urgency} onChange={(e) => setUrgency(e.target.value as AssistanceUrgency)}>
            <option value="low">低</option>
            <option value="normal">正常</option>
            <option value="high">高</option>
            <option value="critical">極高</option>
          </select>
        </label>

        <label>
          模擬打擾成本：
          <select value={interruptionCost} onChange={(e) => setInterruptionCost(e.target.value as InterruptionCost)}>
            <option value="low">低</option>
            <option value="moderate">中</option>
            <option value="high">高</option>
          </select>
        </label>

        <label>
          模擬駕駛負荷：
          <select value={driverLoad} onChange={(e) => setDriverLoad(e.target.value as DriverLoad)}>
            <option value="low">低</option>
            <option value="normal">正常</option>
            <option value="high">高</option>
            <option value="critical">極高</option>
            <option value="unknown">未知</option>
          </select>
        </label>

        <label>
          模擬敏感程度：
          <select value={sensitivity} onChange={(e) => setSensitivity(e.target.value as Sensitivity)}>
            <option value="ordinary">一般</option>
            <option value="sensitive">敏感</option>
          </select>
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={passengerHandoffAuthorized}
            onChange={(e) => setPassengerHandoffAuthorized(e.target.checked)}
          />
          <span>模擬乘員接手已授權</span>
        </label>
      </div>

      <div className="timing-result">
        <h4>模擬結果</h4>
        <div className="result-grid">
          <div><strong>結果：</strong> <span>{uiText(decision.outcome)}</span></div>
          <div><strong>原因碼：</strong> <span>{decision.reasonCode}</span></div>
        </div>

        {decision.exposeContent ? (
          <div className="timing-preview-content">
            <p>［模擬內容預覽］</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
