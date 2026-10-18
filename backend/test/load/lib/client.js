/* global __ENV */
// Клиент API для сценариев k6 (W0.16 → W2.47): вход через dev-провайдер, CSRF и Origin на изменениях,
// Idempotency-Key, If-Match, теги op/kind для порогов, фото по сессии загрузки с ожиданием проверки cmd/worker.
// Тег tenant ставит сценарий (options); запросы setup() получают kind:setup и в пороги не входят.
import { check, sleep } from 'k6';
import crypto from 'k6/crypto';
import exec from 'k6/execution';
import http from 'k6/http';

import { OPS, devLoginAllowed, idempotencyKey, pathFor, uploadCreate } from './model.js';

// Двойник W0.16 — слот 8 (план §8); на стенде BASE_URL задаёт stand-smoke.mjs (API слота 8100 + N).
export const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:8108').replace(/\/$/, '');
// Origin изменяющих запросов: на стенде — адрес Vite слота из ALLOWED_ORIGINS cmd/api.
export const ORIGIN = __ENV.ORIGIN || BASE_URL;
// Допущение A-23: dev-вход W0.09 / W1.03; только local и compose.
const DEV_LOGIN_PATH = __ENV.DEV_LOGIN_PATH || '/api/v1/dev/login';
if (!devLoginAllowed(BASE_URL)) {
  throw new Error(
    `dev-вход запрещён для ${BASE_URL}: dev-провайдер только для local и compose (PD-18, Q-102). ` +
      'Вход на stage — по решению интегратора / техлида (docs/plan/v2/load-profile.md §4).',
  );
}
const CSRF_COOKIE = __ENV.CSRF_COOKIE || 'ortus_csrf';
const RUN_ID = __ENV.RUN_ID || Date.now().toString(36);
// Опрос проверки фото, как у клиента W2.22: раз в секунду, не дольше двух минут.
const POLL_SECONDS = Number(__ENV.FILE_POLL_SECONDS || 1);
const POLL_MAX = Number(__ENV.FILE_POLL_MAX || 120);

/** Ожидаемые коды успеха (контракт 0.5.1); остальные операции — 200. */
const SUCCESS = {
  createTripPlan: [201],
  reserveVehicle: [201],
  initiateUpload: [201],
  completeUpload: [202],
  submitInspection: [201],
  startTrip: [201],
  createTripExpense: [201],
};

function header(res, name) {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(res.headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/** VU и итерация для Idempotency-Key; в setup() сведений о сценарии нет. */
function where() {
  try {
    return { vu: exec.vu.idInTest, iter: exec.scenario.iterationInTest };
  } catch {
    return { vu: 0, iter: 'setup' };
  }
}

export class Session {
  /** kind — класс всех запросов сессии вместо класса операции (setup()); по умолчанию — из OPS. */
  constructor(persona, scenario, { kind } = {}) {
    this.persona = persona;
    this.scenario = scenario;
    this.kind = kind;
    this.csrf = '';
    this.seq = 0;
  }

  /** Вход персонажем dev-провайдера; cookie сессии в jar VU, токен CSRF — из ответа (или cookie). */
  login() {
    const jar = http.cookieJar();
    jar.clear(BASE_URL);
    const res = http.post(
      `${BASE_URL}${DEV_LOGIN_PATH}`,
      JSON.stringify({ persona: this.persona }),
      {
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        tags: { op: 'devLogin', kind: 'auth' },
      },
    );
    const ok = check(res, { 'devLogin → 2xx': (r) => r.status >= 200 && r.status < 300 });
    let token;
    try {
      token = (res.json() || {}).csrfToken || '';
    } catch {
      token = '';
    }
    const cookie = jar.cookiesForURL(BASE_URL)[CSRF_COOKIE];
    this.csrf = token || (cookie && cookie.length ? cookie[0] : '');
    return ok && this.csrf !== '';
  }

  /**
   * Вызов операции контракта. expected — допустимые коды (по умолчанию — успех операции).
   * Возвращает { ok, status, json, etag }.
   */
  call(opId, { params = {}, query = {}, body, ifMatch, expected } = {}) {
    const spec = OPS[opId];
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (spec.method !== 'GET') {
      headers['X-CSRF-Token'] = this.csrf;
      headers.Origin = ORIGIN;
    }
    if (spec.idempotent) {
      this.seq += 1;
      headers['Idempotency-Key'] = idempotencyKey({
        run: RUN_ID,
        scenario: this.scenario,
        ...where(),
        step: `${opId}.${this.seq}`,
      });
    }
    if (spec.ifMatch) {
      if (!ifMatch) throw new Error(`${opId}: нужен If-Match (ETag свежего GET)`);
      headers['If-Match'] = ifMatch;
    }
    const statuses = expected || SUCCESS[opId] || [200];
    const res = http.request(
      spec.method,
      `${BASE_URL}${pathFor(opId, params, query)}`,
      body === undefined ? null : JSON.stringify(body),
      {
        headers,
        tags: { op: opId, kind: this.kind || spec.kind },
        responseCallback: http.expectedStatuses(...statuses),
      },
    );
    const ok = check(res, {
      [`${opId} → ${statuses.join('|')}`]: (r) => statuses.includes(r.status),
    });
    let json = null;
    if (res.status !== 204 && res.body) {
      try {
        json = res.json();
      } catch {
        json = null;
      }
    }
    return { ok, status: res.status, json, etag: header(res, 'ETag') };
  }

  /**
   * Фото рейса: initiateUpload → PUT по presigned URL (kind:transfer, вне порогов) → completeUpload → getFile
   * раз в секунду до `ready` (wait: false — без ожидания, поток шумного тенанта). Возвращает { fileId } или
   * { reason }: upload, photo_rejected, photo_timeout.
   */
  upload({ tenantId, purpose, tripId, fileName, filler, wait = true }) {
    this.seq += 1;
    const { vu, iter } = where();
    const blob = uniqueJpeg(filler, `${RUN_ID}:${vu}:${iter}:${this.seq}:`);
    const sha256 = crypto.sha256(blob.buffer, 'hex');
    const ticket = this.call('initiateUpload', {
      params: { tenantId },
      body: uploadCreate({ fileName, sizeBytes: blob.length, sha256, purpose, tripId }),
    });
    if (!ticket.ok || !ticket.json) return { reason: 'upload' };
    const put = http.put(ticket.json.uploadUrl, blob.buffer, {
      headers: { 'Content-Type': ticket.json.requiredContentType },
      tags: { op: 'uploadTransfer', kind: 'transfer' },
    });
    if (!check(put, { 'uploadTransfer → 2xx': (r) => r.status >= 200 && r.status < 300 })) {
      return { reason: 'upload' };
    }
    const done = this.call('completeUpload', {
      params: { tenantId, uploadId: ticket.json.uploadId },
      body: { sha256 },
    });
    if (!done.ok) return { reason: 'upload' };
    const fileId = ticket.json.fileId;
    if (!wait) return { fileId };
    let status = done.json && done.json.status;
    for (let i = 0; status !== 'ready' && status !== 'rejected'; i++) {
      if (i >= POLL_MAX) return { reason: 'photo_timeout' };
      if (i > 0 || status) sleep(POLL_SECONDS);
      const file = this.call('getFile', { params: { tenantId, fileId } });
      status = file.json && file.json.status;
    }
    return status === 'ready' ? { fileId } : { reason: 'photo_rejected' };
  }

  /** Скачивание фото по ссылке getFileDownload (kind:transfer, вне порогов). */
  download(url) {
    const res = http.get(url, {
      tags: { op: 'downloadTransfer', kind: 'transfer' },
      responseType: 'none',
    });
    return check(res, { 'downloadTransfer → 200': (r) => r.status === 200 });
  }
}

/** Первый тенант из /me/context: { tenantId, orgUnitIds } или null. */
export function tenantOf(session) {
  const ctx = session.call('getMyContext');
  const t = ctx.ok && ctx.json && ctx.json.tenants && ctx.json.tenants[0];
  return t ? { tenantId: t.tenantId, orgUnitIds: t.orgUnitIds || [] } : null;
}

const JPEG_SOI = [0xff, 0xd8, 0xff, 0xe0];

/**
 * Тело фото size байт: сигнатура JPEG (`FF D8 FF E0` — так cmd/worker узнаёт image/jpeg по содержимому) и
 * заполнитель. Уникальный префикс каждой загрузки пишет uniqueJpeg.
 */
export function makeFiller(size) {
  const bytes = new Uint8Array(Math.max(size, JPEG_SOI.length + 64));
  bytes.fill(0x20);
  bytes.set(JPEG_SOI, 0);
  return bytes;
}

function uniqueJpeg(filler, unique) {
  const blob = filler.slice();
  for (let i = 0; i < unique.length && JPEG_SOI.length + i < blob.length; i++) {
    blob[JPEG_SOI.length + i] = unique.charCodeAt(i) & 0x7f;
  }
  return blob;
}
