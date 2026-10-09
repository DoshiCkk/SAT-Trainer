import type { QType } from "../types";

/**
 * Scoring for the practice test, built the way the digital SAT is scored.
 *
 * College Board scores each section with item response theory: every question
 * has a difficulty, and the scaled score comes from the ability estimate that
 * best explains the whole pattern of answers, not from a count of right ones.
 * That is why a hard question is worth more than an easy one, and why the
 * easier second module caps the score however well it goes.
 *
 * What College Board does not publish is each question's fitted parameters,
 * the routing threshold or the per-form score table. Here every question gets
 * the parameters of its difficulty label, and the scale is anchored per form
 * the way a real one is: a perfect paper is 800 and an empty one 200.
 */

/** Three-parameter logistic model, the usual scaling constant. */
const D = 1.7;

/**
 * Location of each difficulty label on the ability scale, and one slope for
 * all. Fitted by simulation to the hard-route curves of Bluebook practice tests
 * (roughly: 5 misses ≈ 740, 10 ≈ 670 in Reading and Writing; 4 ≈ 750, 10 ≈ 650
 * in Math), within about 20 points.
 */
export const ITEM_B: Record<string, number> = { Easy: -1.0, Medium: 0.2, Hard: 2.0 };
const ITEM_A = 0.65;
/** Chance of guessing a four-option question; a typed answer cannot be guessed. */
const GUESS_MCQ = 0.2;

export interface Item {
  difficulty: string;
  type: QType;
}

export interface Response extends Item {
  correct: boolean;
}

function params(item: Item): { a: number; b: number; c: number } {
  return {
    a: ITEM_A,
    b: ITEM_B[item.difficulty] ?? 0,
    c: item.type === "mcq" ? GUESS_MCQ : 0,
  };
}

export function pCorrect(theta: number, item: Item): number {
  const { a, b, c } = params(item);
  return c + (1 - c) / (1 + Math.exp(-D * a * (theta - b)));
}

const GRID: number[] = Array.from({ length: 161 }, (_, i) => -4 + i * 0.05);

export interface Estimate {
  theta: number;
  /** Posterior spread; becomes the "score range" the real report prints. */
  sd: number;
}

/**
 * Expected a posteriori ability under a standard normal prior. Unlike maximum
 * likelihood it stays finite for an all-right or all-wrong paper.
 */
export function estimate(responses: Response[]): Estimate {
  const logPost = GRID.map((t) => {
    let s = -(t * t) / 2;
    for (const r of responses) {
      const p = pCorrect(t, r);
      s += Math.log(r.correct ? p : 1 - p);
    }
    return s;
  });
  const top = Math.max(...logPost);
  const w = logPost.map((v) => Math.exp(v - top));
  const total = w.reduce((a, b) => a + b, 0);
  const theta = GRID.reduce((a, t, i) => a + t * w[i], 0) / total;
  const varr = GRID.reduce((a, t, i) => a + (t - theta) ** 2 * w[i], 0) / total;
  return { theta, sd: Math.sqrt(varr) };
}

export type Route = "easy" | "hard";

/**
 * Share of the first module's scored questions needed for the harder second
 * module. College Board keeps the real cut secret, so this one is a plain count
 * that can be known in advance: 20 of 25 in Reading and Writing, 16 of 20 in Math.
 */
export const ROUTE_SHARE = 0.8;

/** Right answers the first module needs out of `scored` for the hard route. */
export function routeThreshold(scored: number): number {
  // The epsilon keeps 0.8 × 25 from landing a hair above 20.
  return Math.ceil(ROUTE_SHARE * scored - 1e-9);
}

export function routeFor(firstModule: Response[]): Route {
  const right = firstModule.filter((r) => r.correct).length;
  return right >= routeThreshold(firstModule.length) ? "hard" : "easy";
}

/** The questions of one section as drawn: both versions of the second module. */
export interface SectionForm {
  first: Item[];
  easy: Item[];
  hard: Item[];
}

/**
 * A perfect paper's estimate runs off on the prior's tail alone, so pinning 800
 * there would make the first miss cost 40 points. Real forms forgive one or two;
 * 800 sits a little below it instead.
 */
const TOP = 0.9;

export interface Anchors {
  /** Ability scaled to 800. */
  top: number;
  /** Ability of an all-wrong paper on the easy route — scaled to 200. */
  bottom: number;
}

export function anchorsFor(form: SectionForm): Anchors {
  const all = (items: Item[], correct: boolean) => items.map((i) => ({ ...i, correct }));
  const perfect = estimate([...all(form.first, true), ...all(form.hard, true)]).theta;
  return {
    top: TOP * perfect,
    bottom: estimate([...all(form.first, false), ...all(form.easy, false)]).theta,
  };
}

/** Ability to the 200–800 scale: 500 at the population mean, ends pinned. */
function toScale(theta: number, a: Anchors): number {
  const raw = theta >= 0 ? 500 + (300 * theta) / a.top : 500 - (300 * theta) / a.bottom;
  return Math.min(800, Math.max(200, raw));
}

const round10 = (v: number) => Math.round(v / 10) * 10;

export interface Scaled {
  score: number;
  low: number;
  high: number;
}

export function scaleSection(est: Estimate, anchors: Anchors): Scaled {
  const score = round10(toScale(est.theta, anchors));
  // One standard error either way, the band College Board prints on a report.
  const low = round10(toScale(est.theta - est.sd, anchors));
  const high = round10(toScale(est.theta + est.sd, anchors));
  return { score, low: Math.min(low, score), high: Math.max(high, score) };
}

export function scoreSection(form: SectionForm, first: Response[], second: Response[]): Scaled {
  return scaleSection(estimate([...first, ...second]), anchorsFor(form));
}
