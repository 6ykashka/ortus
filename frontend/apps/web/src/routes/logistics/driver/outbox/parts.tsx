// W2.24 · Части экрана очереди отправки (рендер эталона, PD-28): карточка «Сдача сохранена на устройстве»
// (dr.sQueued :822–829, queuedLabel :3459) и строки расходов на устройстве (localExp :3463). «Повторить» у ошибки
// отправки — нет в эталоне (03 §10.2: повтор только переключением связи); добавлено с подписью слота фото
// (allowlist driver-outbox, бриф §10 п. 4).
import { rub } from '@ortus/domain';
import { format, logisticsDriver as L } from '@ortus/texts';
import { type ReactElement, useId } from 'react';

import { EXPENSE_KINDS, type ExpenseRow } from '../model.ts';
import { Sym } from '../parts.tsx';
import type { ExpenseItem, ReturnItem } from './queue.ts';
import './outbox.css';

const O = L.outbox;

/** Подпись чипа сдачи на устройстве: «Ожидает отправки» / «Отправляется…» / «Ошибка отправки: …». */
export function queuedLabel(item: ReturnItem): string {
  if (item.state === 'sending') return O.sending;
  if (item.state === 'error') return format(O.sendError, { message: item.error ?? '' });
  return O.pending;
}

/**
 * «Сдача сохранена на устройстве» вместо осмотра при сдаче, пока сервер не принял сдачу. Без «Повторить» в
 * прокручиваемой основной области оболочки нет ни одной цели Tab (axe scrollable-region-focusable на 390, возврат 1):
 * карточка сама цель фокуса с именем по заголовку (как дерево «Структуры» W1.54).
 */
export function QueuedReturn({
  item,
  onRetry,
}: {
  item: ReturnItem;
  onRetry: () => void;
}): ReactElement {
  const titleId = useId();
  const commands = item.state === 'error';
  return (
    <div
      role="status"
      className="ox-dr-final"
      data-queued
      aria-labelledby={titleId}
      tabIndex={commands ? undefined : 0}
    >
      <span className="ox-dr-final-icon">
        <Sym name="cloud_off" size={28} />
      </span>
      <h2 id={titleId} className="ox-dr-final-title">
        {L.states.savedLocal}
      </h2>
      <p className="ox-dr-final-text ox-ob-text">{L.states.savedLocalText}</p>
      <span className="ox-ob-chip">{queuedLabel(item)}</span>
      {commands ? (
        <button type="button" className="ox-dr-btn" onClick={onRetry}>
          {L.inspection.retry}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Категория расхода очереди. С `labels` (справочник тенанта, W2.41) — подпись справочника, затем посева, затем
 * сам код; без него — посев с «Прочее» для неизвестного кода.
 */
const kindOf = (k: ExpenseItem['body']['kind'], labels?: ReadonlyMap<string, string>) => {
  const seed = EXPENSE_KINDS.find((x) => x.kind === k);
  if (!labels) return seed ?? EXPENSE_KINDS[EXPENSE_KINDS.length - 1];
  return {
    label: labels.get(k) ?? seed?.label ?? k,
    icon: seed?.icon ?? EXPENSE_KINDS[EXPENSE_KINDS.length - 1]?.icon,
  };
};

/** Подпись операции расхода в тостах очереди: «Мойка 400 ₽» (saveExp :2621). */
export function expenseLabel(
  body: ExpenseItem['body'],
  labels?: ReadonlyMap<string, string>,
): string {
  return `${kindOf(body.kind, labels)?.label ?? ''} ${rub(body.amount.amountMinor / 100)}`;
}

/** Строка расхода на устройстве (localExp :3463): «Локальный черновик» и чип состояния очереди. */
export function localExpenseRow(
  item: ExpenseItem,
  onRetry: (id: string) => void,
  labels?: ReadonlyMap<string, string>,
): ExpenseRow {
  const k = kindOf(item.body.kind, labels);
  const chip =
    item.state === 'sending'
      ? { label: O.chips.sending, tone: 'info' as const, icon: 'sync' as const }
      : item.state === 'error'
        ? { label: O.chips.error, tone: 'danger' as const, icon: 'error' as const }
        : { label: O.chips.device, tone: 'warn' as const, icon: 'cloud_off' as const };
  const row: ExpenseRow = {
    id: item.id,
    icon: k?.icon ?? 'receipt_long',
    title: format(L.expenses.line, {
      label: k?.label ?? '',
      amount: rub(item.body.amount.amountMinor / 100),
    }),
    meta: O.chips.local,
    chip,
  };
  if (item.state === 'error') row.onRetry = () => onRetry(item.id);
  return row;
}
