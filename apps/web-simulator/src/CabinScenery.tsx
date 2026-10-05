import { useEffect, useRef, useState } from "react";
import type { CabinSend } from "./CabinVoiceInput";
import { cabinError } from "./cabin-ui";
import alpine from "./assets/window-rainy-alpine.webp";
import panorama from "./assets/dong-hwa/campus-panorama.jpg";
import lake from "./assets/dong-hwa/campus-lake.jpg";
const scenes = [alpine, panorama, lake];
/** The same canvas is both the visible window and the capture source, including crossfades. */
export function CabinScenery({
  personId,
  send,
}: {
  personId: string;
  send: CabinSend;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const paused = useRef(false);
  const ready = useRef(false);
  const [isPaused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [index, setIndex] = useState(0);
  useEffect(() => {
    let disposed = false,
      frame = 0,
      elapsed = 0,
      previous = 0,
      current = -1;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const images = scenes.map((src) => {
      const image = new Image();
      image.src = src;
      return image;
    });
    const draw = (image: HTMLImageElement, progress: number, alpha: number) => {
      const context = canvas.current?.getContext("2d");
      if (!context || !image.naturalWidth) return;
      const scale =
        Math.max(800 / image.naturalWidth, 600 / image.naturalHeight) *
        (reduced ? 1 : 1.04);
      const width = image.naturalWidth * scale,
        height = image.naturalHeight * scale;
      context.globalAlpha = alpha;
      context.drawImage(
        image,
        (800 - width) * (reduced ? 0.5 : 0.3 + progress * 0.4),
        (600 - height) / 2,
        width,
        height,
      );
    };
    Promise.all(images.map((image) => image.decode()))
      .then(() => {
        if (disposed) return;
        ready.current = true;
        const render = (time: number) => {
          if (disposed) return;
          if (previous && !paused.current && !document.hidden)
            elapsed += Math.min(time - previous, 100);
          previous = time;
          const slide = Math.floor(elapsed / 6000) % images.length,
            progress = (elapsed % 6000) / 6000;
          canvas.current?.getContext("2d")?.clearRect(0, 0, 800, 600);
          draw(images[slide], progress, 1);
          if (progress > 0.85)
            draw(
              images[(slide + 1) % images.length],
              0,
              (progress - 0.85) / 0.15,
            );
          if (slide !== current) {
            current = slide;
            setIndex(slide);
          }
          if (canvas.current) canvas.current.dataset.ready = "true";
          frame = requestAnimationFrame(render);
        };
        frame = requestAnimationFrame(render);
      })
      .catch(() => {
        if (!disposed) setMessage("窗景載入失敗，請重新整理。");
      });
    return () => {
      disposed = true;
      ready.current = false;
      cancelAnimationFrame(frame);
    };
  }, []);
  async function capture() {
    if (busy) return;
    if (!ready.current || !canvas.current) {
      setMessage("窗景尚未載入，請稍候再點。");
      return;
    }
    // Freeze the pixels immediately, before the asynchronous network operation.
    const dataUrl = canvas.current.toDataURL("image/jpeg", 0.75);
    setBusy(true);
    try {
      await send({ type: "photo.share", personId, dataUrl });
      setMessage("這一刻的景色已傳給媽媽。");
    } catch (error) {
      setMessage(cabinError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="cabin-scenery">
      <button
        type="button"
        className="cabin-scene-capture"
        aria-label="點擊車窗景色並傳給媽媽"
        disabled={busy}
        onClick={() => void capture()}
      >
        <canvas
          ref={canvas}
          width={800}
          height={600}
          role="img"
          aria-label="正在輪播的車外窗景"
        />
      </button>
      <div className="cabin-scene-toolbar">
        <small>
          {busy ? "正在傳送…" : "點一下景色，分享這一刻給媽媽"} · {index + 1}/
          {scenes.length}
        </small>
        <button
          className="cabin-secondary"
          aria-pressed={isPaused}
          onClick={() => {
            paused.current = !paused.current;
            setPaused(paused.current);
          }}
        >
          {isPaused ? "繼續窗景輪播" : "暫停窗景輪播"}
        </button>
      </div>
      <small>Demo 窗景輪播，非即時車外攝影機。</small>
      {message && (
        <p className="cabin-feedback" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
