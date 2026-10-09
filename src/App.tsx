import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Attempt,
  FilterState,
  ModeId,
  PracticeScore,
  Question,
  QuestionFile,
  RunPlan,
  Session,
} from "./types";
import { buildHistory, buildTaxonomy, loadQuestions, type History } from "./lib/data";
import {
  listAttempts,
  listMarks,
  listSessions,
  putAttempts,
  putSession,
  updateSession,
} from "./lib/db";
import { buildPlan } from "./lib/modes";
import { buildPractice, routeNext, scorePractice, type PracticeScope } from "./lib/practice";
import { clearRun, loadRun, saveRun, type ModuleSnapshot, type SavedRun } from "./lib/resume";
import { registerWorker } from "./lib/offline";
import Home from "./screens/Home";
import Test from "./screens/Test";
import Break from "./screens/Break";
import Results from "./screens/Results";

type Screen = "loading" | "home" | "test" | "break" | "results";

const EMPTY_HISTORY: History = { last: new Map(), all: new Map(), marked: new Set() };

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [counts, setCounts] = useState<QuestionFile["counts"]>({ total: 0, new: 0 });
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const [sessions, setSessions] = useState<Session[]>([]);

  const [plan, setPlan] = useState<RunPlan | null>(null);
  const [moduleIndex, setModuleIndex] = useState(0);
  const [sessionId, setSessionId] = useState("");
  const [runAttempts, setRunAttempts] = useState<Attempt[]>([]);
  /** Where the module about to mount should start; set only on resume. */
  const [snapshot, setSnapshot] = useState<ModuleSnapshot | undefined>();
  const [breakLeft, setBreakLeft] = useState(0);
  const [score, setScore] = useState<PracticeScore | null>(null);
  /** A run left unfinished, offered on the home screen. */
  const [pending, setPending] = useState<SavedRun | null>(null);

  const [filter, setFilter] = useState<FilterState>({
    section: "Reading and Writing",
    domains: [],
    skills: [],
    difficulties: [],
    status: "all",
    count: 10,
    timer: true,
    instantFeedback: true,
  });

  const refreshHistory = useCallback(async () => {
    try {
      const [attempts, marks, sess] = await Promise.all([
        listAttempts(),
        listMarks(),
        listSessions(),
      ]);
      setHistory(buildHistory(attempts, marks));
      setSessions(sess);
    } catch {
      // Private mode or blocked storage: run without history rather than hang.
      setHistory(EMPTY_HISTORY);
    }
  }, []);

  // Registered once, before the data: the worker is what makes a cold start
  // without network possible at all.
  useEffect(registerWorker, []);

  useEffect(() => {
    (async () => {
      try {
        const { questions: qs, counts: c } = await loadQuestions();
        setQuestions(qs);
        setCounts(c);
        setPending(loadRun(qs));
        // Open on Reading and Writing when it exists, whatever order the
        // parser happened to write the files in.
        const sections = buildTaxonomy(qs).sections;
        setFilter((f) => ({ ...f, section: sections[0] ?? f.section }));
        setScreen("home");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
      void refreshHistory();
    })();
  }, [refreshHistory]);

  const taxonomy = useMemo(() => buildTaxonomy(questions), [questions]);

  const begin = useCallback(
    (p: RunPlan) => {
      if (p.modules.every((m) => m.questions.length === 0)) return;
      if (pending && !window.confirm("Незаконченный тест будет удалён. Начать новый?")) return;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const session: Session = {
        id,
        mode: p.mode,
        label: p.label,
        startedAt: Date.now(),
        moduleCount: p.modules.length,
      };
      void putSession(session);
      saveRun({ sessionId: id, plan: p, moduleIndex: 0, screen: "test" });
      setSessionId(id);
      setPlan(p);
      setModuleIndex(0);
      setRunAttempts([]);
      setSnapshot(undefined);
      setScore(null);
      setPending(null);
      setScreen("test");
    },
    [pending]
  );

  const start = useCallback(
    (mode: ModeId) => {
      const { plan: p } = buildPlan(mode, questions, filter, history);
      if (p) begin(p);
    },
    [begin, filter, history, questions]
  );

  const startPractice = useCallback(
    (scope: PracticeScope) => begin(buildPractice(scope, questions, history).plan),
    [begin, history, questions]
  );

  const resume = useCallback(async () => {
    if (!pending) return;
    let done: Attempt[] = [];
    try {
      done = (await listAttempts()).filter((a) => a.sessionId === pending.sessionId);
    } catch {
      // Without them a practice test still resumes; only its score would suffer.
    }
    setSessionId(pending.sessionId);
    setPlan(pending.plan);
    setModuleIndex(pending.moduleIndex);
    setRunAttempts(done);
    setSnapshot(pending.snapshot);
    setBreakLeft(pending.breakLeft ?? 0);
    setScore(null);
    setPending(null);
    setScreen(pending.screen === "break" && pending.breakLeft ? "break" : "test");
  }, [pending]);

  const discard = useCallback(() => {
    clearRun();
    setPending(null);
  }, []);

  const onSnapshot = useCallback(
    (s: ModuleSnapshot) => {
      if (plan) saveRun({ sessionId, plan, moduleIndex, screen: "test", snapshot: s });
    },
    [moduleIndex, plan, sessionId]
  );

  const submitModule = useCallback(
    async (rows: Attempt[]) => {
      if (!plan) return;
      const mod = plan.modules[moduleIndex];
      const pre = new Set(mod.pretest ?? []);
      const tagged = rows.map((r) => (pre.has(r.questionId) ? { ...r, pretest: true } : r));
      await putAttempts(tagged);
      const all = [...runAttempts, ...tagged];
      setRunAttempts(all);
      // An adaptive second module is settled the moment the first one is in.
      const routed = routeNext(plan, moduleIndex, all);
      setPlan(routed);
      setSnapshot(undefined);

      const next = moduleIndex + 1;
      if (next < routed.modules.length) {
        const rest = (mod.breakAfter ?? 0) * 60;
        saveRun({
          sessionId,
          plan: routed,
          moduleIndex: next,
          screen: rest ? "break" : "test",
          breakLeft: rest || undefined,
        });
        setModuleIndex(next);
        setBreakLeft(rest);
        setScreen(rest ? "break" : "test");
        return;
      }

      clearRun();
      const result = routed.mode === "practice" ? scorePractice(routed, all) : null;
      setScore(result);
      try {
        await updateSession(sessionId, { endedAt: Date.now(), ...(result ? { score: result } : {}) });
      } catch {
        // The score is still on screen; it just will not be listed later.
      }
      await refreshHistory();
      setScreen("results");
    },
    [moduleIndex, plan, refreshHistory, runAttempts, sessionId]
  );

  const breakTick = useCallback(
    (left: number) => {
      if (plan) saveRun({ sessionId, plan, moduleIndex, screen: "break", breakLeft: left });
    },
    [moduleIndex, plan, sessionId]
  );

  const breakDone = useCallback(() => {
    if (plan) saveRun({ sessionId, plan, moduleIndex, screen: "test" });
    setScreen("test");
  }, [moduleIndex, plan, sessionId]);

  // Leaving a test pauses it: the snapshot is already saved, so the home
  // screen simply offers it back.
  const goHome = useCallback(async () => {
    await refreshHistory();
    setPlan(null);
    setRunAttempts([]);
    setScore(null);
    setPending(loadRun(questions));
    setScreen("home");
  }, [questions, refreshHistory]);

  if (error) {
    return (
      <div className="wrap">
        <div className="banner bad">{error}</div>
      </div>
    );
  }

  if (screen === "loading") {
    return (
      <div className="center-screen">
        <span className="muted">Загрузка вопросов…</span>
      </div>
    );
  }

  if (screen === "test" && plan) {
    return (
      <Test
        key={`${sessionId}-${moduleIndex}`}
        plan={plan}
        module={plan.modules[moduleIndex]}
        moduleIndex={moduleIndex}
        sessionId={sessionId}
        markedIds={history.marked}
        initial={snapshot}
        onSnapshot={onSnapshot}
        onSubmit={submitModule}
        onAbort={goHome}
      />
    );
  }

  if (screen === "break" && plan) {
    return (
      <Break
        seconds={breakLeft || 600}
        next={plan.modules[moduleIndex].label}
        onTick={breakTick}
        onDone={breakDone}
      />
    );
  }

  if (screen === "results" && plan) {
    return <Results plan={plan} attempts={runAttempts} score={score} onHome={goHome} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">SAT Train</span>
        <span className="muted small">локальная тренировка · Digital SAT</span>
        <div className="spacer" />
      </header>
      <Home
        questions={questions}
        counts={counts}
        taxonomy={taxonomy}
        history={history}
        sessions={sessions}
        pending={pending}
        filter={filter}
        setFilter={setFilter}
        onStart={start}
        onStartPractice={startPractice}
        onResume={resume}
        onDiscard={discard}
      />
    </div>
  );
}
