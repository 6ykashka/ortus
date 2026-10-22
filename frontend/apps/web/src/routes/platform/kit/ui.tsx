// W4.61 · Общая разметка страниц шага 4.6 по шаблонам эталона («Ортус CRM.dc.html» design-2026-10-19): шапка
// страницы (надзаголовок, h1, описание :870–874), чип статуса (:930), полоса заполнения (:901, :932), фильтры-пилюли
// `aria-pressed` (:913, :951, :998), состояния без эталона (скелетон области, ошибка чтения с «Повторить»).
import { ProblemError } from '@ortus/api-client';
import { format, shell } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import type { ReactElement, ReactNode } from 'react';

import { problemCode, problemText } from '../../../shell/run.tsx';
import type { Chip } from './format.ts';
import { KIT_TEXT as T } from './texts.ts';

export function PageHead({
  id,
  crumb,
  title,
  intro,
}: {
  id: string;
  crumb: string;
  title: string;
  intro?: string | undefined;
}): ReactElement {
  return (
    <div className="ox-pk-head">
      <div className="ox-pk-crumb">{crumb}</div>
      <h1 id={id} tabIndex={-1}>
        {title}
      </h1>
      {intro ? <p className="ox-pk-intro">{intro}</p> : null}
    </div>
  );
}

export function StatusChip({ chip, className }: { chip: Chip; className?: string }): ReactElement {
  return (
    <span className={className ? `ox-chip ${className}` : 'ox-chip'} data-tone={chip.tone}>
      <Icon name={chip.icon} size={15} />
      <span className="ox-chip-label">{chip.label}</span>
    </span>
  );
}

export type BarTone = 'accent' | 'warn' | 'danger';

/** Полоса заполнения: подложка `#ECEFEA`, заливка цветом порога, ширина — доля в процентах. */
export function Bar({
  percent,
  tone,
  size = 6,
  className,
}: {
  percent: number;
  tone: BarTone;
  size?: 6 | 10;
  className?: string;
}): ReactElement {
  return (
    <div className={className ? `ox-pk-bar ${className}` : 'ox-pk-bar'} data-size={size}>
      <div
        className="ox-pk-bar-fill"
        data-tone={tone}
        style={{ width: `${Math.max(0, Math.min(100, percent)).toFixed(1)}%` }}
      />
    </div>
  );
}

export interface Pill<K extends string> {
  key: K;
  label: string;
}

/** Группа фильтров-пилюль (`role="group"`, кнопки `aria-pressed`): выбранная — тёмная. */
export function Pills<K extends string>({
  label,
  items,
  value,
  onChange,
  size = 36,
  className,
}: {
  label: string;
  items: readonly Pill<K>[];
  value: K;
  onChange: (key: K) => void;
  size?: 34 | 36;
  className?: string;
}): ReactElement {
  return (
    <div
      role="group"
      aria-label={label}
      className={className ? `ox-pk-pills ${className}` : 'ox-pk-pills'}
    >
      {items.map((p) => (
        <button
          key={p.key}
          type="button"
          className="ox-pk-pill ox-pk-hit"
          data-size={size}
          aria-pressed={p.key === value}
          onClick={() => onChange(p.key)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

/** Скелетон области страницы под уже показанной шапкой (без эталона): статус «Загрузка» и блоки без текста. */
export function AreaSkeleton({ blocks = 3 }: { blocks?: number }): ReactElement {
  return (
    <div className="ox-pk-skeleton" role="status" aria-label={shell.a11y.loading}>
      {Array.from({ length: blocks }, (_, i) => (
        <span key={i} className="ox-pk-skeleton-block" data-first={i === 0 || undefined} />
      ))}
    </div>
  );
}

/** Текст ошибки чтения: нет связи — свой текст (без «Операция не выполнена» команд), иначе по коду. */
export function readErrorText(e: unknown): string {
  return problemCode(e) === 'offline' ? T.state.offlineRead : problemText(e);
}

/** Отказ по праву роли оператора или участника (403 forbidden_action). */
export const isForbidden = (e: unknown): boolean => e instanceof ProblemError && e.status === 403;

/** Ошибка чтения раздела (без эталона): `role="alert"`, текст по коду и «Повторить». */
export function RetryAlert({
  text,
  error,
  onRetry,
}: {
  text: string;
  error: unknown;
  onRetry: () => void;
}): ReactElement {
  return (
    <div className="ox-pk-error" role="alert">
      <span>{format(text, { error: readErrorText(error) })}</span>
      <button
        type="button"
        className="ox-pk-btn ox-pk-hit"
        data-variant="secondary"
        onClick={onRetry}
      >
        {T.state.retry}
      </button>
    </div>
  );
}

/** Сообщение раздела вместо данных (нет права роли — без эталона). */
export function Notice({ children }: { children: ReactNode }): ReactElement {
  return <p className="ox-pk-notice">{children}</p>;
}
