/**
 * Sanity checks for set building, run with:
 *   npx esbuild src/lib/modes.test.ts --bundle --platform=node --format=esm --outfile=<tmp>.mjs && node <tmp>.mjs
 */
import { readFileSync } from "node:fs";
import type { Attempt, FilterState, Question, QuestionFile } from "../types";
import { buildHistory, buildTaxonomy, DOMAIN_ORDER, SKILL_ORDER } from "./data";
import { applyFilters } from "./filters";
import { buildPlan, RW_MODULE } from "./modes";

const data = JSON.parse(readFileSync("public/questions.json", "utf8")) as QuestionFile;
// Same gate as loadQuestions(): a question with no key cannot be scored.
const questions: Question[] = data.questions.filter((q) => q.correct.length > 0);

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${detail ? `  — ${detail}` : ""}`);
}

const emptyHistory = buildHistory([], []);
const baseFilter: FilterState = {
  section: "Reading and Writing",
  domains: [],
  skills: [],
  difficulties: [],
  status: "all",
  count: 10,
  timer: true,
  instantFeedback: true,
};

console.log(`\nданные: ${questions.length} вопросов\n`);

// --- taxonomy
const tax = buildTaxonomy(questions);
check(
  "секции выведены из данных",
  tax.sections.join(",") === "Reading and Writing,Math",
  tax.sections.join(",")
);
check(
  "домены в порядке Bluebook",
  tax.domains["Reading and Writing"].join(" | ") === DOMAIN_ORDER["Reading and Writing"].join(" | "),
  tax.domains["Reading and Writing"].join(" | ")
);
check(
  "скиллы Information в порядке Bluebook",
  tax.skills["Information and Ideas"].join(" | ") === SKILL_ORDER["Information and Ideas"].join(" | "),
  tax.skills["Information and Ideas"].join(" | ")
);
check(
  "сложности из данных, по возрастанию",
  tax.difficulties.join(",") === "Easy,Medium,Hard",
  tax.difficulties.join(",")
);

// --- R&W module proportions
const rw = buildPlan("rw-module", questions, baseFilter, emptyHistory);
const mod = rw.plan!.modules[0];
check("модуль R&W: 27 вопросов", mod.questions.length === RW_MODULE.count, String(mod.questions.length));
check("модуль R&W: 32 минуты", mod.minutes === RW_MODULE.minutes, String(mod.minutes));
check("нехваток нет", rw.shortfalls.length === 0);

const counts: Record<string, number> = {};
for (const q of mod.questions) counts[q.domain] = (counts[q.domain] ?? 0) + 1;
console.log("    состав:", counts);
check("Craft = 8 (28%)", counts["Craft and Structure"] === 8);
check("Information = 7 (26%)", counts["Information and Ideas"] === 7);
check("SEC = 7 (26%)", counts["Standard English Conventions"] === 7);
check("Expression = 5 (20%)", counts["Expression of Ideas"] === 5);

const order = DOMAIN_ORDER["Reading and Writing"];
const seq = mod.questions.map((q) => order.indexOf(q.domain));
check(
  "порядок Craft → Information → SEC → Expression",
  seq.every((v, i) => i === 0 || v >= seq[i - 1]),
  mod.questions.map((q) => q.domain[0]).join("")
);
const diffRank = (d: string) => ["Easy", "Medium", "Hard"].indexOf(d);
check(
  "внутри скилла — от лёгких к сложным",
  mod.questions.every(
    (q, i) =>
      i === 0 ||
      q.skill !== mod.questions[i - 1].skill ||
      diffRank(q.difficulty) >= diffRank(mod.questions[i - 1].difficulty)
  )
);
const uniq = new Set(mod.questions.map((q) => q.id));
check("без дублей внутри модуля", uniq.size === mod.questions.length);

// --- endurance
const end = buildPlan("endurance", questions, baseFilter, emptyHistory);
const [m1, m2] = end.plan!.modules;
check("выносливость: 2 модуля по 27", m1.questions.length === 27 && m2.questions.length === 27);
check("перерыв 10 мин после модуля 1", m1.breakAfter === 10 && m2.breakAfter === undefined);
check("результаты между модулями скрыты", end.plan!.hideResultsBetween === true);
const ids1 = new Set(m1.questions.map((q) => q.id));
check(
  "модуль 2 не повторяет модуль 1",
  m2.questions.every((q) => !ids1.has(q.id))
);

// --- Math module
const math = buildPlan("math-module", questions, baseFilter, emptyHistory);
const mq = math.plan!.modules[0];
check("модуль Math: 22 вопроса", mq.questions.length === 22, String(mq.questions.length));
check("модуль Math: 35 минут", mq.minutes === 35, String(mq.minutes));
check(
  "модуль Math: только из секции Math",
  mq.questions.every((q) => q.section === "Math")
);
const mathCounts: Record<string, number> = {};
for (const q of mq.questions) mathCounts[q.domain] = (mathCounts[q.domain] ?? 0) + 1;
check(
  "модуль Math: 8/8/3/3 по доменам",
  mathCounts["Algebra"] === 8 &&
    mathCounts["Advanced Math"] === 8 &&
    mathCounts["Problem-Solving and Data Analysis"] === 3 &&
    mathCounts["Geometry and Trigonometry"] === 3,
  JSON.stringify(mathCounts)
);
check("модуль Math: нехваток нет", math.shortfalls.length === 0, JSON.stringify(math.shortfalls));
check(
  "модуль Math: домены вперемешку, от лёгких к сложным",
  mq.questions.every(
    (q, i) => i === 0 || diffRank(q.difficulty) >= diffRank(mq.questions[i - 1].difficulty)
  ),
  mq.questions.map((q) => q.difficulty[0]).join("")
);

// --- Math data integrity: formulas live in crops, so those must be present
const mathQs = questions.filter((q) => q.section === "Math");
check(
  "Math: все четыре домена",
  new Set(mathQs.map((q) => q.domain)).size === 4,
  [...new Set(mathQs.map((q) => q.domain))].join(", ")
);
check(
  "Math: у каждого вопроса есть ключ",
  mathQs.every((q) => q.correct.length > 0)
);
const mathMcq = mathQs.filter((q) => q.type === "mcq");
check(
  "Math: варианты-формулы нарезаны по буквам",
  mathMcq.every((q) => {
    const imgs = q.choiceImages;
    if (!imgs) return true;
    return (["A", "B", "C", "D"] as const).every((L) => typeof imgs[L] === "string");
  })
);
check("Math: есть spr-вопросы", mathQs.some((q) => q.type === "spr"));

// --- history-aware filters
const rwQuestions = questions.filter((q) => q.section === "Reading and Writing");
const fakeAttempts: Attempt[] = rwQuestions.slice(0, 40).map((q, i) => ({
  key: `s:${q.id}`,
  sessionId: "s",
  moduleIndex: 0,
  questionId: q.id,
  domain: q.domain,
  skill: q.skill,
  difficulty: q.difficulty,
  answer: "A",
  correct: i % 2 === 0,
  timeMs: 45000,
  marked: i < 5,
  at: Date.now(),
}));
const hist = buildHistory(fakeAttempts, rwQuestions.slice(0, 5).map((q) => q.id));

check(
  "статус «только новые»",
  applyFilters(questions, { ...baseFilter, status: "new" }, hist).length === rwQuestions.length - 40,
  String(applyFilters(questions, { ...baseFilter, status: "new" }, hist).length)
);
check(
  "статус «только ошибки»",
  applyFilters(questions, { ...baseFilter, status: "wrong" }, hist).length === 20,
  String(applyFilters(questions, { ...baseFilter, status: "wrong" }, hist).length)
);
check("статус «только отмеченные»", applyFilters(questions, { ...baseFilter, status: "marked" }, hist).length === 5);

const focus = buildPlan(
  "focus",
  questions,
  { ...baseFilter, domains: ["Craft and Structure"], skills: ["Words in Context"], count: 15, timer: false },
  hist
);
const fq = focus.plan!.modules[0].questions;
check("фокус: 15 вопросов одного скилла", fq.length === 15 && fq.every((q) => q.skill === "Words in Context"));
check("фокус: без таймера", focus.plan!.modules[0].minutes === null);
check("фокус: не повторяет решённые", fq.every((q) => !hist.last.has(q.id)));

// --- shortfall reporting
const thin = buildPlan(
  "rw-module",
  questions.filter((q) => q.domain !== "Expression of Ideas"),
  baseFilter,
  emptyHistory
);
check(
  "нехватка домена отражена в отчёте",
  thin.shortfalls.some((s) => s.domain === "Expression of Ideas"),
  JSON.stringify(thin.shortfalls)
);
check(
  "модуль всё равно добирается до 27",
  thin.plan!.modules[0].questions.length === 27,
  String(thin.plan!.modules[0].questions.length)
);

console.log(failures === 0 ? "\nвсе проверки прошли\n" : `\n${failures} проверок упало\n`);
process.exit(failures === 0 ? 0 : 1);
