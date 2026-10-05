import { useEffect, useState } from 'react';

import { useSimulatedCabin } from './core/simulated-cabin';

export function ClimateControls({ rear = false }: { rear?: boolean }) {
  const [state, set] = useSimulatedCabin();
  const temperature = rear ? state.rearTemperature : state.temperature;
  const change = (delta: number) => {
    const value = Math.max(16, Math.min(28, temperature + delta));
    set(rear && !state.sync ? { rearTemperature: value } : { temperature: value });
  };
  return <div className="sim-controls"><div className="temperature"><button aria-label="降低溫度" disabled={temperature <= 16} onClick={() => change(-.5)}>−</button><strong aria-live="polite">{temperature.toFixed(1)}°C</strong><button aria-label="提高溫度" disabled={temperature >= 28} onClick={() => change(.5)}>＋</button></div><label>風量 {state.fan}<input aria-label="風量" type="range" min="1" max="5" step="1" value={state.fan} onChange={event => set({ fan: Number(event.target.value) })}/></label><button aria-pressed={state.sync} onClick={() => set({ sync: !state.sync })}>{state.sync ? '取消同步' : '同步前後座溫度'}</button><small>模擬空調 · 同源瀏覽器畫面同步</small></div>;
}
export function DisplaySettings({ general = false }: { general?: boolean }) {
  const [state, set] = useSimulatedCabin();
  return <div className="sim-controls"><label>亮度 {state.brightness}%<input aria-label="亮度" type="range" min="40" max="100" value={state.brightness} onChange={e => set({ brightness: Number(e.target.value) })}/></label><label>音量 {state.volume}%<input aria-label="音量" type="range" min="0" max="100" value={state.volume} onChange={e => set({ volume: Number(e.target.value) })}/></label>{general && <button onClick={() => set({ temperature: 22, rearTemperature: 21.5, fan: 3, sync: false, call: false, brightness: 100, volume: 50 })}>恢復模擬設定</button>}<small>模擬設定 · 不控制裝置亮度或真實音訊</small></div>;
}
const tracks = ['午夜回聲', '沿途微光', '湖畔午後'];
export function MediaControls({ radio = false }: { radio?: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [track, setTrack] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const [state, set] = useSimulatedCabin();
  const active = playing && seconds < 180;
  const next = () => { setTrack(current => shuffle ? (current + 1 + Math.floor(Math.random() * (tracks.length - 1))) % tracks.length : (current + 1) % tracks.length); setSeconds(0); };
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setSeconds(current => { if (current >= 179) { if (repeat) return 0; return 180; } return current + 1; }), 1000);
    return () => clearInterval(timer);
  }, [active, repeat]);
  return <div className="sim-controls"><b aria-live="polite">{radio ? ['FM 98.4', 'FM 100.7', 'FM 103.3'][track] : tracks[track]}</b><div className="media-controls"><button aria-label="隨機播放" aria-pressed={shuffle} onClick={() => setShuffle(!shuffle)}>隨機</button><button aria-label="上一首" onClick={() => { setTrack((track + tracks.length - 1) % tracks.length); setSeconds(0); }}>上一首</button><button aria-label={active ? '暫停' : '播放'} aria-pressed={active} onClick={() => { if (seconds === 180) setSeconds(0); setPlaying(!active); }}>{active ? '暫停' : '播放'}</button><button aria-label="下一首" onClick={next}>下一首</button><button aria-label="重複播放" aria-pressed={repeat} onClick={() => setRepeat(!repeat)}>重複</button><button aria-label="音量" aria-expanded={showVolume} onClick={() => setShowVolume(!showVolume)}>音量</button></div><label>播放進度<input aria-label="播放進度" type="range" min="0" max="180" value={seconds} onChange={e => setSeconds(Number(e.target.value))}/></label><small>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} / 3:00 · 模擬播放 · 無音訊</small>{showVolume && <label>音量 {state.volume}%<input aria-label="媒體音量" type="range" min="0" max="100" value={state.volume} onChange={e => set({ volume: Number(e.target.value) })}/></label>}</div>;
}
export function CenterControls({ blocked, stops }: { blocked: boolean; stops: string[] }) {
  const [panel, setPanel] = useState('');
  const [route, setRoute] = useState('最快路線');
  const [phone, setPhone] = useState(false);
  const [state, set] = useSimulatedCabin();

  return <><div className="center-actions">{['導航', '廣播', '空調', '電話'].map(name => <button key={name} disabled={blocked} aria-expanded={panel === name} onClick={() => setPanel(panel === name ? '' : name)}><b>{name}</b><span>{name === '空調' ? `${state.temperature.toFixed(1)}°C` : name === '電話' ? (phone ? '模擬通話中' : '模擬待命') : '操作選項'}</span></button>)}</div>{blocked && <p className="sim-feedback">駕駛負荷限制中，暫緩操作。</p>}{state.call && !blocked && <div className="sim-feedback" role="status">後座請求聯絡駕駛 · 模擬通知<button onClick={() => set({ call: false })}>確認收到</button></div>}{panel && !blocked && <section className="sim-panel" aria-label={`${panel}操作`}><h3>{panel} · 模擬</h3><button className="sim-close" onClick={() => setPanel('')}>關閉</button>{panel === '導航' && <><label>路線選項<select value={route} onChange={e => setRoute(e.target.value)}>{['最快路線', '避開高速公路', '避開收費道路'].map(item => <option key={item}>{item}</option>)}</select></label><p role="status">已選擇：{route} · 示意地圖不重新計算</p><p>已核准停靠：{stops.join('、') || '無'}</p></>}{panel === '廣播' && <MediaControls radio/>}{panel === '空調' && <ClimateControls/>}{panel === '電話' && <><p role="status">{phone ? '模擬通話中' : '模擬聯絡人：旅程服務'}</p><button onClick={() => setPhone(!phone)}>{phone ? '結束模擬通話' : '開始模擬通話'}</button></>}</section>}</>;
}
