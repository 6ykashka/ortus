// W2.22 · Загрузка фото осмотра и чека по сессии W1.09/W1.24 (бриф §4): initiateUpload (резерв места, билет PUT)
// → PUT по билету (ход передачи) → completeUpload (сверка SHA-256) → ожидание проверки файла (getFile:
// quarantined → ready | rejected). Слот «готов» только после `ready` (бриф §10 п. 6): до ответа проверки ход
// держится на 99 %. Сбой до проверки файла (PUT, completeUpload) отменяет сессию (резерв освобождается). Очередь
// W2.24 загружает уже сжатое фото с устройства (`prepared`); ответ проверки 4xx — ошибка, а не опрос (Q-W2.22-11).
// Публикуемый интерфейс: `uploadPhoto(api, tenantId, file, options)`.
import { type ApiClient, unwrap } from '@ortus/api-client';

import { prepareImage } from '../../core/files/upload/image.ts';
import { type PutObject, putObject } from '../../core/files/upload/upload.tsx';

// Подготовка фото (сжатие до 1600 px, D-08; геоданные вырезаются по всем путям, W2.44) — модуль загрузки.
export { fitSize, MAX_SIDE, prepareImage } from '../../core/files/upload/image.ts';

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
export class UploadRejectedError extends Error {
  constructor() {
    super('rejected');
    this.name = 'UploadRejectedError';
  }
}

/** Проверка файла не закончилась за `pollMax` опросов. */
export class UploadTimeoutError extends Error {
  constructor() {
    super('scan timeout');
    this.name = 'UploadTimeoutError';
  }
}

export interface UploadOptions {
  purpose: 'inspection' | 'expense_receipt';
  /** Рейс — владелец файла (`fleet` / `trip`). */
  tripId: string;
  /** Ход 0–99 %: 100 % слот показывает только после проверки файла. */
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  /** Файл уже сжат на клиенте (фото с устройства, очередь W2.24) — без повторного перекодирования. */
  prepared?: boolean;
}

async function sha256(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CAP = 99;

/** Имя файла после перекодирования в JPEG: «IMG_0042.HEIC» → «IMG_0042.jpg» (Q-W2.22-11). */
function fileNameOf(name: string, type: string): string {
  const base = name || 'photo.jpg';
  if (type !== 'image/jpeg' || /\.jpe?g$/i.test(base)) return base;
  const dot = base.lastIndexOf('.');
  return `${dot > 0 ? base.slice(0, dot) : base}.jpg`;
}

/** Загружает файл и ждёт проверки; возвращает id готового (`ready`) файла. */
export async function uploadPhoto(
  api: ApiClient,
  tenantId: string,
  file: File,
  o: UploadOptions,
): Promise<string> {
  const blob = o.prepared ? file : await transport.prepare(file);
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
        purpose: o.purpose,
        owner: { moduleKey: 'fleet', entityType: 'trip', entityId: o.tripId },
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
    if (i >= transport.pollMax) throw new UploadTimeoutError();
    if (o.signal?.aborted) throw new DOMException('Передача прервана', 'AbortError');
    await sleep(transport.pollMs);
    const r = await api.GET('/api/v1/tenants/{tenantId}/files/{fileId}', {
      params: { path: { tenantId, fileId: ticket.fileId } },
    });
    status = (await unwrap(r)).status;
  }
  if (status === 'rejected') throw new UploadRejectedError();
  return ticket.fileId;
}
