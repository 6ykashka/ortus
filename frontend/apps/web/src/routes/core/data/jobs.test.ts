// W4.50 · Модель журнала «Выгрузки» (no-reference, B-6; 07-ux-and-data §3): строка задания — набор, время, состояние,
// строки файла, автор чужого задания; «Скачать» — только у своей готовой, «Отменить» — у очереди, «Отозвать» — у
// готовой.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import { activeJobs, jobView, orderJobs, ownPerson, viewQuery, viewSort } from './jobs.ts';

type S = components['schemas'];

const job = (o: Partial<S['DatasetExportJob']> = {}): S['DatasetExportJob'] => ({
  id: '10000000-0000-4000-8000-000000000001',
  datasetId: 'fleet.trips',
  datasetName: 'Поездки',
  state: 'queued',
  spec: { select: ['trip'], filters: [], sort: [] },
  columnLabels: ['Рейс'],
  timeZone: 'Europe/Moscow',
  rowLimit: 100000,
  requestedByMemberId: 'p-1',
  requestedByDisplayName: 'Дарья Зимина',
  createdAt: '2026-10-01T07:30:00Z',
  revision: 1,
  ...o,
});

describe('jobView', () => {
  it('в очереди: «В очереди», «Отменить», без «Скачать»; время — пояс задания', () => {
    expect(jobView(job(), true)).toEqual({
      id: job().id,
      title: 'Поездки',
      at: '01.10, 10:30',
      state: 'В очереди',
      tone: 'info',
      detail: '',
      download: false,
      stop: 'cancel',
      revision: 1,
    });
    expect(jobView(job({ state: 'running' }), true).state).toBe('Готовится');
  });

  it('готова: строки, срок хранения, «Скачать» и «Отозвать»; обрезанная — до предела', () => {
    const ready = job({
      state: 'ready',
      rowCount: 1234,
      truncated: false,
      fileName: 'Поездки-2026-10-01.csv',
      sizeBytes: 100,
      expiresAt: '2026-10-02T07:30:00Z',
      revision: 3,
    });
    expect(jobView(ready, true)).toMatchObject({
      state: 'Готова',
      tone: 'ok',
      detail: '1 234 строки · файл до 02.10, 10:30',
      download: true,
      stop: 'revoke',
    });
    expect(jobView({ ...ready, rowCount: 100000, truncated: true }, true).detail).toBe(
      '100 000 строк, обрезано по пределу · файл до 02.10, 10:30',
    );
  });

  it('чужая готовая (журнал владельца): автор, «Скачать» нет, «Отозвать» есть', () => {
    const v = jobView(
      job({ state: 'ready', rowCount: 2, truncated: false, expiresAt: '2026-10-02T07:30:00Z' }),
      false,
    );
    expect(v.download).toBe(false);
    expect(v.stop).toBe('revoke');
    expect(v.detail).toBe('2 строки · файл до 02.10, 10:30 · Дарья Зимина');
  });

  it('завершённые: сбой с кодом, отзыв с причиной, истекла — без действий', () => {
    expect(jobView(job({ state: 'failed', failureCode: 'timeout' }), true)).toMatchObject({
      state: 'Не удалась',
      tone: 'error',
      detail: 'Не уложилась во время',
      stop: null,
      download: false,
    });
    expect(
      jobView(job({ state: 'revoked', revokeReason: 'permissions_changed' }), true),
    ).toMatchObject({ state: 'Отозвана', tone: 'warn', detail: 'Права изменились', stop: null });
    expect(jobView(job({ state: 'revoked', revokeReason: 'author' }), true).detail).toBe(
      'Отозвана автором',
    );
    expect(jobView(job({ state: 'expired', rowCount: 2, truncated: false }), true)).toMatchObject({
      state: 'Срок хранения истёк',
      tone: 'muted',
      detail: '2 строки',
      stop: null,
      download: false,
    });
  });

  it('строки файла — с согласованием числа: 1 строка, 2 строки, 5 строк, 11 строк, 21 строка', () => {
    const rows = (n: number, truncated = false) =>
      jobView(job({ state: 'expired', rowCount: n, truncated }), true).detail;
    expect([1, 2, 5, 11, 21, 0].map((n) => rows(n))).toEqual([
      '1 строка',
      '2 строки',
      '5 строк',
      '11 строк',
      '21 строка',
      '0 строк',
    ]);
    expect(rows(3, true)).toBe('3 строки, обрезано по пределу');
  });
});

describe('orderJobs — новые сверху', () => {
  const a = job({ id: 'a', createdAt: '2026-10-01T07:30:00Z' });
  const b = job({ id: 'b', createdAt: '2026-10-01T07:30:00Z' });
  const c = job({ id: 'c', createdAt: '2026-10-01T07:31:00Z' });

  it('по моменту постановки: позже — выше', () => {
    expect(orderJobs([a, c], []).map((j) => j.id)).toEqual(['c', 'a']);
  });

  it('тот же момент: новое (его не было в прошлом ответе) — выше прежних', () => {
    expect(orderJobs([a, b], [a]).map((j) => j.id)).toEqual(['b', 'a']);
    expect(orderJobs([b, a], [b]).map((j) => j.id)).toEqual(['a', 'b']);
  });

  it('тот же момент, оба прежние — порядок прошлого ответа; оба новые — порядок сервера', () => {
    expect(orderJobs([a, b], [b, a]).map((j) => j.id)).toEqual(['b', 'a']);
    expect(orderJobs([a, b], []).map((j) => j.id)).toEqual(['a', 'b']);
  });

  it('микросекунды стенда: «…00.000001Z» позже «…00Z»', () => {
    const x = job({ id: 'x', createdAt: '2026-10-01T07:30:00Z' });
    const y = job({ id: 'y', createdAt: '2026-10-01T07:30:00.000001Z' });
    expect(orderJobs([x, y], [x, y]).map((j) => j.id)).toEqual(['y', 'x']);
  });
});

describe('журнал и виды', () => {
  it('activeJobs — есть задание в очереди или в работе (опрос журнала)', () => {
    expect(activeJobs([job({ state: 'ready' }), job({ state: 'running' })])).toBe(true);
    expect(activeJobs([job({ state: 'ready' }), job({ state: 'failed' })])).toBe(false);
    expect(activeJobs([])).toBe(false);
  });

  it('ownPerson — профиль участника по аккаунту', () => {
    const members = [{ id: 'p-1', userId: 'u-1' }, { id: 'p-2', userId: 'u-2' }, { id: 'p-3' }];
    expect(ownPerson(members, 'u-2')).toBe('p-2');
    expect(ownPerson(members, 'u-9')).toBeUndefined();
  });

  it('viewQuery и viewSort — фильтр и сортировка вида', () => {
    expect(viewQuery(' Р-70 ', null)).toEqual({ filters: [], search: 'Р-70', sort: [] });
    expect(viewQuery('', { key: 'trip', dir: 'desc' })).toEqual({
      filters: [],
      sort: [{ fieldKey: 'trip', direction: 'desc' }],
    });
    expect(viewSort({ filters: [], sort: [{ fieldKey: 'trip', direction: 'asc' }] })).toEqual({
      key: 'trip',
      dir: 'asc',
    });
    expect(viewSort({ filters: [], sort: [] })).toBeNull();
  });
});
