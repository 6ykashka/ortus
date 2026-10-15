import { useContext, type ReactElement, type ReactNode } from 'react';
import { FieldContext } from './fieldContext';
import styles from './InputFrame.module.css';

interface InputFrameProps {
  unit?: string;
  size?: 'md' | 'lg';
  disabled?: boolean;
  readOnly?: boolean;
  children: ReactNode;
}

/**
 * Рамка поля вне `Field` (та же, что у `Field`: Дизайн-система.dc.html:220). Внутри `Field` рамку рисует
 * `Field`, а здесь остаются контрол и единица справа (Q-W0.10-5: единица поля — внутри рамки `Field`).
 */
export function InputFrame({
  unit,
  size = 'md',
  disabled,
  readOnly,
  children,
}: InputFrameProps): ReactElement {
  const inField = useContext(FieldContext);
  const unitNode = unit ? <span className={styles.unit}>{unit}</span> : null;
  if (inField) {
    return (
      <>
        {children}
        {unitNode}
      </>
    );
  }
  return (
    <span
      className={styles.frame}
      data-frame=""
      data-size={size}
      data-disabled={disabled ? '' : undefined}
      data-readonly={readOnly ? '' : undefined}
    >
      {children}
      {unitNode}
    </span>
  );
}
