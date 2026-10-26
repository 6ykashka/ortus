// W5.32 · Мелкие общие части страницы «Касса»: чип, заметка, факт, сегментный выбор, переключатель, поле, строки журнала.
// Разметка и классы — по «Касса.dc.html» (design-2026-10-19); цвета — токены @ortus/tokens, стили — cash.css.
import { Icon } from '@ortus/ui';
import type { ChangeEvent, ReactElement, ReactNode } from 'react';

import { CASH_TEXT as T } from './texts.ts';
import {
  type Account,
  fmtAt,
  isReversible,
  METHOD_INFO,
  type Operation,
  opAmountText,
  opChip,
  opReceiptText,
  type Tone,
} from './model.ts';

export function Chip(p: {
  label: string;
  tone: Tone;
  icon?: string;
  size?: 'sm' | 'md' | 'lg';
}): ReactElement {
  return (
    <span className="ox-ca-chip" data-tone={p.tone} data-size={p.size ?? 'md'}>
      {p.icon ? <Icon name={p.icon} size={15} /> : null}
      {p.label}
    </span>
  );
}

const NOTE_ICON: Record<Tone, string> = {
  ok: 'check_circle',
  info: 'info',
  warn: 'error',
  danger: 'cancel',
  neutral: 'info',
};

export function Note(p: { tone: Tone; icon?: string; children: ReactNode }): ReactElement {
  return (
    <div className="ox-ca-note" data-tone={p.tone}>
      <Icon name={p.icon ?? NOTE_ICON[p.tone]} size={18} />
      <span>{p.children}</span>
    </div>
  );
}

export function Alert(p: { children: ReactNode; onClose?: () => void }): ReactElement {
  return (
    <div role="alert" className="ox-ca-alert">
      <Icon name="error" size={18} />
      <span className="ox-ca-alert-text">{p.children}</span>
      {p.onClose ? (
        <button
          type="button"
          aria-label={T.closeAlert}
          className="ox-ca-alert-x"
          onClick={p.onClose}
        >
          <Icon name="close" size={18} />
        </button>
      ) : null}
    </div>
  );
}

export interface FactData {
  l: string;
  v: string;
  s?: string;
  tone?: 'warn' | 'danger';
}

export function Facts(p: { facts: readonly FactData[]; min?: number }): ReactElement {
  return (
    <div className="ox-ca-facts" style={{ ['--ca-fact' as string]: `${String(p.min ?? 170)}px` }}>
      {p.facts.map((f) => (
        <div key={f.l} className="ox-ca-fact">
          <span className="ox-ca-fact-l">{f.l}</span>
          <strong className="ox-ca-fact-v">{f.v}</strong>
          <span className="ox-ca-fact-s" data-tone={f.tone}>
            {f.s ?? ''}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Группа кнопок-переключателей (`role=radiogroup`, K:581 seg). */
export function Seg<K extends string>(p: {
  label: string;
  value: K;
  options: readonly (readonly [K, string])[];
  onChange: (k: K) => void;
  soft?: boolean;
  fill?: boolean;
}): ReactElement {
  return (
    <div
      role="radiogroup"
      aria-label={p.label}
      className="ox-ca-seg"
      data-soft={p.soft ? 'true' : undefined}
      data-fill={p.fill ? 'true' : undefined}
    >
      {p.options.map(([k, t]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={k === p.value}
          className="ox-ca-segbtn"
          onClick={() => p.onChange(k)}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

export function SwitchRow(p: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={p.checked}
      className="ox-ca-switch"
      onClick={() => p.onChange(!p.checked)}
    >
      <span aria-hidden="true" className="ox-ca-track">
        <span className="ox-ca-knob" />
      </span>
      {p.children}
    </button>
  );
}

/** Подписанное поле: `label` оборачивает управляющий элемент, подсказка — под ним. */
export function Field(p: {
  label: string;
  hint?: string;
  small?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <label className="ox-ca-field" data-small={p.small ? 'true' : undefined}>
      {p.label}
      {p.children}
      {p.hint ? <span className="ox-ca-hint">{p.hint}</span> : null}
    </label>
  );
}

export function TextField(p: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  small?: boolean;
  mono?: boolean;
  inputMode?: 'decimal' | 'numeric' | 'text';
}): ReactElement {
  return (
    <Field label={p.label} {...(p.hint ? { hint: p.hint } : {})} small={p.small ?? false}>
      <input
        className="ox-ca-input"
        aria-label={p.label}
        data-mono={p.mono ? 'true' : undefined}
        inputMode={p.inputMode}
        value={p.value}
        placeholder={p.placeholder}
        onChange={(e: ChangeEvent<HTMLInputElement>) => p.onChange(e.target.value)}
      />
    </Field>
  );
}

export function SelectField(p: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
  hint?: string;
  children?: ReactNode;
}): ReactElement {
  return (
    <Field label={p.label} {...(p.hint ? { hint: p.hint } : {})}>
      <select
        className="ox-ca-input"
        aria-label={p.label}
        value={p.value}
        onChange={(e) => p.onChange(e.target.value)}
      >
        {p.children}
        {p.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Button(p: {
  children: ReactNode;
  onClick: () => void;
  icon?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'info' | 'ghost-danger';
  disabled?: boolean;
  small?: boolean;
  label?: string;
}): ReactElement {
  return (
    <button
      type="button"
      className="ox-ca-btn"
      data-variant={p.variant ?? 'secondary'}
      data-small={p.small ? 'true' : undefined}
      disabled={p.disabled}
      aria-label={p.label}
      onClick={p.onClick}
    >
      {p.icon ? <Icon name={p.icon} size={18} /> : null}
      {p.children}
    </button>
  );
}

export function Steps(p: { n: number; title: string; extra?: ReactNode }): ReactElement {
  return (
    <span className="ox-ca-step">
      <span className="ox-ca-stepn">{p.n}</span>
      <strong>{p.title}</strong>
      {p.extra}
    </span>
  );
}

export interface OpNames {
  member: (id: string) => string;
  shiftNo: (id: string) => string | undefined;
  me: { memberId: string };
  onReverse: (o: Operation, a: Account) => void;
  accountOf: (id: string) => Account | undefined;
  onSource?: (o: Operation) => void;
  canNav?: (o: Operation) => boolean;
  /** Без кнопки «Сторно» («Операции смены»). */
  noReverse?: boolean;
}

/** Строка журнала (opRow K:611–621). */
export function OpRow(p: { op: Operation; names: OpNames; compact?: boolean }): ReactElement {
  const { op, names } = p;
  const chip = opChip(op.type);
  const a = names.accountOf(op.accountId);
  const m = METHOD_INFO[op.method];
  const rc = opReceiptText(op.receipt);
  const shiftNo = op.shiftId ? names.shiftNo(op.shiftId) : undefined;
  const meta =
    `${fmtAt(op.occurredAt)} · ${names.member(op.createdByMemberId)}` +
    (op.approvedByMemberId
      ? ` · ${T.journal.approvedBy.replace('{name}', names.member(op.approvedByMemberId))}`
      : '') +
    (shiftNo ? ` · ${T.journal.shiftOf.replace('{no}', shiftNo)}` : '');
  const reversible =
    !names.noReverse &&
    !!a &&
    isReversible(op, a, { memberId: names.me.memberId, owner: a.my.via === 'owner' });
  const sign = op.type === 'in' || op.type === 'opening' || op.type === 'move_in';
  return (
    <div className="ox-ca-op" data-fixed={op.reversedByOperationId ? 'true' : undefined}>
      <span className="ox-ca-opid">{opCode(op.id)}</span>
      <span className="ox-ca-opchip">
        <Chip label={chip.label} tone={chip.tone} icon={chip.icon} size="md" />
      </span>
      <span className="ox-ca-opmain">
        <span className="ox-ca-opbasis">{op.basis ?? ''}</span>
        <span className="ox-ca-opmeta">
          <span className="ox-ca-oppart">
            <Icon name={m.icon} size={15} />
            {m.label}
          </span>
          {rc ? (
            <span className="ox-ca-oppart" data-warn={op.receipt?.none ? 'true' : undefined}>
              <Icon name="receipt" size={15} />
              {rc}
            </span>
          ) : null}
          <span>{meta}</span>
          {op.source ? (
            names.canNav?.(op) && names.onSource ? (
              <button type="button" className="ox-ca-link" onClick={() => names.onSource?.(op)}>
                <Icon name="link" size={15} />
                {op.source.label ?? op.source.id}
              </button>
            ) : (
              <span className="ox-ca-oppart">
                <Icon name="link" size={15} />
                {op.source.label ?? op.source.id}
              </span>
            )
          ) : null}
        </span>
      </span>
      <strong className="ox-ca-opamount" data-in={sign ? 'true' : undefined}>
        {opAmountText(op)}
      </strong>
      <span className="ox-ca-oprev">
        {reversible && a ? (
          <button type="button" className="ox-ca-revbtn" onClick={() => names.onReverse(op, a)}>
            {T.journal.reverse}
          </button>
        ) : null}
        {op.reversedByOperationId ? (
          <span className="ox-ca-revtext">
            {T.journal.fixedBy.replace('{id}', opCode(op.reversedByOperationId))}
          </span>
        ) : op.reversesOperationId ? (
          <span className="ox-ca-revtext">
            {T.journal.fixes.replace('{id}', opCode(op.reversesOperationId))}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** Номер записи журнала: контракт номера не несёт (Q-W5.32-2) — устойчивый короткий код по хвосту ID. */
export const opCode = (id: string): string => `K-${id.slice(-5).toUpperCase()}`;
