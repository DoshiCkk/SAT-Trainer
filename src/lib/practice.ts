import type {
  Attempt,
  ModulePlan,
  PracticeScore,
  Question,
  Route,
  RunPlan,
  Section,
  SectionScore,
} from "../types";
import type { History } from "./data";
import { DIFFICULTY_ORDER, shuffle, sortForModule } from "./data";
import { apportion, type Shortfall } from "./filters";
import { BREAK_MINUTES, MATH_MODULE, MATH_WEIGHTS, RW_MODULE, RW_WEIGHTS } from "./modes";
import { routeFor, scoreSection, type Item, type Response } from "./scoring";

/**
 * A full adaptive practice test: per section a first module with a broad mix
 * of difficulty, then an easier or a harder second module depending on how the
 * first went. Both versions of the second module are drawn before the test
 * starts, so the choice between them is the only thing left to the result.
 */

export type PracticeScope = "full" | "rw" | "math";

export const SCOPES: { id: PracticeScope; title: string; sections: Section[] }[] = [
  { id: "full", title: "Весь тест", sections: ["Reading and Writing", "Math"] },
  { id: "rw", title: "Только R&W", sections: ["Reading and Writing"] },
  { id: "math", title: "Только Math", sections: ["Math"] },
];

/** Difficulty mix of each module kind. */
export const MIX: Record<"first" | Route, Record<string, number>> = {
  first: { Easy: 0.25, Medium: 0.5, Hard: 0.25 },
  easy: { Easy: 0.5, Medium: 0.4, Hard: 0.1 },
  hard: { Easy: 0.1, Medium: 0.4, Hard: 0.5 },
};

/** Questions per module that are tried out and not scored, as on the real test. */
export const PRETEST = 2;

const SHORT: Record<Section, string> = { "Reading and Writing": "R&W", Math: "Math" };

function specFor(section: Section) {
  return section === "Math"
    ? { ...MATH_MODULE, weights: MATH_WEIGHTS }
    : { ...RW_MODULE, weights: RW_WEIGHTS };
}

/** Minutes of testing for a scope, breaks not included. */
export function practiceMinutes(scope: PracticeScope): number {
  const sections = SCOPES.find((s) => s.id === scope)!.sections;
  return sections.reduce((n, s) => n + 2 * specFor(s).minutes, 0);
}

export function practiceQuestions(scope: PracticeScope): number {
  const sections = SCOPES.find((s) => s.id === scope)!.sections;
  return sections.reduce((n, s) => n + 2 * specFor(s).count, 0);
}

interface Cell {
  domain: string;
  difficulty: string;
  n: number;
}

/**
 * Domain × difficulty counts whose rows and columns both hit their targets.
 * Each cell starts at its floor and the leftovers go to the largest fractions
 * that still fit, then to any cell that does.
 */
function cells(domains: Record<string, number>, mix: Record<string, number>, total: number): Cell[] {
  const cols = apportion(total, mix);
  const out: Cell[] = [];
  const rowLeft = { ...domains };
  const colLeft = { ...cols };
  const fracs: { cell: Cell; frac: number }[] = [];
  for (const [domain, rowN] of Object.entries(domains)) {
    for (const [difficulty, share] of Object.entries(mix)) {
      const exact = rowN * share;
      const cell = { domain, difficulty, n: Math.floor(exact) };
      out.push(cell);
      rowLeft[domain] -= cell.n;
      colLeft[difficulty] -= cell.n;
      fracs.push({ cell, frac: exact - cell.n });
    }
  }
  const order = [
    ...shuffle(fracs).sort((a, b) => b.frac - a.frac),
    ...shuffle(fracs),
  ];
  for (const { cell } of order) {
    if (rowLeft[cell.domain] > 0 && colLeft[cell.difficulty] > 0) {
      cell.n++;
      rowLeft[cell.domain]--;
      colLeft[cell.difficulty]--;
    }
  }
  return out.filter((c) => c.n > 0);
}

/** Never-seen questions first in random order, then the longest-ago seen. */
function rank(pool: Question[], history: History): Question[] {
  const unseen = shuffle(pool.filter((q) => !history.last.has(q.id)));
  const seen = pool
    .filter((q) => history.last.has(q.id))
    .sort((a, b) => history.last.get(a.id)!.at - history.last.get(b.id)!.at);
  return [...unseen, ...seen];
}

interface Drawn {
  questions: Question[];
  shortfalls: Shortfall[];
}

function draw(
  ranked: Question[],
  taken: Set<string>,
  weights: Record<string, number>,
  mix: Record<string, number>,
  count: number
): Drawn {
  const out: Question[] = [];
  const shortfalls: Shortfall[] = [];
  const take = (pred: (q: Question) => boolean, n: number): number => {
    let got = 0;
    for (const q of ranked) {
      if (got >= n) break;
      if (taken.has(q.id) || !pred(q)) continue;
      taken.add(q.id);
      out.push(q);
      got++;
    }
    return got;
  };

  const plan = cells(apportion(count, weights), mix, count);
  const missing: { cell: Cell; got: number }[] = [];
  for (const c of plan) {
    const got = take((q) => q.domain === c.domain && q.difficulty === c.difficulty, c.n);
    if (got < c.n) missing.push({ cell: c, got });
  }
  // A thin cell borrows from its own domain first, at the nearest difficulty,
  // then from its own difficulty anywhere, then from whatever is left.
  for (const { cell: c, got } of missing) {
    let left = c.n - got;
    const dist = (d: string) =>
      Math.abs(DIFFICULTY_ORDER.indexOf(d) - DIFFICULTY_ORDER.indexOf(c.difficulty));
    for (const d of [...DIFFICULTY_ORDER].sort((a, b) => dist(a) - dist(b))) {
      if (left === 0) break;
      left -= take((q) => q.domain === c.domain && q.difficulty === d, left);
    }
    if (left > 0) left -= take((q) => q.difficulty === c.difficulty, left);
    if (left > 0) take(() => true, left);
    shortfalls.push({ domain: `${c.domain} · ${c.difficulty}`, want: c.n, have: got });
  }
  return { questions: out, shortfalls };
}

export interface PracticeBuild {
  plan: RunPlan;
  shortfalls: Shortfall[];
}

export function buildPractice(
  scope: PracticeScope,
  all: Question[],
  history: History
): PracticeBuild {
  const def = SCOPES.find((s) => s.id === scope)!;
  const modules: ModulePlan[] = [];
  const shortfalls: Shortfall[] = [];
  const taken = new Set<string>();

  def.sections.forEach((section, si) => {
    const spec = specFor(section);
    const ranked = rank(
      all.filter((q) => q.section === section),
      history
    );
    const last = si === def.sections.length - 1;
    const make = (kind: "first" | Route): ModulePlan => {
      const d = draw(ranked, taken, spec.weights, MIX[kind], spec.count);
      shortfalls.push(...d.shortfalls);
      // Any question may be a pretest one; on the real test nobody can tell.
      const pretest = shuffle(d.questions)
        .slice(0, PRETEST)
        .map((q) => q.id);
      return {
        questions: sortForModule(shuffle(d.questions)),
        minutes: spec.minutes,
        label: `${SHORT[section]} · модуль ${kind === "first" ? 1 : 2}`,
        section,
        pretest,
        ...(kind === "first" ? {} : { route: kind }),
        // Ten minutes between the sections, none between a section's modules.
        ...(kind !== "first" && !last ? { breakAfter: BREAK_MINUTES } : {}),
      };
    };
    const first = make("first");
    const easy = make("easy");
    const hard = make("hard");
    modules.push(first, {
      ...hard,
      questions: [],
      route: undefined,
      pretest: undefined,
      routes: { easy, hard },
    });
  });

  return {
    plan: {
      mode: "practice",
      label: scope === "full" ? "Пробный SAT" : `Пробный ${SHORT[def.sections[0]]}`,
      modules,
      hideResultsBetween: true,
      instantFeedback: false,
    },
    shortfalls: mergeShortfalls(shortfalls),
  };
}

function mergeShortfalls(list: Shortfall[]): Shortfall[] {
  const map = new Map<string, Shortfall>();
  for (const s of list) {
    const cur = map.get(s.domain);
    if (cur) {
      cur.want += s.want;
      cur.have += s.have;
    } else map.set(s.domain, { ...s });
  }
  return [...map.values()];
}

const item = (q: Question): Item => ({ difficulty: q.difficulty, type: q.type });

/** The scored answers of one module; pretest questions are dropped. */
function responses(mod: ModulePlan, attempts: Attempt[], index: number): Response[] {
  const right = new Map(
    attempts.filter((a) => a.moduleIndex === index).map((a) => [a.questionId, a.correct])
  );
  const skip = new Set(mod.pretest ?? []);
  return mod.questions
    .filter((q) => !skip.has(q.id))
    .map((q) => ({ ...item(q), correct: right.get(q.id) ?? false }));
}

const scored = (mod: ModulePlan): Item[] => {
  const skip = new Set(mod.pretest ?? []);
  return mod.questions.filter((q) => !skip.has(q.id)).map(item);
};

/**
 * Resolve the adaptive module after `index`, if there is one, from how the
 * module at `index` went. Returns the plan unchanged otherwise.
 */
export function routeNext(plan: RunPlan, index: number, attempts: Attempt[]): RunPlan {
  const next = plan.modules[index + 1];
  if (!next?.routes) return plan;
  const route = routeFor(responses(plan.modules[index], attempts, index));
  const modules = [...plan.modules];
  modules[index + 1] = { ...next.routes[route], routes: next.routes };
  return { ...plan, modules };
}

const round10 = (v: number) => Math.round(v / 10) * 10;

export function scorePractice(plan: RunPlan, attempts: Attempt[]): PracticeScore {
  const sections: SectionScore[] = [];
  plan.modules.forEach((second, i) => {
    if (!second.routes || !second.route || !second.section) return;
    const first = plan.modules[i - 1];
    const r1 = responses(first, attempts, i - 1);
    const r2 = responses(second, attempts, i);
    const form = {
      first: scored(first),
      easy: scored(second.routes.easy),
      hard: scored(second.routes.hard),
    };
    const s = scoreSection(form, r1, r2);
    const count = (rs: Response[]) => ({ right: rs.filter((r) => r.correct).length, of: rs.length });
    sections.push({
      section: second.section,
      ...s,
      route: second.route,
      first: count(r1),
      second: count(r2),
    });
  });

  if (sections.length < 2) return { total: null, low: null, high: null, sections };
  const total = sections.reduce((n, s) => n + s.score, 0);
  // Section errors are independent, so the half-widths add in quadrature.
  const half = Math.sqrt(
    sections.reduce((n, s) => n + ((s.high - s.low) / 2) ** 2, 0)
  );
  return {
    total,
    low: Math.max(400, round10(total - half)),
    high: Math.min(1600, round10(total + half)),
    sections,
  };
}
