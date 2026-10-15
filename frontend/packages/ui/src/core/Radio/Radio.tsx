import { useContext, useId, type ReactElement, type ReactNode } from 'react';
import { Radio as AriaRadio, RadioGroupStateContext } from 'react-aria-components';
import type { RadioProps } from '../../types';
import { RadioVariantContext } from '../_internal/radioContext';
import { visuallyHiddenStyle } from '../VisuallyHidden/VisuallyHidden';
import styles from './Radio.module.css';

function Content({
  labelId,
  descId,
  label,
  description,
  cards,
}: {
  labelId: string;
  descId?: string;
  label: ReactNode;
  description?: ReactNode;
  cards: boolean;
}): ReactElement {
  return (
    <>
      {cards ? <span className={styles.dot} aria-hidden="true" /> : null}
      <span className={styles.text}>
        <span id={labelId} className={styles.title}>
          {label}
        </span>
        {description ? (
          <span id={descId} className={styles.description}>
            {description}
          </span>
        ) : null}
      </span>
    </>
  );
}

/**
 * Радио на React Aria внутри `RadioGroup`: плитка 44 px, выбранная — рамка 2 px акцентом, фон `accent-soft`,
 * 600 (Дизайн-система.dc.html:239–242); карточка — точка, подпись 600 и описание (Ортус CRM.dc.html:2255).
 * Вне группы — нативное радио с состоянием из `checked`.
 */
export function Radio<V extends string = string>({
  value,
  label,
  description,
  disabled = false,
  checked,
}: RadioProps<V>): ReactElement {
  const group = useContext(RadioGroupStateContext);
  const variant = useContext(RadioVariantContext);
  const id = useId();
  const labelId = `${id}-label`;
  const descId = description ? `${id}-desc` : undefined;
  const cards = variant === 'cards';
  const content = (
    <Content
      labelId={labelId}
      descId={descId}
      label={label}
      description={description}
      cards={cards}
    />
  );

  if (!group) {
    return (
      <label
        className={styles.radio}
        data-variant={variant}
        data-selected={checked ? '' : undefined}
        data-disabled={disabled ? '' : undefined}
      >
        <input
          type="radio"
          value={value}
          checked={checked ?? false}
          disabled={disabled}
          readOnly
          style={visuallyHiddenStyle}
          aria-labelledby={labelId}
          aria-describedby={descId}
        />
        {content}
      </label>
    );
  }

  return (
    <AriaRadio
      className={styles.radio}
      data-variant={variant}
      value={value}
      isDisabled={disabled}
      aria-labelledby={labelId}
      aria-describedby={descId}
    >
      {content}
    </AriaRadio>
  );
}
