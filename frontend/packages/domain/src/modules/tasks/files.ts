// Вложения задачи (api.js 14.10:120–127, docs/21 «Создание задачи и вложения»): до 20 МБ каждое,
// до 30 на задачу; фото, PDF, текст, документы Office и ZIP. Доступ к файлу — как к задаче.
import { ApiError } from '../../core/errors/index.ts';
import type { FileDraft } from './types.ts';

export const FILE_MAX_BYTES = 20 * 1048576;
export const FILES_PER_TASK = 30;
const FILE_OK =
  /^(image\/|application\/pdf|text\/|application\/(msword|vnd\.openxmlformats|vnd\.ms-excel|vnd\.oasis|zip))/;

/** Принятый файл до присвоения id, автора и времени. */
export interface CheckedFile {
  name: string;
  size: number;
  type: string;
  url: string | null;
}

function rejectWhy(f: FileDraft): string | null {
  if (f.size > FILE_MAX_BYTES) return 'больше 20 МБ';
  if (!(f.size > 0)) return 'пустой файл';
  if (!FILE_OK.test(f.type ?? '')) return 'такой тип не принимаем';
  return null;
}

/** Проверяет новые файлы при `have` уже прикреплённых; ошибка — `validation` с текстом эталона. */
export function checkFiles(list: readonly FileDraft[], have: number): CheckedFile[] {
  if (have + list.length > FILES_PER_TASK) {
    throw new ApiError('validation', 'К задаче можно прикрепить не больше 30 файлов');
  }
  for (const f of list) {
    const why = rejectWhy(f);
    if (why) throw new ApiError('validation', 'Файл «' + f.name + '» не принят: ' + why);
  }
  return list.map((f) => ({
    name: String(f.name).slice(0, 180),
    size: f.size,
    type: f.type ?? '',
    url: f.url || null,
  }));
}
