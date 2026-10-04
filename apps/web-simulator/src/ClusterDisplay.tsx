import type { CSSProperties } from 'react';
import type { resolvePresentation } from '../../../packages/core-domain/src/presentation-resolver';
import type { SharedSafetyWarning } from './core/useAuraCommand';
import clusterArt from './assets/cluster-design-2026-10-04.png';
import rearCar from './assets/cluster-rear-car.webp';
import './ClusterDisplay.css';

type Density = ReturnType<typeof resolvePresentation>['informationDensity'];

const tires = [
  { position: 'FL', pressure: '2.4' },
  { position: 'FR', pressure: '2.4' },
  { position: 'RL', pressure: '2.5' },
  { position: 'RR', pressure: '2.5' },
] as const;

function RpmDial() {
  return <div className="aura-cluster-dial rpm" aria-label="Simulated example, 4200 RPM">
    <svg viewBox="0 0 300 540" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path className="dial-rpm-track" d="M 276 22 C 124 22 28 117 28 275 C 28 383 70 461 143 507" />
      <path className="dial-rpm-bright" d="M 57 154 C 37 193 28 233 28 275 C 28 383 70 461 143 507" />
      <g className="dial-marks"><path d="M276 35v20M213 48l6 19M146 83l12 17M93 133l18 13M55 208l21 7M36 291h22M48 374l21-7M86 446l17-14" /></g>
      <g className="dial-numbers"><text x="276" y="92">7</text><text x="207" y="115">6</text><text x="143" y="163">5</text><text x="100" y="223">4</text><text x="75" y="302">3</text><text x="83" y="380">2</text><text x="115" y="449">1</text><text x="166" y="496">0</text></g>
    </svg>
    <div className="aura-cluster-dial-value"><strong>4200</strong><span>RPM</span></div>
  </div>;
}

function PowerDial() {
  return <div className="aura-cluster-dial power" aria-label="Simulated example, 68 percent power">
    <svg viewBox="0 0 300 540" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path className="dial-power-track" d="M 24 22 C 178 22 273 117 273 275 C 273 383 229 461 158 507" />
      <path className="dial-power-highlight" d="M 184 91 C 239 130 273 194 273 275 C 273 383 229 461 158 507" />
      <g className="dial-marks"><path d="M24 36v20M112 48l-7 19M188 83l-13 18M238 151l-18 11M267 264h-22M251 380l-19-8M208 453l-17-15" /></g>
      <g className="dial-numbers"><text x="65" y="101">100%</text><text x="171" y="498">0</text></g>
    </svg>
    <div className="aura-cluster-dial-value"><strong>68%</strong><span>Power</span></div>
  </div>;
}

function Telltales() {
  return <span className="aura-cluster-telltales" role="img" aria-label="Illustrative headlight and seatbelt indicators">
    <svg viewBox="0 0 36 30" aria-hidden="true"><g fill="none" stroke="#4be972" strokeWidth="2.4" strokeLinecap="round"><path d="M14 4v22M18 4c10 0 15 5 15 11s-5 11-15 11V4ZM2 7l8-2M2 13l8-2M2 19l8-2M2 25l8-2" /></g></svg>
    <svg viewBox="0 0 32 32" aria-hidden="true"><g fill="none" stroke="#ff3b30" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="17" cy="5" r="2"/><path d="m13 10-4 12m9-13 7 15m-13-10 10 7M8 25h17M5 29l22-22" /></g></svg>
  </span>;
}

export function ClusterDisplay({ speedKph, warning, density, motionPaused }: { speedKph: number; warning: SharedSafetyWarning | null; density: Density; motionPaused: boolean }) {
  const markerDuration = `${Math.max(250, 3000 / Math.max(1, speedKph))}ms`;
  const roadStyle = { '--marker-duration': markerDuration, '--marker-play-state': speedKph > 0 && !motionPaused ? 'running' : 'paused' } as CSSProperties;
  return <section className={`device aura-cluster ${density === 'reduced' ? 'load-reduced' : ''} ${density === 'safety_only' ? 'load-critical' : ''} ${warning ? 'safety-active' : ''}`} aria-label="Cluster display preview">
    <header className="aura-cluster-header"><span>14:38&nbsp;&nbsp; 21°C</span><span>DRIVE</span><Telltales /></header>
    {warning && <div className="aura-cluster-warning" role="alert" aria-live="assertive"><b>CRITICAL SAFETY WARNING</b><span>Immediate safety condition · {warning.source === 'simulated' ? 'SIMULATED' : warning.source.toUpperCase()}</span></div>}
    <div className="aura-cluster-body">
      <aside className="aura-cluster-trip" aria-label="Simulated trip examples"><p><span>Trip:</span> <b>24.8 km</b></p><p><span>Avg:</span> <b>16.1 kWh/100 km</b></p><p><span>Time:</span> <b>0:42 h</b></p><p><span>Range:</span> <b>412 km</b></p></aside>
      <RpmDial />
      <div className="aura-cluster-speed"><strong>{Math.round(speedKph)}</strong><span>km/h</span><div className="aura-cluster-road" style={roadStyle} aria-hidden="true"><svg viewBox="0 0 400 310" preserveAspectRatio="none"><path className="road-edge" d="M145 0 30 310M255 0l115 310"/><path className="road-center" d="M200 0v310"/></svg><div className="aura-cluster-car" style={{ backgroundImage: `url(${rearCar})` }}/></div></div>
      <PowerDial />
      <aside className="aura-cluster-vehicle" aria-label="Four independent simulated tire pressure examples"><h2>TIRE PRESSURE <span>· bar</span></h2><div className="aura-cluster-tires"><div className="aura-cluster-topcar" style={{ backgroundImage: `url(${clusterArt})` }} aria-hidden="true"/>{tires.map((tire) => <div key={tire.position} className={`aura-cluster-tire tire-${tire.position}`}><span>{tire.position}</span><b>{tire.pressure}</b></div>)}</div><span className="aura-cluster-simulated">SIMULATED</span><span className="aura-cluster-temp">Temp: 19°C</span></aside>
    </div>
  </section>;
}
