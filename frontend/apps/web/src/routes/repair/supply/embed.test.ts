// W6.22 · Вкладка «Снабжение» зарегистрирована в реестре вкладок карточки объекта W6.20 (TAB_PANELS.supply).
import { describe, expect, it } from 'vitest';

import { TAB_PANELS } from '../tabs.tsx';

describe('вкладка «Снабжение» в карточке объекта', () => {
  it('имеет панель в реестре, а не заглушку', () => {
    expect(TAB_PANELS.supply).toBeTypeOf('function');
  });
});
