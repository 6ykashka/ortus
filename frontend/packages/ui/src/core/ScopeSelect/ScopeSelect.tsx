import type { ReactElement } from 'react';
import type { ScopeSelectProps } from '../../types';
import { labels } from '../_internal/labels';
import styles from './ScopeSelect.module.css';

/**
 * Область просмотра в шапке (Ортус CRM.dc.html:109–112): нативный `select` 36 px до 240 px,
 * `aria-label` «Область просмотра»; вид области — `data-kind` опции (организация / регион / фирма).
 */
export function ScopeSelect({
  value,
  options,
  onChange,
  label = labels.scope,
}: ScopeSelectProps): ReactElement {
  return (
    <select
      className={styles.select}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} data-kind={o.kind}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
