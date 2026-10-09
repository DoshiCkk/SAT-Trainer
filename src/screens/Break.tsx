import { useEffect, useState } from "react";

function fmt(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function Break({
  seconds,
  next,
  onTick,
  onDone,
}: {
  seconds: number;
  /** Label of the module that follows. */
  next: string;
  /** Called every second so a reload resumes the break where it was. */
  onTick?: (left: number) => void;
  onDone: () => void;
}) {
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    const t = setInterval(() => setLeft((v) => (v <= 1 ? 0 : v - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (left === 0) onDone();
    else onTick?.(left);
  }, [left, onDone, onTick]);

  return (
    <div className="center-screen">
      <div className="col" style={{ alignItems: "center", gap: 18, textAlign: "center" }}>
        <h1 style={{ fontSize: 22 }}>Перерыв</h1>
        <div className="big-timer">{fmt(left)}</div>
        <p className="muted" style={{ maxWidth: 420 }}>
          Дальше — {next}. Результаты покажу только в конце, как на реальном экзамене.
        </p>
        <button className="btn primary" onClick={onDone}>
          Начать сейчас
        </button>
      </div>
    </div>
  );
}
