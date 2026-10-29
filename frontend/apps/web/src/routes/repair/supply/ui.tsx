// W6.22 · Общие элементы страниц снабжения и «Шаблонов и расценок»: чип состояния (`ch`), сегментные вкладки
// (`seg`: tablist на сером фоне, выбранная — белая плитка), сообщение-подтверждение (`hb.note`, «Скрыть сообщение»).
// Вкладки — по шаблону ARIA: стрелки, Home и End переключают и переносят фокус (roving tabindex).
import { Icon } from '@ortus/ui';
import { type KeyboardEvent, type ReactElement, useRef } from 'react';

import './repair.css';

export interface ChipData {
  label: string;
  tone: 'ok' | 'info' | 'warn' | 'danger' | 'neutral';
  icon: string;
}

export function Chip({ chip, label }: { chip: ChipData; label?: string }): ReactElement {
  return (
    <span className="ox-rps-chip" data-tone={chip.tone}>
      <Icon name={chip.icon} size={15} />
      {label ?? chip.label}
    </span>
  );
}

export interface SegItem<K extends string> {
  key: K;
  label: string;
}

/** Идентификаторы вкладки и панели: страница вешает на панель `id` и `aria-labelledby`. */
export const tabId = (base: string, key: string): string => `${base}-tab-${key}`;
export const panelId = (base: string, key: string): string => `${base}-panel-${key}`;

export function SegTabs<K extends string>(p: {
  base: string;
  aria: string;
  items: readonly SegItem<K>[];
  value: K;
  onChange: (key: K) => void;
}): ReactElement {
  const refs = useRef<Partial<Record<K, HTMLButtonElement | null>>>({});
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, cur: K): void => {
    const i = p.items.findIndex((x) => x.key === cur);
    const n = p.items.length;
    const next =
      e.key === 'ArrowRight'
        ? p.items[(i + 1) % n]
        : e.key === 'ArrowLeft'
          ? p.items[(i - 1 + n) % n]
          : e.key === 'Home'
            ? p.items[0]
            : e.key === 'End'
              ? p.items[n - 1]
              : undefined;
    if (!next) return;
    e.preventDefault();
    refs.current[next.key]?.focus();
    if (next.key !== p.value) p.onChange(next.key);
  };
  return (
    <div role="tablist" aria-label={p.aria} className="ox-rps-seg">
      {p.items.map((it) => (
        <button
          key={it.key}
          ref={(el) => {
            refs.current[it.key] = el;
          }}
          id={tabId(p.base, it.key)}
          type="button"
          role="tab"
          aria-selected={p.value === it.key ? 'true' : 'false'}
          aria-controls={panelId(p.base, it.key)}
          tabIndex={p.value === it.key ? 0 : -1}
          className="ox-rps-seg-btn"
          onClick={() => p.onChange(it.key)}
          onKeyDown={(e) => onKey(e, it.key)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Группа переключателей `aria-pressed` на сером фоне («Все склады · …», «Все / Работы / Материалы»). */
export function SegGroup<K extends string>(p: {
  aria: string;
  items: readonly SegItem<K>[];
  value: K;
  onChange: (key: K) => void;
}): ReactElement {
  return (
    <div role="group" aria-label={p.aria} className="ox-rps-seg ox-rps-seg-sm">
      {p.items.map((it) => (
        <button
          key={it.key}
          type="button"
          aria-pressed={p.value === it.key ? 'true' : 'false'}
          className="ox-rps-seg-btn"
          onClick={() => p.onChange(it.key)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Note({
  text,
  onClose,
  closeLabel,
}: {
  text: string;
  onClose: () => void;
  closeLabel: string;
}): ReactElement {
  return (
    <div role="status" className="ox-rps-note">
      <Icon name="check_circle" size={20} />
      <span className="ox-rps-note-text">{text}</span>
      <button type="button" className="ox-rps-note-x" aria-label={closeLabel} onClick={onClose}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
