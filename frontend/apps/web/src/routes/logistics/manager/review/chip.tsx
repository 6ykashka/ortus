// W2.21 · Чип состояния страниц логиста (ch эталона: тон → фон и цвет, иконка 15 px; стили — review.css).
import { Icon } from '@ortus/ui';
import type { ReactElement } from 'react';

import type { Chip } from './model.ts';

export function ChipView({ chip }: { chip: Chip }): ReactElement {
  return (
    <span className="ox-rv-chip" data-tone={chip.tone}>
      <Icon name={chip.icon} size={15} />
      {chip.label}
    </span>
  );
}
