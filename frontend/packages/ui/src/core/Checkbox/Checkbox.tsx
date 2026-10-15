import { useId, type ReactElement } from 'react';
import type { CheckboxProps } from '../../types';
import styles from './Checkbox.module.css';

/**
 * Флажок-строка (Дизайн-система.dc.html:228–229): `label` ≥ 44 px, нативный `input` 20 px с `accent-color`
 * (эталон рисует нативный флажок; RAC `Checkbox` заменил бы его своим квадратом — решение в брифе §10 п.2).
 * Имя — подпись, описание — `aria-describedby`; вся строка — цель нажатия.
 */
export function Checkbox({
  checked,
  indeterminate = false,
  disabled = false,
  onChange,
  label,
  description,
}: CheckboxProps): ReactElement {
  const id = useId();
  const labelId = `${id}-label`;
  const descId = description ? `${id}-desc` : undefined;
  return (
    <label className={styles.row} data-row="" data-disabled={disabled ? '' : undefined}>
      <input
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        type="checkbox"
        className={styles.input}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-labelledby={labelId}
        aria-describedby={descId}
      />
      <span className={styles.text}>
        <span id={labelId}>{label}</span>
        {description ? (
          <span id={descId} className={styles.description}>
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
