import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { Attempt, Choice, ModulePlan, RunPlan } from "../types";
import { RichText } from "../components/RichText";
import { Crop } from "../components/Crop";
import DesmosPanel from "../components/DesmosPanel";
import Reference from "../components/Reference";
import { setMark } from "../lib/db";
import { useIsPhone } from "../lib/useIsPhone";
import { isCorrectAnswer } from "../lib/data";
import type { ModuleSnapshot } from "../lib/resume";

const LETTERS: Choice[] = ["A", "B", "C", "D"];

function fmt(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Dock slide duration; mirrored by the transition in styles.css. */
const DOCK_MS = 260;
const DOCK_MIN = 280;

/**
 * Keeps a docked tool mounted while the dock slides shut, so the panel does not
 * blink out before the question has finished widening back.
 */
function useLingering(on: boolean, ms: number): boolean {
  const [alive, setAlive] = useState(on);
  useEffect(() => {
    if (on) {
      setAlive(true);
      return;
    }
    const t = setTimeout(() => setAlive(false), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return alive;
}

interface Props {
  plan: RunPlan;
  module: ModulePlan;
  moduleIndex: number;
  sessionId: string;
  markedIds: Set<string>;
  /** Where a resumed module left off. */
  initial?: ModuleSnapshot;
  /** Receives the module's state on every change, so it can be resumed. */
  onSnapshot?: (s: ModuleSnapshot) => void;
  onSubmit: (attempts: Attempt[]) => void;
  onAbort: () => void;
}

export default function Test({
  plan,
  module: mod,
  moduleIndex,
  sessionId,
  markedIds,
  initial,
  onSnapshot,
  onSubmit,
  onAbort,
}: Props) {
  const questions = mod.questions;
  const [idx, setIdx] = useState(() => Math.min(initial?.idx ?? 0, questions.length - 1));
  const [answers, setAnswers] = useState<Record<string, string>>(initial?.answers ?? {});
  const [crossed, setCrossed] = useState<Record<string, string[]>>(initial?.crossed ?? {});
  const [marked, setMarked] = useState<Set<string>>(() => new Set(markedIds));
  const [remaining, setRemaining] = useState<number | null>(
    initial ? initial.remaining : mod.minutes != null ? mod.minutes * 60 : null
  );
  const [hideTimer, setHideTimer] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [crossMode, setCrossMode] = useState(false);
  /** Questions whose answer has been confirmed and therefore marked. */
  const [checked, setChecked] = useState<Set<string>>(() => new Set(initial?.checked));
  const [desmos, setDesmos] = useState(false);
  const [reference, setReference] = useState(false);
  // Both tools dock to the right like the facing page of a book: the exam
  // column gives way to them instead of being covered up.
  const dockOpen = reference || desmos;
  const refAlive = useLingering(reference, DOCK_MS);
  const desmosAlive = useLingering(desmos, DOCK_MS);
  const [dockW, setDockW] = useState<number | null>(null);
  /** The PDF's own explanation, shown once the answer has been checked. */
  const [showWhy, setShowWhy] = useState(true);
  const [sizing, setSizing] = useState(false);

  const q = questions[idx];
  // Per-question time lives in a ref: it is never rendered, and a state update
  // could still be in flight when the module is submitted.
  const times = useRef<Record<string, number>>({ ...initial?.times });
  const enteredAt = useRef(Date.now());
  const submitted = useRef(false);
  const paneRef = useRef<HTMLDivElement>(null);
  // On a phone the panes stop scrolling separately and this wrapper scrolls
  // instead, so moving to the next question has to rewind whichever is live.
  const bodyRef = useRef<HTMLDivElement>(null);
  const phone = useIsPhone();

  const commitTime = useCallback((qid: string) => {
    const now = Date.now();
    times.current[qid] = (times.current[qid] ?? 0) + (now - enteredAt.current);
    enteredAt.current = now;
  }, []);

  const go = useCallback(
    (next: number) => {
      if (next < 0 || next >= questions.length || next === idx) return;
      commitTime(questions[idx].id);
      setIdx(next);
      setNavOpen(false);
      paneRef.current?.scrollTo({ top: 0 });
      bodyRef.current?.scrollTo({ top: 0 });
    },
    [commitTime, idx, questions]
  );

  const submit = useCallback(() => {
    if (submitted.current) return;
    submitted.current = true;
    commitTime(q.id);
    const now = Date.now();
    const finalTimes = times.current;
    const rows: Attempt[] = questions.map((item) => {
      const given = answers[item.id] ?? null;
      const ok = isCorrectAnswer(item, given);
      return {
        key: `${sessionId}:${item.id}`,
        sessionId,
        moduleIndex,
        questionId: item.id,
        domain: item.domain,
        skill: item.skill,
        difficulty: item.difficulty,
        answer: given,
        correct: ok,
        timeMs: finalTimes[item.id] ?? 0,
        marked: marked.has(item.id),
        at: now,
      };
    });
    onSubmit(rows);
  }, [answers, commitTime, marked, moduleIndex, onSubmit, q, questions, sessionId]);

  // countdown
  useEffect(() => {
    if (remaining == null) return;
    const t = setInterval(() => {
      setRemaining((r) => {
        if (r == null) return r;
        if (r <= 1) {
          clearInterval(t);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [remaining == null]);

  useEffect(() => {
    if (remaining === 0) submit();
  }, [remaining, submit]);

  // Runs on every tick as well, so a dropped tab loses a second at most.
  useEffect(() => {
    if (!onSnapshot || submitted.current) return;
    const live = { ...times.current };
    live[q.id] = (live[q.id] ?? 0) + (Date.now() - enteredAt.current);
    onSnapshot({ idx, answers, crossed, checked: [...checked], remaining, times: live });
  }, [answers, checked, crossed, idx, onSnapshot, q, remaining]);

  const instant = plan.instantFeedback;

  const choose = useCallback(
    (value: string) =>
      // The answer stays editable until it is confirmed; after that it is final,
      // because it has already been marked right or wrong.
      setAnswers((a) => (instant && checked.has(q.id) ? a : { ...a, [q.id]: value })),
    [checked, instant, q]
  );

  const confirmAnswer = useCallback(() => {
    setChecked((c) => (c.has(q.id) ? c : new Set(c).add(q.id)));
  }, [q]);

  const given = answers[q.id] ?? null;
  const marked_ = instant && checked.has(q.id);
  const canConfirm = instant && given != null && !marked_;

  const toggleCross = useCallback(
    (letter: string) => {
      setCrossed((c) => {
        const cur = c[q.id] ?? [];
        return {
          ...c,
          [q.id]: cur.includes(letter) ? cur.filter((x) => x !== letter) : [...cur, letter],
        };
      });
    },
    [q]
  );

  const toggleMark = useCallback(() => {
    setMarked((m) => {
      const next = new Set(m);
      const on = !next.has(q.id);
      if (on) next.add(q.id);
      else next.delete(q.id);
      void setMark(q.id, on);
      return next;
    });
  }, [q]);

  // The drag flag lives in a ref as well, so the first move after the grab is
  // not dropped while the re-render that only drives the cursor is in flight.
  const sizingRef = useRef(false);

  const onGripDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    sizingRef.current = true;
    setSizing(true);
  }, []);

  const onGripMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!sizingRef.current) return;
    const max = Math.max(DOCK_MIN, window.innerWidth * 0.66);
    setDockW(Math.min(Math.max(window.innerWidth - e.clientX, DOCK_MIN), max));
  }, []);

  const onGripUp = useCallback(() => {
    sizingRef.current = false;
    setSizing(false);
  }, []);

  // keyboard: Bluebook-style letter keys plus arrows
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toUpperCase();
      if (q.type === "mcq" && (LETTERS as string[]).includes(k)) {
        e.preventDefault();
        if (crossMode) toggleCross(k);
        else choose(k);
      } else if (e.key === "ArrowRight") {
        go(idx + 1);
      } else if (e.key === "ArrowLeft") {
        go(idx - 1);
      } else if (k === "M") {
        toggleMark();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (canConfirm) confirmAnswer();
        else if (idx < questions.length - 1) go(idx + 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canConfirm, choose, confirmAnswer, crossMode, go, idx, q, questions.length, toggleCross, toggleMark]);

  const answeredCount = questions.filter((item) => answers[item.id] != null).length;
  const unanswered = useMemo(
    () => questions.map((item, i) => ({ item, i })).filter(({ item }) => answers[item.id] == null),
    [answers, questions]
  );
  const markedList = useMemo(
    () => questions.map((item, i) => ({ item, i })).filter(({ item }) => marked.has(item.id)),
    [marked, questions]
  );
  /** The domains this user tends to rush; named in the early-submit warning. */
  const risky = useMemo(() => {
    const names = ["Craft and Structure", "Information and Ideas"];
    return [...markedList, ...unanswered]
      .filter(({ item }) => names.includes(item.domain))
      .map(({ i }) => i + 1);
  }, [markedList, unanswered]);

  const isMath = q.section === "Math";
  // Bluebook puts a Math question in one centred column and splits only Reading
  // and Writing into passage + question. A crop already contains the passage and
  // the stem as they appear in the PDF, so the text stem is rendered only when
  // there is no crop to show.
  const hasLeft = !isMath && Boolean(q.image || q.passage.trim());
  // The crop holds only the figure now, so whatever text survived beside it is
  // still rendered; a question with neither leaves the stem to carry it alone.
  const crossedHere = crossed[q.id] ?? [];
  const choiceImages = q.choiceImages ?? null;

  const givenIsRight = marked_ && isCorrectAnswer(q, given);
  /** How one choice should be coloured once the answer has been marked. */
  const verdict = (L: Choice): "correct" | "wrong" | "reveal" | null => {
    if (!marked_) return null;
    const isKey = isCorrectAnswer(q, L);
    if (given === L) return isKey ? "correct" : "wrong";
    return isKey ? "reveal" : null;
  };
  const keyText = q.correct.join(" или ");
  const hasWhy = Boolean(q.rationaleImage) || q.rationale.trim().length > 0;

  return (
    <div className={`test ${dockOpen ? "docked" : ""} ${sizing ? "sizing" : ""}`}>
      <div className="test-main">
        <div className="test-head">
          <div className="row">
            {/* A phone has room for one of the two, and the module is what changes. */}
            {phone && plan.modules.length > 1 ? (
              <strong>{mod.label}</strong>
            ) : (
              <>
                <strong>{plan.label}</strong>
                {plan.modules.length > 1 && <span className="muted">· {mod.label}</span>}
              </>
            )}
          </div>

          <div className="timer-wrap">
            {remaining != null ? (
              <>
                <div className={`timer ${remaining <= 300 ? "low" : ""}`}>
                  {hideTimer ? "•••" : fmt(remaining)}
                </div>
                <button className="btn ghost sm" onClick={() => setHideTimer((h) => !h)}>
                  {hideTimer ? "Показать" : "Скрыть"}
                </button>
              </>
            ) : (
              <div className="muted small">без таймера</div>
            )}
          </div>

          <div className="row" style={{ justifyContent: "flex-end" }}>
            {isMath && (
              <>
                <button
                  className="btn sm"
                  aria-pressed={reference}
                  onClick={() => setReference((r) => !r)}
                  title="Справочные формулы, как в Bluebook"
                >
                  {phone ? "Ref" : "Reference"}
                </button>
                <button className="btn sm" aria-pressed={desmos} onClick={() => setDesmos((d) => !d)}>
                  Desmos
                </button>
              </>
            )}
            <button className="btn sm" onClick={onAbort}>
              Выйти
            </button>
          </div>
        </div>

        <div className={`test-body ${hasLeft ? "" : "single"}`} ref={bodyRef}>
          {hasLeft && (
            <div className="pane left" ref={paneRef}>
              {q.image && <Crop src={q.image} alt="График или таблица из PDF" zoomable />}
              {q.passage.trim() && <RichText text={q.passage} className="passage" />}
            </div>
          )}

          <div className="pane">
            <div className="q-head">
              <div className="q-num">{idx + 1}</div>
              <button className="mark-btn" aria-pressed={marked.has(q.id)} onClick={toggleMark}>
                {marked.has(q.id) ? "★" : "☆"} Mark for Review
              </button>
              <div style={{ flex: 1 }} />
              {q.type === "mcq" && (
                <button
                  className="btn sm"
                  aria-pressed={crossMode}
                  onClick={() => setCrossMode((c) => !c)}
                  title="Режим зачёркивания вариантов"
                  style={crossMode ? { background: "var(--accent-soft)", borderColor: "var(--accent)" } : undefined}
                >
                  <span style={{ textDecoration: "line-through" }}>ABC</span>
                </button>
              )}
            </div>

            {!hasLeft && q.image && (
              <Crop src={q.image} alt="Формула или график из PDF" zoomable />
            )}
            {!hasLeft && q.passage.trim() && <RichText text={q.passage} className="passage" />}
            {q.stem.trim() && <RichText text={q.stem} className="stem" />}

            {q.type === "mcq" && q.choices ? (
              <div className="choices">
                {LETTERS.map((L) => {
                  const body = q.choices![L];
                  if (body == null && !choiceImages?.[L]) return null;
                  const isCrossed = crossedHere.includes(L);
                  const v = verdict(L);
                  return (
                    <div className="choice-row" key={L}>
                      <button
                        className={["choice", isCrossed ? "crossed" : "", v ?? ""]
                          .filter(Boolean)
                          .join(" ")}
                        aria-pressed={given === L}
                        disabled={marked_ && !crossMode}
                        onClick={() => (crossMode ? toggleCross(L) : choose(L))}
                      >
                        <span className="letter">
                          {v === "correct" || v === "reveal" ? "✓" : v === "wrong" ? "✕" : L}
                        </span>
                        {choiceImages?.[L] ? (
                          <Crop className="choice-crop" src={choiceImages[L]!} alt={`Вариант ${L}`} />
                        ) : (
                          <span className="body" dangerouslySetInnerHTML={{ __html: body ?? "" }} />
                        )}
                      </button>
                      {crossMode && (
                        <button
                          className="cross-btn"
                          onClick={() => toggleCross(L)}
                          title={isCrossed ? "Вернуть" : "Зачеркнуть"}
                        >
                          {isCrossed ? "↺" : L}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="col" style={{ gap: 12 }}>
                <label className="field" style={{ maxWidth: 280 }}>
                  Ответ (student-produced response)
                  <input
                    className={["spr-input", marked_ ? (givenIsRight ? "correct" : "wrong") : ""]
                      .filter(Boolean)
                      .join(" ")}
                    value={given ?? ""}
                    disabled={marked_}
                    onChange={(e) => choose(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canConfirm) {
                        e.preventDefault();
                        confirmAnswer();
                      }
                    }}
                    placeholder="например 3/2 или 1.5"
                  />
                </label>
              </div>
            )}

            {marked_ && (
              <div className={`verdict ${givenIsRight ? "ok" : "bad"}`} role="status">
                <span className="verdict-mark">{givenIsRight ? "✓" : "✕"}</span>
                <span>
                  {givenIsRight ? "Верно" : `Неверно · правильный ответ: ${keyText}`}
                </span>
              </div>
            )}

            {marked_ && hasWhy && (
              <div className="rationale">
                <button
                  className="rationale-head"
                  aria-expanded={showWhy}
                  onClick={() => setShowWhy((w) => !w)}
                >
                  <span>Разбор — почему именно этот ответ</span>
                  <span className="chev">{showWhy ? "▴" : "▾"}</span>
                </button>
                {showWhy &&
                  (q.rationaleImage ? (
                    // Maths explanations are half formulas, so the PDF crop is the
                    // only faithful version; the text one has holes where they were.
                    <Crop
                className="rationale-crop"
                src={q.rationaleImage}
                alt="Разбор из PDF"
                zoomable
              />
                  ) : (
                    <RichText text={q.rationale} className="rationale-text" />
                  ))}
              </div>
            )}
          </div>
        </div>

        <div className="test-foot">
          <div className="small muted">
            Отвечено {answeredCount} из {questions.length}
          </div>
          <button className="nav-toggle" onClick={() => setNavOpen((n) => !n)}>
            Вопрос {idx + 1} из {questions.length} ▲
          </button>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button
              className="btn sm"
              disabled={idx === 0}
              onClick={() => go(idx - 1)}
              aria-label="Предыдущий вопрос"
            >
              {phone ? "←" : "Назад"}
            </button>
            {instant && (
              <button
                className={`btn sm ${canConfirm ? "primary" : ""}`}
                disabled={!canConfirm}
                onClick={confirmAnswer}
                title="Проверить выбранный ответ"
              >
                Дальше
              </button>
            )}
            {idx < questions.length - 1 ? (
              <button
                className={`btn sm ${canConfirm ? "" : "primary"}`}
                onClick={() => go(idx + 1)}
              >
                {phone ? "→" : instant ? "След. вопрос" : "Далее"}
              </button>
            ) : (
              <button
                className={`btn sm ${canConfirm ? "" : "primary"}`}
                onClick={() => setConfirm(true)}
              >
                Сдать
              </button>
            )}
          </div>
        </div>

        {navOpen && (
          <>
            <div
              className="backdrop"
              style={{ background: "transparent", backdropFilter: "none" }}
              onClick={() => setNavOpen(false)}
            />
            <div className="nav-pop">
              <div className="row">
                <strong>{mod.label}</strong>
                <div style={{ flex: 1 }} />
                <button
                  className="btn sm"
                  onClick={() => {
                    setNavOpen(false);
                    setConfirm(true);
                  }}
                >
                  Сдать модуль
                </button>
              </div>
              <div className="nav-grid">
                {questions.map((item, i) => (
                  <button
                    key={item.id}
                    className={[
                      "nav-cell",
                      answers[item.id] != null ? "answered" : "",
                      marked.has(item.id) ? "marked" : "",
                      i === idx ? "current" : "",
                    ].join(" ")}
                    onClick={() => go(i)}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              <div className="nav-legend">
                <span>█ отвечено</span>
                <span>▫ без ответа</span>
                <span style={{ color: "var(--mark)" }}>● отмечено</span>
              </div>
            </div>
          </>
        )}
      </div>

      {(refAlive || desmosAlive) && (
        <aside
          className={`side-dock ${dockOpen ? "" : "shut"}`}
          aria-label="Инструменты"
          style={dockW ? ({ "--dock-w": `${dockW}px` } as CSSProperties) : undefined}
        >
          <div
            className="dock-grip"
            role="separator"
            aria-orientation="vertical"
            title="Потяни, чтобы изменить ширину"
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onPointerCancel={onGripUp}
          />
          <div className="dock-stack">
            {refAlive && <Reference onClose={() => setReference(false)} />}
            {desmosAlive && <DesmosPanel onClose={() => setDesmos(false)} />}
          </div>
        </aside>
      )}

      {confirm && (
        <div className="backdrop" onClick={() => setConfirm(false)}>
          <div className="modal col" onClick={(e) => e.stopPropagation()} style={{ gap: 14 }}>
            <h2 style={{ fontSize: 19 }}>Сдать модуль?</h2>

            {remaining != null && remaining > 60 && (
              <div className="banner warn">
                Осталось {Math.ceil(remaining / 60)} мин — хватит, чтобы вернуться к отмеченным
                и к тем, что без ответа.
              </div>
            )}

            <div className="small col" style={{ gap: 6 }}>
              {unanswered.length > 0 && (
                <div>
                  <strong>Без ответа ({unanswered.length}):</strong>{" "}
                  {unanswered.map(({ i }) => (
                    <button
                      key={i}
                      className="btn ghost sm"
                      style={{ padding: "1px 6px" }}
                      onClick={() => {
                        setConfirm(false);
                        go(i);
                      }}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              )}
              {markedList.length > 0 && (
                <div>
                  <strong>Отмечено ({markedList.length}):</strong>{" "}
                  {markedList.map(({ i }) => (
                    <button
                      key={i}
                      className="btn ghost sm"
                      style={{ padding: "1px 6px", color: "var(--mark)" }}
                      onClick={() => {
                        setConfirm(false);
                        go(i);
                      }}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              )}
              {risky.length > 0 && (
                <div className="muted">
                  Из них Craft/Information: {[...new Set(risky)].sort((a, b) => a - b).join(", ")}
                </div>
              )}
              {unanswered.length === 0 && markedList.length === 0 && (
                <div className="muted">Всё отвечено, отмеченных нет.</div>
              )}
            </div>

            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setConfirm(false)}>
                Вернуться
              </button>
              <button className="btn primary" onClick={submit}>
                Всё равно сдать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
