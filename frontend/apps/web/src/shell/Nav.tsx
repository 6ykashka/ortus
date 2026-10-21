// W1.20 · Меню оболочки: боковая панель и рейл (:149–170), нижняя навигация телефона (:2165–2174), лист
// «Все разделы» (:2274–2282; 01-shell.md §9.4–§9.6). Один DOM на все пороги: видимость — container queries
// (shell.css). Подписи — словарь по ключам домена навигации.
import { bottomItems, type NavItem, type PageKey } from '@ortus/domain/nav';
import { shell } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import {
  Fragment,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
  useEffect,
  useRef,
} from 'react';

import { type BrandedGroup, type BrandedItem, itemText } from './brand.ts';
import { navLabel } from './labels.ts';

export interface NavProps {
  /** Меню по оформлению организации (W4.62: подпись пункта — своя или из словаря). */
  groups: readonly BrandedGroup[];
  page: PageKey | null;
  onGo: (item: NavItem) => void;
}

export function Sidebar({ groups, page, onGo, note }: NavProps & { note: string }): ReactElement {
  return (
    <nav className="ox-sidebar" aria-label={shell.a11y.mainNav}>
      {groups.map((g) => (
        <Fragment key={g.key}>
          <div className="ox-nav-title">{navLabel(g.title)}</div>
          <div className="ox-nav-sep" />
          {g.items.map((it) => {
            const label = itemText(it);
            return (
              <button
                key={`${g.key}:${it.key}`}
                type="button"
                className="ox-nav-item"
                aria-current={it.key === page ? 'page' : undefined}
                title={label}
                onClick={() => onGo(it)}
              >
                <Icon name={it.icon} size={20} />
                <span className="ox-nav-label">{label}</span>
                {it.badge ? <span className="ox-nav-badge">{it.badge}</span> : null}
              </button>
            );
          })}
        </Fragment>
      ))}
      <div className="ox-nav-foot">
        <span>
          <Icon name="shield" size={16} />
          {note}
        </span>
      </div>
    </nav>
  );
}

export function BottomNav({
  groups,
  page,
  onGo,
  sheetOpen,
  onMore,
  moreRef,
}: NavProps & {
  sheetOpen: boolean;
  onMore: () => void;
  moreRef: RefObject<HTMLButtonElement | null>;
}): ReactElement {
  return (
    <nav className="ox-bottom" aria-label={shell.a11y.bottomNav}>
      {bottomItems(groups).map((it) => {
        const active = it.key === page;
        return (
          <button
            key={it.key}
            type="button"
            className="ox-bottom-item"
            aria-current={active ? 'page' : undefined}
            onClick={() => onGo(it)}
          >
            <Icon name={it.icon} size={24} fill={active} />
            {itemText(it as BrandedItem)}
            {it.badge ? <span className="ox-bottom-badge">{it.badge}</span> : null}
          </button>
        );
      })}
      <button
        ref={moreRef}
        type="button"
        className="ox-bottom-item"
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        onClick={onMore}
      >
        <Icon name="menu" size={24} />
        {shell.nav.bottom.more}
      </button>
    </nav>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], select, input, [tabindex]:not([tabindex="-1"])';

/**
 * Лист «Все разделы» в модальном контейнере (:2176–2178): подложка закрывает только кликом по себе,
 * Escape закрывает (обработчик оболочки). Фокус-ловушка и возврат фокуса на «Ещё» — PD-29 (в эталоне нет).
 */
export function MoreSheet({
  groups,
  page,
  onGo,
  onClose,
}: NavProps & { onClose: () => void }): ReactElement {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
  }, []);
  const trap = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !dialog.current) return;
    const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };
  return (
    <div
      className="ox-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="ox-dialog ox-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        onKeyDown={trap}
      >
        <div className="ox-sheet-head">
          <h2 id="dlg-title" className="ox-sheet-title">
            {shell.nav.sheetTitle}
          </h2>
          <button
            ref={close}
            type="button"
            className="ox-icon-button"
            aria-label={shell.modal.close}
            onClick={onClose}
          >
            <Icon name="close" size={22} />
          </button>
        </div>
        {groups.map((g) => (
          <Fragment key={g.key}>
            <div className="ox-sheet-group">{navLabel(g.title)}</div>
            {g.items.map((it) => (
              <button
                key={`${g.key}:${it.key}`}
                type="button"
                className="ox-sheet-item"
                aria-current={it.key === page ? 'page' : undefined}
                onClick={() => onGo(it)}
              >
                <Icon name={it.icon} size={22} />
                <span className="ox-nav-label">{itemText(it)}</span>
                {it.badge ? <span className="ox-nav-badge">{it.badge}</span> : null}
              </button>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
