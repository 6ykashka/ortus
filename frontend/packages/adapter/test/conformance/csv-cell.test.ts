// W2.52 (0.6.1-stage2, возврат 1): ячейка CSV выгрузки exportDataset сценарного сервера. Защита от формул — только у
// текстовых ячеек (текст, варианты, ссылки, файлы), в том числе после ведущих пробелов (OWASP «CSV Injection»);
// отрицательные деньги и числа остаются числами для Excel и 1С («-1234,50» без апострофа).
import { describe, expect, it } from 'vitest';

import type { Cell } from '../../src/msw/data/catalog.ts';
import { csvCell } from '../../src/msw/data/index.ts';

const text = (s: string): Cell => ({ value: { type: 'text', value: s }, text: s, num: null });

describe('csvCell — ячейка CSV выгрузки', () => {
  it('текст с = + - @ TAB CR в начале — с апострофом, в том числе после ведущих пробелов', () => {
    expect(csvCell(text('=1+2'))).toBe("'=1+2");
    expect(csvCell(text('  =HYPERLINK("x")'))).toBe('"\'  =HYPERLINK(""x"")"');
    expect(csvCell(text(' @SUM(A1)'))).toBe("' @SUM(A1)");
    expect(csvCell(text('\tтаб'))).toBe("'\tтаб");
    expect(csvCell(text('-Тент'))).toBe("'-Тент");
    expect(csvCell(text('Тент = борт'))).toBe('Тент = борт');
    expect(csvCell(text('  Тент'))).toBe('  Тент');
    const choice: Cell = {
      value: { type: 'choices', value: ['custom_1'] },
      text: '+Своя',
      num: null,
    };
    expect(csvCell(choice)).toBe("'+Своя");
  });

  it('деньги и числа — без апострофа и с запятой, даже отрицательные', () => {
    const money: Cell = {
      value: { type: 'money', value: { amountMinor: -123450, currency: 'RUB' } },
      text: '-1 234,50 ₽',
      num: -1234.5,
    };
    expect(csvCell(money)).toBe('-1234,50');
    const decimal: Cell = { value: { type: 'decimal', value: '-2.5' }, text: '-2,5', num: -2.5 };
    expect(csvCell(decimal)).toBe('-2,5');
  });
});
