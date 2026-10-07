import { useMemo } from "react";
import type { FilterState, ModeId, Question, Section, StatusFilter } from "../types";
import type { History, Taxonomy } from "../lib/data";
import { applyFilters } from "../lib/filters";
import { MODES, buildPlan } from "../lib/modes";

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "Все",
  new: "Только новые",
  wrong: "Только ошибки",
  marked: "Только отмеченные",
};

interface Props {
  questions: Question[];
  taxonomy: Taxonomy;
  history: History;
  filter: FilterState;
  setFilter: (f: FilterState) => void;
  onStart: (mode: ModeId) => void;
}

export default function Home({ questions, taxonomy, history, filter, setFilter, onStart }: Props) {
  const available = useMemo(
    () => applyFilters(questions, filter, history),
    [questions, filter, history]
  );

  /** Count for one chip: what the pool becomes if that value were selected. */
  const countWith = (patch: Partial<FilterState>) =>
    applyFilters(questions, { ...filter, ...patch }, history).length;

  const domains = taxonomy.domains[filter.section] ?? [];
  const activeDomains = filter.domains.length ? filter.domains : domains;

  const onlyHard =
    taxonomy.difficulties.length === 1 && taxonomy.difficulties[0] === "Hard";

  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  function setSection(section: Section) {
    setFilter({ ...filter, section, domains: [], skills: [] });
  }

  function toggleDomain(d: string) {
    const domainsNext = toggle(filter.domains, d);
    // drop skills that no longer belong to any selected domain
    const allowed = new Set(
      (domainsNext.length ? domainsNext : domains).flatMap((x) => taxonomy.skills[x] ?? [])
    );
    setFilter({
      ...filter,
      domains: domainsNext,
      skills: filter.skills.filter((s) => allowed.has(s)),
    });
  }

  const modeStates = MODES.map((m) => {
    const hasSection = taxonomy.sections.includes(m.section);
    const result = hasSection ? buildPlan(m.id, questions, filter, history) : null;
    const total = result?.plan?.modules.reduce((n, mod) => n + mod.questions.length, 0) ?? 0;
    return { mode: m, hasSection, result, total };
  });

  return (
    <div className="wrap">
      <div className="row" style={{ marginBottom: 20, gap: 16 }}>
        <div className="section-tabs">
          {(["Reading and Writing", "Math"] as Section[]).map((s) => (
            <button
              key={s}
              aria-pressed={filter.section === s}
              disabled={!taxonomy.sections.includes(s)}
              onClick={() => setSection(s)}
              title={taxonomy.sections.includes(s) ? undefined : "Нет данных: добавь PDF и запусти npm run parse"}
            >
              {s === "Math" ? "Math" : "Reading and Writing"}
            </button>
          ))}
        </div>
        <span className="muted small">
          {questions.length} вопросов в базе · решено {history.last.size}
        </span>
      </div>

      {onlyHard && (
        <div className="banner warn" style={{ marginBottom: 20 }}>
          Набор только из Hard: сложнее реального модуля, точность будет ниже экзаменационной.
        </div>
      )}

      <div className="home-grid">
        <div className="col" style={{ gap: 20 }}>
          <section>
            <div className="section-title">Домены и скиллы</div>
            {domains.length === 0 && (
              <div className="banner info">
                Для этой секции ещё нет данных. Положи PDF в <code>Themes/</code> и запусти{" "}
                <code>npm run parse</code>.
              </div>
            )}
            {domains.map((d) => {
              const on = filter.domains.includes(d);
              const skills = taxonomy.skills[d] ?? [];
              const show = on || filter.domains.length === 0;
              return (
                <div className="domain-block" key={d}>
                  <div className="domain-head">
                    <button className="chip" aria-pressed={on} onClick={() => toggleDomain(d)}>
                      {d} <span className="n">{countWith({ domains: [d], skills: [] })}</span>
                    </button>
                  </div>
                  {show && skills.length > 0 && (
                    <div className="skill-list">
                      {skills.map((s) => (
                        <button
                          key={s}
                          className="chip"
                          aria-pressed={filter.skills.includes(s)}
                          onClick={() =>
                            setFilter({ ...filter, skills: toggle(filter.skills, s) })
                          }
                        >
                          {s}{" "}
                          <span className="n">
                            {countWith({ domains: [d], skills: [s] })}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          <section>
            <div className="section-title">Сложность</div>
            <div className="wrap-chips">
              {taxonomy.difficulties.map((d) => (
                <button
                  key={d}
                  className="chip"
                  aria-pressed={filter.difficulties.includes(d)}
                  onClick={() =>
                    setFilter({ ...filter, difficulties: toggle(filter.difficulties, d) })
                  }
                >
                  {d} <span className="n">{countWith({ difficulties: [d] })}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="section-title">Статус</div>
            <div className="wrap-chips">
              {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((s) => (
                <button
                  key={s}
                  className="chip"
                  aria-pressed={filter.status === s}
                  onClick={() => setFilter({ ...filter, status: s })}
                >
                  {STATUS_LABELS[s]} <span className="n">{countWith({ status: s })}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="section-title">Готовые режимы</div>
            <div className="col">
              {modeStates.map(({ mode, hasSection, result, total }) => {
                const short = result?.shortfalls ?? [];
                const blocked = !hasSection || total === 0;
                return (
                  <div key={mode.id}>
                    <button
                      className="mode-card"
                      disabled={blocked}
                      onClick={() => onStart(mode.id)}
                    >
                      <div style={{ flex: 1 }}>
                        <div className="title">{mode.title}</div>
                        <div className="detail">{mode.detail}</div>
                      </div>
                      <div className="count">{hasSection ? `${total} вопр.` : "нет данных"}</div>
                    </button>
                    {hasSection && short.length > 0 && (
                      <div className="banner bad small" style={{ marginTop: 6 }}>
                        Не хватает вопросов:{" "}
                        {short
                          .map((s) => `${s.domain} — нужно ${s.want}, есть ${s.have}`)
                          .join("; ")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="sticky-side">
          <div className="card col" style={{ gap: 16 }}>
            <div>
              <div className="section-title" style={{ marginBottom: 2 }}>
                Доступно по фильтру
              </div>
              <div className="counter">{available.length}</div>
            </div>

            <label className="field">
              Количество вопросов
              <input
                type="number"
                min={1}
                max={Math.max(1, available.length)}
                value={filter.count}
                onChange={(e) =>
                  setFilter({ ...filter, count: Math.max(1, Number(e.target.value) || 1) })
                }
              />
            </label>

            <label className="switch">
              <input
                type="checkbox"
                checked={filter.timer}
                onChange={(e) => setFilter({ ...filter, timer: e.target.checked })}
              />
              Таймер
            </label>

            <label className="switch" title="В «Выносливости» всегда выключено">
              <input
                type="checkbox"
                checked={filter.instantFeedback}
                onChange={(e) => setFilter({ ...filter, instantFeedback: e.target.checked })}
              />
              Сразу показывать правильность
            </label>

            <button
              className="btn primary"
              disabled={available.length === 0}
              onClick={() => onStart("custom")}
            >
              Начать свой набор ({Math.min(filter.count, available.length)})
            </button>

            {(filter.domains.length > 0 ||
              filter.skills.length > 0 ||
              filter.difficulties.length > 0 ||
              filter.status !== "all") && (
              <button
                className="btn ghost sm"
                onClick={() =>
                  setFilter({ ...filter, domains: [], skills: [], difficulties: [], status: "all" })
                }
              >
                Сбросить фильтры
              </button>
            )}

            <div className="small muted">
              Выбрано доменов: {activeDomains.length} из {domains.length}
              {filter.skills.length > 0 && ` · скиллов: ${filter.skills.length}`}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
