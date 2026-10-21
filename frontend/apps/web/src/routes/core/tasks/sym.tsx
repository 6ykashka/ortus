// W4.12 · Иконка эталона размера, которого нет в шкале Icon @ortus/ui (14, 17, 26 px — «Задачи и проекты.dc.html»
// :135, :176, :111): та же лигатура Material Symbols Rounded, скрытая от AT.
import type { ReactElement } from 'react';

export function Sym({ name, size }: { name: string; size: 14 | 17 | 26 }): ReactElement {
  return (
    <span className="material-symbols-rounded" aria-hidden="true" style={{ fontSize: `${size}px` }}>
      {name}
    </span>
  );
}
