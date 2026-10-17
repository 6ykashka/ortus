// W2.21 · Страница «Очередь блокирующих дефектов» (`logistics-defects`, S2-17; no-reference B-6 №7, design-requests
// «defect-queue», 14-stage2-dor.md §4: пусто, есть дефекты, решение принято, решён другим — 409). Вне меню (как
// «Хранилище»), вход — ссылка на «Приёмке смен». Карточка и команды — как карточка дефекта эталона (:592–602):
// «Дефект некритичный — разрешить выезд» / «Подтвердить неисправность» (decideInspectionDefect, If-Match,
// Idempotency-Key), комментарий решения — поле контракта `DefectDecision.comment`. Вкладка — `?tab=` (ADR-0001).
import type { components } from '@ortus/api-client';
import { format, logisticsManager, shell, toast as toastText } from '@ortus/texts';
import { Banner, Icon, Skeleton } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { type KeyboardEvent, type ReactElement, useId, useRef, useState } from 'react';

import { useApi } from '../../../../app/api.tsx';
import { useCan, useShell } from '../../../../shell/context.tsx';
import { problemCode, problemText, useBusy, useRun } from '../../../../shell/run.tsx';
import { useToast } from '../../../../shell/toast.tsx';
import { afterChange, decideDefect } from '../review/api.ts';
import { useCrumb } from '../review/crumb.ts';
import { ChipView } from '../review/chip.tsx';
import { useDefects } from './api.ts';
import { defectRow, partition } from './model.ts';
import { DEFECTS_TEXT as T } from './texts.ts';
import '../review/review.css';
import './defects.css';

type S = components['schemas'];
type Tab = 'review' | 'decided';
const TABS: readonly Tab[] = ['review', 'decided'];

const L = logisticsManager.review;

const detail = (e: unknown): string | undefined =>
  (e as { problem?: { detail?: string } }).problem?.detail ?? undefined;

function DefectCard(p: {
  tenantId: string;
  defect: S['InspectionDefect'];
  locked: boolean;
  onShift: (tripId: string) => void;
}): ReactElement {
  const { tenantId, defect } = p;
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const toast = useToast();
  const key = `defect:${defect.id}`;
  const busy = useBusy(key);
  const [comment, setComment] = useState('');
  const id = useId();
  const row = defectRow(defect);

  const decide = async (decision: S['DefectDecision']['decision']): Promise<void> => {
    try {
      await run(
        key,
        () =>
          decideDefect(api, tenantId, defect.id, {
            decision,
            ...(comment.trim() ? { comment: comment.trim() } : {}),
          }),
        decision === 'allow_departure'
          ? toastText.manager.defectAllowed
          : toastText.manager.defectConfirmed,
        { quiet: ['invalid_transition'] },
      );
    } catch (e) {
      // Решён другим менеджером (409): текст сервера, очередь перечитывается.
      if (problemCode(e) === 'invalid_transition') toast(detail(e) ?? problemText(e), 'error');
    } finally {
      await afterChange(qc, tenantId);
    }
  };

  return (
    <article
      className="ox-df-card"
      aria-labelledby={`${id}-h`}
      data-decided={row.decision ? '' : undefined}
    >
      <div className="ox-rv-defect-head">
        <span className="ox-rv-defect-icon" data-decided={row.decision ? '' : undefined}>
          <Icon name="report" size={24} />
        </span>
        <div className="ox-df-head-text">
          <h2 id={`${id}-h`} className="ox-rv-h2">
            {row.title}
          </h2>
          {row.trip ? <span className="ox-rv-sub">{row.trip}</span> : null}
          {row.vehicle ? <span className="ox-rv-sub">{row.vehicle}</span> : null}
          <span className="ox-rv-sub">{row.reported}</span>
        </div>
        {row.decision ? <ChipView chip={row.decision.chip} /> : null}
      </div>
      {row.decision ? (
        <div className="ox-df-decided">
          {row.decision.at ? <span className="ox-rv-sub">{row.decision.at}</span> : null}
          {row.decision.comment ? (
            <div className="ox-rv-comment">{row.decision.comment}</div>
          ) : null}
        </div>
      ) : (
        <>
          <p className="ox-rv-note">{L.criticalText}</p>
          <label className="ox-rv-label">
            {T.comment}
            <textarea
              rows={2}
              value={comment}
              placeholder={T.commentPlaceholder}
              disabled={p.locked}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          <div className="ox-rv-actions">
            {defect.tripId ? (
              <button
                type="button"
                className="ox-rv-btn ox-rv-hit ox-df-link"
                onClick={() => p.onShift(defect.tripId ?? '')}
              >
                {T.openShift}
              </button>
            ) : null}
            <button
              type="button"
              className="ox-rv-btn ox-rv-hit"
              disabled={busy || p.locked}
              onClick={() => void decide('allow_departure')}
            >
              {L.allowDeparture}
            </button>
            <button
              type="button"
              className="ox-rv-btn ox-rv-hit"
              data-variant="danger"
              disabled={busy || p.locked}
              onClick={() => void decide('confirm_out_of_service')}
            >
              {L.confirmDefect}
            </button>
          </div>
        </>
      )}
    </article>
  );
}

export default function DefectsPage(): ReactElement {
  const { tenantId: id, audience, readOnly } = useShell();
  const tenantId = id ?? '';
  const can = useCan();
  const crumbText = useCrumb('fleet.inspections.review');
  const navigate = useNavigate();
  const location = useLocation();
  const tab: Tab =
    (location.search as Record<string, unknown>).tab === 'decided' ? 'decided' : 'review';
  const defects = useDefects(tenantId);
  const parts = partition(defects.data ?? []);
  const locked = readOnly || !(audience === 'owner' || can('fleet.inspections.review'));
  const ids = useId();
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  const go = (page: 'defects' | 'review', search: Record<string, string>): void =>
    void navigate({
      to: '/t/$tenantId/$page',
      params: { tenantId, page },
      search: search as never,
    });

  let body: ReactElement;
  let filled = false;
  if (defects.isPending) {
    body = <Skeleton lines={5} label={shell.a11y.loading} />;
  } else if (defects.isError) {
    body = (
      <Banner
        tone="danger"
        role="alert"
        title={format(T.loadFailed, { error: problemText(defects.error) })}
        action={{ label: T.retry, onPress: () => void defects.refetch() }}
      />
    );
  } else {
    const list = parts[tab];
    filled = list.length > 0;
    body =
      list.length === 0 ? (
        <div className="ox-rv-empty">
          <span className="ox-rv-empty-icon">
            <Icon name={tab === 'review' ? 'verified' : 'history'} size={28} />
          </span>
          <strong>{tab === 'review' ? T.empty.review : T.empty.decided}</strong>
          {tab === 'review' ? <span>{T.empty.reviewHint}</span> : null}
        </div>
      ) : (
        <>
          {list.map((d) => (
            <DefectCard
              key={d.id}
              tenantId={tenantId}
              defect={d}
              locked={locked}
              onShift={(trip) => go('review', { trip })}
            />
          ))}
        </>
      );
  }

  /** Вкладки по шаблону ARIA: стрелки, Home и End переключают и переносят фокус (roving tabindex). */
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, cur: Tab): void => {
    const i = TABS.indexOf(cur);
    const next =
      e.key === 'ArrowRight'
        ? TABS[(i + 1) % TABS.length]
        : e.key === 'ArrowLeft'
          ? TABS[(i - 1 + TABS.length) % TABS.length]
          : e.key === 'Home'
            ? TABS[0]
            : e.key === 'End'
              ? TABS[TABS.length - 1]
              : undefined;
    if (!next) return;
    e.preventDefault();
    tabRefs.current[next]?.focus();
    if (next !== tab) go('defects', next === 'review' ? {} : { tab: next });
  };

  return (
    <section aria-labelledby="h-defects" className="ox-rv">
      <div className="ox-rv-top">
        <div className="ox-rv-crumb">{crumbText}</div>
        <h1 id="h-defects" className="ox-rv-title" tabIndex={-1}>
          {shell.nav.items.defects}
        </h1>
        <p className="ox-rv-intro">{T.intro}</p>
      </div>
      <div role="tablist" aria-label={T.tabsAria} className="ox-df-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            ref={(el) => {
              tabRefs.current[t] = el;
            }}
            id={`${ids}-tab-${t}`}
            type="button"
            role="tab"
            aria-selected={tab === t ? 'true' : 'false'}
            aria-controls={`${ids}-panel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            className="ox-df-tab"
            onClick={() => go('defects', t === 'review' ? {} : { tab: t })}
            onKeyDown={(e) => onTabKey(e, t)}
          >
            {T.tabs[t]}
            {defects.isSuccess ? ' ' : null}
            {defects.isSuccess ? <span className="ox-df-count">{parts[t].length}</span> : null}
          </button>
        ))}
      </div>
      {/* Панель активной вкладки — всегда (загрузка, ошибка, пусто, список): aria-controls не висит. */}
      <div
        id={`${ids}-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`${ids}-tab-${tab}`}
        className={filled ? 'ox-df-list' : undefined}
      >
        {body}
      </div>
    </section>
  );
}
