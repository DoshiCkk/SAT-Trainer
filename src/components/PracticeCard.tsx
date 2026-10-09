import { useMemo, useState } from "react";
import type { Question, Section, Session } from "../types";
import type { History } from "../lib/data";
import { BREAK_MINUTES } from "../lib/modes";
import {
  MIX,
  SCOPES,
  buildPractice,
  practiceMinutes,
  practiceQuestions,
  type PracticeScope,
} from "../lib/practice";
import { ROUTE_SHARE } from "../lib/scoring";

function duration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} ч${m ? ` ${m} мин` : ""}` : `${m} мин`;
}

const pctOf = (v: number) => `${Math.round(v * 100)}%`;

const day = (t: number) =>
  new Date(t).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

export default function PracticeCard({
  questions,
  history,
  sessions,
  sections,
  onStart,
}: {
  questions: Question[];
  history: History;
  sessions: Session[];
  /** Sections that have data at all. */
  sections: Section[];
  onStart: (scope: PracticeScope) => void;
}) {
  const [scope, setScope] = useState<PracticeScope>("full");
  const usable = (id: PracticeScope) =>
    SCOPES.find((s) => s.id === id)!.sections.every((s) => sections.includes(s));

  const ok = usable(scope);
  // Drawn here only to find out what is missing; the real draw happens on start.
  const shortfalls = useMemo(
    () => (ok ? buildPractice(scope, questions, history).shortfalls : []),
    [ok, scope, questions, history]
  );

  const past = useMemo(
    () =>
      sessions
        .filter((s) => s.score)
        .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
        .slice(0, 5),
    [sessions]
  );

  const m1 = MIX.first;

  return (
    <section className="practice">
      <div className="col" style={{ gap: 12, minWidth: 0 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <h2 className="practice-title">Пробный тест</h2>
          <span className="practice-badge">адаптивный</span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Модуль 1 — смесь: {pctOf(m1.Easy)} Easy, {pctOf(m1.Medium)} Medium, {pctOf(m1.Hard)}{" "}
          Hard. {pctOf(ROUTE_SHARE)} верных и больше — модуль 2 сложный, иначе лёгкий. В конце —
          балл 200–800 за секцию и 400–1600 за весь тест.
        </p>

        <div className="wrap-chips">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              className="chip"
              aria-pressed={scope === s.id}
              disabled={!usable(s.id)}
              onClick={() => setScope(s.id)}
            >
              {s.title}
            </button>
          ))}
        </div>

        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <span className="small muted">
            {practiceQuestions(scope)} вопросов · {duration(practiceMinutes(scope))}
            {scope === "full" && ` + перерыв ${BREAK_MINUTES} мин`}
          </span>
          <button className="btn primary" disabled={!ok} onClick={() => onStart(scope)}>
            Начать
          </button>
        </div>

        {shortfalls.length > 0 && (
          <div className="banner warn small">
            Не хватает вопросов нужной сложности, добрал соседними:{" "}
            {shortfalls.map((s) => `${s.domain} — ${s.have} из ${s.want}`).join("; ")}
          </div>
        )}
      </div>

      <div className="practice-past">
        <div className="section-title" style={{ marginBottom: 8 }}>
          Прошлые пробники
        </div>
        {past.length === 0 ? (
          <div className="small muted">Пока нет. Балл каждого пробника появится здесь.</div>
        ) : (
          <ul>
            {past.map((s) => {
              const sc = s.score!;
              return (
                <li key={s.id}>
                  <span className="muted">{day(s.endedAt ?? s.startedAt)}</span>
                  <strong className="practice-past-num">
                    {sc.total ?? sc.sections[0]?.score}
                  </strong>
                  <span className="small muted">
                    {sc.sections
                      .map(
                        (x) =>
                          `${x.section === "Math" ? "Math" : "R&W"} ${x.score}${
                            x.route === "hard" ? " ↑" : " ↓"
                          }`
                      )
                      .join(" · ")}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {past.length > 0 && (
          <div className="small muted" style={{ marginTop: 6 }}>
            ↑ сложный модуль 2, ↓ лёгкий
          </div>
        )}
      </div>
    </section>
  );
}
