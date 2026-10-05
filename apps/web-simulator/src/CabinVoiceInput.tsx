import { useEffect, useEffectEvent, useRef, useState } from "react";
import type {
  CabinCommand,
  CabinResultMessage,
} from "../../../contracts/protocol/src/cabin";
import { cabinError } from "./cabin-ui";
let microphoneOwner: string | null = null;
export type CabinSend = (command: CabinCommand) => Promise<CabinResultMessage>;
export function CabinVoiceInput({
  personId,
  purpose,
  send,
  onResult,
  label,
  disabled = false,
  ballotId,
  autoListenKey,
  tripVersion,
}: {
  personId: string;
  purpose: "caption" | "journey" | "vote" | "trip_edit";
  send: CabinSend;
  onResult?: (result: CabinResultMessage) => void;
  label: string;
  disabled?: boolean;
  ballotId?: string;
  tripVersion?: number;
  autoListenKey?: string;
}) {
  const [phase, setPhase] = useState<
    "idle" | "permission" | "recording" | "sending"
  >("idle");
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const animation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const key = useRef(crypto.randomUUID());
  const cancelled = useRef(false);
  const autoStarted = useRef("");
  const release = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    cancelAnimationFrame(animation.current);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    void audio.current?.close().catch(() => {});
    audio.current = null;
    if (microphoneOwner === key.current) microphoneOwner = null;
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelled.current = true;
      try {
        recorder.current?.stop();
      } catch {
        /* already stopped */
      }
      release();
    };
  }, []);
  useEffect(() => {
    const stop = () => {
      if (
        microphoneOwner !== key.current &&
        recorder.current?.state !== "recording"
      )
        return;
      cancelled.current = true;
      try {
        recorder.current?.stop();
      } catch {}
      release();
      setPhase("idle");
      setMessage("錄音已停止，重新按語音輸入即可繼續。");
    };
    const hidden = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("aura:media-stop", stop);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("aura:media-stop", stop);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  async function start() {
    if (microphoneOwner) {
      setMessage("另一個螢幕正在使用麥克風，請先結束錄音。");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setMessage(
        "此瀏覽器不支援錄音，請使用最新版 Chrome 或 Safari，並從 localhost 或 HTTPS 開啟。",
      );
      return;
    }
    microphoneOwner = key.current;
    cancelled.current = false;
    setPhase("permission");
    setMessage("正在請求麥克風權限…");
    try {
      const input = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        video: false,
      });
      if (!mounted.current || cancelled.current) {
        input.getTracks().forEach((track) => track.stop());
        release();
        return;
      }
      stream.current = input;
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const capture = new MediaRecorder(input, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: 64000,
      });
      recorder.current = capture;
      const chunks: Blob[] = [];
      let heard = false;
      capture.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      capture.onerror = () => {
        if (mounted.current) {
          setPhase("idle");
          setMessage("錄音失敗，請重試。");
        }
        cancelled.current = true;
        release();
      };
      capture.onstop = async () => {
        const blob = new Blob(chunks, { type: capture.mimeType });
        release();
        if (!mounted.current || cancelled.current) return;
        setPhase("sending");
        setLevel(0);
        setMessage("正在辨識語音…");
        try {
          if (!heard || blob.size < 200) throw new Error("SPEECH_NOT_RECOGNIZED");
          if (blob.size > 1000000) throw new Error("AUDIO_TOO_LARGE");
          const buffer = await blob.arrayBuffer();
          let binary = "";
          for (const byte of new Uint8Array(buffer))
            binary += String.fromCharCode(byte);
          const result = await send({
            type: "speech.transcribe",
            personId,
            purpose,
            data: btoa(binary),
            ...(ballotId ? { ballotId } : {}),
            ...(tripVersion !== undefined ? { tripVersion } : {}),
            mimeType: blob.type.split(";")[0] ?? "audio/webm",
          });
          if (mounted.current) {
            setMessage(
              purpose === "vote"
                ? "駕駛語音確認已送出。"
                : (result.text ?? "語音已送出"),
            );
            onResult?.(result);
          }
        } catch (error) {
          if (mounted.current) setMessage(cabinError(error));
        } finally {
          if (mounted.current) setPhase("idle");
        }
      };
      const ctx = new AudioContext();
      void ctx.resume().catch(() => {});
      audio.current = ctx;
      const source = ctx.createMediaStreamSource(input);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const samples = new Float32Array(analyser.fftSize);
      let lastSound = performance.now();
      const begun = performance.now();
      const meter = () => {
        if (!mounted.current || capture.state !== "recording") return;
        analyser.getByteFrequencyData(buffer);
        const value =
          buffer.reduce((sum, x) => sum + x, 0) / buffer.length / 128;
        setLevel(Math.min(1, value));
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(
          samples.reduce((sum, x) => sum + x * x, 0) / samples.length,
        );
        if (rms > 0.008) {
          heard = true;
          lastSound = performance.now();
        }
        if (
          heard &&
          performance.now() - lastSound > (purpose === "vote" ? 1700 : 2300) &&
          performance.now() - begun > 1700
        ) {
          capture.stop();
          return;
        }
        animation.current = requestAnimationFrame(meter);
      };
      capture.start();
      setPhase("recording");
      setMessage("正在聽，說完停頓即送出，也可按「結束並送出」。");
      meter();
      timer.current = setTimeout(() => {
        if (capture.state === "recording") capture.stop();
      }, 20000);
    } catch (error) {
      release();
      if (mounted.current) {
        setPhase("idle");
        const name = (error as { name?: string })?.name;
        setMessage(
          name === "NotAllowedError"
            ? "麥克風權限被拒絕，請在瀏覽器網址列允許麥克風後重試。"
            : name === "NotFoundError"
              ? "找不到麥克風，請接上裝置後重試。"
              : cabinError(error),
        );
      }
    }
  }
  const startAutomatically = useEffectEvent(() => {
    void start();
  });
  useEffect(() => {
    if (autoListenKey && autoStarted.current !== autoListenKey && !disabled) {
      autoStarted.current = autoListenKey;
      startAutomatically();
    }
    if ((!autoListenKey || disabled) && autoStarted.current) {
      autoStarted.current = "";
      cancelled.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      release();
      setPhase("idle");
    }
  }, [autoListenKey, disabled]);
  return (
    <div className="cabin-voice">
      <button
        type="button"
        disabled={disabled || phase === "sending" || phase === "permission"}
        aria-pressed={phase === "recording"}
        onClick={() => {
          if (phase === "recording") recorder.current?.stop();
          else void start();
        }}
      >
        {phase === "recording"
          ? "結束並送出"
          : phase === "sending"
            ? "辨識中…"
            : phase === "permission"
              ? "允許麥克風…"
              : label}
      </button>
      {phase === "recording" && (
        <div className="cabin-listening" role="status" aria-label="正在聽">
          <span>正在聽</span>
          {[0.6, 1, 0.8, 1, 0.6].map((scale, i) => (
            <i key={i} style={{ height: `${8 + level * 30 * scale}px` }} />
          ))}
          <small>最長20秒</small>
        </div>
      )}
      {message && (
        <p className="cabin-feedback" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
