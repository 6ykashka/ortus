// W7.32 · Мелкие общие части страницы «Обращения»: чип, плашка срока, кнопка, поле, ошибка. Разметка и классы — по
// «Обращения.dc.html» (design-2026-10-19); цвета — токены @ortus/tokens, стили — service.css.
import { Icon } from '@ortus/ui';
import type { ReactElement, ReactNode } from 'react';

import { SERVICE_TEXT as T } from './texts.ts';
import type { Tone } from './model.ts';

export function Chip(p: {
  label: string;
  tone: Tone;
  icon?: string;
  strong?: boolean;
}): ReactElement {
  return (
    <span className="ox-sv-chip" data-tone={p.tone} data-strong={p.strong ? 'true' : undefined}>
      {p.icon ? <Icon name={p.icon} size={15} /> : null}
      {p.label}
    </span>
  );
}

/** Плашка срока: значок, подпись и текст («Первый ответ · до 18:24» / «осталось 2 ч»). */
export function SlaBox(p: {
  tone: Tone;
  icon: string;
  label: string;
  text: string;
  wide?: boolean;
}): ReactElement {
  return (
    <span className="ox-sv-sla" data-tone={p.tone} data-wide={p.wide ? 'true' : undefined}>
      <Icon name={p.icon} size={18} />
      <span className="ox-sv-sla-t">
        <span className="ox-sv-sla-l">{p.label}</span>
        <span className="ox-sv-sla-x">{p.text}</span>
      </span>
    </span>
  );
}

export function Alert(p: { children: ReactNode; onClose?: () => void }): ReactElement {
  return (
    <div role="alert" className="ox-sv-alert">
      <Icon name="error" size={18} />
      <span className="ox-sv-alert-text">{p.children}</span>
      {p.onClose ? (
        <button
          type="button"
          aria-label={T.closeAlert}
          className="ox-sv-alert-x"
          onClick={p.onClose}
        >
          <Icon name="close" size={18} />
        </button>
      ) : null}
    </div>
  );
}

export function Note(p: { tone: Tone; icon: string; children: ReactNode }): ReactElement {
  return (
    <div className="ox-sv-note" data-tone={p.tone}>
      <Icon name={p.icon} size={18} />
      <span>{p.children}</span>
    </div>
  );
}

export function Button(p: {
  children: ReactNode;
  onClick: () => void;
  icon?: string;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  small?: boolean;
  className?: string;
}): ReactElement {
  return (
    <button
      type="button"
      className={`ox-sv-btn${p.className ? ` ${p.className}` : ''}`}
      data-variant={p.variant ?? 'secondary'}
      data-small={p.small ? 'true' : undefined}
      disabled={p.disabled}
      onClick={p.onClick}
    >
      {p.icon ? <Icon name={p.icon} size={18} /> : null}
      {p.children}
    </button>
  );
}

export function LinkButton(p: {
  children: ReactNode;
  onClick: () => void;
  icon?: string;
  disabled?: boolean;
}): ReactElement {
  return (
    <button type="button" className="ox-sv-link" disabled={p.disabled} onClick={p.onClick}>
      {p.icon ? <Icon name={p.icon} size={15} /> : null}
      {p.children}
    </button>
  );
}

export function Select(p: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
  disabled?: boolean;
  className?: string;
}): ReactElement {
  return (
    <select
      className={`ox-sv-select${p.className ? ` ${p.className}` : ''}`}
      aria-label={p.label}
      value={p.value}
      disabled={p.disabled}
      onChange={(e) => p.onChange(e.target.value)}
    >
      {p.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Field(p: { label: string; children: ReactNode }): ReactElement {
  return (
    <label className="ox-sv-field">
      {p.label}
      {p.children}
    </label>
  );
}
