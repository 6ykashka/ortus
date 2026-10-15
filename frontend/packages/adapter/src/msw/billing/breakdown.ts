// Тег Billing, контракт 0.4.0-stage1 (W1.00, S1-22): разбивка занятого места «Хранилища» — группы эталона
// «Фото осмотров и отчётов», «Документы», «Вложения задач и форм», «Прочее» и модули-источники.
// «Альта» стартует с разбивки примера getStorageBreakdown/ok (эталон: 31,4 / 9,8 / 3,1 ГБ, PD-43); байты
// новых загрузок режима mock учитываются во «Вложениях». У остальных организаций файлы — «Вложения»,
// база и версии — «Прочее». Обе разбивки в сумме дают committedBytes getStorageUsage.
import type { components } from '@ortus/api-client';

import { example } from '../contract/index.ts';
import type { Registry } from '../core/registry.ts';

type S = components['schemas'];
type Key = S['StorageBreakdownGroup']['key'];

const KEYS: readonly Key[] = ['photos', 'documents', 'attachments', 'other'];
/** Модуль-владелец группы в режиме mock. */
const MODULE_OF: Readonly<Record<Key, string>> = {
  photos: 'fleet',
  documents: 'files',
  attachments: 'tasks',
  other: 'core',
};
/** Файлов в состоянии «Альты» на старте (пример getFile/ok). */
const SEED_FILES = 1;

export const storageBreakdownHandlers: Registry = {
  getStorageBreakdown: (ctx) => {
    const { tenant, org } = ctx.org();
    const st = tenant.storage;
    const seed =
      tenant.proto === 't-alta'
        ? (example('getStorageBreakdown', 'ok') as S['StorageBreakdown'] | undefined)
        : undefined;
    const bytes: Record<Key, number> = { photos: 0, documents: 0, attachments: 0, other: 0 };
    const counts: Record<Key, number> = { photos: 0, documents: 0, attachments: 0, other: 0 };
    if (seed) {
      for (const g of seed.groups) {
        bytes[g.key] = g.bytes;
        counts[g.key] = g.fileCount;
      }
      const seededFiles = bytes.photos + bytes.documents + bytes.attachments;
      bytes.attachments += st.buckets.attachments - seededFiles;
      counts.attachments += Math.max(0, org.files.length - SEED_FILES);
    } else {
      bytes.attachments = st.buckets.attachments;
      counts.attachments = org.files.length;
    }
    bytes.other = st.committedBytes - bytes.photos - bytes.documents - bytes.attachments;
    const body: S['StorageBreakdown'] = {
      committedBytes: st.committedBytes,
      groups: KEYS.map((key) => ({ key, bytes: bytes[key], fileCount: counts[key] })),
      modules: KEYS.map((key) => ({
        moduleKey: MODULE_OF[key],
        bytes: bytes[key],
        fileCount: counts[key],
      })),
      measuredAt: st.measuredAt,
      consistency: 'estimated',
    };
    return { body };
  },
};
