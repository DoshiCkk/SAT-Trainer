import type { Attempt, Question, QuestionFile, Section } from "../types";

/** Bluebook presents a module in this order; the parser has no say in it. */
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

/** The key check, shared by instant feedback and by module submission. */
export function isCorrectAnswer(q: Question, given: string | null): boolean {
  if (given == null) return false;
  const norm = (v: string) => v.trim().toLowerCase();
  return q.correct.some((c) => norm(c) === norm(given));
}

export function sortForModule(questions: Question[]): Question[] {
  return [...questions].sort((a, b) => {
    if (a.section !== b.section) {
      return byOrder(["Reading and Writing", "Math"])(a.section, b.section);
    }
    const dord = DOMAIN_ORDER[a.section] ?? [];
    const d = byOrder(dord)(a.domain, b.domain);
    if (d !== 0) return d;
    return byOrder(SKILL_ORDER[a.domain] ?? [])(a.skill, b.skill);
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
