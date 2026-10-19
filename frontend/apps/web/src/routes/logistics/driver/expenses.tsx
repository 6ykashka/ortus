// W2.22 · Блок «Расходы» (:781–811; S2-08): принятые сервером расходы рейса и форма нового расхода. Категории —
// пять кодов D-12 списком (ADR-0013), сумма, дата, литры у топлива, комментарий, фото чека (сессия загрузки).
// Ошибки — под полями после первой попытки (patchExp :2609), с сервера (422) — под суммой. W2.24: без связи —
// «Сохранить на устройстве» (saveLabel :3514), расходы на устройстве — строки очереди с «Повторить» у ошибки.
import { logisticsDriver as L, shell } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { type ReactElement, useId } from 'react';

import { Chip, PhotoSlot } from './parts.tsx';
import {
  EXPENSE_KINDS,
  type ExpenseForm,
  type ExpenseKind,
  expenseErrors,
  type ExpenseRow,
  photoView,
} from './model.ts';

const E = L.expenses;

export interface ExpensesProps {
  rows: readonly ExpenseRow[];
  form: ExpenseForm | null;
  setForm: (f: ExpenseForm | null) => void;
  onOpen: () => void;
  onSave: () => void;
  saving: boolean;
  /** Ошибка суммы с сервера (422). */
  serverError: string | null;
  onReceipt: () => void;
  /** Подпись сохранения: «Сохранить расход» или без связи «Сохранить на устройстве». */
  saveLabel?: string;
}

function Form(p: ExpensesProps & { form: ExpenseForm }): ReactElement {
  const f = p.form;
  const errs = f.tried ? expenseErrors(f) : {};
  const amountErr = errs.amount ?? p.serverError ?? undefined;
  const ids = { amount: useId(), date: useId(), receipt: useId() };
  const patch = (x: Partial<ExpenseForm>) => p.setForm({ ...f, ...x });
  const receiptLabel = E.receiptShort;
  const r = photoView(f.receipt, receiptLabel);
  return (
    <div className="ox-dr-form" style={{ gap: 12 }}>
      <label className="ox-dr-label">
        {E.category}
        <select
          className="ox-dr-input"
          value={f.kind}
          onChange={(e) => patch({ kind: e.target.value as ExpenseKind })}
        >
          {EXPENSE_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <div className="ox-dr-fields" style={{ gap: 12 }}>
        <label className="ox-dr-label" style={{ flex: '1 1 150px' }}>
          {E.amount}
          <input
            className="ox-dr-input"
            data-num
            inputMode="decimal"
            placeholder="0"
            value={f.amount}
            aria-invalid={amountErr ? 'true' : 'false'}
            aria-describedby={amountErr ? ids.amount : undefined}
            onChange={(e) => patch({ amount: e.target.value })}
          />
          {amountErr ? (
            <span id={ids.amount} role="alert" className="ox-dr-error">
              {amountErr}
            </span>
          ) : null}
        </label>
        <label className="ox-dr-label" style={{ flex: '1 1 150px' }}>
          {E.date}
          <input
            className="ox-dr-input"
            type="date"
            value={f.date}
            aria-invalid={errs.date ? 'true' : 'false'}
            aria-describedby={errs.date ? ids.date : undefined}
            onChange={(e) => patch({ date: e.target.value })}
          />
          {errs.date ? (
            <span id={ids.date} role="alert" className="ox-dr-error">
              {errs.date}
            </span>
          ) : null}
        </label>
        {f.kind === 'fuel' ? (
          <label className="ox-dr-label" style={{ flex: '1 1 110px' }}>
            {E.liters}
            <input
              className="ox-dr-input"
              data-thin
              inputMode="decimal"
              placeholder={E.litersPlaceholder}
              value={f.liters}
              onChange={(e) => patch({ liters: e.target.value })}
            />
          </label>
        ) : null}
      </div>
      <label className="ox-dr-label">
        {E.comment}
        <input
          className="ox-dr-input"
          data-thin
          placeholder={E.commentPlaceholder}
          value={f.comment}
          onChange={(e) => patch({ comment: e.target.value })}
        />
      </label>
      <div className="ox-dr-receipt">
        <PhotoSlot
          receipt
          label={receiptLabel}
          view={r}
          retryLabel={L.inspection.retry}
          onTap={p.onReceipt}
          onRetry={p.onReceipt}
        />
        <div className="ox-dr-col" style={{ gap: 2, minWidth: 0 }}>
          <span style={{ fontWeight: 500 }}>{E.receipt}</span>
          <span style={{ fontSize: 12, color: r.stFg }}>{r.status}</span>
          {r.failed ? (
            <button
              type="button"
              className="ox-dr-link"
              style={{ color: '#A13A33', textDecoration: 'none', alignSelf: 'flex-start' }}
              onClick={p.onReceipt}
            >
              {L.inspection.retry}
            </button>
          ) : null}
        </div>
      </div>
      {errs.receipt ? (
        <span id={ids.receipt} role="alert" className="ox-dr-error">
          {errs.receipt}
        </span>
      ) : null}
      <div className="ox-dr-form-actions">
        <button
          type="button"
          className="ox-dr-btn"
          data-size="lg"
          style={{ borderRadius: 8 }}
          onClick={() => p.setForm(null)}
        >
          {shell.modal.cancel}
        </button>
        <button
          type="button"
          className="ox-dr-btn"
          data-kind="primary"
          data-size="lg"
          style={{ borderRadius: 8, padding: '0 18px' }}
          disabled={p.saving}
          onClick={p.onSave}
        >
          {p.saving ? L.inspection.sending : (p.saveLabel ?? E.save)}
        </button>
      </div>
    </div>
  );
}

export function Expenses(p: ExpensesProps): ReactElement {
  return (
    <div className="ox-dr-card">
      <div className="ox-dr-defects-head">
        <h2 className="ox-dr-h2">{E.title}</h2>
        {p.form ? null : (
          <button
            type="button"
            className="ox-dr-btn"
            style={{ padding: '0 14px' }}
            onClick={p.onOpen}
          >
            <Icon name="add" size={20} />
            {E.add}
          </button>
        )}
      </div>
      {p.rows.length ? null : <span className="ox-dr-sub">{E.empty}</span>}
      {p.rows.map((e) => (
        <div key={e.id} className="ox-dr-exp">
          <span className="ox-dr-exp-icon">
            <Icon name={e.icon} size={20} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ox-dr-exp-title">{e.title}</div>
            <div className="ox-dr-exp-meta">{e.meta}</div>
          </div>
          <Chip chip={e.chip} />
          {e.onRetry ? (
            <button type="button" className="ox-ob-retry" onClick={e.onRetry}>
              {L.inspection.retry}
            </button>
          ) : null}
        </div>
      ))}
      {p.form ? <Form {...p} form={p.form} /> : null}
    </div>
  );
}
