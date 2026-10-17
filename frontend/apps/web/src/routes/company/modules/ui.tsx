// W1.24 · Общая разметка страниц «Модули и место», «Хранилище», «Файлы» по рендеру эталона (PD-28): шапка
// страницы (:207–211), пилюля статуса `ch` (:2331, :216), полоса места (:263, :1861), ошибка загрузки.
import { problemText } from '../../../shell/run.tsx';
import { shell } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { type ReactElement, type ReactNode, useEffect, useRef } from 'react';

import type { BarTone } from './storage.ts';
import { MOD_TEXT, t } from './texts.ts';
import type { Chip } from './vm.ts';

/** Лигатура Material Symbols с кеглем из CSS: размеры эталона 14 px (чипы списков, зависимости) вне шкалы Icon. */
export function Glyph({ name, className }: { name: string; className: string }): ReactElement {
  return (
    <span className={`material-symbols-rounded ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

export function Pill({ chip }: { chip: Chip }): ReactElement {
  return (
    <span className="ox-pill" data-tone={chip.tone}>
      <Icon name={chip.icon} size={15} />
      {chip.label}
    </span>
  );
}

export function PageHead(p: {
  id: string;
  crumb?: string;
  title: string;
  intro?: string;
}): ReactElement {
  return (
    <div className="ox-mod-head">
      {p.crumb ? <div className="ox-mod-crumb">{p.crumb}</div> : null}
      {/* tabIndex=-1: сюда возвращается фокус после «Повторить» (кнопка исчезает вместе с ошибкой). */}
      <h1 id={p.id} className="ox-mod-title" tabIndex={-1}>
        {p.title}
      </h1>
      {p.intro ? <p className="ox-mod-intro">{p.intro}</p> : null}
    </div>
  );
}

/**
 * Скелетон содержимого страницы под её заголовком (без подписи оболочки «Загружаем рабочее пространство…»):
 * шапка страницы уже на месте, карточки — пустые блоки.
 */
export function PageSkeleton(): ReactElement {
  return (
    <div className="ox-mod-skel" role="status" aria-label={shell.a11y.loading}>
      <span className="ox-mod-skel-block" data-size="card" />
      <span className="ox-mod-skel-block" data-size="block" />
    </div>
  );
}

/** Пустые строки на месте разбивки, пока она грузится (место карточки не сдвигается). */
export function SkeletonLines({ n, className }: { n: number; className: string }): ReactElement {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={className}>
          <span className="ox-mod-skel-line" />
        </span>
      ))}
    </>
  );
}

/**
 * Фокус после «Повторить»: кнопка исчезает вместе с ошибкой, и браузер переводит фокус на body. Обёртка
 * повтора запоминает намерение; когда данные загрузились (`ready`), фокус уходит на `target`. Повтор снова
 * отказал — ошибка с кнопкой остаётся на экране, фокус на ней.
 */
export function useRetryFocus(
  ready: boolean,
  target: () => HTMLElement | null,
): (retry: () => unknown) => () => void {
  const want = useRef(false);
  useEffect(() => {
    if (!ready || !want.current) return;
    want.current = false;
    target()?.focus();
  });
  return (retry) => () => {
    want.current = true;
    void retry();
  };
}

/** Полоса места: у «Модули и место» и «Хранилища» — `meter` «Занятое место» (:263), у «Файлов» — без роли. */
export function UsageBar(p: {
  pct: string;
  tone: BarTone;
  meter?: { label: string; now: number; max: number };
}): ReactElement {
  const fill = <div className="ox-mod-bar-fill" data-tone={p.tone} style={{ width: p.pct }} />;
  if (!p.meter) return <div className="ox-mod-bar">{fill}</div>;
  return (
    <div
      className="ox-mod-bar"
      role="meter"
      aria-label={p.meter.label}
      aria-valuemin={0}
      aria-valuemax={p.meter.max}
      aria-valuenow={p.meter.now}
    >
      {fill}
    </div>
  );
}

/** Ошибка загрузки данных страницы: текст по коду Problem (как тосты `run`) и «Повторить», если задан повтор. */
export function LoadFailed({
  error,
  onRetry,
  describedBy,
}: {
  error: unknown;
  onRetry?: () => void;
  /** id заголовка карточки: «Повторить» в карточке описан тем, что повторяет. */
  describedBy?: string;
}): ReactElement {
  return (
    <div className="ox-mod-alert" data-retry={onRetry ? '' : undefined}>
      <Icon name="error" size={20} />
      <span role="alert" className="ox-mod-alert-text">
        {t(MOD_TEXT.loadFailed, { error: problemText(error) })}
      </span>
      {onRetry ? (
        <button
          type="button"
          className="ox-mod-btn"
          data-variant="secondary"
          data-size="lg"
          aria-describedby={describedBy}
          onClick={onRetry}
        >
          {MOD_TEXT.retry}
        </button>
      ) : null}
    </div>
  );
}

/** Предупреждение в карточке (`role=alert`, :267–269). */
export function CardAlert({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="ox-mod-alert" role="alert">
      <Icon name="error" size={20} />
      <span className="ox-mod-alert-text">{children}</span>
    </div>
  );
}
