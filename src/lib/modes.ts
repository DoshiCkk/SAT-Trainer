import type { FilterState, ModeId, Question, RunPlan, Section } from "../types";
import type { History } from "./data";
import { shuffle, sortForModule } from "./data";
import { applyFilters, pickByWeights, seenIds, type Shortfall } from "./filters";

/** Domain mix of a real Bluebook Reading and Writing module. */
export const RW_WEIGHTS: Record<string, number> = {
  "Craft and Structure": 0.28,
  "Information and Ideas": 0.26,
  "Standard English Conventions": 0.26,
  "Expression of Ideas": 0.2,
};

export const MATH_WEIGHTS: Record<string, number> = {
  Algebra: 0.35,
  "Advanced Math": 0.35,
  "Problem-Solving and Data Analysis": 0.15,
  "Geometry and Trigonometry": 0.15,
};

export const RW_MODULE = { count: 27, minutes: 32 };
export const MATH_MODULE = { count: 22, minutes: 35 };
export const BREAK_MINUTES = 10;

export interface ModeInfo {
  id: ModeId;
  title: string;
  detail: string;
  section: Section;
}

export const MODES: ModeInfo[] = [
  {
    id: "rw-module",
    title: "Модуль R&W",
    detail: `${RW_MODULE.count} вопросов · ${RW_MODULE.minutes} мин · пропорции и порядок как в Bluebook`,
    section: "Reading and Writing",
  },
  {
    id: "math-module",
    title: "Модуль Math",
    detail: `${MATH_MODULE.count} вопросов · ${MATH_MODULE.minutes} мин · калькулятор Desmos`,
    section: "Math",
  },
  {
    id: "endurance",
    title: "Выносливость",
    detail: `2 модуля R&W подряд · перерыв ${BREAK_MINUTES} мин · результаты только в конце`,
    section: "Reading and Writing",
  },
  {
    id: "focus",
    title: "Фокус",
    detail: "По фильтрам слева · без повторов · таймер по галочке",
    section: "Reading and Writing",
  },
];

function pickRandom(qs: Question[], n: number): Question[] {
  return shuffle(qs).slice(0, n);
}

export interface PlanResult {
  plan: RunPlan | null;
  shortfalls: Shortfall[];
  /** Total available after filtering, before the module size cap. */
  available: number;
}

function poolFor(
  mode: ModeId,
  all: Question[],
  filter: FilterState,
  history: History,
  section: Section
): Question[] {
  // A preset module defines its own domain mix, so the domain/skill checkboxes
  // must not reshape it; difficulty and status still apply.
  const preset = mode === "rw-module" || mode === "math-module" || mode === "endurance";
  const base = applyFilters(
    all,
    preset ? { ...filter, section, domains: [], skills: [] } : { ...filter, section },
    history
  );
  // Timed runs and Focus both avoid questions already answered; fall back to
  // seen ones only if that would otherwise leave nothing.
  const seen = seenIds(history);
  const unseen = base.filter((q) => !seen.has(q.id));
  return unseen.length > 0 ? unseen : base;
}

export function buildPlan(
  mode: ModeId,
  all: Question[],
  filter: FilterState,
  history: History
): PlanResult {
  if (mode === "rw-module" || mode === "math-module") {
    const isMath = mode === "math-module";
    const section: Section = isMath ? "Math" : "Reading and Writing";
    const spec = isMath ? MATH_MODULE : RW_MODULE;
    const weights = isMath ? MATH_WEIGHTS : RW_WEIGHTS;
    const pool = poolFor(mode, all, filter, history, section);
    // Keep every domain in the mix even at zero available, so a missing domain
    // is reported as a shortfall rather than silently redistributed.
    const { questions, shortfalls } = pickByWeights(pool, weights, spec.count, pickRandom);
    return {
      plan: {
        mode,
        label: isMath ? "Модуль Math" : "Модуль R&W",
        modules: [
          { questions: sortForModule(questions), minutes: filter.timer ? spec.minutes : null, label: "Модуль" },
        ],
        hideResultsBetween: false,
        instantFeedback: filter.instantFeedback,
      },
      shortfalls,
      available: pool.length,
    };
  }

  if (mode === "endurance") {
    const pool = poolFor(mode, all, filter, history, "Reading and Writing");
    const first = pickByWeights(pool, RW_WEIGHTS, RW_MODULE.count, pickRandom);
    const usedIds = new Set(first.questions.map((q) => q.id));
    const rest = pool.filter((q) => !usedIds.has(q.id));
    const second = pickByWeights(rest, RW_WEIGHTS, RW_MODULE.count, pickRandom);
    return {
      plan: {
        mode,
        label: "Выносливость",
        modules: [
          {
            questions: sortForModule(first.questions),
            minutes: RW_MODULE.minutes,
            label: "Модуль 1",
            breakAfter: BREAK_MINUTES,
          },
          { questions: sortForModule(second.questions), minutes: RW_MODULE.minutes, label: "Модуль 2" },
        ],
        hideResultsBetween: true,
        // The point of this mode is two modules with nothing in between, so
        // per-question feedback stays off here whatever the switch says.
        instantFeedback: false,
      },
      shortfalls: mergeShortfalls(first.shortfalls, second.shortfalls),
      available: pool.length,
    };
  }

  // focus / custom: honour the filter panel as given
  const pool =
    mode === "focus"
      ? poolFor(mode, all, filter, history, filter.section)
      : applyFilters(all, filter, history);
  const questions = sortForModule(pickRandom(pool, Math.min(filter.count, pool.length)));
  const shortfalls: Shortfall[] =
    pool.length < filter.count
      ? [{ domain: "по фильтру", want: filter.count, have: pool.length }]
      : [];
  return {
    plan: {
      mode,
      label: mode === "focus" ? "Фокус" : "Свой набор",
      modules: [
        {
          questions,
          minutes: filter.timer ? Math.max(1, Math.round(questions.length * 1.2)) : null,
          label: "Набор",
        },
      ],
      hideResultsBetween: false,
      instantFeedback: filter.instantFeedback,
    },
    shortfalls,
    available: pool.length,
  };
}

function mergeShortfalls(a: Shortfall[], b: Shortfall[]): Shortfall[] {
  const map = new Map<string, Shortfall>();
  for (const s of [...a, ...b]) {
    const cur = map.get(s.domain);
    if (cur) cur.want += s.want;
    else map.set(s.domain, { ...s });
  }
  return [...map.values()];
}
