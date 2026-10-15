// Клиент conformance и unit-тестов сценарного сервера (W0.13): cookie-сессия BFF (dev-вход), CSRF из cookie,
// Origin, Idempotency-Key для изменяющих операций, X-Request-Id примеров. Цель — `fetch` режима `mock`
// (msw/node или `server.handle`); стенд (W1.x) подставит свой `fetch` и адрес.
import { findOperation } from '../../src/msw/contract/index.ts';

export const REQUEST_ID = '01J9Z4QK8M6T2V5X7Y9A1B3C5D';

export interface Target {
  /** Origin приложения: адрес запросов и разрешённый Origin. */
  base: string;
  fetch(request: Request): Promise<Response>;
}

export interface CallOptions {
  /** Тело запроса (JSON) или строка как есть. */
  body?: unknown;
  /** false — без X-CSRF-Token; строка — свой токен. */
  csrf?: false | string;
  /** false — без Origin; строка — свой Origin. */
  origin?: false | string;
  /** false — без Idempotency-Key; строка — свой ключ (по умолчанию новый на каждый вызов). */
  idempotencyKey?: false | string;
  /** Значение If-Match: число — `"rev-N"`, строка — как есть. */
  ifMatch?: number | string;
  scenario?: string;
  headers?: Record<string, string>;
}

export interface Reply {
  status: number;
  headers: Headers;
  body: unknown;
  /** operationId запроса (по контракту) — для учёта покрытия. */
  operationId: string | undefined;
  method: string;
  path: string;
}

export type ReplyHook = (r: Reply) => void;

let keySeq = 0;
const nextKey = (): string => `conformance-key-${String(++keySeq).padStart(6, '0')}`;

/** Сессия клиента: cookie, CSRF-токен. */
export class Session {
  readonly cookies = new Map<string, string>();

  constructor(
    private readonly target: Target,
    private readonly hooks: ReplyHook[] = [],
  ) {}

  get csrf(): string | undefined {
    return this.cookies.get('ortus_csrf');
  }

  async request(method: string, path: string, o: CallOptions = {}): Promise<Reply> {
    const url = new URL(path, this.target.base);
    const headers = new Headers(o.headers);
    headers.set('X-Request-Id', REQUEST_ID);
    if (this.cookies.size) {
      headers.set('Cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    }
    const mutating = !['GET', 'HEAD'].includes(method);
    if (mutating && o.origin !== false) headers.set('Origin', o.origin ?? this.target.base);
    if (mutating && o.csrf !== false) {
      const t = o.csrf ?? this.csrf;
      if (t) headers.set('X-CSRF-Token', t);
    }
    const op = findOperation(method, url.pathname)?.op;
    if (op?.idempotent && o.idempotencyKey !== false) {
      headers.set('Idempotency-Key', o.idempotencyKey ?? nextKey());
    }
    if (o.ifMatch !== undefined) {
      headers.set('If-Match', typeof o.ifMatch === 'number' ? `"rev-${o.ifMatch}"` : o.ifMatch);
    }
    if (o.scenario) headers.set('X-Test-Scenario', o.scenario);
    let body: string | undefined;
    if (o.body !== undefined) {
      body = typeof o.body === 'string' ? o.body : JSON.stringify(o.body);
      headers.set('Content-Type', 'application/json');
    }
    const res = await this.target.fetch(
      new Request(url, { method, headers, body, redirect: 'manual' }),
    );
    for (const c of res.headers.getSetCookie()) {
      const [pair = ''] = c.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (/max-age=0|max-age=-/i.test(c) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = res.type === 'error' ? '' : await res.text();
    const reply: Reply = {
      status: res.type === 'error' ? 0 : res.status,
      headers: res.headers,
      body: text ? (JSON.parse(text) as unknown) : undefined,
      operationId: op?.id,
      method,
      path: url.pathname,
    };
    for (const h of this.hooks) h(reply);
    return reply;
  }

  get = (path: string, o?: CallOptions) => this.request('GET', path, o);
  post = (path: string, body?: unknown, o?: CallOptions) =>
    this.request('POST', path, { ...o, body });
  put = (path: string, body?: unknown, o?: CallOptions) =>
    this.request('PUT', path, { ...o, body });
  patch = (path: string, body?: unknown, o?: CallOptions) =>
    this.request('PATCH', path, { ...o, body });
  delete = (path: string, o?: CallOptions) => this.request('DELETE', path, o);
}

export class Client {
  constructor(
    readonly target: Target,
    readonly hooks: ReplyHook[] = [],
  ) {}

  /** Без сессии. */
  anon(): Session {
    return new Session(this.target, this.hooks);
  }

  /** Сессия персонажа e2e (`owner`, `manager`…) или subject сида (`acc-7`, `op-3`) через dev-вход. */
  async as(persona: string): Promise<Session> {
    const s = new Session(this.target, this.hooks);
    const r = await s.post('/api/v1/dev/login', { persona });
    if (r.status !== 200)
      throw new Error(`dev-вход ${persona}: ${r.status} ${JSON.stringify(r.body)}`);
    return s;
  }
}
