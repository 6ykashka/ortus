// W2.53 · Хранилище объектов режима mock (вне контракта, как MinIO стенда W1.09): PUT по билету загрузки
// `initiateUpload` (`uploadUrl` — `https://storage.example.invalid/uploads/<uploadId>`). Ключ — сессия загрузки,
// тип содержимого — из билета, объект не больше заявленного размера; принятый объект переводит сессию в `uploaded`.
// Содержимое не хранится: completeUpload сверяет sha256 заявленный, а не посчитанный (как и раньше в mock).
import type { ScenarioState, UploadRow } from '../core/state.ts';

/** Origin хранилища mock: адреса билетов загрузки и ссылок на скачивание. */
export const STORAGE_ORIGIN = 'https://storage.example.invalid';

/** Путь PUT объекта по билету (шаблон MSW). */
export const STORAGE_UPLOAD_PATH = `${STORAGE_ORIGIN}/uploads/:uploadId`;

/** Ключ sessionStorage: `on` / `off` — явный выбор хранилища mock во вкладке (проверяющий через MCP, e2e). */
export const STORAGE_MODE_KEY = 'ortus:msw:storage';

function uploadById(s: ScenarioState, uploadId: string): UploadRow | undefined {
  const id = uploadId.toLowerCase();
  for (const org of Object.values(s.orgs)) {
    const u = org.uploads.find((x) => x.uploadId === id);
    if (u) return u;
  }
  return undefined;
}

/** Ответ хранилища без тела (коды S3: 404 NoSuchKey, 403 AccessDenied, 400 EntityTooLarge). */
const reply = (status: number, headers?: HeadersInit): Response =>
  new Response(null, { status, headers });

/** Короткий ETag объекта: FNV-1a по байтам (S3 отдаёт MD5; клиенту важен только сам заголовок). */
function etag(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return `"${h.toString(16).padStart(8, '0')}"`;
}

/**
 * PUT объекта по билету: 200 и сессия `uploaded`; неизвестная сессия — 404; билет истёк, сессия не `issued` и не
 * `uploaded` или тип содержимого не из билета — 403; объект больше заявленного — 400.
 */
export async function putObject(
  s: ScenarioState,
  request: Request,
  uploadId: string,
  now: string,
): Promise<Response> {
  const u = uploadById(s, uploadId);
  if (!u) return reply(404);
  if (u.state !== 'issued' && u.state !== 'uploaded') return reply(403);
  if (Date.parse(now) >= Date.parse(u.ticketExpiresAt)) return reply(403);
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== u.contentType.toLowerCase()) return reply(403);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > u.sizeBytes) return reply(400);
  u.state = 'uploaded';
  return reply(200, { ETag: etag(bytes) });
}

/** Режим вкладки: явная опция `startMockWorker`, затем sessionStorage, иначе — включено вне Playwright. */
export function storageEnabled(o: {
  webdriver: boolean;
  stored?: string | null;
  option?: boolean;
}): boolean {
  if (o.option !== undefined) return o.option;
  if (o.stored === 'on') return true;
  if (o.stored === 'off') return false;
  return !o.webdriver;
}
