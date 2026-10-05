import { useEffect, useState } from "react";
import type {
  CabinBallot,
  CabinPerson,
  CabinPlace,
  CabinResultMessage,
  CabinSnapshot,
  VotePolicy,
} from "../../../contracts/protocol/src/cabin";
import {
  parseBrowserDisplaySelection,
  canUseDisplay,
} from "./core/browser-display-selection";
import {
  useAuraCommand,
  DISPLAY_REGISTRATIONS,
  type DisplayId,
} from "./core/useAuraCommand";
import { ClusterDisplay } from "./ClusterDisplay";
import { CabinVoiceInput, type CabinSend } from "./CabinVoiceInput";
import { CabinNavigationPanel } from "./CabinNavigationPanel";
import { CabinMap } from "./CabinMap";
import { cabinError } from "./cabin-ui";
import { CabinScenery } from "./CabinScenery";
import "./CabinSystemApp.css";
const titles: Record<DisplayId, string> = {
  "cluster-main": "駕駛儀表",
  "center-main": "共享行程 · 駕駛",
  "front-passenger-main": "前座媽媽",
  "rear-tablet": "後座乘員",
  "window-tablet": "智慧車窗",
};
function seatFor(displayId: DisplayId) {
  return displayId === "center-main" || displayId === "cluster-main"
    ? "driver"
    : displayId === "front-passenger-main"
      ? "front"
      : "rear";
}
function SeatSelector({
  people,
  value,
  onChange,
}: {
  people: CabinPerson[];
  value: string;
  onChange: (id: string) => void;
}) {
  return people.length > 1 ? (
    <label className="cabin-person">
      目前乘員
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  ) : (
    <span className="cabin-person">{people[0]?.name ?? "此座位無乘員"}</span>
  );
}
function VotePanel({
  ballot,
  personId,
  send,
  readOnly = false,
  handsFree = false,
  people,
  onPersonChange,
  voiceEnabled = true,
}: {
  ballot: CabinBallot;
  personId: string;
  send: CabinSend;
  readOnly?: boolean;
  handsFree?: boolean;
  people?: CabinPerson[];
  onPersonChange?: (id: string) => void;
  voiceEnabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!["scheduled", "pending"].includes(ballot.status)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ballot.id, ballot.status]);
  useEffect(() => {
    if (
      !["passed", "failed", "cancelled", "expired"].includes(ballot.status) ||
      ballot.notificationUntil === undefined
    )
      return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, ballot.notificationUntil - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [ballot.id, ballot.status, ballot.notificationUntil]);
  if (
    ["passed", "failed", "cancelled", "expired"].includes(ballot.status) &&
    ballot.notificationUntil !== undefined &&
    now >= ballot.notificationUntil
  )
    return null;
  const votingEnabled = ballot.votingEnabled !== false;
  const present =
    ballot.electorate.some((p) => p.id === personId) &&
    (votingEnabled || personId === "driver");
  const voted = Object.prototype.hasOwnProperty.call(ballot.votes, personId);
  const cast = async (approve: boolean) => {
    setBusy(true);
    setError("");
    try {
      await send({ type: "vote.cast", personId, ballotId: ballot.id, approve });
    } catch (error) {
      setError(cabinError(error));
    } finally {
      setBusy(false);
    }
  };
  const labels = {
    scheduled: "投票尚未開始",
    pending: voted ? "等待結果" : present ? "要加入行程嗎？" : "等待駕駛確認",
    optimizing: "正在更新行程",
    passed: votingEnabled ? "投票通過" : "駕駛已同意",
    failed: votingEnabled ? "投票未通過" : "駕駛未同意",
    cancelled: "投票已取消",
    expired: votingEnabled ? "投票已逾時" : "駕駛確認已逾時",
    error: "路線尚未更新",
  };
  return (
    <section
      className={`cabin-vote ${ballot.status !== "scheduled" ? "cabin-vote-fullscreen" : ""} cabin-vote-${ballot.status}`}
      role="status"
      aria-label="行程投票"
    >
      <header>
        <b>{labels[ballot.status]}</b>
        {ballot.status === "pending" && (
          <span>
            {Math.max(0, Math.ceil((ballot.deadline - now) / 1000))}秒
          </span>
        )}
      </header>
      {ballot.status === "scheduled" && (
        <p className="cabin-scheduled-time">
          {new Date(ballot.opensAt ?? now).toLocaleTimeString("zh-TW")} 開始 ·
          還有 {Math.max(0, Math.ceil(((ballot.opensAt ?? now) - now) / 1000))}{" "}
          秒
        </p>
      )}
      {ballot.status === "pending" && people && people.length > 1 && onPersonChange && <SeatSelector people={people} value={personId} onChange={onPersonChange} />}
      <h3>{ballot.place.name}</h3>
      {ballot.status === "error" && <p className="cabin-error">{cabinError(new Error(ballot.reason.split(" · ")[0]))} 原路線保持不變，可重試。</p>}
      {ballot.status === "pending" && present && !readOnly && !voted && (
        <div className="cabin-actions">
          <button disabled={busy} onClick={() => void cast(true)}>
            同意
          </button>
          <button
            className="cabin-secondary"
            disabled={busy}
            onClick={() => void cast(false)}
          >
            不同意
          </button>
        </div>
      )}
      {voted && ballot.status === "pending" && <p className="cabin-vote-waiting">已選擇「{ballot.votes[personId] ? "同意" : "不同意"}」</p>}
      {personId === "driver" &&
        ballot.status === "pending" &&
        !readOnly &&
        !voted &&
        voiceEnabled && (
          <CabinVoiceInput
            personId={personId}
            send={send}
            purpose="vote"
            ballotId={ballot.id}
            autoListenKey={handsFree ? ballot.id : undefined}
            label="駕駛語音投票"
          />
        )}
      {ballot.status === "error" && personId === "driver" && !readOnly && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await send({ type: "vote.retry", ballotId: ballot.id });
            } catch (e) {
              setError(cabinError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          重試路線計算
        </button>
      )}
      {["passed", "failed", "cancelled", "expired"].includes(ballot.status) && <p className="cabin-vote-return">5 秒後返回原畫面</p>}
      {error && (
        <p className="cabin-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
function Conversation({
  state,
  personId,
  send,
  label,
}: {
  state: CabinSnapshot;
  personId: string;
  send: CabinSend;
  label: string;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="cabin-conversation">
      <h3>前後座字幕對話</h3>
      <CabinVoiceInput
        personId={personId}
        send={send}
        purpose="caption"
        label={label}
      />
      <div className="cabin-captions" aria-live="polite" aria-label="對座字幕">
        {state.captions.slice(-3).map((c) => (
          <p key={c.id}>
            <b>{c.sender}</b>
            <span>{c.text}</span>
            <small>
              {c.source === "voice" ? "語音辨識" : "文字輸入"} ·{" "}
              {new Date(c.createdAt).toLocaleTimeString("zh-TW")}
            </small>
          </p>
        ))}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await send({ type: "caption.send", personId, text: text.trim() });
            setText("");
          } catch (e) {
            setError(cabinError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          字幕測試文字
          <input
            value={text}
            maxLength={1000}
            onChange={(e) => setText(e.target.value)}
            placeholder="送到相反座位的螢幕"
          />
        </label>
        <button disabled={busy || !text.trim()} type="submit">
          送出字幕
        </button>
      </form>
      {error && (
        <p className="cabin-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
function Places({
  places,
  personId,
  send,
}: {
  places: CabinPlace[];
  personId: string;
  send: CabinSend;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [votingEnabled, setVotingEnabled] = useState(true);
  const [startDelaySeconds, setDelay] = useState(0);
  const [voteDurationSeconds, setDuration] = useState(60);
  return (
    <>
      {!!places.length && (
        <details className="cabin-proposal-settings">
          <summary>{votingEnabled ? startDelaySeconds ? `排定投票 · ${startDelaySeconds} 秒後` : "立即投票" : "只請駕駛確認"}<span>調整設定</span></summary>
        <fieldset className="cabin-proposal-options" disabled={!!busy}>
          <legend className="cabin-visually-hidden">加入行程設定</legend>
          <label>
            是否投票
            <select
              aria-label="是否投票"
              value={votingEnabled ? "vote" : "driver"}
              onChange={(e) => setVotingEnabled(e.target.value === "vote")}
            >
              <option value="vote">乘員投票＋駕駛同意</option>
              <option value="driver">不投票，請駕駛同意</option>
            </select>
          </label>
          {votingEnabled && (
            <label>
              幾秒後開始投票
              <input
                type="number"
                min={0}
                max={3600}
                step={1}
                value={startDelaySeconds}
                onChange={(e) => setDelay(Number(e.target.value))}
              />
            </label>
          )}
          <label>
            {votingEnabled ? "投票持續秒數" : "駕駛確認期限（秒）"}
            <input
              type="number"
              min={10}
              max={300}
              step={1}
              value={voteDurationSeconds}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </label>
          <small>
            {votingEnabled
              ? "0 秒代表立即開始；開始後才計算投票期限。"
              : "不要求其他乘員投票，駕駛仍可用語音同意或拒絕。"}
          </small>
        </fieldset>
        </details>
      )}
      <ol className="cabin-places">
        {places.map((place) => (
          <li key={place.id}>
            <div>
              <b>{place.name}</b>
              <p>{place.address}</p>
              <small>
                {place.fromCache
                  ? "已儲存 · OpenStreetMap · 原查詢時間 "
                  : "OpenStreetMap · 查詢時間 "}
                {new Date(place.observedAt).toLocaleTimeString("zh-TW")}
              </small>
            </div>
            <button
              disabled={!!busy}
              onClick={async () => {
                const delay = votingEnabled ? startDelaySeconds : 0;
                if (
                  !Number.isInteger(delay) ||
                  delay < 0 ||
                  delay > 3600 ||
                  !Number.isInteger(voteDurationSeconds) ||
                  voteDurationSeconds < 10 ||
                  voteDurationSeconds > 300
                ) {
                  setError(cabinError(new Error("VOTE_TIMING_INVALID")));
                  return;
                }
                setBusy(place.id);
                setError("");
                try {
                  await send({
                    type: "trip.propose",
                    personId,
                    placeId: place.id,
                    votingEnabled,
                    startDelaySeconds: votingEnabled ? startDelaySeconds : 0,
                    voteDurationSeconds,
                  });
                } catch (e) {
                  setError(cabinError(e));
                } finally {
                  setBusy("");
                }
              }}
            >
              {votingEnabled
                ? startDelaySeconds > 0
                  ? "排定投票"
                  : "發起投票"
                : "請駕駛確認"}
            </button>
          </li>
        ))}
      </ol>
      {error && (
        <p className="cabin-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
function PlaceFinder({
  personId,
  send,
}: {
  personId: string;
  send: CabinSend;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<CabinResultMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const search = async (recommend: boolean) => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(
        await send({ type: "place.search", query: query.trim(), recommend }),
      );
    } catch (e) {
      setError(cabinError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="cabin-finder">
      <h3>找景點 · 加入共享行程</h3>
      <CabinVoiceInput
        personId={personId}
        send={send}
        purpose="journey"
        label="語音加入或推薦景點"
        onResult={setResult}
        disabled={busy}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search(false);
        }}
      >
        <label>
          景點或需求
          <input
            value={query}
            maxLength={300}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="例如：鯉魚潭、推薦花蓮適合小孩的景點"
          />
        </label>
        <div className="cabin-actions">
          <button type="submit" disabled={busy || !query.trim()}>
            搜尋景點
          </button>
          <button
            type="button"
            disabled={busy || !query.trim()}
            onClick={() => void search(true)}
          >
            AI 推薦景點
          </button>
        </div>
      </form>
      <button
        className="cabin-secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            setResult(
              await send({ type: "place.cached", query: query.trim() }),
            );
          } catch (error) {
            setError(cabinError(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        查詢已儲存景點
      </button>
      <small>留空可看最近景點；已儲存資料可離線查詢，非即時資訊。</small>
      {busy && <p role="status">正在搜尋，請稍候…</p>}
      {error && (
        <p className="cabin-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <>
          <p className="cabin-feedback" role="status">
            {result.text} {result.provider && `· ${result.provider}`}
          </p>
          {result.places?.length ? (
            <Places places={result.places} personId={personId} send={send} />
          ) : (
            <p>沒有找到相符景點，請改用明確的地名。</p>
          )}
        </>
      )}
    </section>
  );
}
function Photos({
  state,
  personId,
  send,
  receiver,
}: {
  state: CabinSnapshot;
  personId: string;
  send: CabinSend;
  receiver: boolean;
}) {
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<CabinResultMessage | null>(null);
  const [error, setError] = useState("");
  return (
    <section className="cabin-photos">
      <h3>{receiver ? "小孩傳來的景色" : "已分享的景色"}</h3>
      {state.photos.map((photo) => (
        <article key={photo.id}>
          <img src={photo.dataUrl} alt={`${photo.sender}分享的窗外景色`} />
          <p>
            {photo.sender} ·{" "}
            {new Date(photo.createdAt).toLocaleTimeString("zh-TW")}
          </p>
          <div className="cabin-actions">
            <button
              disabled={!!busy}
              onClick={async () => {
                setBusy(photo.id);
                setError("");
                setResult(null);
                try {
                  setResult(
                    await send({ type: "image.search", photoId: photo.id }),
                  );
                } catch (e) {
                  setError(cabinError(e));
                } finally {
                  setBusy("");
                }
              }}
            >
              {busy === photo.id ? "正在比對圖片…" : "AI 以圖搜圖"}
            </button>
            {receiver && (
              <button
                className="cabin-secondary"
                disabled={!!busy}
                onClick={async () => {
                  setBusy(photo.id);
                  try {
                    await send({ type: "photo.ack", photoId: photo.id });
                    setResult(null);
                  } catch (e) {
                    setError(cabinError(e));
                  } finally {
                    setBusy("");
                  }
                }}
              >
                媽媽確認 · 關閉照片
              </button>
            )}
          </div>
        </article>
      ))}
      {error && (
        <p className="cabin-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <>
          <p>{result.text}</p>
          <p>下方是 AI 判斷的視覺相似圖片，不代表已確認原照片位置。</p>
          <div className="cabin-image-results">
            {result.images?.map((image) => (
              <figure key={image.id}>
                <img src={image.dataUrl} alt={image.title} />
                <figcaption>
                  <a href={image.url} target="_blank" rel="noreferrer">
                    {image.title}
                  </a>
                  <p>{image.reason}</p>
                  <small>
                    AI相似度 {Math.round((image.score ?? 0) * 100)}% ·{" "}
                    {image.attribution}
                  </small>
                </figcaption>
              </figure>
            ))}
          </div>
          {!result.images?.length && (
            <p>暫未找到可比較的相似照片，請換一張較清楚的景色。</p>
          )}
          {!!result.places?.length && (
            <Places places={result.places} personId={personId} send={send} />
          )}
        </>
      )}
    </section>
  );
}
function RouteSetup({
  state,
  send,
}: {
  state: CabinSnapshot;
  send: CabinSend;
}) {
  const [origin, setOrigin] = useState(state.trip.origin?.name ?? "");
  const [destination, setDestination] = useState(
    state.trip.destination?.name ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <details className="cabin-route-setup" open={!state.trip.origin}>
      <summary>
        {state.trip.origin ? "修改起點與終點" : "設定起點與終點"}
      </summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          if (!origin.trim() || !destination.trim()) {
            setMessage("請填寫起點與終點。");
            return;
          }
          setBusy(true);
          setMessage("正在查詢地點並計算路線…");
          try {
            const result = await send({
              type: "trip.configure",
              origin: origin.trim(),
              destination: destination.trim(),
            });
            setMessage(result.text ?? "路線已設定");
          } catch (error) {
            setMessage(cabinError(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          起點
          <input
            value={origin}
            placeholder="例如：國立東華大學"
            maxLength={300}
            required
            disabled={busy}
            onChange={(e) => setOrigin(e.target.value)}
          />
        </label>
        <label>
          終點
          <input
            value={destination}
            placeholder="例如：花蓮車站"
            maxLength={300}
            required
            disabled={busy}
            onChange={(e) => setDestination(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "正在計算…" : "設定並計算共享路線"}
        </button>
      </form>
      {message && (
        <p className="cabin-feedback" role="status">
          {message}
        </p>
      )}
    </details>
  );
}
function TripSummary({
  state,
  send,
  personId,
  voiceOnly = false,
}: {
  state: CabinSnapshot;
  send?: CabinSend;
  personId?: string;
  voiceOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function edit(placeId?: string) {
    if (!send) return;
    setBusy(true);
    try {
      const result = await send(
        placeId
          ? { type: "trip.remove", placeId, version: state.trip.version }
          : { type: "trip.clear", version: state.trip.version },
      );
      setMessage(result.text ?? "行程已更新");
    } catch (error) {
      setMessage(cabinError(error));
    } finally {
      setBusy(false);
    }
  }
  const trip = state.trip;
  return (
    <section className="cabin-trip">
      <h3>目前共享行程</h3>
      {send && <RouteSetup state={state} send={send} />}
      {send && personId && trip.origin && (
        <CabinVoiceInput
          personId={personId}
          send={send}
          purpose="trip_edit"
          tripVersion={trip.version}
          label="語音刪除行程"
          disabled={busy}
        />
      )}
      {send && personId && trip.origin && (
        <small>說「刪除景點名稱」或「清空行程」</small>
      )}
      {trip.origin && trip.destination ? (
        <>
          <ol>
            {[trip.origin, ...trip.stops, trip.destination].map((place, i) => (
              <li key={`${i}-${place.id}`}>
                <span>
                  {i === 0
                    ? "起點"
                    : i === trip.stops.length + 1
                      ? "終點"
                      : `停靠 ${i}`}
                </span>
                <b>{place.name}</b>
                {send && !voiceOnly && i > 0 && i <= trip.stops.length && (
                  <button
                    className="cabin-secondary"
                    disabled={busy}
                    aria-label={`刪除景點 ${place.name}`}
                    onClick={() => void edit(place.id)}
                  >
                    刪除
                  </button>
                )}
              </li>
            ))}
          </ol>
          {send && !voiceOnly && (
            <button
              className="cabin-secondary"
              disabled={busy}
              onClick={() => void edit()}
            >
              清空共享行程
            </button>
          )}
          {message && (
            <p className="cabin-feedback" role="status">
              {message}
            </p>
          )}
          {trip.route && (
            <p className="cabin-route-stats">
              <b>{(trip.route.distanceMeters / 1000).toFixed(1)}公里</b>
              <b>{Math.round(trip.route.durationSeconds / 60)}分鐘</b>
              <small>
                OSRM 路線估計，非即時交通 ·{" "}
                {new Date(trip.route.observedAt).toLocaleTimeString("zh-TW")}
              </small>
            </p>
          )}
        </>
      ) : (
        <p>請在此面板設定起點與終點，即可開始規劃共享行程。</p>
      )}
    </section>
  );
}
function CabinController({
  state,
  send,
  connected,
  onConnectivity,
}: {
  state: CabinSnapshot | null;
  send: CabinSend;
  connected: boolean;
  onConnectivity: (online: boolean) => void;
}) {
  const [count, setCount] = useState(3);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const peopleCount = state?.people.length;
  useEffect(() => {
    if (peopleCount !== undefined) setCount(peopleCount);
  }, [peopleCount]);
  return (
    <section className="cabin-controller">
      <h2>座艙控制器</h2>

      <p>
        乘員人數由控制器模擬車內攝影機感知；照片、字幕、投票與路線由後端同步。
      </p>
      {state?.capabilities.tripSaved !== undefined && (
        <p role="status">
          {state.capabilities.tripSaved
            ? "已核准的共享行程已儲存；重啟後會恢復。"
            : "行程尚未成功儲存，請檢查本機資料夾寫入權限。"}
        </p>
      )}
      <div className="cabin-controller-row">
        <label>
          車上人數（含駕駛）
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <button
          disabled={!connected || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await send({
                type: "people.set",
                count,
                policy: "majority_driver" as VotePolicy,
              });
              setMessage(`乘員名單已更新為${count}人`);
            } catch (e) {
              setMessage(cabinError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          更新感知人數
        </button>
        <span>投票：過半同意＋駕駛同意</span>
      </div>
      <div className="cabin-actions">
        <button
          disabled={!connected || busy}
          onClick={() => onConnectivity(true)}
        >
          恢復網路模式
        </button>
        <button
          className="cabin-secondary"
          disabled={!connected || busy}
          onClick={() => onConnectivity(false)}
        >
          測試離線模式
        </button>
      </div>
      <small>
        OSM公共查詢：按下搜尋才送出，最高每秒一次，並快取結果。請使用公共地點，勿輸入私人住址。
        <a
          href="https://operations.osmfoundation.org/policies/nominatim/"
          target="_blank"
          rel="noreferrer"
        >
          服務政策
        </a>
      </small>
      <p className="cabin-feedback" role="status">
        {message}
      </p>
      {state && (
        <p>
          地圖：OpenStreetMap＋OSRM · 雲端 AI：
          {state.capabilities.cloud ? "已設定" : "未設定"} · 本地語音：
          {state.capabilities.localSpeech ? "Whisper已設定" : "尚未設定"}
        </p>
      )}
    </section>
  );
}
function Display({
  id,
  state,
  send,
  connected,
}: {
  id: DisplayId;
  state: CabinSnapshot;
  send: CabinSend;
  connected: boolean;
}) {
  const people = state.people.filter((p) => p.seat === seatFor(id));
  const [selected, setSelected] = useState("");
  const personId = people.some((p) => p.id === selected)
    ? selected
    : (people[0]?.id ?? "");
  const [handsFree, setHandsFree] = useState(false);
  const [handsFreeMessage, setHandsFreeMessage] = useState("");
  const [tab, setTab] = useState(
    id === "center-main"
      ? "行程"
      : id === "front-passenger-main"
        ? "照片"
        : id === "rear-tablet"
          ? "對話"
          : "景色",
  );
  useEffect(() => {
    if (state.ballot?.status !== "passed") return;
    setTab(id === "center-main" || id === "front-passenger-main" ? "行程" : id === "rear-tablet" ? "對話" : "景色");
  }, [state.ballot?.id, state.ballot?.status, id]);
  const tabs =
    id === "center-main"
      ? ["行程"]
      : id === "front-passenger-main"
        ? ["照片", "景點", "對話", "行程"]
        : id === "rear-tablet"
          ? ["對話", "景點", "照片"]
          : ["景色", "景點", "照片"];
  return (
    <section className={`cabin-display cabin-${id}`} aria-label={titles[id]}>
      <header className="cabin-display-header">
        <h2>{titles[id]}</h2>
        <span>{connected ? "已連線" : "連線中斷"}</span>
        <SeatSelector people={people} value={personId} onChange={setSelected} />
      </header>
      {id === "center-main" && (
        <div className="cabin-hands-free">
          <button
            className="cabin-secondary"
            disabled={!connected}
            aria-pressed={handsFree}
            onClick={async () => {
              if (handsFree) {
                setHandsFree(false);
                setHandsFreeMessage("免持確認已關閉");
                return;
              }
              try {
                const input = await navigator.mediaDevices.getUserMedia({
                  audio: true,
                  video: false,
                });
                input.getTracks().forEach((t) => t.stop());
                setHandsFree(true);
                setHandsFreeMessage(
                  "免持確認已啟用；新投票開始時自動收音，說完停頓即送出。",
                );
              } catch {
                setHandsFreeMessage("請在瀏覽器允許麥克風後重試。");
              }
            }}
          >
            {handsFree ? "關閉駕駛免持確認" : "啟用駕駛免持確認"}
          </button>
          <small>{handsFreeMessage}</small>

        </div>
      )}
      {state.ballot && (
        <VotePanel
          ballot={state.ballot}
          personId={personId}
          send={send}
          readOnly={!connected || !personId}
          handsFree={handsFree}
          people={people}
          onPersonChange={setSelected}
        />
      )}
      {id === "front-passenger-main" &&
        tab !== "照片" &&
        state.photos.length > 0 && (
          <aside className="cabin-photo-inbox" aria-label="新收到的景色照片">
            <Photos state={state} personId={personId} send={send} receiver />
          </aside>
        )}
      {id !== "center-main" &&
        state.captions.slice(-1).map((c) => (
          <div key={c.id} className="cabin-subtitle" aria-live="polite">
            <b>{c.sender}</b>
            <span>{c.text}</span>
            <small>{c.source === "voice" ? "語音字幕" : "文字字幕"}</small>
          </div>
        ))}
      {tabs.length > 1 && (
        <nav aria-label={`${titles[id]}功能`}>
          {tabs.map((item) => (
            <button
              key={item}
              aria-pressed={tab === item}
              onClick={() => setTab(item)}
            >
              {item}
              {item === "照片" && state.photos.length
                ? ` (${state.photos.length})`
                : ""}
            </button>
          ))}
        </nav>
      )}
      {!personId ? (
        <p>目前名單中沒有此座位乘員，請在控制器更新人數。</p>
      ) : (
        <div className="cabin-display-body">
          {tab === "行程" && (
            <>
              <TripSummary
                state={state}
                send={send}
                personId={personId}
                voiceOnly={id === "center-main"}
              />
              <CabinNavigationPanel
                state={state}
                send={send}
                driver={id === "center-main"}
              />
              {state.trip.route && (
                <CabinMap trip={state.trip} navigation={state.navigation} />
              )}
            </>
          )}
          {tab === "對話" && (
            <Conversation
              state={state}
              personId={personId}
              send={send}
              label={seatFor(id) === "rear" ? "後座語音輸入" : "前座語音輸入"}
            />
          )}{" "}
          {tab === "景點" && <PlaceFinder personId={personId} send={send} />}{" "}
          {tab === "照片" && (
            <Photos
              state={state}
              personId={personId}
              send={send}
              receiver={id === "front-passenger-main"}
            />
          )}{" "}
          {tab === "景色" && <CabinScenery personId={personId} send={send} />}
        </div>
      )}
    </section>
  );
}
export default function CabinSystemApp() {
  const [entry] = useState(() =>
    parseBrowserDisplaySelection(window.location.search),
  );
  const { state, cabinByDisplay, sendCabin, sendCommand } =
    useAuraCommand(entry);
  const controlOnly =
    new URLSearchParams(window.location.search).get("control") === "1";
  const center = cabinByDisplay["center-main"];
  const any = center ?? Object.values(cabinByDisplay)[0];
  if (entry.mode === "invalid")
    return (
      <main className="cabin-app">
        <p role="alert">無效螢幕入口。</p>
        <a href={window.location.pathname}>返回全部畫面</a>
      </main>
    );
  return (
    <main
      className={`cabin-app${entry.mode === "single" ? " cabin-single" : ""}`}
    >
      <header className="cabin-app-header">
        {(entry.mode === "single" || controlOnly) && (
          <a className="cabin-overview-link" href={window.location.pathname}>
            返回全部畫面
          </a>
        )}
        <div>
          <b>AURA</b>
          <span>共享座艙 · 照片、字幕與旅程</span>
        </div>
        <span>
          乘員 {any?.people.length ?? "—"} 人 ·{" "}
          {state.connectivity.mode === "online" ? "連網" : "本地／離線"}
        </span>
      </header>
      {!controlOnly && (
        <div className="cabin-display-grid">
          {[
            ["cluster-main", "center-main"],
            ["front-passenger-main", "rear-tablet", "window-tablet"],
          ].map((group, index) => (
            <div className="cabin-column" key={index}>
              {DISPLAY_REGISTRATIONS.filter(
                (d) =>
                  group.includes(d.displayId) &&
                  canUseDisplay(entry, d.displayId),
              ).map(({ displayId }) => {
                const snapshot = cabinByDisplay[displayId];
                const send: CabinSend = (command) =>
                  sendCabin(displayId, command);
                const connected =
                  state.connections[displayId].status === "connected";
                if (displayId === "cluster-main")
                  return (
                    <section
                      className="cabin-cluster"
                      key={displayId}
                      aria-label="駕駛儀表"
                    >
                      <h2>駕駛儀表</h2>
                      <ClusterDisplay
                        speedKph={
                          snapshot?.navigation?.status === "active"
                            ? snapshot.navigation.speedKph
                            : state.speedKph
                        }
                        warning={state.activeSafetyWarning}
                        density="rich"
                        motionPaused={false}
                        nextStop={snapshot?.trip.stops[0]?.name}
                      />

                    </section>
                  );
                return snapshot ? (
                  <Display
                    key={displayId}
                    id={displayId}
                    state={snapshot}
                    send={send}
                    connected={connected}
                  />
                ) : (
                  <section key={displayId} className="cabin-display">
                    <h2>{titles[displayId]}</h2>
                    <p role="status">
                      {connected
                        ? "等待後端座艙資料；請確認已啟動更新後的主機。"
                        : "正在連線到座艙主機…"}
                    </p>
                    <small>{state.connections[displayId].lastMessage}</small>
                  </section>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {controlOnly && (
        <CabinController
          state={center ?? null}
          send={(command) => sendCabin("center-main", command)}
          connected={state.connections["center-main"].status === "connected"}
          onConnectivity={(online) =>
            sendCommand("center-main", {
              type: "connectivity.mode.report",
              payload: {
                mode: online ? "online" : "offline",
                evidence: "CONTROLLER_NETWORK_MODE",
              },
            })
          }
        />
      )}
      <footer>
        <nav aria-label="獨立螢幕入口">
          <a href={window.location.pathname}>全部畫面</a>
          {DISPLAY_REGISTRATIONS.map((d) => (
            <a
              key={d.displayId}
              target="_blank"
              rel="noreferrer"
              href={`?display=${d.displayId}`}
            >
              {titles[d.displayId]}
            </a>
          ))}
          <a target="_blank" rel="noreferrer" href="?control=1">
            控制器
          </a>
        </nav>
        © OpenStreetMap contributors · 窗外景色為 Demo
        動畫輪播，點擊可截取當下畫面。乘員名單由控制器模擬感知。
      </footer>
    </main>
  );
}
