import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROP_KEYS, UNITS } from '../contract';

/** Контракт 14.10: копия design/docs/design-system/components.md 0.2 до обновления design/ (W0.02). */
const md = readFileSync(join(import.meta.dirname, '../../contract/components.md'), 'utf8');

interface Row {
  units: string[];
  props: string[];
  /** «`Dialog` / `ConfirmDialog`» — пропсы строки делятся между единицами. */
  shared: boolean;
}

function parseRows(text: string): Row[] {
  const table = text.split('## Компоненты')[1]?.split('\n## ')[0] ?? '';
  return table
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => {
      const [, unitsCell = '', propsCell = ''] = line.split('|').map((c) => c.trim());
      return {
        units: [...unitsCell.matchAll(/`([A-Za-z]+)`/g)].map((m) => m[1] as string),
        props: [...propsCell.replace(/\([^)]*\)/g, '').matchAll(/`([A-Za-z]+)[^`]*`/g)].map(
          (m) => m[1] as string,
        ),
        shared: unitsCell.includes(' / '),
      };
    });
}

const rows = parseRows(md);
const keysOf = (unit: string): readonly string[] =>
  (PROP_KEYS as Record<string, readonly string[]>)[unit] ?? [];

describe('контракт пропсов ↔ components.md 14.10', () => {
  it('таблица компонентов версии 0.2 — 31 строка, включая Gantt, ScheduleChangePreview, Lookahead', () => {
    expect(rows).toHaveLength(31);
    expect(rows.flatMap((r) => r.units)).toEqual(
      expect.arrayContaining(['Gantt', 'ScheduleChangePreview', 'Lookahead']),
    );
  });

  it('каждая единица таблицы есть в UNITS', () => {
    const missing = rows.flatMap((r) => r.units).filter((u) => !UNITS.includes(u as never));
    expect(missing).toEqual([]);
  });

  it('каждый проп таблицы есть в PROP_KEYS своей единицы', () => {
    const missing: string[] = [];
    for (const row of rows) {
      for (const prop of row.props) {
        const has = row.shared
          ? row.units.some((u) => keysOf(u).includes(prop))
          : row.units.every((u) => keysOf(u).includes(prop));
        if (!has) missing.push(`${row.units.join('/')}.${prop}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('PROP_KEYS описывает ровно UNITS', () => {
    expect(Object.keys(PROP_KEYS).sort()).toEqual([...UNITS].sort());
  });
});
