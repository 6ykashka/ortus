// W1.24 · Место организации: числа и тон полосы (omVM :3123–3135), разбивка (getStorageBreakdown, S1-22).
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  breakdownRows,
  changeDoneText,
  gbNum,
  gbText,
  GiB,
  moduleRows,
  quoteLine,
  storageView,
} from './storage.ts';

type S = components['schemas'];

/** Пример getStorageUsage/ok «Альты»: 46,2 из 100 ГБ. */
const usage = (o: Partial<S['StorageUsage']> = {}): S['StorageUsage'] => ({
  quotaBytes: 107374182400,
  committedBytes: 49606872269,
  reservedBytes: 0,
  buckets: [],
  measuredAt: '2026-10-01T07:30:00Z',
  consistency: 'estimated',
  writeStatus: 'allowed',
  ...o,
});

/** Пример getStorageBreakdown/ok. */
const breakdown: S['StorageBreakdown'] = {
  committedBytes: 49606872269,
  groups: [
    { key: 'photos', bytes: 33715493274, fileCount: 1840 },
    { key: 'documents', bytes: 10522669875, fileCount: 212 },
    { key: 'attachments', bytes: 3328599654, fileCount: 96 },
    { key: 'other', bytes: 2040109466, fileCount: 0 },
  ],
  modules: [
    { moduleKey: 'fleet', bytes: 33715493274, fileCount: 1840 },
    { moduleKey: 'files', bytes: 10522669875, fileCount: 212 },
    { moduleKey: 'tasks', bytes: 3328599654, fileCount: 96 },
    { moduleKey: 'core', bytes: 2040109466, fileCount: 0 },
  ],
  measuredAt: '2026-10-01T07:30:00Z',
  consistency: 'estimated',
};

describe('числа места', () => {
  it('ГБ (ГиБ) с одной цифрой после запятой, целые — без дробной части', () => {
    expect(gbNum(49606872269)).toBe(46.2);
    expect(gbText(49606872269)).toBe('46,2');
    expect(gbText(100 * GiB)).toBe('100');
    expect(gbText(0)).toBe('0');
  });
});

describe('storageView (omVM :3123–3135)', () => {
  it('«46,2 ГБ» из «100 ГБ», доля 46.2%, полоса акцентом, не перебор', () => {
    const v = storageView(usage());
    expect(v).toMatchObject({
      usedNum: 46.2,
      quotaNum: 100,
      used: '46,2 ГБ',
      quota: '100 ГБ',
      pct: '46.2%',
      tone: 'accent',
      over: false,
      reserved: '0',
    });
  });

  it('больше 85 % — полоса warn; занято не меньше лимита — danger и текст перебора', () => {
    expect(storageView(usage({ committedBytes: 90 * GiB })).tone).toBe('warn');
    const over = storageView(usage({ quotaBytes: 25 * GiB }));
    expect(over.tone).toBe('danger');
    expect(over.over).toBe(true);
    expect(over.pct).toBe('100.0%');
    expect(over.overText).toBe(
      'Занято больше лимита на 21,2 ГБ. Новые загрузки заблокированы, файлы не удалены. Освободите место в разделе «Файлы» или увеличьте лимит.',
    );
  });

  it('writeStatus blocked — перебор, даже если байты ниже лимита (резерв, оценка БД)', () => {
    expect(storageView(usage({ writeStatus: 'blocked' })).over).toBe(true);
  });

  it('занято считает и резерв начатых загрузок (committed + reserved)', () => {
    const v = storageView(usage({ committedBytes: 40 * GiB, reservedBytes: 2 * GiB }));
    expect(v.used).toBe('42 ГБ');
    expect(v.reserved).toBe('2');
  });

  it('варианты лимита 25…500 ГБ, меньше занятого помечены', () => {
    expect(storageView(usage()).options).toEqual([
      { value: '25', label: '25 ГБ · меньше занятого' },
      { value: '50', label: '50 ГБ' },
      { value: '100', label: '100 ГБ' },
      { value: '250', label: '250 ГБ' },
      { value: '500', label: '500 ГБ' },
    ]);
  });
});

describe('разбивка (getStorageBreakdown)', () => {
  it('группы эталона в порядке photos, documents, attachments, other', () => {
    expect(breakdownRows(breakdown)).toEqual([
      { key: 'photos', label: 'Фото осмотров и отчётов', gb: '31,4 ГБ', files: 1840 },
      { key: 'documents', label: 'Документы', gb: '9,8 ГБ', files: 212 },
      { key: 'attachments', label: 'Вложения задач и форм', gb: '3,1 ГБ', files: 96 },
      { key: 'other', label: 'Прочее', gb: '1,9 ГБ', files: 0 },
    ]);
  });

  it('модули: имена отраслевых и базовых модулей, ядро — служебные данные', () => {
    expect(moduleRows(breakdown).map((r) => r.label)).toEqual([
      'Логистика',
      'Файлы',
      'Задачи',
      'База данных и служебные данные',
    ]);
  });

  it('неизвестный ключ модуля не выводится: такие модули — одна строка «Прочее» в конце', () => {
    const rows = moduleRows({
      ...breakdown,
      modules: [
        { moduleKey: 'x-new', bytes: GiB, fileCount: 10 },
        ...breakdown.modules,
        { moduleKey: 'y-new', bytes: GiB / 2, fileCount: 5 },
      ],
    });
    expect(rows.map((r) => r.label)).toEqual([
      'Логистика',
      'Файлы',
      'Задачи',
      'База данных и служебные данные',
      'Прочее',
    ]);
    expect(rows.at(-1)).toEqual({ key: 'other', label: 'Прочее', gb: '1,5 ГБ', files: 15 });
    expect(rows.some((r) => /x-new|y-new/.test(r.label))).toBe(false);
  });

  it('группа без данных сервера — 0 ГБ, порядок эталона сохраняется', () => {
    const rows = breakdownRows({ ...breakdown, groups: breakdown.groups.slice(3) });
    expect(rows.map((r) => [r.key, r.gb])).toEqual([
      ['photos', '0 ГБ'],
      ['documents', '0 ГБ'],
      ['attachments', '0 ГБ'],
      ['other', '1,9 ГБ'],
    ]);
  });
});

describe('смена лимита: строка расчёта и тост результата', () => {
  const change = (o: Partial<S['StorageChange']> = {}): S['StorageChange'] => ({
    id: 'c1',
    state: 'quoted',
    requestedQuotaBytes: 250 * GiB,
    ...o,
  });

  it('строка расчёта: с ценой в месяц; без recurringCharge — без цены, а не «0 ₽»', () => {
    expect(
      quoteLine(change({ recurringCharge: { amountMinor: 250000, currency: 'RUB' } })),
    ).toMatch(/^Лимит 250 ГБ · 2\s500 ₽ в месяц$/);
    expect(quoteLine(change())).toBe('Лимит 250 ГБ');
  });

  it('applied — «Лимит места: N ГБ»; scheduled — запрошенное уменьшение с даты вступления', () => {
    expect(changeDoneText(change({ state: 'applied' }))).toBe('Лимит места: 250 ГБ');
    expect(
      changeDoneText(
        change({
          state: 'scheduled',
          requestedQuotaBytes: 50 * GiB,
          effectiveAt: '2026-11-01T00:00:00Z',
        }),
      ),
    ).toBe('Запрошено уменьшение до 50 ГБ с 01.11.2026');
    expect(changeDoneText(change({ state: 'scheduled', requestedQuotaBytes: 50 * GiB }))).toBe(
      'Запрошено уменьшение до 50 ГБ',
    );
  });
});
