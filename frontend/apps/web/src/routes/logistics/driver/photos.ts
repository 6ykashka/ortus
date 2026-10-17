// W2.22 · Загрузка фото осмотра и чека по сессии W1.09/W1.24 (бриф §4): initiateUpload (резерв места, билет PUT)
// → PUT по билету (ход передачи) → completeUpload (сверка SHA-256) → ожидание проверки файла (getFile:
// quarantined → ready | rejected). Слот «готов» только после `ready` (бриф §10 п. 6): до ответа проверки ход
// держится на 99 %. Сбой до completeUpload отменяет сессию (резерв освобождается). Публикуемый интерфейс для
// W2.24 (очередь отправки): `uploadPhoto(api, tenantId, file, options)`.
import { type ApiClient, unwrap } from '@ortus/api-client';

import { type PutObject, putObject } from '../../core/files/upload/upload.tsx';

/** Большая сторона фото после сжатия на клиенте (D-08, R-03). */
export const MAX_SIDE = 1600;

const JPEG_QUALITY = 0.85;

/** Размер после сжатия: большая сторона не больше MAX_SIDE, пропорции сохраняются. */
export function fitSize(width: number, height: number): { width: number; height: number } {
  const k = Math.min(1, MAX_SIDE / Math.max(width, height));
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

/**
 * Фото для загрузки (D-08, R-03; ПДн §6): декодирование с учётом ориентации, сжатие до MAX_SIDE и перекодирование
 * в JPEG — EXIF (в том числе геоданные) в результат не попадает. Нет декодера (jsdom, старый браузер) или файл не
 * читается как изображение — загружается исходный файл: проверку содержимого делает сервер.
 */
export async function prepareImage(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = fitSize(bmp.width, bmp.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d');
    if (!g) {
      bmp.close();
      return file;
    }
    g.drawImage(bmp, 0, 0, width, height);
    bmp.close();
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', JPEG_QUALITY));
    return out && out.size > 0 ? out : file;
  } catch {
    return file;
  }
}

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
}

async function sha256(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CAP = 99;

/** Загружает файл и ждёт проверки; возвращает id готового (`ready`) файла. */
export async function uploadPhoto(
  api: ApiClient,
  tenantId: string,
  file: File,
  o: UploadOptions,
): Promise<string> {
  const blob = await transport.prepare(file);
  const sum = await sha256(blob);
  const contentType = blob.type || file.type || 'application/octet-stream';
  const ticket = await unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/files/uploads', {
      params: { path: { tenantId }, header: idem() },
      body: {
        fileName: file.name || 'photo.jpg',
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
  const done = await unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/files/uploads/{uploadId}/complete', {
      params: { path: { tenantId, uploadId: ticket.uploadId }, header: idem() },
      body: { sha256: sum },
    }),
  );
  o.onProgress?.(CAP);
  let status = done.status;
  for (let i = 0; status !== 'ready' && status !== 'rejected'; i++) {
    if (i >= transport.pollMax) throw new UploadTimeoutError();
    if (o.signal?.aborted) throw new DOMException('Передача прервана', 'AbortError');
    await sleep(transport.pollMs);
    const r = await api.GET('/api/v1/tenants/{tenantId}/files/{fileId}', {
      params: { path: { tenantId, fileId: ticket.fileId } },
    });
    if (r.data) status = r.data.status;
  }
  if (status === 'rejected') throw new UploadRejectedError();
  return ticket.fileId;
}
