import { describe, expect, it } from 'vitest';
import { ApiError } from '../../core/errors/index.ts';
import { checkFiles, FILE_MAX_BYTES, FILES_PER_TASK } from './files.ts';
import type { FileDraft } from './types.ts';

const MB = 1048576;
const file = (o: Partial<FileDraft> = {}): FileDraft => ({
  name: 'Счёт № 418 от 07.10.pdf',
  size: 184320,
  type: 'application/pdf',
  ...o,
});

const err = (f: () => unknown): { code: string; message: string } => {
  try {
    f();
  } catch (e) {
    if (e instanceof ApiError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error('нет ошибки');
};

describe('checkFiles: вложения задачи (api.js:120–127)', () => {
  it('лимиты: 20 МБ на файл, 30 файлов на задачу', () => {
    expect(FILE_MAX_BYTES).toBe(20 * MB);
    expect(FILES_PER_TASK).toBe(30);
  });

  it.each([
    'image/jpeg',
    'image/png',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.oasis.opendocument.text',
    'application/zip',
  ])('принимается тип %s', (type) => {
    expect(checkFiles([file({ type })], 0)).toHaveLength(1);
  });

  it.each([
    [
      file({ type: 'application/x-msdownload', name: 'setup.exe' }),
      'Файл «setup.exe» не принят: такой тип не принимаем',
    ],
    [
      file({ type: undefined, name: 'без типа' }),
      'Файл «без типа» не принят: такой тип не принимаем',
    ],
    [file({ size: 0, name: 'пусто.txt' }), 'Файл «пусто.txt» не принят: пустой файл'],
    [file({ size: Number.NaN, name: 'nan.pdf' }), 'Файл «nan.pdf» не принят: пустой файл'],
    [
      file({ size: 20 * MB + 1, name: 'видео.mp4', type: 'video/mp4' }),
      'Файл «видео.mp4» не принят: больше 20 МБ',
    ],
  ])('%j → «%s»', (f, message) => {
    expect(err(() => checkFiles([file(), f], 0))).toEqual({ code: 'validation', message });
  });

  it('ровно 20 МБ принимается', () => {
    expect(checkFiles([file({ size: 20 * MB })], 0)).toHaveLength(1);
  });

  it.each([
    [30, 0, true],
    [1, 29, true],
    [2, 29, false],
    [31, 0, false],
  ])('%i новых + %i уже есть → %s', (n, have, ok) => {
    const list = Array.from({ length: n }, (_, i) => file({ name: 'f' + i + '.pdf' }));
    if (ok) expect(checkFiles(list, have)).toHaveLength(n);
    else
      expect(err(() => checkFiles(list, have))).toEqual({
        code: 'validation',
        message: 'К задаче можно прикрепить не больше 30 файлов',
      });
  });

  it('имя обрезается до 180 символов, ссылка по умолчанию — null; лишние поля отбрасываются', () => {
    const long = 'а'.repeat(200) + '.pdf';
    const [a, b] = checkFiles(
      [
        { ...file({ name: long }), extra: 1 } as FileDraft,
        file({ url: 'blob:x', type: 'image/png' }),
      ],
      0,
    );
    expect(a).toEqual({ name: 'а'.repeat(180), size: 184320, type: 'application/pdf', url: null });
    expect(b).toEqual({
      name: 'Счёт № 418 от 07.10.pdf',
      size: 184320,
      type: 'image/png',
      url: 'blob:x',
    });
  });
});
