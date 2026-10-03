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
    <section className="timing-panel" aria-label="Assistance Timing Preview (Simulator Only)">
      <header>
        <h3>Assistance Timing Preview (Simulator Only)</h3>
        <p>This panel computes the timing policy locally without routing content or sending protocol commands.</p>
      </header>

      <div className="timing-controls">
        <label>
          Simulated Information Value:
          <select value={informationValue} onChange={(e) => setInformationValue(e.target.value as InformationValue)}>
            <option value="negligible">Negligible</option>
            <option value="useful">Useful</option>
            <option value="important">Important</option>
          </select>
        </label>

        <label>
          Simulated Urgency:
          <select value={urgency} onChange={(e) => setUrgency(e.target.value as AssistanceUrgency)}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </label>

        <label>
          Simulated Interruption Cost:
          <select value={interruptionCost} onChange={(e) => setInterruptionCost(e.target.value as InterruptionCost)}>
            <option value="low">Low</option>
            <option value="moderate">Moderate</option>
            <option value="high">High</option>
          </select>
        </label>

        <label>
          Simulated Driver Load:
          <select value={driverLoad} onChange={(e) => setDriverLoad(e.target.value as DriverLoad)}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>

        <label>
          Simulated Sensitivity:
          <select value={sensitivity} onChange={(e) => setSensitivity(e.target.value as Sensitivity)}>
            <option value="ordinary">Ordinary</option>
            <option value="sensitive">Sensitive</option>
          </select>
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={passengerHandoffAuthorized}
            onChange={(e) => setPassengerHandoffAuthorized(e.target.checked)}
          />
          <span>Simulated Passenger Handoff Authorized</span>
        </label>
      </div>

      <div className="timing-result">
        <h4>Simulator-only Result</h4>
        <div className="result-grid">
          <div><strong>Outcome:</strong> <span>{decision.outcome}</span></div>
          <div><strong>Reason Code:</strong> <span>{decision.reasonCode}</span></div>
        </div>

        {decision.exposeContent ? (
          <div className="timing-preview-content">
            <p>[Simulated Content Preview Rendered]</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
