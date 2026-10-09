import { useMemo } from "react";
import type { Attempt, PracticeScore, RunPlan, SectionScore } from "../types";

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
  /** Practice tests only. */
  score?: PracticeScore | null;
  onHome: () => void;
  /** Wired up in stage 3. */
  onReview?: () => void;
}

const ROUTE_LABEL = { hard: "сложный", easy: "лёгкий" } as const;

/** 1 вопрос, 4 вопроса, 8 вопросов. */
function questionsWord(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return "вопрос";
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return "вопроса";
  return "вопросов";
}

/** Where a 200–800 score and its band sit on the scale, in percent. */
const at = (v: number) => `${((v - 200) / 600) * 100}%`;

function SectionRow({ s }: { s: SectionScore }) {
  return (
    <div className="score-row">
      <div className="score-head">
        <span className="score-name">{s.section === "Math" ? "Math" : "Reading and Writing"}</span>
        <span className="score-num">{s.score}</span>
      </div>
      <div className="score-track" aria-hidden="true">
        <div className="score-band" style={{ left: at(s.low), right: `calc(100% - ${at(s.high)})` }} />
        <div className="score-dot" style={{ left: at(s.score) }} />
      </div>
      <div className="small muted score-meta">
        <span>
          диапазон {s.low}–{s.high}
        </span>
        <span>
          модуль 1: {s.first.right}/{s.first.of} → модуль 2 {ROUTE_LABEL[s.route]}: {s.second.right}/
          {s.second.of}
        </span>
      </div>
    </div>
  );
}

/** Stage 2 summary. The per-question breakdown with rationale lives in Review. */
export default function Results({ plan, attempts, score, onHome, onReview }: Props) {
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

  const pretest = attempts.filter((a) => a.pretest);

  return (
    <div className="wrap" style={{ maxWidth: 780 }}>
      <h1 style={{ fontSize: 24, marginBottom: 6 }}>{plan.label} — результат</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {right} из {total} правильно · {pct(right, total)}
      </p>

      {score && (
        <div className="card score-card" style={{ marginBottom: 18 }}>
          {score.total != null && (
            <div className="score-total">
              <div className="score-total-num">{score.total}</div>
              <div className="small muted">
                из 1600 · диапазон {score.low}–{score.high}
              </div>
            </div>
          )}
          {score.sections.map((s) => (
            <SectionRow key={s.section} s={s} />
          ))}
          <p className="small muted" style={{ margin: 0 }}>
            {pretest.length > 0 &&
              `${pretest.length} ${questionsWord(pretest.length)} не в счёт — это pretest, по 2 на модуль, как на экзамене. `}
            Балл считается по модели IRT, как у College Board: вес вопроса зависит от его
            сложности, а лёгкий второй модуль ограничивает потолок. Параметры вопросов
            College Board не публикует, поэтому балл — оценка; диапазон показывает её точность.
          </p>
        </div>
      )}

      {!score && byModule.length > 1 && (
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
              <th className="num">Верно</th>
              <th className="num">Точность</th>
              <th className="num">Время</th>
            </tr>
          </thead>
          <tbody>
            {byDomain.map(([d, r]) => (
              <tr key={d}>
                <td>{d}</td>
                <td className="num">
                  {r.ok}/{r.n}
                </td>
                <td className="num">{pct(r.ok, r.n)}</td>
                <td className="num" title="Среднее на вопрос">
                  {mmss(r.ms / r.n)}
                </td>
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
