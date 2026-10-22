// W4.22 · «Конструктор» (`forms-builder`, dc:143–286, builderVM dc:813–838): «Содержание» (страницы и вопросы,
// sticky от 780 px), «До публикации исправьте» (после правки в сессии), отмена удаления, страницы (название, «Страница
// i из n», перемешивание, выше / ниже, меню, свернуть), свёрнутые вопросы (мета, «Скрытый», флаг относительно
// действующей версии), карточка выбранного вопроса (question.tsx), выбор типа («Выберите вопрос», частые и все),
// «Добавить вопрос», «Добавить страницу».
import { format, forms as F } from '@ortus/texts';
import type { Dispatch, ReactElement, SetStateAction } from 'react';

import { useForms } from './ctx.tsx';
import type { EditorModel } from './editor.tsx';
import {
  addPage,
  COMMON,
  deletePage,
  flagOf,
  GROUPS,
  isOff,
  movePage,
  newQuestion,
  pageTitle,
  qmeta,
  type QType,
  restore,
  TYPE_KEYS,
  typeInfo,
  type Undo,
} from './model.ts';
import { Glyph, Menu } from './parts.tsx';
import { QuestionEditor } from './question.tsx';

export interface Pick {
  page: string;
  after: string | null;
  all: boolean;
}

export interface BuilderState {
  /** Раскрытый вопрос (sel эталона). */
  sel: string | null;
  pick: Pick | null;
  /** Свёрнутые страницы. */
  coll: Readonly<Record<string, boolean>>;
  undo: Undo | null;
  /** Вводимый идентификатор с ошибкой (idTxt dc:612). */
  idTxt: { key: string; text: string; err: string } | null;
}

export const initialBuilder: BuilderState = {
  sel: null,
  pick: null,
  coll: {},
  undo: null,
  idTxt: null,
};

export type SetBuilder = Dispatch<SetStateAction<BuilderState>>;

/** Ширина корня, от которой «Содержание» закреплено (navPos dc:837). */
const STICKY = 780;

const rnd = (): string => Math.random().toString(36).slice(2, 6);

/** Прокрутка к странице или вопросу (scrollTo dc:616–623): ближайший прокручиваемый предок, отступ 90 px. */
export function scrollToItem(kind: 'page' | 'q', id: string): void {
  setTimeout(() => {
    const sel =
      typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
    const el = document.querySelector<HTMLElement>(`[data-${kind}="${sel}"]`);
    if (!el) return;
    let p = el.parentElement;
    while (p && p !== document.body) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight) break;
      p = p.parentElement;
    }
    const top = el.getBoundingClientRect().top;
    if (p && p !== document.body) p.scrollTop += top - p.getBoundingClientRect().top - 90;
    else window.scrollBy(0, top - 90);
  }, 80);
}

export function Builder({
  m,
  state,
  setState,
}: {
  m: EditorModel;
  state: BuilderState;
  setState: SetBuilder;
}): ReactElement {
  const { width, menu, setMenu } = useForms();
  const d = m.def;
  const ro = !m.canEdit;
  const sel = d.fields.some((x) => x.key === state.sel) ? state.sel : null;
  const pk = state.pick;
  const published = !!m.form.publishedVersionNumber;

  const addQuestion = (t: QType) => {
    if (isOff(t)) return;
    const page = pk?.page ?? d.pages.at(-1)?.id ?? 'p1';
    const nx = newQuestion(t, page, rnd());
    m.draft.edit((dd) => {
      const fields = [...dd.fields];
      const i = pk?.after ? fields.findIndex((y) => y.key === pk.after) : -1;
      if (i >= 0) fields.splice(i + 1, 0, nx);
      else fields.push(nx);
      return { ...dd, fields };
    });
    setState((s) => ({ ...s, sel: nx.key, pick: null }));
    scrollToItem('q', nx.key);
  };

  const onAddPage = () => {
    const id = `p-${rnd()}`;
    m.draft.edit((dd) => addPage(dd, id));
    setState((s) => ({ ...s, pick: { page: id, after: null, all: false }, sel: null }));
    scrollToItem('page', id);
  };

  const onDeletePage = (pid: string) => {
    setMenu(null);
    const r = deletePage(d, pid);
    if (!r) return;
    m.draft.edit(() => r.def);
    setState((s) => ({ ...s, undo: r.undo, sel: null }));
  };

  const nq = d.fields.length;
  const showIssues = m.issues.E.length > 0 && m.draft.edited;

  return (
    <div className="ox-fm-build">
      <nav
        aria-label={F.builder.outlineAria}
        className="ox-fm-outline"
        data-sticky={width >= STICKY ? '' : undefined}
      >
        <div className="ox-fm-outline-head">
          <strong>{F.builder.outline}</strong>
          <span>{format(F.builder.count, { p: d.pages.length, n: nq })}</span>
          {!ro ? (
            <button
              type="button"
              className="ox-fm-icon-btn"
              data-size="30"
              aria-label={F.builder.addPage}
              onClick={onAddPage}
            >
              <Glyph name="add" size={20} />
            </button>
          ) : null}
        </div>
        {d.pages.map((p, pi) => {
          const closed = !!state.coll[p.id];
          return (
            <div key={p.id} className="ox-fm-outline-page">
              <div className="ox-fm-outline-row">
                <button
                  type="button"
                  className="ox-fm-outline-chev"
                  aria-label={F.builder.toggle}
                  onClick={() => setState((s) => ({ ...s, coll: { ...s.coll, [p.id]: !closed } }))}
                >
                  <Glyph name={closed ? 'chevron_right' : 'expand_more'} size={18} />
                </button>
                <button
                  type="button"
                  className="ox-fm-outline-title"
                  onClick={() => {
                    setState((s) => ({ ...s, coll: { ...s.coll, [p.id]: false } }));
                    scrollToItem('page', p.id);
                  }}
                >
                  {p.title || pageTitle(pi + 1)}
                </button>
              </div>
              {!closed
                ? d.fields
                    .filter((x) => x.pageId === p.id)
                    .map((x) => {
                      const t = typeInfo(x.type);
                      return (
                        <button
                          key={x.key}
                          type="button"
                          className="ox-fm-outline-q"
                          data-sel={x.key === sel ? '' : undefined}
                          onClick={() => {
                            setState((s) => ({
                              ...s,
                              sel: x.key,
                              pick: null,
                              coll: { ...s.coll, [p.id]: false },
                            }));
                            scrollToItem('q', x.key);
                          }}
                        >
                          <Glyph name={t.icon} size={16} />
                          <span className="ox-fm-outline-label">{x.label.trim() || t.label}</span>
                          {x.hidden ? (
                            <Glyph
                              name="visibility_off"
                              size={15}
                              label={F.builder.hidden}
                              className="ox-fm-outline-hidden"
                            />
                          ) : null}
                        </button>
                      );
                    })
                : null}
            </div>
          );
        })}
      </nav>
      <div className="ox-fm-build-main">
        {showIssues ? (
          <div role="status" className="ox-fm-issues">
            <strong>{F.builder.issues}</strong>
            {m.issues.E.slice(0, 6).map((e, i) => (
              <span key={i}>· {e}</span>
            ))}
          </div>
        ) : null}
        {state.undo ? (
          <div className="ox-fm-undo">
            <span className="ox-fm-undo-text">{state.undo.text}</span>
            <button
              type="button"
              className="ox-fm-undo-btn"
              onClick={() => {
                const u = state.undo;
                if (!u) return;
                m.draft.edit((dd) => restore(dd, u));
                setState((s) => ({ ...s, undo: null }));
              }}
            >
              <Glyph name="restore" size={18} />
              {F.builder.restore}
            </button>
            <button
              type="button"
              className="ox-fm-icon-btn"
              data-size="32"
              aria-label={F.builder.hide}
              onClick={() => setState((s) => ({ ...s, undo: null }))}
            >
              <Glyph name="close" size={18} />
            </button>
          </div>
        ) : null}
        {d.pages.map((p, pi) => {
          const qs = d.fields.filter((x) => x.pageId === p.id);
          const open = !state.coll[p.id];
          const mk = `page:${p.id}`;
          const of = format(F.builder.page.of, { i: pi + 1, n: d.pages.length });
          const pickHere = (after: string | null) => pk && pk.page === p.id && pk.after === after;
          return (
            <section key={p.id} data-page={p.id} aria-label={of} className="ox-fm-page">
              <div className="ox-fm-page-head">
                <input
                  className="ox-fm-page-title"
                  value={p.title}
                  maxLength={200}
                  disabled={ro}
                  aria-label={F.builder.page.titleAria}
                  onChange={(e) => {
                    const title = e.target.value;
                    m.draft.edit((dd) => ({
                      ...dd,
                      pages: dd.pages.map((z) => (z.id === p.id ? { ...z, title } : z)),
                    }));
                  }}
                />
                <span className="ox-fm-page-of">{of}</span>
                {p.shuffle ? (
                  <Glyph
                    name="shuffle"
                    size={18}
                    label={F.builder.page.shuffled}
                    className="ox-fm-page-shuffled"
                  />
                ) : null}
                {!ro ? (
                  <>
                    <button
                      type="button"
                      className="ox-fm-icon-btn"
                      data-size="32"
                      disabled={pi === 0}
                      aria-label={F.builder.page.up}
                      onClick={() => {
                        setMenu(null);
                        m.draft.edit((dd) => movePage(dd, p.id, -1));
                      }}
                    >
                      <Glyph name="arrow_upward" size={18} />
                    </button>
                    <button
                      type="button"
                      className="ox-fm-icon-btn"
                      data-size="32"
                      disabled={pi === d.pages.length - 1}
                      aria-label={F.builder.page.down}
                      onClick={() => {
                        setMenu(null);
                        m.draft.edit((dd) => movePage(dd, p.id, 1));
                      }}
                    >
                      <Glyph name="arrow_downward" size={18} />
                    </button>
                    <div className="ox-fm-anchor">
                      <button
                        type="button"
                        className="ox-fm-icon-btn"
                        data-size="32"
                        aria-label={F.builder.page.menu}
                        aria-expanded={menu === mk}
                        onClick={() => setMenu(menu === mk ? null : mk)}
                      >
                        <Glyph name="more_horiz" size={18} />
                      </button>
                      {menu === mk ? (
                        <Menu
                          className="ox-fm-menu-page"
                          onClose={() => setMenu(null)}
                          items={[
                            {
                              label: p.shuffle ? F.builder.page.noShuffle : F.builder.page.shuffle,
                              icon: 'shuffle',
                              onClick: () => {
                                m.draft.edit((dd) => ({
                                  ...dd,
                                  pages: dd.pages.map((z) => {
                                    if (z.id !== p.id) return z;
                                    if (!z.shuffle) return { ...z, shuffle: true };
                                    return { id: z.id, title: z.title };
                                  }),
                                }));
                                setMenu(null);
                              },
                            },
                            {
                              label: F.builder.page.remove,
                              icon: 'delete',
                              danger: true,
                              disabled: d.pages.length < 2,
                              onClick: () => onDeletePage(p.id),
                            },
                          ]}
                        />
                      ) : null}
                    </div>
                  </>
                ) : null}
                <button
                  type="button"
                  className="ox-fm-icon-btn"
                  data-size="32"
                  aria-label={F.builder.toggle}
                  onClick={() => setState((s) => ({ ...s, coll: { ...s.coll, [p.id]: open } }))}
                >
                  <Glyph name={open ? 'expand_less' : 'expand_more'} size={20} />
                </button>
              </div>
              {open ? (
                <>
                  {qs.map((x) => {
                    const t = typeInfo(x.type);
                    const active = x.key === sel;
                    const lb = x.label.trim();
                    const fl = flagOf(x, m.prev, published);
                    return (
                      <div key={x.key} className="ox-fm-q-wrap">
                        <div data-q={x.key} className="ox-fm-q" data-open={active ? '' : undefined}>
                          {active ? (
                            <QuestionEditor m={m} x={x} state={state} setState={setState} />
                          ) : (
                            <button
                              type="button"
                              className="ox-fm-q-row"
                              onClick={() => {
                                setMenu(null);
                                setState((s) => ({ ...s, sel: x.key, pick: null, idTxt: null }));
                              }}
                            >
                              <span
                                className="ox-fm-q-icon"
                                aria-hidden="true"
                                style={{ background: t.bg, color: t.fg }}
                              >
                                <Glyph name={t.icon} size={18} />
                              </span>
                              <span className="ox-fm-q-text">
                                <span className="ox-fm-q-label" data-empty={lb ? undefined : ''}>
                                  {lb ||
                                    (x.type === 'statement' ? F.types.statement : F.builder.noText)}
                                  {x.required && x.type !== 'statement' ? (
                                    <span className="ox-fm-req"> *</span>
                                  ) : null}
                                </span>
                                <span className="ox-fm-q-meta">{qmeta(x, d)}</span>
                              </span>
                              {x.hidden ? (
                                <span className="ox-fm-q-hidden">
                                  <Glyph name="visibility_off" size={14} />
                                  {F.builder.hidden}
                                </span>
                              ) : null}
                              {fl ? (
                                <span className="ox-fm-q-flag" data-tone={fl.tone}>
                                  {fl.label}
                                </span>
                              ) : null}
                            </button>
                          )}
                        </div>
                        {pickHere(x.key) ? (
                          <Picker pick={pk as Pick} setState={setState} add={addQuestion} />
                        ) : null}
                      </div>
                    );
                  })}
                  {pickHere(null) ? (
                    <Picker pick={pk as Pick} setState={setState} add={addQuestion} />
                  ) : null}
                  {!qs.length ? (
                    <div className="ox-fm-page-empty">{F.builder.page.empty}</div>
                  ) : null}
                  {!ro ? (
                    <button
                      type="button"
                      className="ox-fm-add-q"
                      onClick={() => {
                        setMenu(null);
                        const after =
                          sel && qs.some((x) => x.key === sel)
                            ? sel
                            : qs.length
                              ? (qs.at(-1)?.key ?? null)
                              : null;
                        setState((s) => ({ ...s, pick: { page: p.id, after, all: false } }));
                      }}
                    >
                      <Glyph name="add" size={18} />
                      {F.builder.addQuestion}
                    </button>
                  ) : null}
                </>
              ) : null}
            </section>
          );
        })}
        {!ro ? (
          <div className="ox-fm-add-page-row">
            <button type="button" className="ox-fm-btn" onClick={onAddPage}>
              <Glyph name="post_add" size={18} />
              {F.builder.addPage}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** «Выберите вопрос» (dc:269–276, pkv dc:834–835): частые или все четыре группы с причинами недоступных. */
function Picker({
  pick,
  setState,
  add,
}: {
  pick: Pick;
  setState: SetBuilder;
  add: (t: QType) => void;
}): ReactElement {
  const item = (k: QType | 'series' | 'payment', all: boolean) => {
    const t = typeInfo(k);
    const off = isOff(k);
    return (
      <button
        key={k}
        type="button"
        className="ox-fm-pick-item"
        data-all={all ? '' : undefined}
        disabled={off}
        title={t.why}
        onClick={() => add(k as QType)}
      >
        <span
          className="ox-fm-pick-icon"
          aria-hidden="true"
          style={{ background: t.bg, color: t.fg }}
        >
          <Glyph name={t.icon} size={17} />
        </span>
        {all ? (
          <span className="ox-fm-pick-text">
            <span>{t.label}</span>
            {off ? <span className="ox-fm-pick-why">{t.why}</span> : null}
          </span>
        ) : (
          t.label
        )}
      </button>
    );
  };
  return (
    <div className="ox-fm-pick">
      <div className="ox-fm-pick-head">
        <strong>{F.builder.pick.title}</strong>
        <button
          type="button"
          className="ox-fm-icon-btn"
          data-size="32"
          aria-label={F.builder.pick.close}
          onClick={() => setState((s) => ({ ...s, pick: null }))}
        >
          <Glyph name="close" size={18} />
        </button>
      </div>
      {pick.all ? (
        <div className="ox-fm-pick-groups">
          {GROUPS.map((g) => (
            <div key={g} className="ox-fm-pick-group">
              <span className="ox-fm-pick-gtitle">{F.typeGroups[g]}</span>
              {TYPE_KEYS.filter((k) => typeInfo(k).group === g).map((k) => item(k, true))}
            </div>
          ))}
        </div>
      ) : (
        <div className="ox-fm-pick-common">{COMMON.map((k) => item(k, false))}</div>
      )}
      <button
        type="button"
        className="ox-fm-pick-toggle"
        onClick={() =>
          setState((s) => ({ ...s, pick: s.pick ? { ...s.pick, all: !s.pick.all } : s.pick }))
        }
      >
        {pick.all ? F.builder.pick.hideAll : F.builder.pick.showAll}
      </button>
    </div>
  );
}
