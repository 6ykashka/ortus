// W1.23 · Мелкие части страницы «Пользователи и роли»: пилл статуса (ch эталона :2305), список фактов
// (иконка + текст, :393, :2220), скрытое имя области (WCAG 1.3.1).
import { Icon } from '@ortus/ui';
import type { ReactElement, ReactNode } from 'react';

export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';

/** Пилл статуса: иконка 15 px + подпись (usersVM :3150, `ch(label, tone, icon)`). */
export function Chip({
  tone,
  icon,
  children,
}: {
  tone: Tone;
  icon?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <span className="ox-users-chip" data-tone={tone}>
      {icon ? <Icon name={icon} size={15} /> : null}
      {children}
    </span>
  );
}

export interface Fact {
  icon: string;
  /** Цвет иконки (TONE эталона). */
  color: string;
  text: string;
}

/** Список фактов: иконка 18 px цвета факта + текст. */
export function Facts({
  items,
  labelledBy,
}: {
  items: readonly Fact[];
  labelledBy?: string;
}): ReactElement {
  return (
    <ul className="ox-users-facts" aria-labelledby={labelledBy}>
      {items.map((f) => (
        <li key={f.text}>
          <span style={{ color: f.color, display: 'inline-flex' }}>
            <Icon name={f.icon} size={18} />
          </span>
          <span>{f.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Невидимая подпись для `aria-labelledby` (не попадает в структурную сверку подписей). */
export function Hidden({ id, children }: { id: string; children: ReactNode }): ReactElement {
  return (
    <span id={id} className="ox-users-hidden">
      {children}
    </span>
  );
}

/** Цвета фактов эталона (TONE :2303 и «#5C6964»). */
export const FACT_COLOR = {
  info: 'var(--ox-info-fg)',
  warn: 'var(--ox-warn-fg)',
  danger: 'var(--ox-danger-fg)',
  muted: 'var(--ox-text-muted)',
  accent: 'var(--ox-accent)',
} as const;
