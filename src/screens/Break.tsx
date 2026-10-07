import { useEffect, useState } from "react";

function fmt(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function Break({ minutes, onDone }: { minutes: number; onDone: () => void }) {
  const [left, setLeft] = useState(minutes * 60);

  useEffect(() => {
    const t = setInterval(() => setLeft((v) => (v <= 1 ? 0 : v - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (left === 0) onDone();
  }, [left, onDone]);

  return (
    <div className="center-screen">
      <div className="col" style={{ alignItems: "center", gap: 18, textAlign: "center" }}>
        <h1 style={{ fontSize: 22 }}>Перерыв</h1>
        <div className="big-timer">{fmt(left)}</div>
        <p className="muted" style={{ maxWidth: 420 }}>
          Результаты первого модуля будут показаны только после второго — как на реальном
          экзамене.
        </p>
        <button className="btn primary" onClick={onDone}>
          Начать модуль 2 сейчас
        </button>
      </div>
    </div>
  );
}
