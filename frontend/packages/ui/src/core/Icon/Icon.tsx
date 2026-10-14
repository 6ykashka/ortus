import type { CSSProperties, ReactElement } from 'react';
import type { IconProps } from '../../types';

/** Лигатура Material Symbols Rounded (класс из `@ortus/tokens/fonts.css`), скрытая от AT. */
export function Icon({ name, size = 20, fill = false, className }: IconProps): ReactElement {
  const style: CSSProperties = { fontSize: `${size}px` };
  if (fill) style.fontVariationSettings = "'FILL' 1";
  return (
    <span
      className={className ? `material-symbols-rounded ${className}` : 'material-symbols-rounded'}
      aria-hidden="true"
      style={style}
    >
      {name}
    </span>
  );
}
