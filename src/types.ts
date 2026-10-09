export type Section = "Reading and Writing" | "Math";
export type QType = "mcq" | "spr";
export type Confidence = "high" | "medium" | "low";
export type Choice = "A" | "B" | "C" | "D";

export interface Question {
  id: string;
  section: Section;
  domain: string;
  skill: string;
  difficulty: string;
  passage: string;
  stem: string;
  choices: Record<Choice, string> | null;
  type: QType;
  correct: string[];
  rationale: string;
  /** Crop of the question area, when it holds a table, graph or formula. */
  image?: string | null;
  /** One crop per choice, when the choices are rendered as formulas. */
  choiceImages?: Partial<Record<Choice, string>> | null;
  /** Fallback single crop of the whole answer block. */
  choicesImage?: string | null;
  /** Crop of the rationale, when it holds formulas (stage 3 review). */
  rationaleImage?: string | null;
  hasUnderline?: boolean;
  parseConfidence: Confidence;
  sourceFile: string;
}

export interface QuestionFile {
  generatedAt: string;
  files: string[];
  counts: {
    total: number;
    new: number;
    /** Crops on disk, so the phone can say what an offline copy costs. */
    imageFiles?: number;
    imageBytes?: number;
  };
  questions: Question[];
}

/** Why an answer went wrong, tagged in one click during review (stage 3). */
export type ErrorReason =
  | "not-known"
  | "not-finished"
  | "careless"
  | "added-info"
  | "misread-question"
  | "out-of-time";

/** One answered question. Written once when a module is submitted. */
export interface Attempt {
  key: string; // `${sessionId}:${questionId}`
  sessionId: string;
  moduleIndex: number;
  questionId: string;
  domain: string;
  skill: string;
  difficulty: string;
  answer: string | null;
  correct: boolean;
  timeMs: number;
  marked: boolean;
  at: number;
  reason?: ErrorReason;
  /** Tried out on a practice test without counting, like pretest questions. */
  pretest?: boolean;
}

export type ModeId =
  | "rw-module"
  | "math-module"
  | "endurance"
  | "focus"
  | "custom"
  | "practice";

/** Which second module the first one led to. */
export type Route = "easy" | "hard";

export interface SectionScore {
  section: Section;
  score: number;
  /** One standard error either way, as on a College Board score report. */
  low: number;
  high: number;
  route: Route;
  /** Scored questions only; the pretest ones are left out, as on the test. */
  first: { right: number; of: number };
  second: { right: number; of: number };
}

export interface PracticeScore {
  /** 400–1600; only when both sections were taken. */
  total: number | null;
  low: number | null;
  high: number | null;
  sections: SectionScore[];
}

export interface Session {
  id: string;
  mode: ModeId;
  label: string;
  startedAt: number;
  endedAt?: number;
  moduleCount: number;
  score?: PracticeScore;
}

export type StatusFilter = "all" | "new" | "wrong" | "marked";

export interface FilterState {
  section: Section;
  domains: string[];
  skills: string[];
  difficulties: string[];
  status: StatusFilter;
  count: number;
  timer: boolean;
  /** Mark the answer right or wrong as soon as it is given. */
  instantFeedback: boolean;
}

/** A module the runner executes: a fixed list of questions and a time budget. */
export interface ModulePlan {
  questions: Question[];
  minutes: number | null;
  label: string;
  /** Minutes of rest once this module is submitted. */
  breakAfter?: number;
  section?: Section;
  /** Ids answered but not scored: the practice test's pretest questions. */
  pretest?: string[];
  /**
   * An adaptive second module: both versions are drawn up front and the first
   * module's result picks one. Until then `questions` is empty.
   */
  routes?: Record<Route, ModulePlan>;
  route?: Route;
}

export interface RunPlan {
  mode: ModeId;
  label: string;
  modules: ModulePlan[];
  /** Endurance hides per-module results until the whole run ends. */
  hideResultsBetween: boolean;
  /** Colour each answer the moment it is given; never on in endurance. */
  instantFeedback: boolean;
}
