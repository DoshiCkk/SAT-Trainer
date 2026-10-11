import type { Attempt, Question, QuestionFile, Section } from "../types";

/**
 * Bluebook order of the Reading and Writing domains; the parser has no say in
 * it. Math mixes its domains within a module, so there it only orders the UI.
 */
export const DOMAIN_ORDER: Record<Section, string[]> = {
  "Reading and Writing": [
    "Craft and Structure",
    "Information and Ideas",
    "Standard English Conventions",
    "Expression of Ideas",
  ],
  Math: [
    "Algebra",
    "Advanced Math",
    "Problem-Solving and Data Analysis",
    "Geometry and Trigonometry",
  ],
};

export const SKILL_ORDER: Record<string, string[]> = {
  "Craft and Structure": ["Words in Context", "Text Structure and Purpose", "Cross-Text Connections"],
  "Information and Ideas": ["Central Ideas and Details", "Command of Evidence", "Inferences"],
  "Standard English Conventions": ["Boundaries", "Form, Structure, and Sense"],
  "Expression of Ideas": ["Transitions", "Rhetorical Synthesis"],
  "Advanced Math": [
    "Equivalent expressions",
    "Nonlinear equations in one variable and systems of equations in two variables",
    "Nonlinear functions",
  ],
};

export const DIFFICULTY_ORDER = ["Easy", "Medium", "Hard"];

export interface Taxonomy {
  sections: Section[];
  domains: Record<Section, string[]>;
  skills: Record<string, string[]>;
  difficulties: string[];
}

export interface Loaded {
  questions: Question[];
  counts: QuestionFile["counts"];
}

export async function loadQuestions(): Promise<Loaded> {
  const res = await fetch(`${import.meta.env.BASE_URL}questions.json`);
  if (!res.ok) {
    throw new Error(
      `Не удалось загрузить questions.json (${res.status}). Запусти "npm run parse".`
    );
  }
  const data = (await res.json()) as QuestionFile;
  // A question whose key the export never states cannot be scored, so it is not
  // offered; the parser reports it under "Без ключа".
  return {
    questions: data.questions.filter((q) => q.correct.length > 0),
    counts: data.counts,
  };
}

function byOrder(order: string[]) {
  return (a: string, b: string) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  };
}

/** Everything the filter UI can offer is derived from the data, never hardcoded. */
export function buildTaxonomy(questions: Question[]): Taxonomy {
  const sections: Section[] = [];
  const domains: Record<string, Set<string>> = {};
  const skills: Record<string, Set<string>> = {};
  const difficulties = new Set<string>();

  for (const q of questions) {
    if (!sections.includes(q.section)) sections.push(q.section);
    (domains[q.section] ??= new Set()).add(q.domain);
    (skills[q.domain] ??= new Set()).add(q.skill);
    difficulties.add(q.difficulty);
  }

  sections.sort(byOrder(["Reading and Writing", "Math"]));
  const domainsOut = {} as Record<Section, string[]>;
  for (const s of sections) {
    domainsOut[s] = [...(domains[s] ?? [])].sort(byOrder(DOMAIN_ORDER[s] ?? []));
  }
  const skillsOut: Record<string, string[]> = {};
  for (const [d, set] of Object.entries(skills)) {
    skillsOut[d] = [...set].sort(byOrder(SKILL_ORDER[d] ?? []));
  }
  return {
    sections,
    domains: domainsOut,
    skills: skillsOut,
    difficulties: [...difficulties].sort(byOrder(DIFFICULTY_ORDER)),
  };
}

export interface History {
  /** Most recent attempt per question. */
  last: Map<string, Attempt>;
  all: Map<string, Attempt[]>;
  marked: Set<string>;
}

export function buildHistory(attempts: Attempt[], marks: string[]): History {
  const all = new Map<string, Attempt[]>();
  for (const a of attempts) {
    const arr = all.get(a.questionId);
    if (arr) arr.push(a);
    else all.set(a.questionId, [a]);
  }
  const last = new Map<string, Attempt>();
  for (const [qid, arr] of all) {
    arr.sort((x, y) => x.at - y.at);
    last.set(qid, arr[arr.length - 1]);
  }
  return { last, all, marked: new Set(marks) };
}

/** A typed answer as a number — "1.5", ".5", "-3/2" — or null when it isn't one. */
function numeric(v: string): number | null {
  const s = v.replace(/\s+/g, "").replace(/[−–]/g, "-");
  const frac = /^(-?)(\d+)\/(\d+)$/.exec(s);
  if (frac) {
    const d = Number(frac[3]);
    return d === 0 ? null : ((frac[1] ? -1 : 1) * Number(frac[2])) / d;
  }
  return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : null;
}

/**
 * The key check, shared by instant feedback and by module submission. A typed
 * answer counts in any form of the same number, as on the real test: 1.50, 3/2
 * and 6/4 all match a key of 1.5.
 */
export function isCorrectAnswer(q: Question, given: string | null): boolean {
  if (given == null) return false;
  const norm = (v: string) => v.trim().toLowerCase();
  if (q.correct.some((c) => norm(c) === norm(given))) return true;
  if (q.type !== "spr") return false;
  const g = numeric(given);
  return (
    g != null &&
    q.correct.some((c) => {
      const k = numeric(c);
      return k != null && Math.abs(k - g) < 1e-9;
    })
  );
}

/**
 * Attempts graded against an older key: the answer is kept, so a corrected
 * key regrades it. Returns only the rows whose verdict changes.
 */
export function regrade(attempts: Attempt[], questions: Question[]): Attempt[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const out: Attempt[] = [];
  for (const a of attempts) {
    const q = byId.get(a.questionId);
    if (!q || a.answer == null) continue;
    const ok = isCorrectAnswer(q, a.answer);
    if (ok !== a.correct) out.push({ ...a, correct: ok });
  }
  return out;
}

/**
 * Bluebook order. Reading and Writing groups questions by skill in a fixed
 * order, each group running from easiest to hardest; Math mixes its domains and
 * runs the whole module from easiest to hardest. Ties keep the order they came
 * in, which the pickers have already shuffled.
 */
export function sortForModule(questions: Question[]): Question[] {
  const diff = byOrder(DIFFICULTY_ORDER);
  return [...questions].sort((a, b) => {
    if (a.section !== b.section) {
      return byOrder(["Reading and Writing", "Math"])(a.section, b.section);
    }
    if (a.section === "Math") return diff(a.difficulty, b.difficulty);
    const d = byOrder(DOMAIN_ORDER[a.section] ?? [])(a.domain, b.domain);
    if (d !== 0) return d;
    const s = byOrder(SKILL_ORDER[a.domain] ?? [])(a.skill, b.skill);
    if (s !== 0) return s;
    return diff(a.difficulty, b.difficulty);
  });
}

export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
