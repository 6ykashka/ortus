// W1.24 · Модель «Файлов»: строки эталона filesVM :4219–4231 и решения брифа §10 (Q-W1.24-9, -10).
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import { fileParent, fileRow, fileSize, filesUsage, safeDownloadUrl } from './vm.ts';

type S = components['schemas'];

const item = (
  file: Partial<S['File']>,
  owner: Partial<S['ObjectRef']> = {},
  extra: Partial<S['FileListItem']> = {},
): S['FileListItem'] => ({
  file: {
    id: 'f1',
    fileName: 'Р-208 · спереди.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 2457600,
    sha256: 'a'.repeat(64),
    status: 'ready',
    createdAt: '2026-10-01T06:05:00Z',
    ...file,
  },
  purpose: 'inspection',
  owner: { moduleKey: 'fleet', entityType: 'reservation', entityId: 'r1', ...owner },
  ...extra,
});

describe('размер файла (:4223–4226)', () => {
  it('мегабайты с одной цифрой, целые без дробной; меньше мегабайта — килобайты', () => {
    expect(fileSize(1258291, 'ready')).toBe('1,2 МБ');
    expect(fileSize(16 * 1024 * 1024, 'ready')).toBe('16 МБ');
    expect(fileSize(2457600, 'quarantined')).toBe('2,3 МБ');
    expect(fileSize(300 * 1024, 'ready')).toBe('300 КБ');
  });

  it('отклонённый файл — «—»', () => {
    expect(fileSize(2457600, 'rejected')).toBe('—');
  });
});

describe('родитель файла (Q-W1.24-9)', () => {
  it('рейс, расход рейса, осмотр, машина — по ownerTitle родителя', () => {
    expect(fileParent(item({}, { entityType: 'trip' }, { ownerTitle: 'Р-208' }))).toBe(
      'Рейс Р-208',
    );
    expect(fileParent(item({}, { entityType: 'expense' }, { ownerTitle: 'Р-208' }))).toBe(
      'Рейс Р-208 · расход',
    );
    expect(fileParent(item({}, { entityType: 'inspection' }, { ownerTitle: 'Р-196' }))).toBe(
      'Рейс Р-196',
    );
    expect(fileParent(item({}, { entityType: 'vehicle' }, { ownerTitle: 'Е 905 НА 77' }))).toBe(
      'Машина Е 905 НА 77',
    );
  });

  it('бронь — «Бронь машины»; вид с префиксом модуля (fleet.trip) понимается так же', () => {
    expect(fileParent(item({}))).toBe('Бронь машины');
    expect(fileParent(item({}, { entityType: 'fleet.trip' }, { ownerTitle: 'Р-211' }))).toBe(
      'Рейс Р-211',
    );
  });

  it('неизвестный вид: модуль и заголовок, без заголовка — «Объект модуля «…»»', () => {
    expect(
      fileParent(item({}, { moduleKey: 'tasks', entityType: 'task' }, { ownerTitle: 'T-58' })),
    ).toBe('Задачи · T-58');
    expect(fileParent(item({}, { moduleKey: 'repairs', entityType: 'project' }))).toBe(
      'Объект модуля «Ремонт и стройка»',
    );
  });

  it('неизвестный ключ модуля пользователю не выводится: заголовок родителя или «Объект другого модуля»', () => {
    expect(
      fileParent(item({}, { moduleKey: 'x-new', entityType: 'thing' }, { ownerTitle: 'T-58' })),
    ).toBe('T-58');
    expect(fileParent(item({}, { moduleKey: 'x-new', entityType: 'thing' }))).toBe(
      'Объект другого модуля',
    );
  });
});

describe('короткая ссылка «Открыть»: только http(s)', () => {
  it('https и http — адрес как есть; javascript:, data:, blob:, относительный и мусор — null', () => {
    expect(safeDownloadUrl('https://storage.example.invalid/files/1?sig=a')).toBe(
      'https://storage.example.invalid/files/1?sig=a',
    );
    expect(safeDownloadUrl('http://127.0.0.1:9000/files/1')).toBe('http://127.0.0.1:9000/files/1');
    for (const bad of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'blob:https://ortus.test/1',
      '/files/1',
      '',
      'not a url',
    ]) {
      expect(safeDownloadUrl(bad), bad).toBeNull();
    }
  });
});

describe('строка файла (:4223–4227, Q-W1.24-10)', () => {
  it('готовый файл осмотра: иконка photo_library, чип «Готов», «Открыть» доступна', () => {
    expect(fileRow(item({}))).toEqual({
      id: 'f1',
      icon: 'photo_library',
      name: 'Р-208 · спереди.jpg',
      parent: 'Бронь машины',
      chip: { label: 'Готов', tone: 'ok', icon: 'check_circle' },
      size: '2,3 МБ',
      ready: true,
    });
  });

  it('чипы: «Проверяется», «Отклонён», «Загружается»; «Открыть» только у готового', () => {
    const q = fileRow(item({ status: 'quarantined' }));
    expect(q.chip).toEqual({ label: 'Проверяется', tone: 'info', icon: 'shield' });
    expect(q.ready).toBe(false);
    expect(fileRow(item({ status: 'rejected' })).chip).toEqual({
      label: 'Отклонён',
      tone: 'danger',
      icon: 'block',
    });
    expect(fileRow(item({ status: 'pending_upload' })).chip).toEqual({
      label: 'Загружается',
      tone: 'info',
      icon: 'upload',
    });
  });

  it('иконки: чек — receipt, PDF — picture_as_pdf, изображение — image, архив — folder_zip', () => {
    expect(fileRow(item({}, {}, { purpose: 'expense_receipt' })).icon).toBe('receipt');
    const att = { purpose: 'form_attachment' as const };
    expect(fileRow(item({ contentType: 'application/pdf' }, {}, att)).icon).toBe('picture_as_pdf');
    expect(fileRow(item({ contentType: 'image/jpeg' }, {}, att)).icon).toBe('image');
    expect(fileRow(item({ contentType: 'application/zip' }, {}, att)).icon).toBe('folder_zip');
    expect(fileRow(item({ contentType: 'text/csv' }, {}, att)).icon).toBe('description');
  });
});

describe('место организации на «Файлах» (:4228–4230)', () => {
  const usage = (committedBytes: number, quotaBytes = 107374182400): S['StorageUsage'] => ({
    quotaBytes,
    committedBytes,
    reservedBytes: 0,
    buckets: [],
    measuredAt: '2026-10-01T07:30:00Z',
    consistency: 'estimated',
    writeStatus: 'allowed',
  });

  it('«46,2 из 100 ГБ», полоса акцентом', () => {
    expect(filesUsage(usage(49606872269))).toEqual({
      text: '46,2 из 100 ГБ',
      pct: '46.2%',
      tone: 'accent',
    });
  });

  it('занято не меньше лимита — полоса danger, ширина 100 %', () => {
    expect(filesUsage(usage(107374182400))).toEqual({
      text: '100 из 100 ГБ',
      pct: '100.0%',
      tone: 'danger',
    });
  });
});
