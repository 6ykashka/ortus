import { useId, type ReactElement } from 'react';
import { Switch as AriaSwitch } from 'react-aria-components';
import type { SwitchProps } from '../../types';
import { visuallyHiddenStyle } from '../VisuallyHidden/VisuallyHidden';
import styles from './Switch.module.css';

/**
 * Переключатель на React Aria (PD-13): `role="switch"`, Space переключает. Трек 40×24, ручка 18
 * (Дизайн-система.dc.html:233); CRM 44×26/20 (Ортус CRM.dc.html:359) — переменные `--ox-switch-*`.
 * С видимой подписью — строка в рамке; `labelHidden` — только трек (подпись для чтения с экрана).
 * `checked` и `disabled` допустимы одновременно.
 */
export function Switch({
  checked,
  disabled = false,
  onChange,
  label,
  description,
  labelHidden = false,
}: SwitchProps): ReactElement {
  const id = useId();
  const labelId = `${id}-label`;
  const descId = description ? `${id}-desc` : undefined;
  const track = (
    <span className={styles.track} aria-hidden="true">
      <span className={styles.knob} />
    </span>
  );
  const text = (
    <span className={styles.text} style={labelHidden ? visuallyHiddenStyle : undefined}>
      <span id={labelId}>{label}</span>
      {description ? (
        <span id={descId} className={styles.description}>
          {description}
        </span>
      ) : null}
    </span>
  );
  return (
    <AriaSwitch
      className={labelHidden ? styles.bare : styles.row}
      data-row={labelHidden ? undefined : ''}
      isSelected={checked}
      isDisabled={disabled}
      onChange={onChange}
      aria-labelledby={labelId}
      aria-describedby={descId}
    >
      {text}
      {track}
    </AriaSwitch>
  );
}
