// W5.33 · Страница «Мой подотчёт» (`cashSelf`, /t/:tenantId/cash-self; эталон design-2026-10-19 «Касса.dc.html»
// режим isSelf :588, разметка :289–317, selfVM :802–818; cash.md §1.4): водитель и прораб видят свой подотчёт —
// остаток «на руках», «Выдано … · ДД.ММ · отчитались на …», чип срока, «В пути», «Добавить чек» (фото через Files,
// QR), список «Чеки» со статусами и «Переснять», «Вернуть остаток». Нет подотчёта или права — «Кассы недоступны…»
// (:583). Деньги — копейки контракта 0.12.0-stage5; чеки проверяет выдающий на странице «Касса» (W5.32).
import { useQueryClient } from '@tanstack/react-query';
import { format } from '@ortus/texts';
import { type ReactElement, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useShell } from '../../../shell/context.tsx';
import { problemText, useBusy, useRun } from '../../../shell/run.tsx';
import { acceptTransfer, cashKey, isForbidden, useSelfData } from './api.ts';
import {
  buildCard,
  holderAccounts,
  type Move,
  mskDay,
  type ReceiptRow,
  type SelfCard,
  type Transfer,
} from './model.ts';
import { Chip, Sym } from './parts.tsx';
import { ReceiptDialog } from './ReceiptDialog.tsx';
import { ReturnDialog } from './ReturnDialog.tsx';
import { SELF_TEXT as T } from './texts.ts';
import './cash-self.css';

type Open =
  { kind: 'receipt'; card: SelfCard; redo: ReceiptRow | null } | { kind: 'return'; card: SelfCard };

function Head({ title, sub }: { title: string; sub: string }): ReactElement {
  return (
    <div className="ox-cs-head">
      <h1 className="ox-cs-title" tabIndex={-1}>
        {title}
      </h1>
      <span className="ox-cs-sub">{sub}</span>
    </div>
  );
}

function MoveRow({
  move,
  onAccept,
  busy,
}: {
  move: Move;
  onAccept: () => void;
  busy: boolean;
}): ReactElement {
  return (
    <div className="ox-cs-move">
      <Sym name={move.icon} size={20} />
      <span className="ox-cs-move-text">{move.text}</span>
      {move.canAccept ? (
        <button type="button" className="ox-cs-move-btn" disabled={busy} onClick={onAccept}>
          {T.moves.accept}
        </button>
      ) : null}
    </div>
  );
}

function ReceiptItem({
  row,
  readOnly,
  onRedo,
}: {
  row: ReceiptRow;
  readOnly: boolean;
  onRedo: () => void;
}): ReactElement {
  return (
    <div className="ox-cs-receipt">
      <span className="ox-cs-receipt-main">
        <span className="ox-cs-receipt-title">{row.title}</span>
        <span className="ox-cs-receipt-st" data-tone={row.tone}>
          <Sym name={row.icon} size={14} />
          <span className="ox-cs-receipt-status">{row.status}</span>
        </span>
      </span>
      {row.redo && !readOnly ? (
        <button type="button" className="ox-cs-redo" onClick={onRedo}>
          {T.receipts.redo}
        </button>
      ) : (
        <strong className="ox-cs-receipt-sum">{row.amount}</strong>
      )}
    </div>
  );
}

function CardView({
  card,
  readOnly,
  busy,
  onOpen,
  onAccept,
}: {
  card: SelfCard;
  readOnly: boolean;
  busy: boolean;
  onOpen: (o: Open) => void;
  onAccept: (id: string) => void;
}): ReactElement {
  return (
    <div className="ox-cs-col">
      <div className="ox-cs-card">
        <span className="ox-cs-card-name">
          {card.name} · {T.card.onHand}
        </span>
        <strong className="ox-cs-bal">{card.balance}</strong>
        <span className="ox-cs-line">{card.line}</span>
        <span className="ox-cs-bar" aria-hidden="true">
          <span className="ox-cs-bar-fill" style={{ width: `${card.pct}%` }} />
        </span>
        {card.due ? <Chip chip={card.due} /> : null}
      </div>
      {card.moves.map((m) => (
        <MoveRow key={m.id} move={m} busy={busy} onAccept={() => onAccept(m.id)} />
      ))}
      {readOnly ? null : (
        <button
          type="button"
          className="ox-cs-add"
          onClick={() => onOpen({ kind: 'receipt', card, redo: null })}
        >
          <Sym name="photo_camera" size={22} />
          {T.add}
        </button>
      )}
      <div className="ox-cs-receipts">
        <h2 className="ox-cs-receipts-title">{T.receipts.title}</h2>
        {card.receipts.map((r) => (
          <ReceiptItem
            key={r.id}
            row={r}
            readOnly={readOnly}
            onRedo={() => onOpen({ kind: 'receipt', card, redo: r })}
          />
        ))}
        {card.receipts.length ? null : <span className="ox-cs-empty">{T.receipts.empty}</span>}
      </div>
      {card.canReturn && !readOnly ? (
        <button
          type="button"
          className="ox-cs-return"
          onClick={() => onOpen({ kind: 'return', card })}
        >
          {format(T.returnRest, { sum: card.balance })}
        </button>
      ) : null}
    </div>
  );
}

export default function CashSelfPage(): ReactElement {
  const { tenantId: id, readOnly } = useShell();
  const tenantId = id ?? '';
  const api = useApi();
  const run = useRun();
  const qc = useQueryClient();
  const busy = useBusy('cash-accept');
  const [open, setOpen] = useState<Open | null>(null);
  // Возвраты, отправленные в этом сеансе: держателю список перемещений может не отдаваться (Q-W5.33-8).
  const [sent, setSent] = useState<readonly Transfer[]>([]);
  const q = useSelfData(tenantId);

  const reload = () => void qc.invalidateQueries({ queryKey: cashKey(tenantId) });

  if (q.isPending) {
    return (
      <div className="ox-cs">
        <div className="ox-cs-loading" role="status">
          {T.loading}
        </div>
      </div>
    );
  }
  if (q.error && !isForbidden(q.error)) {
    return (
      <div className="ox-cs">
        <Head title={T.title} sub={T.sub} />
        <div role="alert" className="ox-cs-err">
          <Sym name="error" size={18} />
          <span>{`${T.loadError}: ${problemText(q.error)}`}</span>
          <button type="button" className="ox-cs-link" onClick={() => void q.refetch()}>
            {T.retry}
          </button>
        </div>
      </div>
    );
  }
  const data = q.data;
  const mine = data ? holderAccounts(data.accounts) : [];
  if (!data || !mine.length) {
    return (
      <div className="ox-cs">
        <Head title={T.none.title} sub={T.none.sub} />
        <div className="ox-cs-none">
          <Sym name="lock" size={24} />
          <span>{T.none.text}</span>
        </div>
      </div>
    );
  }

  const today = mskDay(new Date().toISOString());
  const names = new Map(data.accounts.map((a) => [a.id, a.name]));
  const cards = mine.map((a) =>
    buildCard(a, {
      ops: data.ops,
      transfers: [
        ...data.transfers,
        ...sent.filter((s) => !data.transfers.some((t) => t.id === s.id)),
      ],
      receipts: data.receipts,
      categories: data.categories,
      today,
      names,
    }),
  );
  const accept = (transferId: string) => {
    const t = data.transfers.find((x) => x.id === transferId);
    if (!t) return;
    void run('cash-accept', () => acceptTransfer(api, tenantId, t), T.toast.accepted)
      .then(reload)
      .catch(reload);
  };

  return (
    <div className="ox-cs">
      <Head title={T.title} sub={T.sub} />
      {cards.map((c) => (
        <CardView
          key={c.id}
          card={c}
          readOnly={readOnly}
          busy={busy}
          onOpen={setOpen}
          onAccept={accept}
        />
      ))}
      {open?.kind === 'receipt' ? (
        <ReceiptDialog
          tenantId={tenantId}
          card={open.card}
          redo={open.redo}
          onClose={() => setOpen(null)}
          onDone={reload}
        />
      ) : null}
      {open?.kind === 'return' ? (
        <ReturnDialog
          tenantId={tenantId}
          accountId={open.card.id}
          balanceMinor={open.card.balanceMinor}
          onClose={() => setOpen(null)}
          onDone={(t) => {
            setSent((s) => [...s, t]);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}
