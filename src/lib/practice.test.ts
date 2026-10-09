/**
 * Checks for the adaptive practice test and its scoring. Run with `npm test`.
 */
import { readFileSync } from "node:fs";
import type { Attempt, ModulePlan, Question, QuestionFile, RunPlan } from "../types";
import { buildHistory } from "./data";
import { buildPractice, routeNext, scorePractice } from "./practice";
import { loadRun, saveRun } from "./resume";

const data = JSON.parse(readFileSync("public/questions.json", "utf8")) as QuestionFile;
const questions: Question[] = data.questions.filter((q) => q.correct.length > 0);

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${detail ? `  — ${detail}` : ""}`);
}

const tally = (qs: Question[], key: "domain" | "difficulty") => {
  const out: Record<string, number> = {};
  for (const q of qs) out[q[key]] = (out[q[key]] ?? 0) + 1;
  return out;
};
const same = (a: Record<string, number>, b: Record<string, number>) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

const empty = buildHistory([], []);
console.log(`\nпробник: база ${questions.length} вопросов\n`);

// --- structure
const { plan, shortfalls } = buildPractice("full", questions, empty);
const [rw1, rw2, m1, m2] = plan.modules;
check("4 модуля: R&W 1, R&W 2, Math 1, Math 2", plan.modules.length === 4);
check("нехваток нет", shortfalls.length === 0, JSON.stringify(shortfalls));
check("R&W модуль 1: 27 вопросов, 32 мин", rw1.questions.length === 27 && rw1.minutes === 32);
check("Math модуль 1: 22 вопроса, 35 мин", m1.questions.length === 22 && m1.minutes === 35);
check(
  "модуль 2 до маршрутизации пуст, оба варианта готовы",
  rw2.questions.length === 0 &&
    rw2.routes!.easy.questions.length === 27 &&
    rw2.routes!.hard.questions.length === 27 &&
    m2.routes!.easy.questions.length === 22 &&
    m2.routes!.hard.questions.length === 22
);

// --- difficulty mix
check(
  "R&W модуль 1: 7 Easy / 13 Medium / 7 Hard",
  same(tally(rw1.questions, "difficulty"), { Easy: 7, Medium: 13, Hard: 7 }),
  JSON.stringify(tally(rw1.questions, "difficulty"))
);
check(
  "Math модуль 1: 6 / 11 / 5",
  same(tally(m1.questions, "difficulty"), { Easy: 6, Medium: 11, Hard: 5 }),
  JSON.stringify(tally(m1.questions, "difficulty"))
);
check(
  "R&W лёгкий модуль 2: 13 / 11 / 3",
  same(tally(rw2.routes!.easy.questions, "difficulty"), { Easy: 13, Medium: 11, Hard: 3 }),
  JSON.stringify(tally(rw2.routes!.easy.questions, "difficulty"))
);
check(
  "R&W сложный модуль 2: 3 / 11 / 13",
  same(tally(rw2.routes!.hard.questions, "difficulty"), { Easy: 3, Medium: 11, Hard: 13 }),
  JSON.stringify(tally(rw2.routes!.hard.questions, "difficulty"))
);

// --- domain mix holds in every module at once with the difficulty mix
const rwDomains = { "Craft and Structure": 8, "Information and Ideas": 7, "Standard English Conventions": 7, "Expression of Ideas": 5 };
const mathDomains = { Algebra: 8, "Advanced Math": 8, "Problem-Solving and Data Analysis": 3, "Geometry and Trigonometry": 3 };
const every = (mods: ModulePlan[], want: Record<string, number>) =>
  mods.every((m) => same(tally(m.questions, "domain"), want));
check(
  "домены R&W 8/7/7/5 во всех трёх вариантах",
  every([rw1, rw2.routes!.easy, rw2.routes!.hard], rwDomains),
  JSON.stringify(tally(rw2.routes!.hard.questions, "domain"))
);
check(
  "домены Math 8/8/3/3 во всех трёх вариантах",
  every([m1, m2.routes!.easy, m2.routes!.hard], mathDomains),
  JSON.stringify(tally(m2.routes!.easy.questions, "domain"))
);

// --- no repeats, pretest, breaks, order
const allIds = [rw1, rw2.routes!.easy, rw2.routes!.hard, m1, m2.routes!.easy, m2.routes!.hard].flatMap(
  (m) => m.questions.map((q) => q.id)
);
check("ни один вопрос не повторяется во всём тесте", new Set(allIds).size === allIds.length);
check(
  "по 2 pretest-вопроса из своего модуля",
  [rw1, rw2.routes!.easy, m1, m2.routes!.hard].every(
    (m) => m.pretest!.length === 2 && m.pretest!.every((id) => m.questions.some((q) => q.id === id))
  )
);
check(
  "перерыв только между секциями",
  !rw1.breakAfter &&
    rw2.routes!.easy.breakAfter === 10 &&
    rw2.routes!.hard.breakAfter === 10 &&
    !m1.breakAfter &&
    !m2.routes!.hard.breakAfter
);
const rank = (d: string) => ["Easy", "Medium", "Hard"].indexOf(d);
check(
  "Math: от лёгких к сложным",
  m1.questions.every((q, i) => i === 0 || rank(q.difficulty) >= rank(m1.questions[i - 1].difficulty)),
  m1.questions.map((q) => q.difficulty[0]).join("")
);
check(
  "R&W: Craft → Information → SEC → Expression",
  rw1.questions.map((q) => q.domain[0]).join("") === "CCCCCCCCIIIIIIISSSSSSSEEEEE",
  rw1.questions.map((q) => q.domain[0]).join("")
);

// --- prefers unseen questions
const rwAll = questions.filter((q) => q.section === "Reading and Writing");
const seenOf = (qs: Question[]): Attempt[] =>
  qs.map((q) => ({
  key: `old:${q.id}`,
  sessionId: "old",
  moduleIndex: 0,
  questionId: q.id,
  domain: q.domain,
  skill: q.skill,
  difficulty: q.difficulty,
  answer: "A",
  correct: true,
  timeMs: 1000,
  marked: false,
  at: 1,
}));
const drawnOf = (p: RunPlan) =>
  p.modules.flatMap((m) =>
    m.routes ? [...m.routes.easy.questions, ...m.routes.hard.questions] : m.questions
  );

// A third of every cell already answered: plenty of new ones left everywhere.
const spreadHist = buildHistory(seenOf(rwAll.filter((_, i) => i % 3 === 0)), []);
const fresh = drawnOf(buildPractice("rw", questions, spreadHist).plan);
check(
  "только R&W: решённые раньше не попадают",
  fresh.length === 81 && fresh.every((q) => !spreadHist.last.has(q.id)),
  `${fresh.filter((q) => spreadHist.last.has(q.id)).length} повторов`
);

// Nearly every Hard one already answered: the mix holds, using the oldest.
const hardHist = buildHistory(seenOf(rwAll.filter((q) => q.difficulty === "Hard").slice(10)), []);
const hardPlan = buildPractice("rw", questions, hardHist).plan;
// In every domain, a seen Hard one is drawn only once its new ones are all used.
const newFirst = Object.keys(rwDomains).every((d) => {
  const cell = (q: Question) => q.domain === d && q.difficulty === "Hard";
  const drawn = drawnOf(hardPlan).filter(cell);
  const fresh = rwAll.filter((q) => cell(q) && !hardHist.last.has(q.id)).length;
  return drawn.filter((q) => !hardHist.last.has(q.id)).length === Math.min(fresh, drawn.length);
});
check(
  "новых Hard не хватает — добирает решёнными Hard, состав не ломается",
  same(tally(hardPlan.modules[0].questions, "difficulty"), { Easy: 7, Medium: 13, Hard: 7 }) &&
    newFirst,
  JSON.stringify(tally(hardPlan.modules[0].questions, "difficulty"))
);

// --- routing and scoring
function answerAll(p: RunPlan, pick: (q: Question, i: number, mi: number) => boolean): {
  plan: RunPlan;
  attempts: Attempt[];
} {
  let cur = p;
  const attempts: Attempt[] = [];
  for (let mi = 0; mi < cur.modules.length; mi++) {
    const mod = cur.modules[mi];
    mod.questions.forEach((q, i) => {
      const ok = pick(q, i, mi);
      attempts.push({
        key: `t:${q.id}`,
        sessionId: "t",
        moduleIndex: mi,
        questionId: q.id,
        domain: q.domain,
        skill: q.skill,
        difficulty: q.difficulty,
        answer: ok ? q.correct[0] : "zzz",
        correct: ok,
        timeMs: 1000,
        marked: false,
        at: 2,
        ...(mod.pretest?.includes(q.id) ? { pretest: true } : {}),
      });
    });
    cur = routeNext(cur, mi, attempts);
  }
  return { plan: cur, attempts };
}

const perfect = answerAll(plan, () => true);
const ps = scorePractice(perfect.plan, perfect.attempts);
check(
  "всё верно → сложные модули 2, 800 + 800 = 1600",
  ps.total === 1600 && ps.sections.every((s) => s.score === 800 && s.route === "hard"),
  JSON.stringify(ps.sections.map((s) => [s.score, s.route]))
);
check(
  "после маршрутизации у модуля 2 есть вопросы и остаются оба варианта",
  perfect.plan.modules[1].questions.length === 27 && Boolean(perfect.plan.modules[1].routes)
);

const zero = answerAll(plan, () => false);
const zs = scorePractice(zero.plan, zero.attempts);
check(
  "всё неверно → лёгкие модули 2, 200 + 200 = 400",
  zs.total === 400 && zs.sections.every((s) => s.score === 200 && s.route === "easy"),
  JSON.stringify(zs.sections.map((s) => [s.score, s.route]))
);

// First module half right (the easy half), second perfect: routed low, capped.
const capped = answerAll(plan, (q, _i, mi) => (mi % 2 === 0 ? q.difficulty === "Easy" : true));
const cs = scorePractice(capped.plan, capped.attempts);
check(
  "слабый модуль 1 → лёгкий модуль 2, балл 450–650",
  cs.sections.every((s) => s.route === "easy" && s.score >= 450 && s.score <= 650),
  JSON.stringify(cs.sections.map((s) => [s.score, s.route]))
);

// The cut is a plain count of scored first-module answers: 20/25 and 16/20.
const scoredOf = (mod: ModulePlan) => mod.questions.filter((q) => !mod.pretest!.includes(q.id));
const firstN = (mi: number, n: number) => {
  const ids = new Set(scoredOf(plan.modules[mi]).slice(0, n).map((q) => q.id));
  return (q: Question) => ids.has(q.id);
};
const cut = (rw: number, math: number) =>
  answerAll(plan, (q, _i, mi) => (mi === 0 ? firstN(0, rw)(q) : mi === 2 ? firstN(2, math)(q) : true));
const atCut = scorePractice(cut(20, 16).plan, cut(20, 16).attempts).sections.map((s) => s.route);
const belowCut = scorePractice(cut(19, 15).plan, cut(19, 15).attempts).sections.map((s) => s.route);
check(
  "порог 80%: 20/25 и 16/20 → сложный, 19/25 и 15/20 → лёгкий",
  atCut.join() === "hard,hard" && belowCut.join() === "easy,easy",
  `${atCut.join()} / ${belowCut.join()}`
);
const nearCap = scorePractice(cut(19, 15).plan, cut(19, 15).attempts).sections.map((s) => s.score);
check(
  "чуть ниже порога и всё верно в лёгком модуле 2 — потолок около 680",
  nearCap.every((v) => v >= 640 && v <= 720),
  nearCap.join(", ")
);

// One miss on the hard route costs little, as on the real test.
let missed = false;
const oneMiss = answerAll(plan, (q, _i, mi) => {
  if (mi === 1 && !missed && q.difficulty === "Hard" && !plan.modules[1].routes!.hard.pretest!.includes(q.id)) {
    missed = true;
    return false;
  }
  return true;
});
const om = scorePractice(oneMiss.plan, oneMiss.attempts).sections[0];
check("одна ошибка на сложном маршруте: 780–800", om.score >= 780 && om.score <= 800, String(om.score));

// Pretest answers do not move the score.
const flipPretest = answerAll(plan, (q, _i, mi) => !(plan.modules[mi].pretest ?? []).includes(q.id));
const fp = scorePractice(flipPretest.plan, flipPretest.attempts);
check(
  "ответы на pretest-вопросы не влияют на балл",
  fp.total === 1600,
  String(fp.total)
);

// More right answers never lower the score.
let monotone = true;
for (let trial = 0; trial < 30 && monotone; trial++) {
  const p = buildPractice("rw", questions, empty).plan;
  const rate = 0.3 + Math.random() * 0.6;
  const base = answerAll(p, () => Math.random() < rate);
  const s0 = scorePractice(base.plan, base.attempts).sections[0].score;
  const wrong = base.attempts.find((a) => !a.correct && !a.pretest && a.moduleIndex === 1);
  if (!wrong) continue;
  const better = base.attempts.map((a) => (a === wrong ? { ...a, correct: true } : a));
  const s1 = scorePractice(base.plan, better).sections[0].score;
  if (s1 < s0) monotone = false;
}
check("ещё один верный ответ никогда не снижает балл", monotone);

check(
  "диапазон охватывает балл и не шире ±60",
  [ps, zs, cs].every((r) =>
    r.sections.every((s) => s.low <= s.score && s.score <= s.high && s.high - s.low <= 120)
  )
);

// --- resume round trip
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
saveRun({
  sessionId: "s1",
  plan,
  moduleIndex: 1,
  screen: "test",
  snapshot: { idx: 4, answers: { x: "B" }, crossed: {}, checked: [], remaining: 1234, times: {} },
});
const back = loadRun(questions);
check(
  "сохранённый тест восстанавливается с вариантами модуля 2",
  back != null &&
    back.moduleIndex === 1 &&
    back.snapshot?.remaining === 1234 &&
    back.plan.modules[1].routes!.hard.questions.map((q) => q.id).join() ===
      plan.modules[1].routes!.hard.questions.map((q) => q.id).join() &&
    back.plan.modules[0].pretest!.join() === plan.modules[0].pretest!.join()
);
check(
  "если вопрос пропал из базы — сохранение сбрасывается",
  loadRun(questions.filter((q) => q.id !== plan.modules[0].questions[0].id)) === null &&
    store.size === 0
);

console.log(failures === 0 ? "\nвсе проверки прошли\n" : `\n${failures} проверок упало\n`);
process.exit(failures === 0 ? 0 : 1);
