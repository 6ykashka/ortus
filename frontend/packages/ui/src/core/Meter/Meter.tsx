import type { ReactElement } from 'react';
import type { MeterProps } from '../../types';
import styles from './Meter.module.css';

/** Доля заполнения и признак «сверх лимита» (`usedGb >= quotaGb`, 01 §11 #5). */
export function meterFill(value: number, max: number): { pct: number; over: boolean } {
  if (max <= 0) return { pct: 100, over: true };
  const pct = Math.round(Math.min(100, Math.max(0, (value / max) * 100)) * 10) / 10;
  return { pct, over: value >= max };
}

/**
 * Полоса заполнения (Ортус CRM.dc.html:263): `role="meter"`, высота 8, заливка акцентом, на лимите
 * и сверх — danger. `tone` задаёт цвет явно, `text` — `aria-valuetext`.
 */
export function Meter({ value, max, label, tone, text }: MeterProps): ReactElement {
  const { pct, over } = meterFill(value, max);
  return (
    <div
      className={styles.meter}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={text}
      data-over={over ? '' : undefined}
      data-tone={tone}
    >
      <div className={styles.fill} data-fill="" style={{ width: `${pct}%` }} />
    </div>
  );
}
