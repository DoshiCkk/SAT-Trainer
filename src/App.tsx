import { useCallback, useEffect, useMemo, useState } from "react";
import type { Attempt, FilterState, ModeId, Question, RunPlan, Session } from "./types";
import { buildHistory, buildTaxonomy, loadQuestions, type History } from "./lib/data";
import { listAttempts, listMarks, putAttempts, putSession } from "./lib/db";
import { buildPlan } from "./lib/modes";
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
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);

  const [plan, setPlan] = useState<RunPlan | null>(null);
  const [moduleIndex, setModuleIndex] = useState(0);
  const [sessionId, setSessionId] = useState("");
  const [runAttempts, setRunAttempts] = useState<Attempt[]>([]);

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
      const [attempts, marks] = await Promise.all([listAttempts(), listMarks()]);
      setHistory(buildHistory(attempts, marks));
    } catch {
      // Private mode or blocked storage: run without history rather than hang.
      setHistory(EMPTY_HISTORY);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const qs = await loadQuestions();
        setQuestions(qs);
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

  const start = useCallback(
    (mode: ModeId) => {
      const { plan: p } = buildPlan(mode, questions, filter, history);
      if (!p || p.modules.every((m) => m.questions.length === 0)) return;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const session: Session = {
        id,
        mode,
        label: p.label,
        startedAt: Date.now(),
        moduleCount: p.modules.length,
      };
      void putSession(session);
      setSessionId(id);
      setPlan(p);
      setModuleIndex(0);
      setRunAttempts([]);
      setScreen("test");
    },
    [filter, history, questions]
  );

  const submitModule = useCallback(
    async (rows: Attempt[]) => {
      await putAttempts(rows);
      const all = [...runAttempts, ...rows];
      setRunAttempts(all);
      if (!plan) return;
      const next = moduleIndex + 1;
      if (next < plan.modules.length) {
        setModuleIndex(next);
        setScreen(plan.breakMinutes ? "break" : "test");
      } else {
        await refreshHistory();
        setScreen("results");
      }
    },
    [moduleIndex, plan, refreshHistory, runAttempts]
  );

  const goHome = useCallback(async () => {
    await refreshHistory();
    setPlan(null);
    setRunAttempts([]);
    setScreen("home");
  }, [refreshHistory]);

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
        onSubmit={submitModule}
        onAbort={goHome}
      />
    );
  }

  if (screen === "break" && plan) {
    return (
      <Break
        minutes={plan.breakMinutes ?? 10}
        onDone={() => setScreen("test")}
      />
    );
  }

  if (screen === "results" && plan) {
    return <Results plan={plan} attempts={runAttempts} onHome={goHome} />;
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
        taxonomy={taxonomy}
        history={history}
        filter={filter}
        setFilter={setFilter}
        onStart={start}
      />
    </div>
  );
}
