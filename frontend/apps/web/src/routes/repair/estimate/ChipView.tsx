// W6.21 · Чип состояния сметы (ch эталона: тон → фон и цвет, иконка; стили — measure/tabs.css).
import { Icon } from '@ortus/ui';
import type { ReactElement } from 'react';

import type { Chip } from './vm.ts';

export function ChipView({ chip, small }: { chip: Chip; small?: boolean }): ReactElement {
  return (
    <span className="ox-rp-chip" data-tone={chip.tone} data-size={small ? 's' : undefined}>
      <Icon name={chip.icon} size={small ? 16 : 15} />
      {chip.label}
    </span>
  );
}
