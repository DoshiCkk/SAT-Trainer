import type { FilterState, Question, StatusFilter } from "../types";
import type { History } from "./data";

export function matchesStatus(q: Question, status: StatusFilter, h: History): boolean {
  switch (status) {
    case "new":
      return !h.last.has(q.id);
    case "wrong":
      return h.last.get(q.id)?.correct === false;
    case "marked":
      return h.marked.has(q.id);
    default:
      return true;
  }
}

export function applyFilters(questions: Question[], f: FilterState, h: History): Question[] {
  return questions.filter(
    (q) =>
      q.section === f.section &&
      (f.domains.length === 0 || f.domains.includes(q.domain)) &&
      (f.skills.length === 0 || f.skills.includes(q.skill)) &&
      (f.difficulties.length === 0 || f.difficulties.includes(q.difficulty)) &&
      matchesStatus(q, f.status, h)
  );
}

/** Questions already answered in any past session — excluded from timed runs. */
export function seenIds(h: History): Set<string> {
  return new Set(h.last.keys());
}

export interface Shortfall {
  domain: string;
  want: number;
  have: number;
}

export interface Picked {
  questions: Question[];
  shortfalls: Shortfall[];
}

/**
 * Pick `total` questions spread across domains by the given weights, topping up
 * from whichever domains still have spare questions so a thin domain does not
 * silently shrink the module.
 */
export function pickByWeights(
  pool: Question[],
  weights: Record<string, number>,
  total: number,
  pickFrom: (qs: Question[], n: number) => Question[]
): Picked {
  const byDomain = new Map<string, Question[]>();
  for (const q of pool) {
    const arr = byDomain.get(q.domain);
    if (arr) arr.push(q);
    else byDomain.set(q.domain, [q]);
  }

  const domains = Object.keys(weights);
  const exact = domains.map((d) => total * weights[d]);
  const want: Record<string, number> = {};
  let assigned = 0;
  domains.forEach((d, i) => {
    want[d] = Math.floor(exact[i]);
    assigned += want[d];
  });
  // hand out the remainder to the largest fractional parts
  const rema = domains
    .map((d, i) => ({ d, frac: exact[i] - Math.floor(exact[i]) }))
    .sort((a, b) => b.frac - a.frac);
  for (let i = 0; assigned < total && i < rema.length; i++, assigned++) want[rema[i].d]++;

  const out: Question[] = [];
  const shortfalls: Shortfall[] = [];
  const leftovers: Question[] = [];

  for (const d of domains) {
    const avail = byDomain.get(d) ?? [];
    const take = Math.min(want[d], avail.length);
    const chosen = pickFrom(avail, take);
    out.push(...chosen);
    const chosenIds = new Set(chosen.map((q) => q.id));
    leftovers.push(...avail.filter((q) => !chosenIds.has(q.id)));
    if (take < want[d]) shortfalls.push({ domain: d, want: want[d], have: avail.length });
  }

  if (out.length < total && leftovers.length > 0) {
    out.push(...pickFrom(leftovers, Math.min(total - out.length, leftovers.length)));
  }
  return { questions: out, shortfalls };
}
