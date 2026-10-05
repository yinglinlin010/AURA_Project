import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { CabinSnapshot } from "../../../contracts/protocol/src/cabin";
import type { CabinSend } from "./CabinVoiceInput";
import { cabinError } from "./cabin-ui";
export function CabinNavigationPanel({
  state,
  send,
  driver,
}: {
  state: CabinSnapshot;
  send: CabinSend;
  driver: boolean;
}) {
  const nav = state.navigation;
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const sending = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  const position = useEffectEvent((sample: GeolocationPosition) => {
    if (sending.current) return;
    sending.current = true;
    void send({
      type: "navigation.position",
      version: state.trip.version,
      longitude: sample.coords.longitude,
      latitude: sample.coords.latitude,
      accuracy: sample.coords.accuracy,
      speed: Math.max(0, sample.coords.speed ?? 0),
      observedAt: Math.round(sample.timestamp),
    })
      .catch((e) => {
        if ((e as Error).message !== "CABIN_BUSY") setMessage(cabinError(e));
      })
      .finally(() => {
        sending.current = false;
      });
  });
  useEffect(() => {
    if (!driver || nav?.status !== "active" || nav.mode !== "gps") return;
    const id = navigator.geolocation.watchPosition(
      (sample) => position(sample),
      (error) => {
        setMessage(
          error.code === 1
            ? "GPS 權限被拒絕，請允許定位後重新開始導航。"
            : "無法取得 GPS，請移到定位訊號較佳的位置。",
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      navigator.geolocation.clearWatch(id);
      clearInterval(timer);
    };
  }, [driver, nav?.status, nav?.mode, nav?.startedAt]);
  async function start() {
    setBusy(true);
    setMessage("");
    try {
      {
        if (!navigator.geolocation) throw new Error("GPS_UNAVAILABLE");
        await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(
            resolve,
            () => reject(new Error("GPS_PERMISSION_REQUIRED")),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
          ),
        );
      }
      const result = await send({
        type: "navigation.start",
        mode: "gps",
        version: state.trip.version,
      });
      setMessage(result.text ?? "導航已開始");
    } catch (error) {
      setMessage(cabinError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="cabin-navigation" aria-label="行程導航">
      {nav && nav.status !== "idle" && (
        <div role="status" aria-live="polite">
          <b>{nav.instruction}</b>
          {nav.status === "active" && (
            <p>
              約 {Math.round(nav.nextManeuverMeters)} 公尺 · 剩餘{" "}
              {(nav.remainingMeters / 1000).toFixed(1)} 公里／
              {Math.ceil(nav.remainingSeconds / 60)} 分鐘
            </p>
          )}
          <small>
            {nav.mode === "demo"
              ? "Demo 模擬位置 · 20倍速"
              : "GPS 裝置定位 · 非即時路況"}
            {nav.status === "active" &&
            nav.mode === "gps" &&
            now - nav.updatedAt > 15000
              ? " · 等待定位更新"
              : ""}
          </small>
        </div>
      )}
      {driver && (
        <div className="cabin-actions">
          {nav?.status === "active" ? (
            <button
              className="cabin-secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await send({ type: "navigation.stop" });
                  setMessage("導航已結束");
                } catch (e) {
                  setMessage(cabinError(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              結束導航
            </button>
          ) : (
            <>
              <button
                disabled={busy || !state.trip.route}
                onClick={() => void start()}
              >
                {busy ? "正在啟動…" : "開始導航"}
              </button>
            </>
          )}
        </div>
      )}
      {message && (
        <p className="cabin-feedback" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
