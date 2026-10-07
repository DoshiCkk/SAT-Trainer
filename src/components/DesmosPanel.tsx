import { useEffect, useRef, useState } from "react";

/** Same build Bluebook embeds; the key is a public, client-side API key. */
const API_VERSION = "v1.11";
const API_KEY = import.meta.env.VITE_DESMOS_API_KEY ?? "";

declare global {
  interface Window {
    Desmos?: {
      GraphingCalculator: (
        el: HTMLElement,
        opts?: Record<string, unknown>
      ) => { destroy: () => void; resize: () => void };
    };
  }
}

let loader: Promise<void> | null = null;

function loadDesmos(): Promise<void> {
  if (window.Desmos) return Promise.resolve();
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = `https://www.desmos.com/api/${API_VERSION}/calculator.js?apiKey=${API_KEY}`;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      loader = null;
      reject(new Error("Не удалось загрузить Desmos — проверь интернет."));
    };
    document.head.appendChild(el);
  });
  return loader;
}

export default function DesmosPanel({ onClose }: { onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let calc: { destroy: () => void; resize: () => void } | null = null;
    let ro: ResizeObserver | null = null;
    let alive = true;

    loadDesmos()
      .then(() => {
        if (!alive || !host.current || !window.Desmos) return;
        calc = window.Desmos.GraphingCalculator(host.current, {
          keypad: true,
          expressions: true,
          settingsMenu: false,
          border: false,
          lockViewport: false,
          autosize: true,
        });
        // Docked, the panel changes width without the window doing so, and
        // autosize only follows the window.
        ro = new ResizeObserver(() => calc?.resize());
        ro.observe(host.current);
      })
      .catch((e: Error) => alive && setError(e.message));

    return () => {
      alive = false;
      ro?.disconnect();
      calc?.destroy();
    };
  }, []);

  return (
    <div className="desmos-panel">
      <div className="desmos-head">
        <span>Desmos</span>
        <button className="btn ghost sm" onClick={onClose}>
          Закрыть
        </button>
      </div>
      {error ? (
        <div className="desmos-body center-note">
          <span className="muted small">{error}</span>
        </div>
      ) : (
        <div className="desmos-body" ref={host} />
      )}
    </div>
  );
}
