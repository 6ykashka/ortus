import type { ReactElement } from 'react';
import type { SkeletonProps } from '../../types';
import { labels } from '../_internal/labels';
import styles from './Skeleton.module.css';

/** Ширины полос витрины по кругу: 40 / 85 / 65 % (Дизайн-система.dc.html:402–404). */
const WIDTHS = ['40%', '85%', '65%'] as const;

/**
 * Скелетон: контейнер `aria-busy="true"`, полосы `aria-hidden` (Дизайн-система.dc.html:401–405).
 * С `label` — `role="status"` «Загрузка» и видимая подпись (Ортус CRM.dc.html:183–188).
 */
export function Skeleton({ lines = 3, shape = 'text', label }: SkeletonProps): ReactElement {
  const count = shape === 'text' ? Math.max(1, lines) : 1;
  return (
    <div
      className={styles.skeleton}
      aria-busy="true"
      role={label ? 'status' : undefined}
      aria-label={label ? labels.loading : undefined}
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={styles.bar}
          data-bar=""
          data-shape={shape}
          aria-hidden="true"
          style={shape === 'text' ? { width: WIDTHS[i % WIDTHS.length] } : undefined}
        />
      ))}
      {label ? <span className={styles.label}>{label}</span> : null}
    </div>
  );
}
