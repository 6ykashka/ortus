import { Fragment, type ReactElement } from 'react';
import type { NavItem, NavProps } from '../../types';
import { labels } from '../_internal/labels';
import { Icon } from '../Icon';
import { VisuallyHidden } from '../VisuallyHidden';
import styles from './Nav.module.css';

function Badge({ badge, mode }: { badge: NavItem['badge']; mode: NavProps['mode'] }) {
  if (badge === undefined || badge === 0) return null;
  if (badge === labels.planned) {
    return mode === 'sidebar' ? <span className={styles.planned}>{badge}</span> : null;
  }
  return <span className={mode === 'bottom' ? styles.dot : styles.count}>{badge}</span>;
}

function Item({ item, mode }: { item: NavItem; mode: NavProps['mode'] }): ReactElement {
  const label =
    mode === 'rail' ? (
      <VisuallyHidden>{item.label}</VisuallyHidden>
    ) : (
      <span className={styles.label}>{item.label}</span>
    );
  return (
    <button
      type="button"
      className={styles.item}
      aria-current={item.current ? 'page' : undefined}
      title={mode === 'rail' ? item.label : undefined}
      onClick={item.onPress}
    >
      <Icon
        name={item.icon}
        size={mode === 'bottom' ? 24 : 20}
        fill={mode === 'bottom' && item.current}
      />
      {label}
      <Badge badge={item.badge} mode={mode} />
    </button>
  );
}

/**
 * Навигация оболочки (Ортус CRM.dc.html:150–169 — sidebar 244 px и rail 68 px; :2166–2172 — нижняя;
 * пункты :3022–3030): кнопки с `aria-current="page"`, бейдж-счётчик акцентом, «план» у будущих модулей.
 * В rail подпись визуально скрыта и остаётся именем кнопки. `more` — пункт «Ещё» нижней навигации.
 */
export function Nav({ groups, mode, 'aria-label': ariaLabel, more }: NavProps): ReactElement {
  const flat = groups.flatMap((g) => g.items);
  return (
    <nav className={styles.nav} data-mode={mode} aria-label={ariaLabel}>
      {mode === 'bottom'
        ? flat.map((item) => <Item key={item.id} item={item} mode={mode} />)
        : groups.map((group, i) => (
            <Fragment key={group.title ?? i}>
              {mode === 'sidebar' && group.title ? (
                <div className={styles.groupTitle}>{group.title}</div>
              ) : null}
              {mode === 'rail' ? <div className={styles.separator} aria-hidden="true" /> : null}
              {group.items.map((item) => (
                <Item key={item.id} item={item} mode={mode} />
              ))}
            </Fragment>
          ))}
      {more ? (
        <Item
          item={{
            id: 'more',
            label: more.label || labels.more,
            icon: more.icon ?? 'menu',
            onPress: more.onPress,
          }}
          mode={mode}
        />
      ) : null}
    </nav>
  );
}
