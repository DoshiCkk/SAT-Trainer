import type { ModulePlan, Question, Route, RunPlan } from "../types";

/**
 * The run in progress, kept in localStorage so that a phone dropping the tab,
 * or a bus reaching its stop mid-module, costs nothing: the next launch offers
 * to pick up at the same question with the same time left.
 *
 * Questions are stored by id and looked up again on restore, so re-parsing the
 * base only breaks a saved run if one of its questions disappeared.
 */

const KEY = "sat-train:run";

/** Everything the test screen needs to come back exactly where it was. */
export interface ModuleSnapshot {
  idx: number;
  answers: Record<string, string>;
  crossed: Record<string, string[]>;
  checked: string[];
  remaining: number | null;
  times: Record<string, number>;
}

export interface RunState {
  sessionId: string;
  plan: RunPlan;
  moduleIndex: number;
  screen: "test" | "break";
  breakLeft?: number;
  snapshot?: ModuleSnapshot;
}

export interface SavedRun extends RunState {
  savedAt: number;
}

interface StoredModule extends Omit<ModulePlan, "questions" | "routes"> {
  ids: string[];
  routes?: Record<Route, StoredModule>;
}

interface Stored extends Omit<RunState, "plan"> {
  v: 1;
  plan: Omit<RunPlan, "modules"> & { modules: StoredModule[] };
  savedAt: number;
}

function pack(m: ModulePlan): StoredModule {
  const { questions, routes, ...rest } = m;
  return {
    ...rest,
    ids: questions.map((q) => q.id),
    ...(routes ? { routes: { easy: pack(routes.easy), hard: pack(routes.hard) } } : {}),
  };
}

function unpack(m: StoredModule, byId: Map<string, Question>): ModulePlan | null {
  const { ids, routes, ...rest } = m;
  const questions = ids.map((id) => byId.get(id));
  if (questions.some((q) => !q)) return null;
  let r: Record<Route, ModulePlan> | undefined;
  if (routes) {
    const easy = unpack(routes.easy, byId);
    const hard = unpack(routes.hard, byId);
    if (!easy || !hard) return null;
    r = { easy, hard };
  }
  return { ...rest, questions: questions as Question[], ...(r ? { routes: r } : {}) };
}

export function saveRun(state: RunState): void {
  const stored: Stored = {
    ...state,
    v: 1,
    plan: { ...state.plan, modules: state.plan.modules.map(pack) },
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Private mode or a full disk: the run goes on, it just cannot be resumed.
  }
}

export function clearRun(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

export function loadRun(questions: Question[]): SavedRun | null {
  let stored: Stored;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    stored = JSON.parse(raw) as Stored;
  } catch {
    return null;
  }
  if (stored?.v !== 1) return null;
  const byId = new Map(questions.map((q) => [q.id, q]));
  const modules = stored.plan.modules.map((m) => unpack(m, byId));
  if (modules.some((m) => !m)) {
    clearRun();
    return null;
  }
  const { v: _v, plan, ...rest } = stored;
  return { ...rest, plan: { ...plan, modules: modules as ModulePlan[] } };
}
