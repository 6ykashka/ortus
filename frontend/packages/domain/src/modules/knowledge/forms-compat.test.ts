// Совместимость с модулем «Формы» W4.20 (бриф W4.30 §4): оба модуля попадут в один барель
// `modules/index.ts`, поэтому имена не должны совпадать (иначе `tsc` — TS2308 на `export *`), а срез
// БЗ должен читаться и писаться `kbRun` W4.20 как есть. Сверка — по точке входа «Форм» через
// `forms-exports.test-util.ts`. Два `export *` ниже — та же проверка на уровне `tsc`.
import { describe, expect, it } from 'vitest';
import { exportedNames } from './exports.test-util.ts';
import type * as F from './forms-exports.test-util.ts';
import type {
  KbDataTable,
  KbRecord,
  KbSource,
  KbTableColumn,
  KbTableRow,
  KnowledgeSlice,
} from './types.ts';

export * from './forms-exports.test-util.ts';
export * from './index.ts';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Таблицы, строки и записи страниц — одной формы с типами W4.20 (проверяет `tsc`). */
const IN_STEP: Record<string, true> = {
  'KbDataTable = forms KbTable': true satisfies Same<KbDataTable, F.KbTable>,
  'KbTableColumn = forms KbColumn': true satisfies Same<KbTableColumn, F.KbColumn>,
  'KbTableRow = forms KbRow': true satisfies Same<KbTableRow, F.KbRow>,
  'KbRecord = forms KbEntry': true satisfies Same<KbRecord, F.KbEntry>,
  'KbSource = forms KbSrc': true satisfies Same<KbSource, F.KbSrc>,
  'KnowledgeSlice читается как FormsKnowledge':
    true satisfies KnowledgeSlice extends F.FormsKnowledge ? true : false,
};

const names = (file: string): Promise<string[]> => exportedNames(new URL(file, import.meta.url));

describe('совместимость с «Формами» W4.20', () => {
  it('общие имена W4.20 (KbColumn, KbEntry, KbTable) у базы знаний называются иначе', async () => {
    const [kb, forms] = await Promise.all([
      names('./index.ts'),
      names('./forms-exports.test-util.ts'),
    ]);
    expect(forms).toHaveLength(57);
    for (const n of ['KbColumn', 'KbEntry', 'KbTable']) {
      expect(forms).toContain(n);
      expect(kb).not.toContain(n);
    }
    // запись списка доступа узла, таблица страницы и её столбец
    expect(kb).toEqual(expect.arrayContaining(['KbAccessEntry', 'KbDataTable', 'KbTableColumn']));
  });

  it('таблицы и записи страниц совпадают с типами W4.20 по форме', () => {
    expect(Object.values(IN_STEP)).toEqual([true, true, true, true, true, true]);
  });
});
