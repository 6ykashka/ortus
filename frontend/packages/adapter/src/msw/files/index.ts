// Тег Files (W0.13, S1-20): сессия загрузки резервирует место (initiate) → клиент кладёт файл по ссылке →
// complete сверяет контрольную сумму, файл уходит на проверку (quarantined) → проверка завершается
// (`POST /api/v1/dev/scenario {scanFiles: true}` в режиме mock) → ready, ссылка на скачивание на 5 минут.
import type { components } from '@ortus/api-client';
import { QUOTA_TEXT } from '@ortus/domain/modules';

import { fileDto, quotaBytes, uploadDto } from '../core/dto.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import type { FileRow, Org, UploadRow } from '../core/state.ts';
import { addMs, MINUTE } from '../core/time.ts';
import { poolClosesParent } from '../fleet/pool-rules.ts';
import { fleetOf } from '../fleet/state.ts';
import { duplicateOf } from './duplicates.ts';
import { STORAGE_ORIGIN as STORAGE } from './storage.ts';

type S = components['schemas'];

const MAX_BYTES = 20 * 1024 * 1024;
const TICKET_TTL_MS = 15 * MINUTE;
const SESSION_TTL_MS = 60 * MINUTE;
const DOWNLOAD_TTL_MS = 5 * MINUTE;
const GONE = 'Загрузка не найдена или истекла.';

function uploadOr404(ctx: HandlerContext): UploadRow {
  const u = ctx.org().org.uploads.find((x) => x.uploadId === ctx.params.uploadId?.toLowerCase());
  return u ?? fail('not_found', GONE);
}

/** Сессия, у которой истёк срок, переходит в expired и отдаёт резерв. */
function expire(ctx: HandlerContext, u: UploadRow): void {
  if ((u.state === 'issued' || u.state === 'uploaded') && ctx.now() >= u.sessionExpiresAt) {
    u.state = 'expired';
    ctx.org().tenant.storage.reservedBytes -= u.reservedBytes;
  }
}

/**
 * W2.57 (AC-06, Q-W2.57-9): родитель из рейса перевода, закрытого участнику пулом, — 404, как несуществующий
 * (files.Hider backend). Видимость прочих родителей mock W1.00 по-прежнему не моделирует.
 */
export function poolClosed(
  ctx: HandlerContext,
  owner: S['ObjectRef'] | undefined,
  key: 'files.read' | 'files.upload',
): boolean {
  const t = ctx.org();
  if (!owner || t.owner || !t.member) return false;
  return poolClosesParent(fleetOf(t.org), owner, t.member.id, ctx.now(), key);
}

const fileOr404 = (ctx: HandlerContext): FileRow => {
  const { org } = ctx.org();
  const f = org.files.find((x) => x.id === ctx.params.fileId?.toLowerCase()) ?? fail('not_found');
  const owner = org.uploads.find((u) => u.fileId === f.id)?.owner;
  if (poolClosed(ctx, owner, 'files.read')) fail('not_found');
  return f;
};

/** W2.52 (0.6.1-stage2, антифрод фото): File.duplicateWarning — повтор по sha256, не отказ. */
function withDuplicate(org: Org, file: S['File']): S['File'] {
  const warning = duplicateOf(org, file.id);
  return warning ? { ...file, duplicateWarning: warning } : file;
}

export const filesHandlers: Registry = {
  initiateUpload: (ctx) => {
    const t = ctx.org();
    const b = ctx.body as S['UploadCreate'];
    if (b.sizeBytes > MAX_BYTES) fail('payload_too_large', 'Файл больше 20 МБ.');
    if (poolClosed(ctx, b.owner, 'files.upload')) fail('not_found');
    const st = t.tenant.storage;
    if (st.committedBytes + st.reservedBytes + b.sizeBytes > quotaBytes(t.tenant)) {
      fail('quota_exceeded', QUOTA_TEXT);
    }
    const now = ctx.now();
    const file: FileRow = {
      id: ctx.newId(),
      fileName: b.fileName,
      contentType: b.contentType,
      sizeBytes: b.sizeBytes,
      sha256: b.sha256,
      status: 'pending_upload',
      createdAt: now,
    };
    const upload: UploadRow = {
      uploadId: ctx.newId(),
      fileId: file.id,
      state: 'issued',
      purpose: b.purpose,
      owner: { ...b.owner },
      sizeBytes: b.sizeBytes,
      reservedBytes: b.sizeBytes,
      ticketExpiresAt: addMs(now, TICKET_TTL_MS),
      sessionExpiresAt: addMs(now, SESSION_TTL_MS),
      fileStatus: 'pending_upload',
      createdAt: now,
      requiredSha256: b.sha256,
      contentType: b.contentType,
    };
    if (t.member) upload.initiatedBy = t.member.id;
    t.org.files.push(file);
    t.org.uploads.push(upload);
    st.reservedBytes += b.sizeBytes;
    const body: S['UploadTicket'] = {
      uploadId: upload.uploadId,
      fileId: file.id,
      method: 'PUT',
      uploadUrl: `${STORAGE}/uploads/${upload.uploadId}`,
      requiredContentType: b.contentType,
      requiredSha256: b.sha256,
      expiresAt: upload.ticketExpiresAt,
      maxBytes: MAX_BYTES,
    };
    return { status: 201, body };
  },

  completeUpload: (ctx) => {
    const t = ctx.org();
    const u = uploadOr404(ctx);
    expire(ctx, u);
    if (u.state === 'expired' || u.state === 'aborted') fail('not_found', GONE);
    if (u.state === 'completed') fail('invalid_transition', 'Загрузка уже завершена.');
    if (poolClosed(ctx, u.owner, 'files.upload')) fail('not_found', GONE);
    const b = ctx.body as S['UploadComplete'];
    if (b.sha256 !== u.requiredSha256) {
      fail('validation_failed', 'Контрольная сумма не совпадает.', {
        violations: [
          { field: 'sha256', code: 'mismatch', message: 'Файл отличается от заявленного' },
        ],
      });
    }
    const file = t.org.files.find((f) => f.id === u.fileId) ?? fail('not_found', GONE);
    file.status = 'quarantined';
    u.state = 'completed';
    u.fileStatus = 'quarantined';
    u.completedAt = ctx.now();
    const st = t.tenant.storage;
    st.reservedBytes -= u.sizeBytes;
    st.committedBytes += u.sizeBytes;
    st.buckets.attachments += u.sizeBytes;
    st.measuredAt = ctx.now();
    return { body: withDuplicate(t.org, fileDto(file)) };
  },

  getUploadSession: (ctx) => {
    const u = uploadOr404(ctx);
    expire(ctx, u);
    return { body: uploadDto(u) };
  },

  abortUpload: (ctx) => {
    const t = ctx.org();
    const u = uploadOr404(ctx);
    expire(ctx, u);
    if (u.state === 'completed')
      fail('invalid_transition', 'Загрузка уже завершена: файл на проверке.');
    if (u.state !== 'issued' && u.state !== 'uploaded') {
      fail('invalid_transition', 'Загрузка уже отменена или истекла.');
    }
    u.state = 'aborted';
    t.tenant.storage.reservedBytes -= u.reservedBytes;
    u.reservedBytes = 0;
    t.org.files = t.org.files.filter((f) => f.id !== u.fileId);
    return { status: 204 };
  },

  getFile: (ctx) => ({ body: withDuplicate(ctx.org().org, fileDto(fileOr404(ctx))) }),

  getFileDownload: (ctx) => {
    const f = fileOr404(ctx);
    if (f.status !== 'ready') fail('photo_not_ready');
    const body: S['DownloadTicket'] = {
      fileId: f.id,
      downloadUrl: `${STORAGE}/files/${f.id}`,
      expiresAt: addMs(ctx.now(), DOWNLOAD_TTL_MS),
    };
    return { body };
  },
};
