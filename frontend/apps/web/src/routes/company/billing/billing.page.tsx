// W4.61 · «Подписка и места» владельца (pg.billing «Ортус CRM.dc.html» :1454–1528, billingVM :3916–3957;
// design-2026-10-19): тариф и срок оплаты, места всего бизнеса, баннеры заявки и смены цен, «Изменить тариф» (сроки,
// тарифы действующей сетки, расчёт, комментарий, заявка оператору), кто занимает и не занимает место. Данные —
// getTenantSubscription, getTenantPriceBook, listSubscriptionChangeRequests, listMembers; команды —
// create/cancelSubscriptionChangeRequest (W4.07).
import '../../platform/kit/kit.css';
import './billing.css';

import type { ProblemError } from '@ortus/api-client';
import { company, format, screenLabels, toast as TOAST } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { useNavigate } from '@tanstack/react-router';
import { type ReactElement, useId, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useShell } from '../../../shell/context.tsx';
import { useBusy } from '../../../shell/run.tsx';
import { useCommand, violation } from '../../platform/kit/api.ts';
import { AreaSkeleton, Bar, PageHead, RetryAlert, StatusChip } from '../../platform/kit/ui.tsx';
import {
  billingKey,
  cancelChange,
  requestChange,
  useChangeRequests,
  useMembers,
  usePriceBook,
  useSubscription,
} from './api.ts';
import {
  banners,
  calcView,
  people,
  planCard,
  seatsCard,
  sendHint,
  termPills,
  tierCards,
} from './model.ts';
import { BILLING_TEXT as T } from './texts.ts';

const B = company.billing;
const DEFAULT_TERM = 12;

const REQUEST_ERRORS = {
  tier_below_usage: (e: ProblemError) => violation(e, 'tierCode') ?? e.problem?.detail,
};

function Body({ tenantId }: { tenantId: string }): ReactElement {
  const api = useApi();
  const navigate = useNavigate();
  const command = useCommand();
  const sending = useBusy('seatReq');
  const sub = useSubscription(tenantId);
  const pb = usePriceBook(tenantId);
  const reqs = useChangeRequests(tenantId);
  const members = useMembers(tenantId);
  const [term, setTerm] = useState(DEFAULT_TERM);
  const [selected, setSelected] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const commentId = useId();
  // «Осталось N дн.» пробного периода — от момента открытия страницы.
  const [now] = useState(() => Date.now());
  const failed = [sub, pb, reqs, members].find((q) => q.isError);
  if (failed) {
    return (
      <RetryAlert
        text={T.loadError}
        error={failed.error}
        onRetry={() => {
          for (const q of [sub, pb, reqs, members]) if (q.isError) void q.refetch();
        }}
      />
    );
  }
  if (!sub.data || !pb.data || !reqs.data || !members.data) return <AreaSkeleton />;
  const version = pb.data.current;
  const plan = planCard(sub.data, now);
  const seats = sub.data.seats ? seatsCard(sub.data.seats) : undefined;
  const ban = banners(reqs.data, pb.data.scheduled);
  const pending = ban.pending !== undefined;
  const cards = tierCards(version, sub.data, term, selected, pending);
  const calc = calcView(version, selected, term);
  const hint = sendHint(pending, selected);
  const list = people(members.data);
  const opts = { invalidate: billingKey(tenantId) };
  const send = () => {
    if (!selected || pending) return;
    const text = comment.trim();
    void command(
      'seatReq',
      () =>
        requestChange(api, tenantId, {
          tierCode: selected,
          termMonths: term as 1 | 4 | 8 | 12,
          ...(text ? { comment: text } : {}),
        }),
      TOAST.company.seatRequestSent,
      { ...opts, texts: REQUEST_ERRORS },
    ).then(
      () => {
        setSelected(null);
        setComment('');
      },
      () => undefined,
    );
  };
  const cancel = (id: string) =>
    void command(
      'cancelReq',
      () => cancelChange(api, tenantId, id),
      TOAST.company.seatRequestCancelled,
      opts,
    ).catch(() => undefined);
  const invite = () =>
    void navigate({
      to: '/t/$tenantId/$page',
      params: { tenantId, page: 'users' },
      // Число, а не строка: роутер пишет строку в URL как JSON (?invite=%221%22).
      search: { tab: 'people', invite: 1 } as never,
    });
  return (
    <>
      <div className="ox-bl-top">
        <div className="ox-pk-card ox-bl-plan">
          <div className="ox-bl-plan-head">
            <h2>{plan.title}</h2>
            <StatusChip chip={plan.chip} />
          </div>
          <p className="ox-bl-plan-meta">{plan.meta}</p>
        </div>
        <div className="ox-pk-card ox-bl-seats">
          <div className="ox-bl-seats-head">
            <h2>{B.seats}</h2>
            <span className="ox-bl-seats-value">{seats?.value ?? '—'}</span>
          </div>
          <Bar
            percent={seats?.percent ?? 0}
            tone={seats?.tone ?? 'accent'}
            size={10}
            className="ox-bl-bar"
          />
          <span className="ox-bl-seats-sub">{seats?.sub}</span>
          {seats?.full ? (
            <div role="status" className="ox-bl-full">
              <Icon name="no_accounts" size={18} />
              <span>{B.seatsFull}</span>
            </div>
          ) : null}
        </div>
      </div>
      {ban.pending ? (
        <div role="status" className="ox-bl-banner" data-tone="warn">
          <Icon name="pending" size={20} />
          <span className="ox-bl-banner-text">{ban.pending.text}</span>
          <button
            type="button"
            className="ox-bl-cancel ox-pk-hit"
            onClick={() => ban.pending && cancel(ban.pending.id)}
          >
            {B.cancelRequest}
          </button>
        </div>
      ) : null}
      {ban.rejected ? (
        <div role="status" className="ox-bl-banner" data-tone="danger">
          <Icon name="block" size={20} />
          <span>{ban.rejected}</span>
        </div>
      ) : null}
      {ban.priceChange ? (
        <div role="status" className="ox-bl-banner" data-tone="info">
          <Icon name="event" size={20} />
          <span>{ban.priceChange}</span>
        </div>
      ) : null}
      {ban.approved ? (
        <div role="status" className="ox-bl-banner" data-tone="ok">
          <Icon name="check_circle" size={20} />
          <span>{ban.approved}</span>
        </div>
      ) : null}

      <div className="ox-pk-card ox-bl-change">
        <div className="ox-bl-change-head">
          <div>
            <h2>{B.changeTitle}</h2>
            <span>{B.changeNote}</span>
          </div>
          <div role="radiogroup" aria-label={B.termAria} className="ox-bl-terms">
            {termPills(version.terms).map((t) => (
              <button
                key={t.months}
                type="button"
                role="radio"
                aria-checked={term === t.months}
                className="ox-bl-term ox-pk-hit"
                onClick={() => setTerm(t.months)}
              >
                {t.label}
                {t.off ? <span className="ox-bl-term-off">{t.off}</span> : null}
              </button>
            ))}
          </div>
        </div>
        <div role="radiogroup" aria-label={B.tierAria} className="ox-bl-tiers">
          {cards.map((x) => (
            <button
              key={x.code}
              type="button"
              role="radio"
              aria-checked={x.checked}
              aria-disabled={x.disabled}
              className="ox-bl-tier"
              onClick={() => {
                if (!x.disabled) setSelected(x.code);
              }}
            >
              {/* Пробелы между строками карточки — как разметка эталона :1487–1492 (имя радиокнопки). */}
              <strong>{x.name}</strong> <span className="ox-bl-tier-seats">{x.seats}</span>{' '}
              <span className="ox-bl-tier-price">{x.price}</span>{' '}
              <span className="ox-bl-tier-per">{x.per}</span>{' '}
              {x.total ? <span className="ox-bl-tier-total">{x.total}</span> : null}{' '}
              {x.note ? <span className="ox-bl-tier-note">{x.note}</span> : null}
            </button>
          ))}
        </div>
        {calc ? (
          <div className="ox-bl-calc">
            <strong>{calc.main}</strong>
            <span>{calc.sub}</span>
          </div>
        ) : null}
        <label className="ox-pk-label" htmlFor={commentId}>
          {B.commentLabel}
          <textarea
            id={commentId}
            rows={2}
            className="ox-pk-input ox-bl-comment"
            value={comment}
            placeholder={B.commentPlaceholder}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>
        <div className="ox-bl-send-row">
          <span className="ox-bl-hint">{hint}</span>
          <button
            type="button"
            className="ox-pk-btn ox-bl-send"
            data-variant="primary"
            disabled={!selected || pending || sending}
            onClick={send}
          >
            <Icon name="send" size={18} />
            {B.send}
          </button>
        </div>
      </div>

      <div className="ox-bl-lists">
        <div className="ox-pk-card ox-bl-paid">
          <div className="ox-bl-list-head">
            <h2>{format(B.paid, { n: list.paid.length })}</h2>
            <button type="button" className="ox-pk-btn ox-pk-hit" data-size="md" onClick={invite}>
              <Icon name="person_add" size={18} />
              {T.invite}
            </button>
          </div>
          {list.paid.map((p) => (
            <div key={p.id} className="ox-bl-person">
              <span className="ox-bl-avatar" aria-hidden="true">
                {p.initials}
              </span>{' '}
              <div className="ox-bl-who">
                <span className="ox-bl-name">{p.name}</span>
                <span className="ox-bl-title">{p.title}</span>
                {p.note ? <span className="ox-bl-note">{p.note}</span> : null}
              </div>{' '}
              <StatusChip chip={p.chip} />
            </div>
          ))}
        </div>
        <div className="ox-pk-card ox-bl-free">
          <div className="ox-bl-list-head ox-bl-free-head">
            <h2>{format(B.free, { n: list.free.length })}</h2>
            <span>{B.freeNote}</span>
          </div>
          {list.free.length === 0 ? <div className="ox-bl-free-empty">{B.freeEmpty}</div> : null}
          {list.free.map((p) => (
            <div key={p.id} className="ox-bl-person">
              <span className="ox-bl-avatar" data-free aria-hidden="true">
                {p.initials}
              </span>{' '}
              <div className="ox-bl-who">
                <span className="ox-bl-name">{p.name}</span>
                <span className="ox-bl-title">{p.what}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default function BillingPage(): ReactElement {
  const { tenant, tenantId } = useShell();
  return (
    <section
      className="ox-pk ox-bl"
      aria-labelledby="h-bill"
      data-screen-label={screenLabels.byPage.billing}
    >
      <PageHead
        id="h-bill"
        crumb={format(company.crumbs.company, { tenant: tenant?.name ?? '' })}
        title={T.title}
        intro={B.intro}
      />
      {tenantId ? <Body tenantId={tenantId} /> : null}
    </section>
  );
}
