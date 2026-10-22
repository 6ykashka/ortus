// W2.22 · Части экрана водителя по рендеру эталона (PD-28): чип, шапка с этапами, карточка рейса, карточка
// машины, слот фото, панель действия; связь и выбор файла камерой. Компоненты @ortus/ui `PhotoSlot`, `Stepper`
// (заглушки W0.10) не используются: их пропсы расходятся с состояниями эталона (бриф §10 п. 12).
import { logisticsDriver as L } from '@ortus/texts';
import { Icon, type IconName } from '@ortus/ui';
import { type ReactElement, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { useBusy } from '../../../shell/run.tsx';
import type { CarCard, Chip as ChipModel, PhotoView, StepState } from './model.ts';

/** Лигатура Material Symbols любого кегля эталона (Icon @ortus/ui — только шкала 15–32). */
export function Sym({ name, size }: { name: IconName; size: number }): ReactElement {
  return (
    <span className="material-symbols-rounded" aria-hidden="true" style={{ fontSize: size }}>
      {name}
    </span>
  );
}

export function Chip({ chip }: { chip: ChipModel }): ReactElement {
  return (
    <span className="ox-dr-chip" data-tone={chip.tone}>
      <Icon name={chip.icon} size={15} />
      {chip.label}
    </span>
  );
}

export interface HeadProps {
  crumb?: string | undefined;
  title: string;
  id: string;
  sub?: string | undefined;
}

/** Шапка страницы: крошка, `h1` (цель фокуса при переходе), пояснение. */
export function Head({ crumb, title, id, sub }: HeadProps): ReactElement {
  return (
    <div className="ox-dr-head">
      {crumb ? <span className="ox-dr-crumb">{crumb}</span> : null}
      <h1 id={id} className="ox-dr-title" tabIndex={-1}>
        {title}
      </h1>
      {sub ? <span className="ox-dr-sub">{sub}</span> : null}
    </div>
  );
}

/** Этапы смены (:666–673): `aria-current="step"` у текущего. */
export function Steps({
  label,
  steps,
}: {
  label: string;
  steps: { label: string; n: string; state: StepState }[];
}): ReactElement {
  return (
    <ol aria-label={label} className="ox-dr-steps">
      {steps.map((s) => (
        <li
          key={s.n}
          className="ox-dr-step"
          data-state={s.state}
          aria-current={s.state === 'current' ? 'step' : undefined}
        >
          <span className="ox-dr-step-dot">
            {s.state === 'done' ? <Icon name="check" size={18} /> : s.n}
          </span>
          <span className="ox-dr-step-label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

/** Карточка машины (:684–695; на «Автомобилях» — без «Подходит рейсу» и без недоступной кнопки, :856–864). */
export function CarArticle({
  car,
  full,
  busy,
  onBook,
  busyLabel,
}: {
  car: CarCard;
  full: boolean;
  busy: boolean;
  busyLabel: string;
  onBook: () => void;
}): ReactElement {
  return (
    <article className="ox-dr-car" data-bookable={car.canBook || undefined}>
      <div className="ox-dr-car-head">
        <span className="ox-dr-car-icon">
          <Icon name={car.icon} size={24} />
        </span>
        <div className="ox-dr-car-main">
          <div className="ox-dr-car-model">{car.model}</div>
          <div className="ox-dr-plate">{car.plate}</div>
          <div className="ox-dr-specs">{car.specs}</div>
        </div>
        <Chip chip={car.chip} />
      </div>
      {car.reasons.length ? (
        <ul className="ox-dr-reasons">
          {car.reasons.map((r) => (
            <li key={r}>
              <Icon name="close" size={16} />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {full && car.fitOk ? <Fits /> : null}
      {car.canBook ? (
        <button
          type="button"
          className="ox-dr-btn ox-dr-book"
          data-kind="primary"
          disabled={busy}
          onClick={onBook}
        >
          {full ? <Icon name="event_available" size={20} /> : null}
          {busy ? busyLabel : car.bookLabel}
        </button>
      ) : full ? (
        <button type="button" className="ox-dr-btn ox-dr-nobook" disabled>
          {car.noBookLabel}
        </button>
      ) : null}
    </article>
  );
}

/** Карточка машины с «Проверяем на сервере…» на время своей брони; другая бронь в пути — кнопка недоступна. */
export function BookCard({
  car,
  full,
  disabled,
  onBook,
}: {
  car: CarCard;
  full: boolean;
  disabled: boolean;
  onBook: () => void;
}): ReactElement {
  const busy = useBusy(`res:${car.id}`);
  return (
    <CarArticle
      car={car}
      full={full}
      busy={busy || disabled}
      busyLabel={busy ? L.vehicle.checking : car.bookLabel}
      onBook={onBook}
    />
  );
}

function Fits(): ReactElement {
  return (
    <div className="ox-dr-fits">
      <Icon name="check_circle" size={18} />
      {L.today.fits}
    </div>
  );
}

/** Слот фото (:738–747) и строка состояния; «Повторить» — после сбоя. */
export function PhotoSlot({
  label,
  view,
  onTap,
  onRetry,
  retryLabel,
  receipt,
}: {
  label: string;
  view: PhotoView;
  onTap: () => void;
  onRetry: () => void;
  retryLabel: string;
  receipt?: boolean;
}): ReactElement {
  const slot = (
    <button
      type="button"
      className="ox-dr-slot"
      aria-label={view.aria}
      onClick={onTap}
      style={{ border: view.border, backgroundImage: view.img, color: view.fg }}
    >
      {view.showIcon ? <Sym name={view.icon} size={receipt ? 28 : 26} /> : null}
      {receipt ? null : (
        <span className="ox-dr-slot-label" style={{ background: view.labelBg }}>
          {label}
        </span>
      )}
      {view.uploading ? (
        <span className="ox-dr-slot-bar">
          <span style={{ width: `${view.progress}%` }} />
        </span>
      ) : null}
      {view.ready && !receipt ? (
        <span className="ox-dr-slot-ok">
          <Icon name="check" size={16} />
        </span>
      ) : null}
    </button>
  );
  if (receipt) return slot;
  return (
    <div className="ox-dr-slot-cell">
      {slot}
      <span className="ox-dr-slot-status" style={{ color: view.stFg }}>
        <Sym name={view.stIcon} size={14} />
        {view.status}
      </span>
      {view.failed ? (
        <button type="button" className="ox-dr-retry" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Плашка причины, почему команды недоступны (нет связи, пробный период, модуль отключён; :675). W2.76 (Q-W2.32-12):
 * `tabStop` — команд на странице нет, у прокручиваемой основной области оболочки нет цели Tab (axe
 * scrollable-region-focusable): плашка сама цель фокуса с именем по тексту причины (как карточка W2.24, дерево W1.54).
 */
export function ReasonNote({
  icon,
  text,
  tabStop,
}: {
  icon: IconName;
  text: string;
  tabStop: boolean;
}): ReactElement {
  return (
    <div
      role="status"
      className="ox-dr-note"
      {...(tabStop ? { tabIndex: 0, 'aria-label': text } : {})}
    >
      <Sym name={icon} size={20} />
      <span style={{ textWrap: 'pretty' }}>{text}</span>
    </div>
  );
}

export interface ActLine {
  key: string;
  tone: 'warn' | 'danger' | 'muted';
  icon: IconName;
  text: string;
  /** W2.76: команда панели недоступна и других команд нет — строка причины цель Tab (`role="note"`). */
  tabStop?: boolean;
}

/** Закреплённая панель главного действия (:839–846). */
export function ActionBar({
  lines,
  label,
  icon,
  disabled,
  danger,
  onPress,
}: {
  lines: ActLine[];
  label: string;
  icon: IconName;
  disabled: boolean;
  danger?: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <div className="ox-dr-act">
      {lines.map((l) => (
        <span
          key={l.key}
          className="ox-dr-act-line"
          data-tone={l.tone}
          {...(l.tabStop ? { role: 'note', tabIndex: 0, 'aria-label': l.text } : {})}
        >
          <Icon name={l.icon} size={18} />
          <span>{l.text}</span>
        </span>
      ))}
      <button
        type="button"
        className="ox-dr-btn ox-dr-act-btn"
        data-kind="primary"
        data-danger={danger || undefined}
        disabled={disabled}
        onClick={onPress}
      >
        <Icon name={icon} size={22} />
        {label}
      </button>
    </div>
  );
}

/** «Конфликт брони» (:676): текст сервера и «Обновить список». */
export function ConflictAlert({
  text,
  busy,
  onRefresh,
}: {
  text: string;
  busy: boolean;
  onRefresh: () => void;
}): ReactElement {
  return (
    <div role="alert" className="ox-dr-alert">
      <div className="ox-dr-alert-body">
        <Sym name="sync_problem" size={22} />
        <div>
          <strong style={{ fontWeight: 600 }}>{L.today.conflictTitle}</strong>
          <div className="ox-dr-alert-text">{text}</div>
        </div>
      </div>
      <button
        type="button"
        className="ox-dr-btn"
        data-kind="danger-outline"
        disabled={busy}
        onClick={onRefresh}
      >
        <Icon name="refresh" size={18} />
        {L.today.refresh}
      </button>
    </div>
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return <div className={className ? `ox-dr-card ${className}` : 'ox-dr-card'}>{children}</div>;
}

/** Есть связь (`navigator.onLine`, события online/offline); тост потери связи показывает оболочка. */
export function useNetwork(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);
  return online;
}

/**
 * Выбор фото камерой или файлом (скрытый input эталона :92: `accept="image/*" capture="environment"`). `pick(cb)`
 * открывает выбор и передаёт файл в `cb`.
 */
export function useFilePicker(): { input: ReactElement; pick: (cb: (f: File) => void) => void } {
  const ref = useRef<HTMLInputElement>(null);
  const pending = useRef<((f: File) => void) | null>(null);
  const pick = useCallback((cb: (f: File) => void) => {
    pending.current = cb;
    const el = ref.current;
    if (!el) return;
    el.value = '';
    el.click();
  }, []);
  const input = (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      capture="environment"
      className="ox-dr-file"
      aria-hidden="true"
      tabIndex={-1}
      onChange={(e) => {
        const f = e.target.files?.[0];
        const cb = pending.current;
        pending.current = null;
        if (f && cb) cb(f);
      }}
    />
  );
  return { input, pick };
}
