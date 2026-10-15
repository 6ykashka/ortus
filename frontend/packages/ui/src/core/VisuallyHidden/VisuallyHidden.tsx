import type { CSSProperties, ReactElement } from 'react';
import type { VisuallyHiddenProps } from '../../types';

/** Приём clip: текст читается с экрана, пиксельного следа нет (Ортус CRM.dc.html:158, PD-29). */
export const visuallyHiddenStyle: CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export function VisuallyHidden({ children }: VisuallyHiddenProps): ReactElement {
  return (
    <span data-visually-hidden="" style={visuallyHiddenStyle}>
      {children}
    </span>
  );
}
