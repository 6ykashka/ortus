// W4.61 · «Тарифная сетка» оператора (pg.plans «Ортус CRM.dc.html» :1161–1252, plansVM :3853–3914;
// design-2026-10-19): действующая версия, баннер запланированной с «Отменить версию», черновик новой версии
// (названия, места, цены, скидки за срок, безлимит, добавление и удаление тарифов, проверки), публикация с даты,
// история версий и правила. Данные — listPriceBookVersions, команды — publish/cancelPriceBookVersion (W4.07).
import '../kit/kit.css';
import './plans.css';

import { type components, type ProblemError } from '@ortus/api-client';
import { errors, format, platform, screenLabels, toast as TOAST } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { type ReactElement, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useCommand, violation } from '../kit/api.ts';
import { useConfirm } from '../kit/confirm.tsx';
import { AreaSkeleton, isForbidden, Notice, PageHead, RetryAlert, StatusChip } from '../kit/ui.tsx';
import { cancelVersion, publishVersion, useVersions } from './api.ts';
import {
  addTier,
  cancelSpec,
  type Draft,
  draftFrom,
  fromOptions,
  heads,
  historyRows,
  nextVersion,
  publishBody,
  publishSpec,
  removeTier,
  scheduledText,
  setUnlimited,
  tierRows,
  validateDraft,
  versionHead,
} from './model.ts';
import { PLANS_TEXT as T } from './texts.ts';

type Version = components['schemas']['PriceBookVersion'];

const P = platform.plans;

/** Отказы публикации: 409 — текст сервера («Уже запланирована версия vN…»), 422 — первое нарушение. */
const PUBLISH_ERRORS = {
  invalid_transition: (e: ProblemError) => e.problem?.detail,
  validation_failed: (e: ProblemError) => violation(e) ?? e.problem?.detail,
};
const CANCEL_ERRORS = { invalid_transition: errors.mock.platform.noScheduled };

function Grid({ versions }: { versions: readonly Version[] }): ReactElement {
  const api = useApi();
  const command = useCommand();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  // Даты начала новой версии — от момента открытия страницы (первые числа следующих месяцев).
  const [now] = useState(() => Date.now());
  const live = versions.filter((v) => v.state !== 'cancelled');
  const cur = live.find((v) => v.state === 'current') ?? live[0];
  const scheduled = live.find((v) => v.state === 'scheduled');
  if (!cur) return <Notice>{T.loadError}</Notice>;
  const next = nextVersion(versions);
  const head = versionHead(cur);
  const froms = fromOptions(now);
  const editing = draft !== null;
  const src = draft ?? draftFrom(cur, froms[0]?.value ?? '');
  const rows = tierRows(src);
  const termHeads = heads(
    src.terms.map((t) => ({ months: t.months, discountPercent: Number(t.off) || 0 })),
  );
  const errs = draft ? validateDraft(draft) : [];
  const canPrepare = !draft && !scheduled;
  const edit = (fn: (d: Draft) => Draft) => setDraft((d) => (d ? fn(d) : d));
  const setTier = (i: number, p: Partial<Draft['tiers'][number]>) =>
    edit((d) => ({ ...d, tiers: d.tiers.map((t, k) => (k === i ? { ...t, ...p } : t)) }));

  const publish = () => {
    if (!draft) return;
    confirm.ask(publishSpec(next, cur.version, draft.from), () =>
      command('publish', () => publishVersion(api, publishBody(draft)), TOAST.platform.done, {
        texts: PUBLISH_ERRORS,
      }).then(() => setDraft(null)),
    );
  };
  const cancelScheduled = (s: Version) =>
    confirm.ask(cancelSpec(s.version, cur.version), () =>
      command('cancelVersion', () => cancelVersion(api, s.version), TOAST.platform.done, {
        texts: CANCEL_ERRORS,
      }),
    );

  return (
    <>
      {scheduled ? (
        <div role="status" className="ox-pb-scheduled">
          <Icon name="event" size={20} />
          <span>{scheduledText(scheduled, cur)}</span>
          <button
            type="button"
            className="ox-pb-scheduled-cancel ox-pk-hit"
            onClick={() => cancelScheduled(scheduled)}
          >
            {P.cancelVersion}
          </button>
        </div>
      ) : null}
      <div className="ox-pk-card ox-pb-grid">
        <div className="ox-pb-grid-head">
          <div className="ox-pb-grid-title">
            <span className="ox-pb-ver">
              {head.title} <span>{head.from}</span>
            </span>
            <span className="ox-pb-note">{head.note}</span>
          </div>
          {canPrepare ? (
            <button
              type="button"
              className="ox-pk-btn"
              onClick={() => setDraft(draftFrom(cur, froms[0]?.value ?? ''))}
            >
              <Icon name="edit" size={18} />
              {format(P.prepareVersion, { version: `v${next}` })}
            </button>
          ) : null}
          {editing ? (
            <span className="ox-chip" data-tone="warn">
              <Icon name="edit_note" size={15} />
              <span className="ox-chip-label">{format(T.draftChip, { v: next })}</span>
            </span>
          ) : null}
        </div>
        {/* Прокрутка таблицы на узком экране — с клавиатуры (axe scrollable-region-focusable; PD-29). */}
        <div className="ox-pb-table-wrap" tabIndex={0}>
          <table className="ox-pb-table">
            <thead>
              <tr>
                <th scope="col">{T.cols.tier}</th>
                <th scope="col">{T.cols.month}</th>
                {termHeads.map((h, j) => (
                  <th key={h.months} scope="col" className="ox-pb-term">
                    <span className="ox-pb-term-head">
                      <span className="ox-pb-term-label">{h.label}</span>
                      {editing ? (
                        <label className="ox-pb-off">
                          {T.offLabel}
                          <input
                            inputMode="numeric"
                            value={src.terms[j]?.off ?? ''}
                            aria-label={format(T.offAria, { label: h.label })}
                            onChange={(e) => {
                              const v = e.target.value;
                              edit((d) => ({
                                ...d,
                                terms: d.terms.map((t, k) => (k === j ? { ...t, off: v } : t)),
                              }));
                            }}
                          />
                          %
                        </label>
                      ) : (
                        <span>{h.offLabel}</span>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const t = src.tiers[i];
                const last = i === rows.length - 1;
                return (
                  <tr key={`${t?.code ?? 'new'}-${i}`}>
                    <td>
                      {editing ? (
                        <div className="ox-pb-edit">
                          <input
                            className="ox-pb-name"
                            value={r.name}
                            aria-label={T.nameAria}
                            placeholder={T.namePlaceholder}
                            onChange={(e) => setTier(i, { name: e.target.value })}
                          />
                          {!r.custom ? (
                            <label className="ox-pb-seats">
                              {T.seatsUpTo}
                              <input
                                inputMode="numeric"
                                value={t?.seats ?? ''}
                                aria-label={format(T.seatsAria, { name: r.name })}
                                onChange={(e) =>
                                  setTier(i, { seats: e.target.value.replace(/\D/g, '') })
                                }
                              />
                              {T.seatsUnit}
                            </label>
                          ) : null}
                          {r.custom ? <span className="ox-pb-hint">{T.unlimitedHint}</span> : null}
                          <div className="ox-pb-row-actions">
                            {last ? (
                              <label className="ox-pb-unl ox-pk-hit">
                                <input
                                  type="checkbox"
                                  checked={r.custom}
                                  onChange={(e) =>
                                    edit((d) => setUnlimited(d, i, e.target.checked))
                                  }
                                />
                                {T.unlimited}
                              </label>
                            ) : null}
                            {src.tiers.length > 1 ? (
                              <button
                                type="button"
                                className="ox-pb-remove ox-pk-hit"
                                aria-label={format(T.removeAria, { name: r.name })}
                                onClick={() => edit((d) => removeTier(d, i))}
                              >
                                <Icon name="delete" size={16} />
                                {T.remove}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <span className="ox-pb-tier">
                          <strong>{r.name}</strong>
                          <span>{r.seats}</span>
                        </span>
                      )}
                    </td>
                    <td>
                      {r.custom ? <span className="ox-pb-individual">{T.individual}</span> : null}
                      {!r.custom && editing ? (
                        <label className="ox-pb-price">
                          <input
                            inputMode="numeric"
                            value={t?.month ?? ''}
                            aria-label={format(T.priceAria, { name: r.name })}
                            onChange={(e) => setTier(i, { month: e.target.value })}
                          />
                          {T.rub}
                        </label>
                      ) : null}
                      {!r.custom && !editing ? (
                        <span className="ox-pb-month">{r.month}</span>
                      ) : null}
                    </td>
                    {r.cells.map((c, k) => (
                      <td key={k}>
                        <span className="ox-pb-cell">
                          <span className="ox-pb-cell-main">{c.main}</span>
                          <span className="ox-pb-cell-sub">{c.sub}</span>
                        </span>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {draft ? (
          <div className="ox-pb-tools">
            <button
              type="button"
              className="ox-pb-add ox-pk-hit"
              onClick={() => edit((d) => addTier(d))}
            >
              <Icon name="add" size={18} />
              {T.addTier}
            </button>
            <span className="ox-pb-tools-hint">{T.draftHint}</span>
            {errs.length > 0 ? (
              <div role="alert" className="ox-pb-errors">
                <strong>{T.errorsTitle}</strong>
                {errs.map((e) => (
                  <span key={e}>{format(T.errorItem, { text: e })}</span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {draft ? (
          <div className="ox-pb-foot">
            <label className="ox-pk-label ox-pb-from">
              {T.startsLabel}
              <select
                className="ox-pk-input"
                value={draft.from}
                onChange={(e) => {
                  const v = e.target.value;
                  edit((d) => ({ ...d, from: v }));
                }}
              >
                {froms.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ox-pk-label ox-pb-what">
              {T.noteLabel}
              <input
                className="ox-pk-input"
                value={draft.note}
                placeholder={T.notePlaceholder}
                onChange={(e) => {
                  const v = e.target.value;
                  edit((d) => ({ ...d, note: v }));
                }}
              />
            </label>
            <div className="ox-pb-foot-buttons">
              <button type="button" className="ox-pk-btn" onClick={() => setDraft(null)}>
                {T.cancelDraft}
              </button>
              <button
                type="button"
                className="ox-pk-btn"
                data-variant="primary"
                disabled={errs.length > 0}
                onClick={publish}
              >
                <Icon name="publish" size={18} />
                {format(T.publish, { v: next })}
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="ox-pb-bottom">
        <div className="ox-pk-card ox-pb-side ox-pb-history">
          <h2>{T.history}</h2>
          {historyRows(versions).map((v) => (
            <div key={v.v} className="ox-pb-version">
              <span className="ox-pb-version-n">{v.v}</span> <StatusChip chip={v.chip} />{' '}
              <span className="ox-pb-version-period">{v.period}</span>{' '}
              <span className="ox-pb-version-line">{v.line}</span>
            </div>
          ))}
        </div>
        <div className="ox-pk-card ox-pb-side ox-pb-rules">
          <h2>{T.rulesTitle}</h2>
          <ul>
            {T.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      </div>
      {confirm.node}
    </>
  );
}

export default function PlansPage(): ReactElement {
  const q = useVersions();
  let content: ReactElement;
  if (q.data) content = <Grid versions={q.data} />;
  else if (q.isError && isForbidden(q.error)) content = <Notice>{T.forbidden}</Notice>;
  else if (q.isError)
    content = <RetryAlert text={T.loadError} error={q.error} onRetry={() => void q.refetch()} />;
  else content = <AreaSkeleton />;
  return (
    <section
      className="ox-pk ox-pb"
      aria-labelledby="h-pb"
      data-screen-label={screenLabels.byPage.plans}
    >
      <PageHead id="h-pb" crumb={platform.crumb} title={T.title} intro={P.intro} />
      <div className="ox-pb-demo">
        <Icon name="info" size={20} />
        <span>{P.demoNote}</span>
      </div>
      {content}
    </section>
  );
}
