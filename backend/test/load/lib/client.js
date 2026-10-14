/* global __ENV */
// Клиент API для сценариев k6 (W0.16): вход через dev-провайдер, CSRF и Origin на изменениях,
// Idempotency-Key, If-Match, теги op/kind для порогов. Тег tenant ставит сценарий (options).
import { check } from 'k6';
import crypto from 'k6/crypto';
import exec from 'k6/execution';
import http from 'k6/http';

import { OPS, devLoginAllowed, idempotencyKey, pathFor, uploadCreate } from './model.js';

// Слот W0.16 — 8 (план §8): API исполнителя 8100 + 8.
export const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:8108').replace(/\/$/, '');
export const ORIGIN = __ENV.ORIGIN || BASE_URL;
// Допущение A-23: механизм dev-входа задаёт W0.09 / W1.03; только local и compose.
const DEV_LOGIN_PATH = __ENV.DEV_LOGIN_PATH || '/api/v1/dev/login';
if (!devLoginAllowed(BASE_URL)) {
  throw new Error(
    `dev-вход запрещён для ${BASE_URL}: dev-провайдер только для local и compose (PD-18, Q-102). ` +
      'Вход на stage — по решению интегратора / техлида (docs/plan/v2/load-profile.md §4).',
  );
}
const CSRF_COOKIE = __ENV.CSRF_COOKIE || 'ortus_csrf';
const RUN_ID = __ENV.RUN_ID || Date.now().toString(36);

/** Ожидаемые коды успеха (OpenAPI 0.1); остальные операции — 200. */
const SUCCESS = {
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

export const pad = (n, width) => String(n).padStart(width, '0');

export class Session {
  constructor(persona, scenario) {
    this.persona = persona;
    this.scenario = scenario;
    this.csrf = '';
    this.seq = 0;
  }

  /** Вход персонажем dev-провайдера; cookie сессии и CSRF кладутся в jar VU. */
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
    const csrf = jar.cookiesForURL(BASE_URL)[CSRF_COOKIE];
    this.csrf = csrf && csrf.length ? csrf[0] : '';
    return ok && this.csrf !== '';
  }

  /**
   * Вызов операции OpenAPI. expected — допустимые коды (по умолчанию — успех операции).
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
        vu: exec.vu.idInTest,
        iter: exec.scenario.iterationInTest,
        step: `${opId}.${this.seq}`,
      });
    }
    if (spec.ifMatch) {
      if (!ifMatch) throw new Error(`${opId}: нужен If-Match (ETag последнего GET)`);
      headers['If-Match'] = ifMatch;
    }
    const statuses = expected || SUCCESS[opId] || [200];
    const res = http.request(
      spec.method,
      `${BASE_URL}${pathFor(opId, params, query)}`,
      body === undefined ? null : JSON.stringify(body),
      {
        headers,
        tags: { op: opId, kind: spec.kind },
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
   * Фото: initiateUpload → PUT по presigned URL (kind:transfer, вне порогов) → completeUpload.
   * Возвращает fileId или null.
   */
  upload({ tenantId, purpose, owner, fileName, filler }) {
    this.seq += 1;
    const unique = `${RUN_ID}:${exec.vu.idInTest}:${exec.scenario.iterationInTest}:${this.seq}:`;
    const blob = (unique + filler).slice(0, filler.length);
    const sha256 = crypto.sha256(blob, 'hex');
    const ticket = this.call('initiateUpload', {
      params: { tenantId },
      body: uploadCreate({ fileName, sizeBytes: blob.length, sha256, purpose, owner }),
    });
    if (!ticket.ok || !ticket.json) return null;
    const put = http.put(ticket.json.uploadUrl, blob, {
      headers: { 'Content-Type': ticket.json.requiredContentType },
      tags: { op: 'uploadTransfer', kind: 'transfer' },
    });
    if (!check(put, { 'uploadTransfer → 2xx': (r) => r.status >= 200 && r.status < 300 })) {
      return null;
    }
    const done = this.call('completeUpload', {
      params: { tenantId, uploadId: ticket.json.uploadId },
      body: { sha256 },
    });
    return done.ok ? ticket.json.fileId : null;
  }
}

/** Первый тенант из /me/context: { tenantId, memberId } или null. */
export function tenantOf(session) {
  const ctx = session.call('getMyContext');
  const t = ctx.ok && ctx.json && ctx.json.tenants && ctx.json.tenants[0];
  return t ? { tenantId: t.tenantId, memberId: t.membershipId } : null;
}

/** Строка из size ASCII-байт — тело фото (уникальный префикс добавляет upload). */
export function makeFiller(size) {
  return 'x'.repeat(size);
}
