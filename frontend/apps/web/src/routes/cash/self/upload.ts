// W5.33 · Загрузка фото чека подотчёта по сессии Files (контракт 0.12.0-stage5, Q-W4.00-cash-12): initiateUpload
// (purpose `expense_receipt`, владелец — счёт подотчёта `cash/account`, Q-W5.33-3) → PUT по билету (ход передачи) →
// completeUpload (сверка SHA-256) → ожидание проверки файла (getFile: quarantined → ready | rejected). Слот
// «готов» — только после `ready`: до ответа проверки ход держится на 99 %. Сбой PUT или completeUpload отменяет
// сессию. Тот же порядок, что у фото осмотра (logistics/driver/photos.ts), но другой владелец файла.
import { type ApiClient, unwrap } from '@ortus/api-client';

import { prepareImage } from '../../core/files/upload/image.ts';
import { type PutObject, putObject } from '../../core/files/upload/upload.tsx';

/** Транспорт загрузки (подменяется в тестах: MSW не обслуживает ссылку хранилища). */
export const transport: {
  put: PutObject;
  prepare: (file: File) => Promise<Blob>;
  pollMs: number;
  pollMax: number;
} = {
  put: putObject,
  prepare: prepareImage,
  pollMs: 1000,
  pollMax: 300,
};

/** Файл отклонён проверкой (антивирус, тип содержимого). */
export class ReceiptRejectedError extends Error {
  constructor() {
    super('rejected');
    this.name = 'ReceiptRejectedError';
  }
}

/** Проверка файла не закончилась за `pollMax` опросов. */
export class ReceiptTimeoutError extends Error {
  constructor() {
    super('scan timeout');
    this.name = 'ReceiptTimeoutError';
  }
}

export interface ReceiptUploadOptions {
  /** Ход 0–99 %: 100 % слот показывает только после проверки файла. */
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

const CAP = 99;
const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sha256(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Имя файла после перекодирования в JPEG: «IMG_0042.HEIC» → «IMG_0042.jpg». */
function fileNameOf(name: string, type: string): string {
  const base = name || 'receipt.jpg';
  if (type !== 'image/jpeg' || /\.jpe?g$/i.test(base)) return base;
  const dot = base.lastIndexOf('.');
  return `${dot > 0 ? base.slice(0, dot) : base}.jpg`;
}

/** Загружает фото чека и ждёт проверки; возвращает id готового (`ready`) файла. */
export async function uploadReceiptPhoto(
  api: ApiClient,
  tenantId: string,
  accountId: string,
  file: File,
  o: ReceiptUploadOptions = {},
): Promise<string> {
  const blob = await transport.prepare(file);
  const sum = await sha256(blob);
  const contentType = blob.type || file.type || 'application/octet-stream';
  const ticket = await unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/files/uploads', {
      params: { path: { tenantId }, header: idem() },
      body: {
        fileName: fileNameOf(file.name, contentType),
        contentType,
        sizeBytes: blob.size,
        sha256: sum,
        purpose: 'expense_receipt',
        owner: { moduleKey: 'cash', entityType: 'account', entityId: accountId },
      },
    }),
  );
  const abort = () =>
    api
      .DELETE('/api/v1/tenants/{tenantId}/files/uploads/{uploadId}', {
        params: { path: { tenantId, uploadId: ticket.uploadId }, header: idem() },
      })
      .catch(() => undefined);
  try {
    await transport.put(
      ticket.uploadUrl,
      blob,
      ticket.requiredContentType,
      o.signal,
      (n, total) => {
        if (total > 0) o.onProgress?.(Math.min(CAP, Math.floor((n / total) * 100)));
      },
    );
  } catch (e) {
    await abort();
    throw e;
  }
  let done;
  try {
    done = await unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/files/uploads/{uploadId}/complete', {
        params: { path: { tenantId, uploadId: ticket.uploadId }, header: idem() },
        body: { sha256: sum },
      }),
    );
  } catch (e) {
    await abort();
    throw e;
  }
  o.onProgress?.(CAP);
  let status = done.status;
  for (let i = 0; status !== 'ready' && status !== 'rejected'; i++) {
    if (i >= transport.pollMax) throw new ReceiptTimeoutError();
    if (o.signal?.aborted) throw new DOMException('Передача прервана', 'AbortError');
    await sleep(transport.pollMs);
    const r = await api.GET('/api/v1/tenants/{tenantId}/files/{fileId}', {
      params: { path: { tenantId, fileId: ticket.fileId } },
    });
    status = (await unwrap(r)).status;
  }
  if (status === 'rejected') throw new ReceiptRejectedError();
  return ticket.fileId;
}
