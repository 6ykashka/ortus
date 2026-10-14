import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { barrelSource } from '../../scripts/gen-barrel.mjs';
import { UNITS } from '../contract';
import * as ui from '../index';

describe('баррель src/index.ts генерируется (план §3.5)', () => {
  it('файл совпадает с выводом scripts/gen-barrel.mjs', () => {
    const file = readFileSync(join(import.meta.dirname, '../index.ts'), 'utf8');
    expect(file).toBe(barrelSource());
  });

  it('рантайм-экспорты: все единицы кроме AppShell (только тип) и константы контракта', () => {
    const expected = [...UNITS.filter((u) => u !== 'AppShell'), 'OWNERS', 'PROP_KEYS', 'UNITS'];
    expect(Object.keys(ui).sort()).toEqual(expected.sort());
  });
});
