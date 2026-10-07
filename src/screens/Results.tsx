import { useMemo } from "react";
import type { Attempt, RunPlan } from "../types";

function pct(n: number, d: number) {
  return d === 0 ? "—" : `${Math.round((n / d) * 100)}%`;
}

function mmss(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface Props {
  plan: RunPlan;
  attempts: Attempt[];
  onHome: () => void;
  /** Wired up in stage 3. */
  onReview?: () => void;
}

/** Stage 2 summary. The per-question breakdown with rationale lives in Review. */
export default function Results({ plan, attempts, onHome, onReview }: Props) {
  const total = attempts.length;
  const right = attempts.filter((a) => a.correct).length;

  const byDomain = useMemo(() => {
    const m = new Map<string, { n: number; ok: number; ms: number }>();
    for (const a of attempts) {
      const row = m.get(a.domain) ?? { n: 0, ok: 0, ms: 0 };
      row.n++;
      if (a.correct) row.ok++;
      row.ms += a.timeMs;
      m.set(a.domain, row);
    }
    return [...m.entries()].sort((x, y) => y[1].n - x[1].n);
  }, [attempts]);

  const byModule = useMemo(() => {
    const m = new Map<number, { n: number; ok: number }>();
    for (const a of attempts) {
      const row = m.get(a.moduleIndex) ?? { n: 0, ok: 0 };
      row.n++;
      if (a.correct) row.ok++;
      m.set(a.moduleIndex, row);
    }
    return [...m.entries()].sort((x, y) => x[0] - y[0]);
  }, [attempts]);

  return (
    <div className="wrap" style={{ maxWidth: 780 }}>
      <h1 style={{ fontSize: 24, marginBottom: 6 }}>{plan.label} — результат</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {right} из {total} правильно · {pct(right, total)}
      </p>

      {byModule.length > 1 && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>Выносливость: модуль 1 vs модуль 2</h2>
          <table className="grid">
            <thead>
              <tr>
                <th>Модуль</th>
                <th>Верно</th>
                <th>Всего</th>
                <th>Точность</th>
              </tr>
            </thead>
            <tbody>
              {byModule.map(([i, r]) => (
                <tr key={i}>
                  <td>Модуль {i + 1}</td>
                  <td className="num">{r.ok}</td>
                  <td className="num">{r.n}</td>
                  <td className="num">{pct(r.ok, r.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>По доменам</h2>
        <table className="grid">
          <thead>
            <tr>
              <th>Домен</th>
              <th>Верно</th>
              <th>Всего</th>
              <th>Точность</th>
              <th>Ср. время</th>
            </tr>
          </thead>
          <tbody>
            {byDomain.map(([d, r]) => (
              <tr key={d}>
                <td>{d}</td>
                <td className="num">{r.ok}</td>
                <td className="num">{r.n}</td>
                <td className="num">{pct(r.ok, r.n)}</td>
                <td className="num">{mmss(r.ms / r.n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row">
        {onReview && (
          <button className="btn primary" onClick={onReview}>
            К разбору
          </button>
        )}
        <button className="btn" onClick={onHome}>
          На главную
        </button>
      </div>
    </div>
  );
}
