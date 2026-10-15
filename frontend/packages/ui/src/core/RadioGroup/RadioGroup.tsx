import type { ReactElement } from 'react';
import { Label, RadioGroup as AriaRadioGroup } from 'react-aria-components';
import type { RadioGroupProps } from '../../types';
import { RadioVariantContext } from '../_internal/radioContext';
import styles from './RadioGroup.module.css';

/**
 * Группа радио на React Aria (PD-13): `role="radiogroup"` с подписью, стрелки двигают выбор.
 * `tiles` — плитки «Уровень топлива» (Дизайн-система.dc.html:237–243), `cards` — карточки «Основа роли»
 * (Ортус CRM.dc.html:2252–2258).
 */
export function RadioGroup<V extends string = string>({
  name,
  value,
  onChange,
  label,
  labelHidden = false,
  variant = 'tiles',
  children,
}: RadioGroupProps<V>): ReactElement {
  return (
    <AriaRadioGroup
      className={styles.group}
      data-variant={variant}
      name={name}
      value={value}
      onChange={(v) => onChange(v as V)}
      orientation={variant === 'tiles' ? 'horizontal' : 'vertical'}
      aria-label={labelHidden ? label : undefined}
    >
      {labelHidden ? null : <Label className={styles.label}>{label}</Label>}
      <div className={styles.options}>
        <RadioVariantContext.Provider value={variant}>{children}</RadioVariantContext.Provider>
      </div>
    </AriaRadioGroup>
  );
}
