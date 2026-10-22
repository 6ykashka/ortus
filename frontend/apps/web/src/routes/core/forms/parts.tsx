// W4.22 · Общие кусочки разметки «Форм и опросов»: значок Material Symbols, чип с тоном (TONE dc:490), меню
// действий (role=menu, пункты role=menuitem, dc:74, 98, 165, 192) и подложка «Закрыть меню» (dc:26), ошибка
// загрузки блока (LoadFailed с «Повторить»).
import { forms as F } from '@ortus/texts';
import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from 'react';

import { LoadFailed } from '../../company/modules/ui.tsx';
import { useForms } from './ctx.tsx';
import type { Chip as ChipT } from './model.ts';

/** Лигатура Material Symbols: с `label` — значок с именем (dc:149, 160), иначе скрыт от AT. */
export function Glyph(p: {
  name: string;
  size: number;
  className?: string;
  label?: string;
  style?: CSSProperties;
}): ReactElement {
  const cls = p.className ? `material-symbols-rounded ${p.className}` : 'material-symbols-rounded';
  const style = { fontSize: `${p.size}px`, ...p.style };
  return p.label ? (
    <span className={cls} role="img" aria-label={p.label} style={style}>
      {p.name}
    </span>
  ) : (
    <span className={cls} aria-hidden="true" style={style}>
      {p.name}
    </span>
  );
}

/** Чип статуса (TONE dc:490): значок 15 px и подпись. */
export function Chip({ chip, className }: { chip: ChipT; className?: string }): ReactElement {
  return (
    <span className={className ?? 'ox-fm-chip'} data-tone={chip.tone}>
      {chip.icon ? <Glyph name={chip.icon} size={15} /> : null}
      {chip.label}
    </span>
  );
}

export interface MenuItem {
  label: string;
  icon: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * Выпадающее меню действий: Escape закрывает и возвращает фокус кнопке, первый пункт получает фокус. Стрелки
 * перемещают фокус по пунктам (роль menu).
 */
export function Menu(p: {
  items: readonly MenuItem[];
  title?: string;
  className?: string;
  onClose: () => void;
}): ReactElement {
  const box = useRef<HTMLDivElement | null>(null);
  // Кнопка, открывшая меню: соседняя кнопка с aria-expanded в обёртке MenuAnchor (на сенсорных экранах нажатие
  // не всегда оставляет на ней фокус), иначе — фокус до первого пункта. Escape возвращает фокус ей.
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    trigger.current =
      box.current?.parentElement?.querySelector<HTMLElement>(':scope > button[aria-expanded]') ??
      (document.activeElement as HTMLElement | null);
    const el = box.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    el?.focus({ preventScroll: true });
  }, []);
  const closeRef = useRef(p.onClose);
  useEffect(() => {
    closeRef.current = p.onClose;
  });
  /** Закрыть и вернуть фокус кнопке меню. */
  const escape = useCallback(() => {
    const back = trigger.current;
    closeRef.current();
    if (back?.isConnected && back !== document.body) back.focus({ preventScroll: true });
  }, []);
  // Escape при фокусе вне меню (нажатие мимо пунктов, сенсорный экран) — слушатель документа.
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') escape();
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [escape]);
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [
      ...(box.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
        []),
    ];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.stopPropagation();
      escape();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      if (!n) return;
      const next = e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
      items[next]?.focus();
    }
  };
  return (
    <div
      ref={box}
      role="menu"
      className={p.className ? `ox-fm-menu ${p.className}` : 'ox-fm-menu'}
      onKeyDown={onKey}
    >
      {p.title ? <span className="ox-fm-menu-title">{p.title}</span> : null}
      {p.items.map((m) => (
        <button
          key={m.label}
          type="button"
          role="menuitem"
          disabled={m.disabled}
          data-danger={m.danger ? '' : undefined}
          onClick={m.onClick}
        >
          <Glyph name={m.icon} size={18} />
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** Подложка закрытия меню (dc:26): нажатие мимо меню закрывает его. */
export function MenuBackdrop(): ReactElement | null {
  const { menu, setMenu } = useForms();
  if (!menu) return null;
  return (
    <button
      type="button"
      className="ox-fm-backdrop"
      aria-label={F.closeMenus}
      tabIndex={-1}
      onClick={() => setMenu(null)}
    />
  );
}

/** Ошибка загрузки блока: текст по коду Problem и «Повторить». */
export function Failed({ q }: { q: { error: unknown; refetch: () => unknown } }): ReactElement {
  return <LoadFailed error={q.error} onRetry={() => void q.refetch()} />;
}

/** Обёртка с относительным позиционированием для выпадающих меню (dc:73, 97, 164, 191). */
export function MenuAnchor({ children }: { children: ReactNode }): ReactElement {
  return <div className="ox-fm-anchor">{children}</div>;
}
