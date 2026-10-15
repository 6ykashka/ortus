// Место организации: разбивка, учёт загрузки, блок по квоте (api.js 14.10:970–985).
import { describe, expect, it } from 'vitest';
import { addUsage, QUOTA_TEXT, storageTotal, uploadQuotaError } from './storage.ts';

describe('storageTotal: сумма разбивки, ГБ', () => {
  it('«Альта» — 46,2 ГБ, «Лотос» — 12,4 ГБ (как usedGb организаций)', () => {
    expect(
      storageTotal([
        ['Фото осмотров и отчётов', 31.4],
        ['Документы', 9.8],
        ['Вложения задач и форм', 3.1],
        ['Прочее', 1.9],
      ]),
    ).toBe(46.2);
    expect(
      storageTotal([
        ['Фото работ и техкарты', 6.2],
        ['Документы', 3.9],
        ['Вложения задач и форм', 1.6],
        ['Прочее', 0.7],
      ]),
    ).toBe(12.4);
    expect(storageTotal([])).toBe(0);
  });
});

describe('addUsage: занятое место после загрузки', () => {
  it.each([
    [46.2, 3.2e6, 46.203],
    [0, 1e9, 1],
    [12.4, 400, 12.4],
  ])('%s ГБ + %s байт → %s ГБ', (used, bytes, want) => {
    expect(addUsage(used, bytes)).toBe(want);
  });
});

describe('uploadQuotaError: загрузка при заполненном месте', () => {
  const full = { usedGb: 46.2, quotaGb: 25 };
  it('место заполнено и смен нет — загрузка закрыта', () => {
    expect(uploadQuotaError(full, [{ status: 'planned' }, { status: 'accepted' }])).toBe(
      QUOTA_TEXT,
    );
    expect(QUOTA_TEXT).toBe('Место организации заполнено. Загрузка новых файлов недоступна.');
    expect(uploadQuotaError({ usedGb: 25, quotaGb: 25 }, [])).toBe(QUOTA_TEXT);
  });

  it.each(['inspection', 'on_route', 'returning', 'rework'])(
    'начатая смена (%s) дописывает фото во временный резерв',
    (status) => {
      expect(uploadQuotaError(full, [{ status }])).toBeNull();
    },
  );

  it('место есть — ошибки нет', () => {
    expect(uploadQuotaError({ usedGb: 46.2, quotaGb: 100 }, [])).toBeNull();
  });
});
