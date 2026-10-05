import { uiText } from './core/ui-copy';
import type { CSSProperties } from 'react';
import type { resolvePresentation } from '../../../packages/core-domain/src/presentation-resolver';
import type { SharedSafetyWarning } from './core/useAuraCommand';
import rearCar from './assets/cluster-rear-car.webp';
import topCar from './assets/cluster-top-car.webp';
import './ClusterDisplay.css';

type Density = ReturnType<typeof resolvePresentation>['informationDensity'];

const tires = [
  { position: 'FL', pressure: '2.4' },
  { position: 'FR', pressure: '2.4' },
  { position: 'RL', pressure: '2.5' },
  { position: 'RR', pressure: '2.5' },
] as const;

// Arcs, ticks, and labels share one ellipse so their positions stay aligned.
function dialPoint(angle: number, inset = 0, mirrored = false) {
  const radians = angle * Math.PI / 180;
  const x = 276 + (248 - inset) * Math.cos(radians);
  return { x: mirrored ? 300 - x : x, y: 275 + (253 - inset) * Math.sin(radians) };
}

function dialArc(startAngle: number, mirrored: boolean) {
  const start = dialPoint(startAngle, 0, mirrored);
  const end = dialPoint(-240, 0, mirrored);
  return `M ${start.x} ${start.y} A 248 253 0 0 ${mirrored ? 1 : 0} ${end.x} ${end.y}`;
}

function DialScale({ mirrored = false }: { mirrored?: boolean }) {
  return <>
    <g className="dial-marks">{Array.from({ length: 8 }, (_, index) => {
      const angle = -90 - index * 150 / 7;
      const outer = dialPoint(angle, 14, mirrored);
      const inner = dialPoint(angle, 34, mirrored);
      return <path key={index} d={`M ${outer.x} ${outer.y} L ${inner.x} ${inner.y}`} />;
    })}</g>
    <g className="dial-numbers">{Array.from({ length: 8 }, (_, index) => {
      if (mirrored && index !== 0 && index !== 7) return null;
      const position = dialPoint(-90 - index * 150 / 7, 65, mirrored);
      // Keep the wider percent label inside the right-hand dial.
      return <text key={index} x={position.x + (mirrored && index === 0 ? 38 : 0)} y={position.y} dominantBaseline="middle">{mirrored ? (index === 0 ? '100%' : '0') : 7 - index}</text>;
    })}</g>
  </>;
}

function RpmDial() {
  return <div className="aura-cluster-dial rpm" aria-label="模擬轉速：4200 RPM">
    <svg viewBox="0 0 300 540" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path className="dial-rpm-track" d={dialArc(-90, false)} />
      <path className="dial-rpm-bright" d={dialArc(-135, false)} />
      <DialScale />
    </svg>
    <div className="aura-cluster-dial-value"><strong>4200</strong><span>RPM</span></div>
  </div>;
}

function PowerDial() {
  return <div className="aura-cluster-dial power" aria-label="模擬動力：68%">
    <svg viewBox="0 0 300 540" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path className="dial-power-track" d={dialArc(-90, true)} />
      <path className="dial-power-highlight" d={dialArc(-135, true)} />
      <DialScale mirrored />
    </svg>
    <div className="aura-cluster-dial-value"><strong>68%</strong><span>動力</span></div>
  </div>;
}

function Telltales() {
  return <span className="aura-cluster-telltales" role="img" aria-label="示意頭燈與安全帶指示">
    <svg viewBox="0 0 36 30" aria-hidden="true"><g fill="none" stroke="#4be972" strokeWidth="2.4" strokeLinecap="round"><path d="M14 4v22M18 4c10 0 15 5 15 11s-5 11-15 11V4ZM2 7l8-2M2 13l8-2M2 19l8-2M2 25l8-2" /></g></svg>
    <svg viewBox="0 0 32 32" aria-hidden="true"><g fill="none" stroke="#ff3b30" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="17" cy="5" r="2"/><path d="m13 10-4 12m9-13 7 15m-13-10 10 7M8 25h17M5 29l22-22" /></g></svg>
  </span>;
}

export function ClusterDisplay({ nextStop, speedKph, warning, density, motionPaused }: { nextStop?: string | undefined; speedKph: number; warning: SharedSafetyWarning | null; density: Density; motionPaused: boolean }) {
  const markerDuration = `${Math.max(250, 3000 / Math.max(1, speedKph))}ms`;
  const roadStyle = { '--marker-duration': markerDuration, '--marker-play-state': speedKph > 0 && !motionPaused ? 'running' : 'paused' } as CSSProperties;
  return <section className={`device aura-cluster ${density === 'reduced' ? 'load-reduced' : ''} ${density === 'safety_only' ? 'load-critical' : ''} ${warning ? 'safety-active' : ''}`} data-presentation={density} aria-label="儀表畫面">
    <header className="aura-cluster-header"><span>14:38&nbsp;&nbsp; 21°C</span><span>{density === "reduced" ? "行駛 · 專注" : "行駛"}</span><Telltales /></header>
    {warning && <div className="aura-cluster-warning" role="alert" aria-live="assertive"><b>重大安全警示</b><span>需立即處理的安全狀況 · {warning.source === 'simulated' ? "模擬" : warning.source.toUpperCase()}</span></div>}
    <div className="aura-cluster-body">
      <aside className="aura-cluster-trip" aria-label="模擬旅程資訊"><p><span>里程：</span> <b>24.8 km</b></p><p><span>平均：</span> <b>16.1 kWh/100 km</b></p><p><span>時間：</span> <b>0:42 h</b></p><p><span>續航：</span> <b>412 km</b></p></aside>
      <RpmDial />
      <div className="aura-cluster-speed"><strong>{Math.round(speedKph)}</strong><span>km/h</span>{nextStop && density !== 'safety_only' && !warning && <span className="aura-cluster-navigation">下一站 · {uiText(nextStop)}</span>}<div className="aura-cluster-road" style={roadStyle} aria-hidden="true"><svg viewBox="0 0 400 310" preserveAspectRatio="none"><path className="road-edge" d="M145 0 30 310M255 0l115 310"/><path className="road-center" d="M200 0v310"/></svg><div className="aura-cluster-car" style={{ backgroundImage: `url(${rearCar})` }}/></div></div>
      <PowerDial />
      <aside className="aura-cluster-vehicle" aria-label="四輪獨立模擬胎壓"><h2>胎壓 <span>· bar</span></h2><div className="aura-cluster-tires"><div className="aura-cluster-topcar" style={{ backgroundImage: `url(${topCar})` }} aria-hidden="true"/>{tires.map((tire) => <div key={tire.position} className={`aura-cluster-tire tire-${tire.position}`}><span>{tire.position}</span><b>{tire.pressure}</b></div>)}</div><span className="aura-cluster-simulated">模擬</span><span className="aura-cluster-temp">溫度：19°C</span></aside>
    </div>
  </section>;
}
