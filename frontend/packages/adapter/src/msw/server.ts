// Сценарный сервер режима mock (W0.13): обработчик запросов /api/v1/* по контракту 0.3.0-stage1 и шлюз
// cmd/api W0.09 — сессия (401) → Origin и CSRF изменяющих (403) → оператор платформы (404) | членство и
// состояние организации (404/403) → подключение модуля (403) → x-permissions (403) → тело по схеме (400/422)
// → Idempotency-Key (повтор, 409) → If-Match (428/412) → хендлер (нет хендлера — 501). Вне каталога под
// /api/v1/ — 404 (fail-closed), кроме dev-маршрутов (вход, выход, сценарии — только mock).
import { seedUuid } from '@ortus/domain/seed';
import { http, type HttpHandler } from 'msw';

import { example, findOperation, type OperationInfo } from './contract/index.ts';
import { actionsFor, permits, type TenantAccess } from './core/access.ts';
import { TAG_MODULE } from './core/catalog.ts';
import { devSummary, type DevScenario, scanFiles } from './core/dev.ts';
import { newId } from './core/people.ts';
import { applyPreset, isPreset, type PresetName, PRESETS } from './core/presets.ts';
import {
  fail,
  PROBLEM_JSON,
  problemBody,
  ProblemError,
  type ProblemExtra,
} from './core/problem.ts';
import { type HandlerContext, type Registry, specOf } from './core/registry.ts';
import {
  actorById,
  type Actor,
  CSRF_HEADER,
  issueSession,
  liveSession,
  lookupActor,
  parseCookies,
  personaTenant,
  serializeCookie,
  SESSION_COOKIE,
  sessionCookies,
  type SetCookie,
} from './core/session.ts';
import { type Directive, directivesFor, parseScenario } from './core/scenario.ts';
import { createScenarioState, type ScenarioState } from './core/state.ts';
import { validate } from './core/validate.ts';
import { getExportObject, STORAGE_EXPORT_PATH } from './data/exports.ts';
import { putObject, STORAGE_UPLOAD_PATH } from './files/storage.ts';
import { defaultRegistry } from './handlers.ts';

export type { HandlerContext, OperationHandler, Registry } from './core/registry.ts';

/** Адреса API в любом origin: http://127.0.0.1:5217/api/v1/…, http://ortus.test/api/v1/…. */
const API_URL = /^[a-z]+:\/\/[^/]+\/api\/v1\//;
const TENANT_PREFIX = '/api/v1/tenants/{tenantId}/';
const PLATFORM_PREFIX = '/api/v1/platform/';
const DEV_LOGIN = '/api/v1/dev/login';
const DEV_LOGOUT = '/api/v1/dev/logout';
const DEV_SCENARIO = '/api/v1/dev/scenario';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STRONG_ETAG = /^"[^"\s]+"$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/;

/** Чтение и запись cookie: заголовки (Node, тесты) или document.cookie (браузер, msw/browser). */
export interface CookieJar {
  read(request: Request): Record<string, string>;
  write(headers: Headers, cookies: SetCookie[]): void;
}

export const headerCookies: CookieJar = {
  read: (request) => parseCookies(request.headers.get('cookie')),
  write: (headers, cookies) => {
    for (const c of cookies) headers.append('Set-Cookie', serializeCookie(c));
  },
};

export interface ScenarioServerOptions {
  /** Начальное состояние (по умолчанию — свежая проекция сида). */
  state?: ScenarioState;
  /** Часы сервера (по умолчанию — `state.clock`). */
  now?: () => string;
  /** Хендлеры поверх реестра модулей (тесты шлюза). */
  operations?: Registry;
  cookies?: CookieJar;
  /** Разрешённые Origin изменяющих запросов (по умолчанию — origin самого запроса). */
  origins?: readonly string[];
  /** Вызывается после запросов, которые могли изменить состояние (сохранение в sessionStorage). */
  onChange?: (state: ScenarioState) => void;
  /**
   * Проверка файла сама завершается через столько мс после completeUpload (ручной режим mock в браузере, W2.53).
   * Без опции файл остаётся на проверке до dev-маршрута `scanFiles` (e2e, экранные тесты, conformance).
   */
  scanAfterMs?: number;
}

export interface ScenarioServer {
  /** MSW 2: один диспетчер /api/v1/* (операции контракта и dev-маршруты). */
  handlers: HttpHandler[];
  /** MSW 2: хранилище объектов mock — PUT по билету загрузки (`uploadUrl`, files/storage.ts, W2.53). */
  storage: HttpHandler[];
  /** Ответ на запрос /api/v1/* без MSW (тесты шлюза, скрипты). */
  handle(request: Request): Promise<Response>;
  /** Ответ хранилища mock на PUT по `uploadUrl` без MSW (тесты). */
  put(request: Request): Promise<Response>;
  state(): ScenarioState;
  reset(state?: ScenarioState): void;
  applyPreset(name: PresetName): void;
  /** Постоянный X-Test-Scenario (e2e без заголовков); `once` — снять после первого срабатывания. */
  setScenario(spec: string | null, once?: boolean): void;
  setNow(at: string): void;
}

interface Reply {
  status: number;
  body?: unknown;
  headers: Headers;
}

const json = (status: number, body: unknown, headers = new Headers()): Reply => {
  if (body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return { status, body, headers };
};

export function createScenarioServer(o: ScenarioServerOptions = {}): ScenarioServer {
  let s = o.state ?? createScenarioState();
  const registry: Registry = { ...defaultRegistry, ...o.operations };
  const jar = o.cookies ?? headerCookies;
  const now = (): string => s.clock;

  const problem = (err: ProblemError, requestId: string, opId?: string): Reply => {
    const body = problemBody(err, requestId, opId);
    return json(body.status, body, new Headers({ 'Content-Type': PROBLEM_JSON }));
  };

  function finish(reply: Reply, requestId: string, method: string): Response {
    const h = reply.headers;
    h.set('X-Request-Id', requestId);
    h.set('Cache-Control', 'private, no-store');
    h.set('X-Content-Type-Options', 'nosniff');
    if (method !== 'GET' && method !== 'HEAD') o.onChange?.(s);
    const text = reply.body === undefined ? null : JSON.stringify(reply.body);
    return new Response(text, { status: reply.status, headers: h });
  }

  function sessionOf(request: Request): { actor?: Actor; sessionId?: string } {
    const sid = jar.read(request)[SESSION_COOKIE];
    const row = liveSession(s, sid);
    if (!row) return {};
    const actor = actorById(s, row.accountId);
    return actor ? { actor, sessionId: row.id } : {};
  }

  function checkOrigin(request: Request, url: URL): void {
    const origin = request.headers.get('Origin');
    if (origin && !(o.origins ?? [url.origin]).includes(origin)) fail('origin_not_allowed');
  }

  async function dev(request: Request, url: URL, requestId: string): Promise<Reply> {
    const path = url.pathname;
    if (path === DEV_LOGIN && request.method === 'POST') {
      checkOrigin(request, url);
      const body = (await request.json().catch(() => undefined)) as
        { persona?: unknown } | undefined;
      if (!body || typeof body.persona !== 'string' || Object.keys(body).length !== 1) {
        fail('malformed_request');
      }
      const actor = lookupActor(s, body.persona);
      if (!actor) fail('session_expired');
      const old = jar.read(request)[SESSION_COOKIE];
      if (old) Reflect.deleteProperty(s.sessions, old);
      const row = issueSession(s, actor.id);
      const tenant = personaTenant(body.persona);
      if (tenant && actor.kind === 'user') {
        actor.account.lastTenantId = seedUuid('platform', tenant);
      }
      const reply = json(200, { userId: actor.id, csrfToken: row.csrf });
      jar.write(reply.headers, sessionCookies(row));
      return reply;
    }
    if (path === DEV_LOGOUT && request.method === 'POST') {
      const { actor, sessionId } = sessionOf(request);
      if (!actor || !sessionId) fail('session_expired');
      checkOrigin(request, url);
      if (request.headers.get(CSRF_HEADER) !== s.sessions[sessionId]?.csrf) fail('csrf_failed');
      Reflect.deleteProperty(s.sessions, sessionId);
      const reply: Reply = { status: 204, headers: new Headers() };
      jar.write(reply.headers, sessionCookies(null));
      return reply;
    }
    if (path === DEV_SCENARIO && request.method === 'POST') {
      const body = (await request.json().catch(() => undefined)) as DevScenario | undefined;
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('malformed_request');
      if (body.preset !== undefined && !isPreset(body.preset)) {
        fail('validation_failed', 'Неизвестный пресет.', {
          violations: [{ field: 'preset', code: 'enum', message: PRESETS.join(', ') }],
        });
      }
      if (body.reset) {
        const sessions = s.sessions;
        s = createScenarioState();
        s.sessions = sessions;
      }
      if (typeof body.now === 'string') s.clock = body.now;
      if (body.preset) applyPreset(s, body.preset);
      if (body.scenario !== undefined) {
        s.scenario = body.scenario ? { spec: body.scenario, once: Boolean(body.once) } : null;
      }
      if (body.scanFiles) scanFiles(s);
      return json(200, devSummary(s));
    }
    if (path === DEV_SCENARIO && request.method === 'GET') return json(200, devSummary(s));
    return problem(new ProblemError('not_found'), requestId);
  }

  /** Организация запроса: членство до состояния организации (`tenantctx.Resolve` W0.09). */
  function resolveTenant(actor: Actor, raw: string, op: OperationInfo): TenantAccess {
    if (!UUID.test(raw) || actor.kind !== 'user') fail('not_found');
    const tenantId = raw.toLowerCase();
    const membership = s.memberships.find(
      (m) => m.accountId === actor.id && m.tenantId === tenantId,
    );
    const tenant = s.tenants.find((t) => t.id === tenantId);
    const org = s.orgs[tenantId];
    if (!membership || membership.status !== 'active' || !tenant || !org) fail('not_found');
    let readOnly = false;
    switch (tenant.status) {
      case 'trial':
      case 'active':
        break;
      case 'grace':
      case 'read_only':
        if (op.mutating) fail('tenant_read_only');
        readOnly = true;
        break;
      case 'suspended':
        fail('tenant_suspended');
        break;
      default:
        fail('not_found');
    }
    const member = org.members.find((m) => m.id === membership.memberId);
    return { tenant, org, membership, member, owner: membership.owner, readOnly };
  }

  function authorize(t: TenantAccess, op: OperationInfo): void {
    const mod = TAG_MODULE[op.tag];
    if (mod) {
      const st = t.org.modules[mod]?.state;
      if (st === 'read_only' || st === 'draining') {
        if (op.mutating) fail('module_read_only');
      } else if (st !== 'active') {
        fail('module_not_installed');
      }
    }
    if (op.scope === 'tenant-owner' && !t.owner) fail('forbidden_action');
    if (!permits(actionsFor(t, op.scope, now()), op.permissions, op.mode)) fail('forbidden_action');
  }

  async function operation(
    request: Request,
    url: URL,
    requestId: string,
    op: OperationInfo,
    params: Record<string, string>,
  ): Promise<Reply> {
    const cookies: SetCookie[] = [];
    let actor: Actor | undefined;
    let sessionId: string | undefined;
    let tenant: TenantAccess | undefined;
    const auth = request.headers.get('Authorization');
    if (!op.public) {
      const sess = sessionOf(request);
      if (auth) fail(jar.read(request)[SESSION_COOKIE] ? 'malformed_request' : 'session_expired');
      const who = sess.actor;
      const sid = sess.sessionId;
      if (!who || !sid) fail('session_expired');
      actor = who;
      sessionId = sid;
      if (op.mutating) {
        checkOrigin(request, url);
        const token = request.headers.get(CSRF_HEADER);
        if (!token || token !== s.sessions[sid]?.csrf) fail('csrf_failed');
      }
      if (op.path.startsWith(PLATFORM_PREFIX)) {
        if (who.kind !== 'operator') fail('not_found');
      } else if (op.path.startsWith(TENANT_PREFIX)) {
        tenant = resolveTenant(who, params.tenantId ?? '', op);
        authorize(tenant, op);
      }
    } else {
      ({ actor, sessionId } = sessionOf(request));
    }

    const spec = registry[op.id] ? specOf(registry[op.id] as never) : undefined;
    const text = op.request ? await request.text() : '';
    let ifMatch: number | undefined;
    const ctx: HandlerContext = {
      s,
      op,
      params,
      query: url.searchParams,
      body: undefined,
      headers: request.headers,
      url,
      requestId,
      now,
      actor,
      session: sessionId ? s.sessions[sessionId] : undefined,
      tenant,
      user: () => (actor?.kind === 'user' ? actor : fail('session_expired')),
      org: () => {
        if (!tenant) throw new Error(`${op.id}: операция без организации`);
        return tenant;
      },
      revision: (current) => {
        if (ifMatch !== current) fail('revision_mismatch');
      },
      newId: (scope) => newId(s, scope ?? tenant?.org.proto ?? 'platform'),
      fail: (code: string, detail?: string, extra?: ProblemExtra) => fail(code, detail, extra),
      setCookies: (c) => cookies.push(...c),
    };
    if (!spec) fail('not_implemented');

    if (op.request) {
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        fail('malformed_request');
      }
      if (body === undefined) fail('malformed_request');
      ctx.body = body;
      spec.before?.(ctx);
      const v = validate(op.request, body);
      if (v.malformed.length) fail('malformed_request');
      if (v.unknown.length) fail('unknown_field');
      if (v.violations.length) {
        const violations = v.violations.map((x) => ({
          ...x,
          message: spec.messages?.[x.field] ?? x.message,
        }));
        fail('validation_failed', undefined, { violations });
      }
    } else {
      spec.before?.(ctx);
    }

    let idemKey: string | undefined;
    const fingerprint = `${request.method} ${url.pathname}${url.search} ${text}`;
    if (op.idempotent) {
      const key = request.headers.get('Idempotency-Key') ?? '';
      if (!IDEMPOTENCY_KEY.test(key)) fail('malformed_request');
      idemKey = `${tenant?.tenant.id ?? '-'}|${actor?.id ?? '-'}|${op.id}|${key}`;
      const seen = s.idempotency[idemKey];
      if (seen) {
        if (seen.fingerprint !== fingerprint) fail('idempotency_key_reused');
        const headers = new Headers(seen.headers);
        headers.set('Idempotency-Replayed', 'true');
        return { status: seen.status, body: structuredClone(seen.body), headers };
      }
    }
    if (op.ifMatch) {
      const raw = request.headers.get('If-Match');
      if (!raw) fail('revision_required');
      if (!STRONG_ETAG.test(raw)) fail('malformed_request');
      const m = /^"rev-(\d+)"$/.exec(raw);
      ifMatch = m ? Number(m[1]) : -1;
    }

    const result = await spec.run(ctx);
    const status = result.status ?? op.success;
    const reply = json(status, result.body, new Headers(result.headers));
    const revision = result.etag ?? (result.body as { revision?: unknown } | undefined)?.revision;
    if (op.etag && typeof revision === 'number') reply.headers.set('ETag', `"rev-${revision}"`);
    if (idemKey && status < 400) {
      s.idempotency[idemKey] = {
        fingerprint,
        status,
        body: structuredClone(result.body),
        headers: Object.fromEntries(reply.headers),
      };
    }
    jar.write(reply.headers, cookies);
    return reply;
  }

  /** Сценарии операции: заголовок запроса сильнее постоянного; `once` снимается после срабатывания. */
  function scenarioOf(request: Request, op: OperationInfo): Directive[] {
    const header = request.headers.get('X-Test-Scenario');
    const spec = header ?? s.scenario?.spec;
    if (!spec) return [];
    const found = directivesFor(parseScenario(spec), op);
    if (found.length && header === null && s.scenario?.once) s.scenario = null;
    return found;
  }

  /** Ответ сценария до шлюза: код Problem (тело примера операции), сетевой сбой, «вечная» загрузка. */
  async function scenarioReply(
    ds: Directive[],
    op: OperationInfo,
    requestId: string,
  ): Promise<Reply | 'offline' | undefined> {
    for (const d of ds) {
      if (d.kind === 'delay') await sleep(d.ms);
      if (d.kind === 'loading') await new Promise<never>(() => undefined);
      if (d.kind === 'offline') return 'offline';
      if (d.kind === 'code') {
        const ex = example(op.id, d.code) as Record<string, unknown> | undefined;
        if (!ex) return problem(new ProblemError(d.code), requestId, op.id);
        const body: Record<string, unknown> = { ...structuredClone(ex), requestId };
        return json(Number(body.status), body, new Headers({ 'Content-Type': PROBLEM_JSON }));
      }
    }
    return undefined;
  }

  /** Сценарий empty: пример `empty` операции или пустая страница списка. */
  function emptied(reply: Reply, op: OperationInfo): Reply {
    if (reply.status !== op.success) return reply;
    const ex = example(op.id, 'empty');
    if (ex) return { ...reply, body: structuredClone(ex) };
    const body = reply.body as Record<string, unknown> | undefined;
    if (!body || !Array.isArray(body.items)) return reply;
    const out: Record<string, unknown> = { ...body, items: [] };
    if ('nextCursor' in out) out.nextCursor = null;
    if ('unreadCount' in out) out.unreadCount = 0;
    return { ...reply, body: out };
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const incoming = request.headers.get('X-Request-Id') ?? '';
    const requestId = REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
    const path = url.pathname;
    if (o.now) s.clock = o.now();
    let opId: string | undefined;
    try {
      if (path.startsWith('/api/v1/dev/')) {
        return finish(await dev(request, url, requestId), requestId, request.method);
      }
      const match = findOperation(request.method, path);
      if (!match) fail('not_found');
      opId = match.op.id;
      const ds = scenarioOf(request, match.op);
      const early = await scenarioReply(ds, match.op, requestId);
      if (early === 'offline') return Response.error();
      if (early) return finish(early, requestId, 'GET');
      let reply = await operation(request, url, requestId, match.op, match.params);
      if (ds.some((d) => d.kind === 'empty')) reply = emptied(reply, match.op);
      if (opId === 'completeUpload' && reply.status === match.op.success) scanLater(reply.body);
      return finish(reply, requestId, request.method);
    } catch (e) {
      if (!(e instanceof ProblemError)) console.error('[msw] сбой хендлера', opId, e);
      const err = e instanceof ProblemError ? e : new ProblemError('internal');
      return finish(problem(err, requestId, opId), requestId, request.method);
    }
  }

  /** Проверка загруженного файла через `scanAfterMs` — только этого файла (W2.53). */
  function scanLater(body: unknown): void {
    const id = (body as { id?: unknown } | undefined)?.id;
    if (o.scanAfterMs === undefined || typeof id !== 'string') return;
    setTimeout(() => {
      scanFiles(s, new Set([id]));
      o.onChange?.(s);
    }, o.scanAfterMs);
  }

  async function put(request: Request): Promise<Response> {
    const uploadId = new URL(request.url).pathname.split('/').at(-1) ?? '';
    if (o.now) s.clock = o.now();
    const res = await putObject(s, request, uploadId, now());
    if (res.ok) o.onChange?.(s);
    return res;
  }

  const server: ScenarioServer = {
    handlers: [http.all(API_URL, ({ request }) => handle(request))],
    storage: [
      http.put(STORAGE_UPLOAD_PATH, ({ request }) => put(request)),
      // W4.06 (0.7.0-stage4): файл готового задания выгрузки «Данных» (getDatasetExportDownload).
      http.get(STORAGE_EXPORT_PATH, ({ params, request }) => {
        if (o.now) s.clock = o.now();
        const signature = new URL(request.url).searchParams.get('signature');
        return getExportObject(s, String(params.jobId ?? ''), signature, now());
      }),
    ],
    handle,
    put,
    state: () => s,
    reset: (state) => {
      s = state ?? createScenarioState();
    },
    applyPreset: (name) => applyPreset(s, name),
    setScenario: (spec, once = false) => {
      s.scenario = spec ? { spec, once } : null;
    },
    setNow: (at) => {
      s.clock = at;
    },
  };
  return server;
}
