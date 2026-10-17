// W1.24 · Страница «Хранилище» (`company-storage`, S1-22; no-reference B-6 №5, design-requests.md: занято,
// резерв, разбивка по модулям, запрос смены квоты). Разметка — карточки «Место организации» эталона (:258–279):
// занято / лимит / резерв (getStorageUsage), разбивка по группам эталона и модулям (getStorageBreakdown),
// расчёт смены лимита с ценой и подтверждение (requestStorageChange quote → commit, Q-W1.24-3).
//
// Фокус после команд (кнопка недоступна на время команды, и браузер переводит фокус на body): расчёт готов —
// на блок расчёта; лимит применён — на «Новый лимит»; отказ — на кнопку, которая отправила команду.
import type { components } from '@ortus/api-client';
import { company } from '@ortus/texts';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useShell } from '../../../shell/context.tsx';
import { problemCode, problemText, useBusy, useRun } from '../../../shell/run.tsx';
import { useToast } from '../../../shell/toast.tsx';
import { afterQuota, commitStorage, quoteStorage, useBreakdown, useStorageUsage } from './api.ts';
import {
  type BreakdownRow,
  breakdownRows,
  changeDoneText,
  GiB,
  gbText,
  moduleRows,
  mskDate,
  mskTime,
  quoteLine,
  storageView,
} from './storage.ts';
import { MOD_TEXT, t } from './texts.ts';
import {
  CardAlert,
  LoadFailed,
  PageHead,
  PageSkeleton,
  SkeletonLines,
  UsageBar,
  useRetryFocus,
} from './ui.tsx';
import { isRestricted } from './vm.ts';
import './modules.css';

type S = components['schemas'];
type FocusTarget = 'select' | 'quote' | 'apply' | 'calc';
const ST = MOD_TEXT.storage;
const C = company.modules.storage;

/**
 * Блок разбивки; `rows = null` — разбивка грузится: заголовок на месте, строки пустые; `failed` — ошибка: под
 * заголовком блока alert и «Повторить» вместо строк.
 */
function Rows({
  title,
  rows,
  kind,
  titleId,
  failed,
}: {
  title: string;
  rows: BreakdownRow[] | null;
  kind: string;
  titleId?: string;
  failed?: ReactNode;
}) {
  return (
    <div className={`ox-mod-storage ox-st-${kind}`}>
      <h2 id={titleId} className="ox-mod-h2" tabIndex={titleId ? -1 : undefined}>
        {title}
      </h2>
      {failed ?? (
        <div className="ox-st-rows">
          {rows ? (
            rows.map((r) => (
              <div key={r.key} className="ox-st-row">
                <span className="ox-st-label">{r.label}</span>
                <span className="ox-st-files">{t(ST.files, { n: r.files })}</span>
                <span className="ox-st-gb">{r.gb}</span>
              </div>
            ))
          ) : (
            <SkeletonLines n={4} className="ox-st-row-skel" />
          )}
        </div>
      )}
    </div>
  );
}

/** Отказ «Применить», после которого расчёт недействителен: истёк или уже не найден (новый расчёт). */
const STALE_QUOTE = new Set(['invalid_transition', 'validation_failed']);

export default function StoragePage(): ReactElement {
  const { tenant, tenantId: id } = useShell();
  const tenantId = id ?? '';
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const toast = useToast();
  const quoting = useBusy('quote');
  const applying = useBusy('quota');
  const busy = quoting || applying;
  const usage = useStorageUsage(tenantId);
  const breakdown = useBreakdown(tenantId);
  const [pick, setPick] = useState<string | null>(null);
  const [quote, setQuote] = useState<S['StorageChange'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Куда вернуть фокус после команды; `focusTick` гарантирует рендер, после которого он ставится. */
  const focusTo = useRef<FocusTarget | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const selectRef = useRef<HTMLSelectElement>(null);
  const quoteRef = useRef<HTMLDivElement>(null);
  const applyRef = useRef<HTMLButtonElement>(null);
  const calcRef = useRef<HTMLButtonElement>(null);
  const restricted = isRestricted(tenant?.tenantState);
  const groupsId = useId();
  // «Повторить»: данные пришли — фокус на заголовке страницы (место) или блока разбивки, а не на body.
  const retryUsage = useRetryFocus(usage.isSuccess, () => document.getElementById('h-st'));
  const retryBreakdown = useRetryFocus(breakdown.isSuccess, () =>
    document.getElementById(groupsId),
  );

  const setFocusTo = (target: FocusTarget): void => {
    focusTo.current = target;
    setFocusTick((n) => n + 1);
  };

  // Фокус ставится, когда команда закончилась и кнопки снова доступны (блок расчёта уже на экране).
  useEffect(() => {
    const to = focusTo.current;
    if (!to || busy) return;
    const target = { select: selectRef, quote: quoteRef, apply: applyRef, calc: calcRef }[to];
    target.current?.focus();
    focusTo.current = null;
  }, [focusTick, busy, quote]);

  const head = (
    <PageHead
      id="h-st"
      crumb={t(company.crumbs.company, { tenant: tenant?.name ?? '' })}
      title={ST.title}
      intro={ST.intro}
    />
  );
  if (usage.isPending) {
    return (
      <section aria-labelledby="h-st" className="ox-mod ox-st">
        {head}
        <PageSkeleton />
      </section>
    );
  }
  if (usage.isError) {
    return (
      <section aria-labelledby="h-st" className="ox-mod ox-st">
        {head}
        <LoadFailed error={usage.error} onRetry={retryUsage(() => usage.refetch())} />
      </section>
    );
  }

  const u = usage.data;
  const v = storageView(u);
  const value = pick ?? String(v.quotaNum);

  const onQuote = async (): Promise<void> => {
    setError(null);
    setQuote(null);
    try {
      const q = await run('quote', () => quoteStorage(api, tenantId, Number(value) * GiB), null, {
        quiet: ['downgrade_below_usage'],
      });
      setQuote(q);
      setFocusTo('quote');
    } catch (e) {
      if (problemCode(e) === 'downgrade_below_usage') setError(problemText(e));
      setFocusTo('calc');
    }
  };

  const onApply = async (q: S['StorageChange']): Promise<void> => {
    try {
      // Тост — по состоянию смены: `scheduled` (уменьшение позже) не выдаётся за применённый лимит.
      const done = await run('quota', () => commitStorage(api, tenantId, q), null);
      toast(changeDoneText(done), 'ok');
      await afterQuota(qc, tenantId);
      setQuote(null);
      setPick(null);
      setFocusTo('select');
    } catch (e) {
      // Тост команды. Расчёт истёк или не найден — он убирается, фокус на «Рассчитать» для нового расчёта;
      // иначе (нет связи, сбой) расчёт остаётся на экране, фокус на «Применить».
      if (STALE_QUOTE.has(problemCode(e) ?? '')) {
        setQuote(null);
        setFocusTo('calc');
      } else {
        setFocusTo('apply');
      }
    }
  };

  return (
    <section aria-labelledby="h-st" className="ox-mod ox-st">
      {head}

      <div className="ox-mod-storage ox-st-usage">
        <div className="ox-mod-storage-top">
          <div>
            <h2 className="ox-mod-h2">{C.title}</h2>
            <span className="ox-mod-note">
              {t(ST.measured, { at: mskDate(Date.parse(u.measuredAt)) })}
            </span>
          </div>
          <div className="ox-mod-storage-num">
            {v.used} <span className="ox-mod-storage-of">{t(C.of, { quota: v.quota })}</span>
          </div>
        </div>
        <UsageBar
          pct={v.pct}
          tone={v.tone}
          meter={{ label: C.meter, now: v.usedNum, max: v.quotaNum }}
        />
        <div className="ox-st-facts">
          <span>{t(ST.reserved, { gb: v.reserved })}</span>
          {u.pendingQuotaBytes !== undefined && u.pendingEffectiveAt ? (
            <span>
              {t(ST.pending, {
                gb: gbText(u.pendingQuotaBytes),
                at: mskDate(Date.parse(u.pendingEffectiveAt)),
              })}
            </span>
          ) : null}
        </div>
        {v.over ? <CardAlert>{v.overText}</CardAlert> : null}
      </div>

      {breakdown.isError ? (
        // Ошибка: блок «По видам файлов» с заголовком на месте, alert и «Повторить» (описан заголовком) в нём.
        // «По модулям» — тот же запрос: второй alert с повтором не выводится.
        <div className="ox-st-grid">
          <Rows
            title={ST.groupsTitle}
            rows={null}
            kind="groups"
            titleId={groupsId}
            failed={
              <LoadFailed
                error={breakdown.error}
                onRetry={retryBreakdown(() => breakdown.refetch())}
                describedBy={groupsId}
              />
            }
          />
        </div>
      ) : (
        // Пока разбивка грузится, блоки на своём месте (aria-busy) и форма смены лимита не сдвигается.
        <div className="ox-st-grid" aria-busy={breakdown.data ? undefined : true}>
          <Rows
            title={ST.groupsTitle}
            rows={breakdown.data ? breakdownRows(breakdown.data) : null}
            kind="groups"
            titleId={groupsId}
          />
          <Rows
            title={ST.modulesTitle}
            rows={breakdown.data ? moduleRows(breakdown.data) : null}
            kind="modules"
          />
        </div>
      )}

      <div className="ox-mod-storage ox-st-change">
        <div>
          <h2 className="ox-mod-h2">{ST.changeTitle}</h2>
          <span className="ox-mod-note">{ST.changeNote}</span>
        </div>
        <div className="ox-mod-limit">
          <label className="ox-mod-field">
            {ST.newLimit}
            <select
              ref={selectRef}
              value={value}
              className="ox-mod-select"
              onChange={(e) => {
                setPick(e.target.value);
                setQuote(null);
                setError(null);
              }}
            >
              {v.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            ref={calcRef}
            type="button"
            className="ox-mod-btn"
            data-variant="primary"
            data-size="lg"
            disabled={busy || restricted || Number(value) === v.quotaNum}
            onClick={() => void onQuote()}
          >
            {ST.quote}
          </button>
        </div>
        {error ? (
          <p className="ox-st-error" role="alert">
            {error}
          </p>
        ) : null}
        {quote ? (
          <div ref={quoteRef} className="ox-st-quote" tabIndex={-1}>
            <strong className="ox-st-quote-line">{quoteLine(quote)}</strong>
            {quote.quoteExpiresAt ? (
              <span className="ox-mod-note">
                {t(ST.quoteUntil, { at: mskTime(Date.parse(quote.quoteExpiresAt)) })}
              </span>
            ) : null}
            <div className="ox-mod-actions">
              <button
                ref={applyRef}
                type="button"
                className="ox-mod-btn"
                data-variant="primary"
                data-size="lg"
                disabled={busy}
                onClick={() => void onApply(quote)}
              >
                {ST.apply}
              </button>
              <button
                type="button"
                className="ox-mod-btn"
                data-variant="secondary"
                data-size="lg"
                disabled={busy}
                onClick={() => {
                  setQuote(null);
                  setFocusTo('calc');
                }}
              >
                {ST.cancel}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
