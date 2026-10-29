// W6.22 · Вкладка «Шаблоны» (эталон :621–687): список шаблонов, карточка выбранного (метка, название, «Вид ремонта…»,
// происхождение, «Сделать копию»), «Смета и формулы объёмов» с правкой («Изменить смету шаблона» → «Готово»),
// «Технология графика», «Комплект документов», «Материалы для снабжения», «Чек-лист приёмки».
import type { components } from '@ortus/api-client';
import { format } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { useState, type Dispatch, type ReactElement, type SetStateAction } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useBusy, useRun } from '../../../shell/run.tsx';
import { rubText, unitRu } from '../supply/model.ts';
import { Chip } from '../supply/ui.tsx';
import { copyTemplate, saveTemplateLines } from './api.ts';
import {
  copyNote,
  documentLabels,
  type DraftLine,
  draftOf,
  FORMULA_LIST,
  type Formula,
  formulaLabel,
  linesOf,
  matRows,
  pickList,
  ruleText,
  srcChip,
  stageRows,
  tplFrom,
  tplMetaLine,
  tplMeta,
  updatedText,
} from './model.ts';
import { CATALOG_TEXT as T } from './texts.ts';

type S = components['schemas'];

interface Row {
  key: string;
  line: S['TemplateLine'];
  draft?: DraftLine;
}

const sectionsOf = (rows: readonly Row[]): { section: string; rows: Row[] }[] =>
  [...new Set(rows.map((r) => r.line.section))].map((section) => ({
    section,
    rows: rows.filter((r) => r.line.section === section),
  }));

/** Выбранный шаблон и черновик правки живут выше панели: при смене вкладки не сбрасываются. */
export interface TemplatesView {
  selId: string | null;
  setSelId: Dispatch<SetStateAction<string | null>>;
  draft: DraftLine[] | null;
  setDraft: Dispatch<SetStateAction<DraftLine[] | null>>;
}

export function TemplatesPanel(p: {
  view: TemplatesView;
  tenantId: string;
  templates: readonly S['Template'][];
  prices: readonly S['PriceItem'][];
  projects: readonly { id: string; name: string }[];
  locked: boolean;
  onNote: (text: string) => void;
  onChanged: () => Promise<void>;
}): ReactElement {
  const api = useApi();
  const run = useRun();
  const { selId, setSelId, draft, setDraft } = p.view;
  const [pick, setPick] = useState<{ section: string; q: string } | null>(null);
  const t = p.templates.find((x) => x.id === selId) ?? p.templates[0];
  const saving = useBusy('catalog:template');
  if (!t) return <div className="ox-rps-empty">{T.templates.empty}</div>;

  const editing = draft !== null;
  const select = (id: string): void => {
    setSelId(id);
    setDraft(null);
    setPick(null);
  };

  const copy = async (): Promise<void> => {
    try {
      const made = await run('catalog:template', () => copyTemplate(api, p.tenantId, t));
      await p.onChanged();
      setSelId(made.id);
      setDraft(draftOf(made));
      setPick(null);
      p.onNote(copyNote(t.name));
    } catch {
      // Ошибку показал `run`.
    }
  };

  const finish = async (): Promise<void> => {
    if (!draft) return;
    const lines = linesOf(draft);
    if (JSON.stringify(lines) === JSON.stringify(linesOf(draftOf(t)))) {
      setDraft(null);
      setPick(null);
      return;
    }
    try {
      await run('catalog:template', () => saveTemplateLines(api, p.tenantId, t, lines));
      await p.onChanged();
      setDraft(null);
      setPick(null);
    } catch {
      // Ошибку показал `run`; правка остаётся открытой.
    }
  };

  const patch = (key: string, change: Partial<DraftLine>): void =>
    setDraft((d) => (d ? d.map((x) => (x.key === key ? { ...x, ...change } : x)) : d));

  const rows: Row[] = draft
    ? draft.map((d) => ({
        key: d.key,
        draft: d,
        line: { priceItemId: d.priceItemId, section: d.section },
      }))
    : t.lines.map((l, i) => ({ key: `${i}:${l.priceItemId}`, line: l }));
  const itemOf = (id: string): S['PriceItem'] | undefined => p.prices.find((x) => x.id === id);
  const chip = srcChip(t);

  return (
    <div className="ox-rc-split">
      <div className="ox-rc-list">
        {p.templates.map((x) => (
          <button
            key={x.id}
            type="button"
            className="ox-rc-tpl"
            aria-pressed={x.id === t.id ? 'true' : 'false'}
            onClick={() => select(x.id)}
          >
            <strong className="ox-rc-tpl-name">{x.name}</strong>
            <Chip chip={srcChip(x)} />
            <span className="ox-rps-sub">{tplMetaLine(x)}</span>
          </button>
        ))}
      </div>
      <div className="ox-rc-detail">
        <div className="ox-rps-card ox-rc-head">
          <div className="ox-rc-head-body">
            <Chip chip={chip} />
            <h2 className="ox-rps-h2">{t.name}</h2>
            <span className="ox-rps-sub ox-rc-meta">
              {format(T.templates.meta, {
                kind: t.kind,
                updated: updatedText(t),
                used: String(t.usedByObjects),
              })}
            </span>
            <span className="ox-rc-from">{tplFrom(t, p.templates, p.projects)}</span>
          </div>
          <button
            type="button"
            className="ox-rps-btn"
            data-size="lg"
            disabled={p.locked || saving}
            onClick={() => void copy()}
          >
            <Icon name="content_copy" size={18} />
            {T.templates.copy}
          </button>
        </div>

        <div className="ox-rps-card">
          <div className="ox-rps-card-head">
            <div className="ox-rps-row-body">
              <h3 className="ox-rps-h3">{T.templates.estimate}</h3>
              <span className="ox-rps-sub">{tplMeta(t)}</span>
            </div>
            <button
              type="button"
              className="ox-rps-btn"
              data-variant="accent"
              data-size="lg"
              disabled={p.locked || saving}
              onClick={() => (editing ? void finish() : setDraft(draftOf(t)))}
            >
              <Icon name={editing ? 'done' : 'edit'} size={18} />
              {editing ? T.templates.done : T.templates.edit}
            </button>
          </div>
          <div className="ox-rps-scroll" tabIndex={0}>
            <table className="ox-rps-table ox-rps-w640">
              <thead>
                <tr>
                  <th scope="col">{T.templates.cols.item}</th>
                  <th scope="col">{T.templates.cols.volume}</th>
                  <th scope="col" className="ox-rps-r">
                    {T.templates.cols.price}
                  </th>
                  {editing ? (
                    <th scope="col" className="ox-rc-th-x">
                      <span className="ox-rps-sr">{T.templates.cols.remove}</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {sectionsOf(rows).flatMap((g) => {
                  const picking = editing && pick?.section === g.section;
                  const found = picking ? pickList(p.prices, pick.q, g.section) : [];
                  return [
                    <tr key={`h:${g.section}`} className="ox-rc-sec">
                      <td colSpan={editing ? 4 : 3}>
                        <span className="ox-rc-sec-line">
                          <strong>{g.section}</strong>
                          {editing ? (
                            <button
                              type="button"
                              className="ox-rc-add"
                              aria-expanded={picking ? 'true' : 'false'}
                              onClick={() =>
                                setPick(picking ? null : { section: g.section, q: '' })
                              }
                            >
                              <Icon name="add" size={16} />
                              {T.templates.addLine}
                            </button>
                          ) : null}
                        </span>
                      </td>
                    </tr>,
                    ...(picking
                      ? [
                          <tr key={`p:${g.section}`} className="ox-rc-pick">
                            <td colSpan={4}>
                              <div className="ox-rc-pick-box">
                                <input
                                  type="search"
                                  className="ox-rps-input ox-rc-pick-q"
                                  value={pick.q}
                                  placeholder={T.templates.pickSearch}
                                  aria-label={T.templates.pickAria}
                                  onChange={(e) =>
                                    setPick({ section: g.section, q: e.target.value })
                                  }
                                />
                                <div className="ox-rc-pick-list">
                                  {found.map((f) => (
                                    <button
                                      key={f.id}
                                      type="button"
                                      className="ox-rc-pick-item"
                                      onClick={() => {
                                        setDraft((d) => [
                                          ...(d ?? []),
                                          {
                                            key: `new:${f.id}:${(d ?? []).length}`,
                                            priceItemId: f.id,
                                            section: g.section,
                                            formula: '',
                                            coefIn: '1',
                                            qtyIn: '1',
                                          },
                                        ]);
                                        setPick(null);
                                      }}
                                    >
                                      <span className="ox-rc-pick-name">{f.name}</span>
                                      <span className="ox-rps-sub">{f.meta}</span>
                                    </button>
                                  ))}
                                  {found.length === 0 ? (
                                    <span className="ox-rps-sub">{T.templates.pickEmpty}</span>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                          </tr>,
                        ]
                      : []),
                    ...g.rows.map((r) => {
                      const item = itemOf(r.line.priceItemId);
                      const name = item?.name ?? r.line.priceItemId;
                      const unit = item ? unitRu(item.unit) : '';
                      const d = r.draft;
                      const rule = ruleText(r.line, p.prices);
                      return (
                        <tr key={r.key}>
                          <td>
                            <span className="ox-rps-cell">
                              <span>{name}</span>
                              <span className="ox-rps-sub">{unit}</span>
                            </span>
                          </td>
                          <td>
                            {d ? (
                              <span className="ox-rc-how">
                                <select
                                  className="ox-rps-select ox-rc-how-sel"
                                  data-sm=""
                                  value={d.formula}
                                  aria-label={format(T.templates.howAria, { name })}
                                  onChange={(e) =>
                                    patch(r.key, { formula: e.target.value as Formula | '' })
                                  }
                                >
                                  <option value="">{T.templates.fixed}</option>
                                  {FORMULA_LIST.map((f) => (
                                    <option key={f} value={f}>
                                      {format(T.templates.fromMeasure, {
                                        formula: formulaLabel(f),
                                      })}
                                    </option>
                                  ))}
                                </select>
                                {d.formula ? (
                                  <label className="ox-rc-coef">
                                    ×
                                    <input
                                      className="ox-rps-input ox-rc-num"
                                      data-num=""
                                      data-sm=""
                                      inputMode="decimal"
                                      value={d.coefIn}
                                      aria-label={format(T.templates.coefAria, { name })}
                                      onChange={(e) => patch(r.key, { coefIn: e.target.value })}
                                    />
                                  </label>
                                ) : (
                                  <>
                                    <input
                                      className="ox-rps-input ox-rc-num ox-rc-num-q"
                                      data-num=""
                                      data-sm=""
                                      inputMode="decimal"
                                      value={d.qtyIn}
                                      aria-label={format(T.templates.qtyAria, { name })}
                                      onChange={(e) => patch(r.key, { qtyIn: e.target.value })}
                                    />
                                    <span className="ox-rps-sub">{unit}</span>
                                  </>
                                )}
                              </span>
                            ) : (
                              <span
                                className="ox-rc-rule"
                                data-kind={rule.formula ? 'formula' : 'fixed'}
                              >
                                <Icon name={rule.formula ? 'straighten' : 'pin'} size={16} />
                                {rule.text}
                              </span>
                            )}
                          </td>
                          <td className="ox-rps-r">
                            {item ? rubText(item.price.amountMinor) : '—'}
                          </td>
                          {editing ? (
                            <td className="ox-rc-td-x">
                              <button
                                type="button"
                                className="ox-rc-x"
                                aria-label={format(T.templates.removeAria, { name })}
                                onClick={() =>
                                  setDraft((cur) =>
                                    cur ? cur.filter((x) => x.key !== r.key) : cur,
                                  )
                                }
                              >
                                <Icon name="close" size={18} />
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    }),
                  ];
                })}
              </tbody>
            </table>
          </div>
          <div className="ox-rc-foot">{T.templates.footnote}</div>
        </div>

        <div className="ox-rc-grid">
          <div className="ox-rps-card ox-rc-box">
            <h3 className="ox-rps-h3">{T.templates.tech}</h3>
            <ol className="ox-rc-tech">
              {stageRows(t).map((s) => (
                <li key={s.n}>
                  <span className="ox-rc-n">{s.n}</span>
                  <span className="ox-rps-cell">
                    <span>
                      <strong className="ox-rps-cell-strong">{s.name}</strong>{' '}
                      <span className="ox-rps-muted">· {s.rate}</span>
                    </span>
                    {s.pause ? <span className="ox-rps-sub ox-rps-warn">{s.pause}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="ox-rc-col">
            <div className="ox-rps-card ox-rc-box">
              <h3 className="ox-rps-h3">{T.templates.docs}</h3>
              <ul className="ox-rc-ul">
                {documentLabels(t).map((d, i) => (
                  <li key={`${i}:${d}`}>
                    <Icon name="description" size={18} />
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="ox-rps-card ox-rc-box">
              <h3 className="ox-rps-h3">{T.templates.mats}</h3>
              <ul className="ox-rc-ul ox-rc-mats">
                {matRows(t, p.prices).map((m, i) => (
                  <li key={`${i}:${m.name}`}>
                    <span>{m.name}</span>
                    <span className="ox-rps-muted">{m.rule}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="ox-rps-card ox-rc-box">
            <h3 className="ox-rps-h3">{T.templates.check}</h3>
            <ul className="ox-rc-ul">
              {t.checklist.map((c, i) => (
                <li key={`${i}:${c}`}>
                  <Icon name="check_box" size={18} />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
