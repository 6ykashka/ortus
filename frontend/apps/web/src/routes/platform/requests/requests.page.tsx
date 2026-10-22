// W4.61 · «Заявки на изменение тарифа» оператора (pg.requests «Ортус CRM.dc.html» :945–985, requestsVM :3586–3617;
// design-2026-10-19): фильтр (`?status=all`), карточки заявок, комментарий для владельца, «Отклонить» (причина
// обязательна) и «Подтвердить и подключить» через opConfirm. Данные — listPlatformSubscriptionRequests,
// команды — decidePlatformSubscriptionRequest (W4.07).
import '../kit/kit.css';
import './requests.css';

import { type components } from '@ortus/api-client';
import { errors, platform, screenLabels, toast as TOAST } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { Fragment, type ReactElement, useId, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useToast } from '../../../shell/toast.tsx';
import { useCommand, violation } from '../kit/api.ts';
import { useConfirm } from '../kit/confirm.tsx';
import {
  AreaSkeleton,
  isForbidden,
  Notice,
  PageHead,
  Pills,
  RetryAlert,
  StatusChip,
} from '../kit/ui.tsx';
import { decide, useRequests } from './api.ts';
import {
  approveSpec,
  type Filter,
  filterPills,
  rejectSpec,
  requestCard,
  visible,
} from './model.ts';
import { REQUESTS_TEXT as T } from './texts.ts';

type Req = components['schemas']['SubscriptionChangeRequest'];

const P = platform.requests;

/** Тексты отказов решения: 409 — «уже рассмотрена или отменена», 422 причины — текст эталона. */
const DECIDE_ERRORS = {
  invalid_transition: errors.mock.platform.requestDecidedOrCancelled,
  validation_failed: (e: Parameters<typeof violation>[0]) =>
    violation(e, 'note') ? errors.mock.platform.rejectReason : undefined,
};

function RequestArticle({
  r,
  note,
  onNote,
  onApprove,
  onReject,
}: {
  r: Req;
  note: string;
  onNote: (v: string) => void;
  onApprove: () => void;
  onReject: () => void;
}): ReactElement {
  const c = requestCard(r);
  const noteId = useId();
  const fields: [string, string, string][] = [
    [T.fields.from, c.from, ''],
    [T.fields.to, c.to, 'ox-rq-to'],
    [T.fields.used, c.used, 'ox-rq-num'],
    [T.fields.term, c.term, ''],
  ];
  return (
    <article className="ox-pk-card ox-rq-card">
      <div className="ox-rq-head">
        <h2>{c.org}</h2>
        <span className="ox-rq-number">{c.number}</span>
        <StatusChip chip={c.chip} />
        <span className="ox-rq-spacer" />
        <span className="ox-rq-meta">{c.meta}</span>
      </div>
      <dl className="ox-rq-fields">
        {fields.map(([label, value, cls], i) => (
          <Fragment key={label}>
            {i ? ' ' : null}
            <div>
              <dt>{label}</dt> <dd className={cls || undefined}>{value}</dd>
            </div>
          </Fragment>
        ))}
      </dl>
      <div className="ox-rq-price">
        <Icon name="payments" size={18} />
        <span>{c.price}</span>
      </div>
      {c.comment ? <p className="ox-rq-comment">{c.comment}</p> : null}
      {c.decision ? <p className="ox-rq-decision">{c.decision}</p> : null}
      {c.pending ? (
        <div className="ox-rq-actions">
          <label className="ox-pk-label" htmlFor={noteId}>
            {T.noteLabel}
            <textarea
              id={noteId}
              rows={2}
              className="ox-pk-input ox-rq-note"
              value={note}
              placeholder={T.notePlaceholder}
              onChange={(e) => onNote(e.target.value)}
            />
          </label>
          <div className="ox-rq-buttons">
            <button type="button" className="ox-pk-btn" data-variant="danger" onClick={onReject}>
              <Icon name="block" size={18} />
              {T.reject}
            </button>
            <button type="button" className="ox-pk-btn" data-variant="primary" onClick={onApprove}>
              <Icon name="check" size={18} />
              {T.approve}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function Queue({ list }: { list: readonly Req[] }): ReactElement {
  const api = useApi();
  const toast = useToast();
  const command = useCommand();
  const navigate = useNavigate();
  const search = useLocation().search as Readonly<Record<string, unknown>>;
  const filter: Filter = search.status === 'all' ? 'all' : 'pending';
  const [notes, setNotes] = useState<Readonly<Record<string, string>>>({});
  const confirm = useConfirm();
  const items = visible(list, filter);
  const setFilter = (f: Filter) =>
    void navigate({
      to: '/platform/$page',
      params: { page: 'requests' },
      search: (f === 'all' ? { status: 'all' } : {}) as never,
    });
  const run = (r: Req, decision: 'approve' | 'reject', note: string) =>
    command('decide', () => decide(api, r.id, decision, note), TOAST.platform.done, {
      texts: DECIDE_ERRORS,
    });
  return (
    <>
      <Pills label={P.filterAria} items={filterPills(list)} value={filter} onChange={setFilter} />
      {items.length === 0 ? (
        <div className="ox-pk-card ox-rq-empty">
          <Icon name="inbox" size={32} />
          <span>{filter === 'pending' ? T.emptyPending : T.emptyAll}</span>
        </div>
      ) : null}
      {items.map((r) => {
        const note = notes[r.id] ?? '';
        return (
          <RequestArticle
            key={r.id}
            r={r}
            note={note}
            onNote={(v) => setNotes((n) => ({ ...n, [r.id]: v }))}
            onApprove={() => confirm.ask(approveSpec(r), () => run(r, 'approve', note))}
            onReject={() => {
              if (!note.trim()) {
                toast(TOAST.platform.rejectReasonRequired, 'warn');
                return;
              }
              confirm.ask(rejectSpec(r, note), () => run(r, 'reject', note));
            }}
          />
        );
      })}
      {confirm.node}
    </>
  );
}

export default function RequestsPage(): ReactElement {
  const q = useRequests();
  let content: ReactElement;
  if (q.data) content = <Queue list={q.data} />;
  else if (q.isError && isForbidden(q.error)) content = <Notice>{T.forbidden}</Notice>;
  else if (q.isError)
    content = <RetryAlert text={T.loadError} error={q.error} onRetry={() => void q.refetch()} />;
  else content = <AreaSkeleton blocks={2} />;
  return (
    <section
      className="ox-pk ox-rq"
      aria-labelledby="h-req"
      data-screen-label={screenLabels.byPage.requests}
    >
      <PageHead id="h-req" crumb={platform.crumb} title={P.title} intro={P.intro} />
      {content}
    </section>
  );
}
