// Антифрод фото (W2.52, контракт 0.6.1-stage2; ответ владельца 17.10, модель данных п. 4): повтор файла по sha256
// среди более ранних не отклонённых файлов организации (tenant 0017 files_sha256_idx) — предупреждение, не отказ.
// Ответ не раскрывает id, владельцев и названия прежних файлов (FileDuplicateWarning).
import type { components } from '@ortus/api-client';

import type { Org } from '../core/state.ts';

type S = components['schemas'];

const sameRef = (a: S['ObjectRef'] | undefined, b: S['ObjectRef'] | undefined): boolean =>
  !!a &&
  !!b &&
  a.moduleKey === b.moduleKey &&
  a.entityType === b.entityType &&
  a.entityId.toLowerCase() === b.entityId.toLowerCase();

/**
 * Предупреждение о повторе файла `fileId`: более ранние (по порядку загрузки) файлы с тем же sha256, кроме
 * отклонённых и не загруженных. `peers` — файлы того же владельца вне сессий загрузки (фото одного осмотра).
 */
export function duplicateOf(
  org: Org,
  fileId: string,
  peers: ReadonlySet<string> = new Set(),
): S['FileDuplicateWarning'] | undefined {
  const at = org.files.findIndex((f) => f.id === fileId);
  const file = org.files[at];
  if (!file) return undefined;
  const earlier = org.files
    .slice(0, at)
    .filter(
      (f) => f.sha256 === file.sha256 && f.status !== 'rejected' && f.status !== 'pending_upload',
    );
  const first = earlier[0];
  if (!first) return undefined;
  const ownerOf = (id: string) => org.uploads.find((u) => u.fileId === id)?.owner;
  const mine = ownerOf(file.id);
  return {
    code: 'duplicate_sha256',
    firstSeenAt: earlier.reduce((m, f) => (f.createdAt < m ? f.createdAt : m), first.createdAt),
    previousCount: earlier.length,
    sameOwner: earlier.some((f) => peers.has(f.id) || sameRef(ownerOf(f.id), mine)),
  };
}

/** Серверное время приёма файла: завершение сессии загрузки (completeUpload), иначе момент записи файла. */
export function receivedAt(org: Org, fileId: string): string | undefined {
  const upload = org.uploads.find((u) => u.fileId === fileId);
  return upload?.completedAt ?? org.files.find((f) => f.id === fileId)?.createdAt;
}
