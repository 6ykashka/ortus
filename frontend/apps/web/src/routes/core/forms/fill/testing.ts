// W4.70 · Помощник экранных тестов заполнения формы: запросы к сценарному серверу экранного теста от имени вошедшего
// персонажа (cookie сессии — в памяти теста, CSRF — из состояния сервера) — подготовка форм через API контракта, как
// e2e (createForm, saveFormDraft, updateForm, publishForm).
import { BASE_URL, type MockApp } from '../../../../app/testing.tsx';

export interface Reply {
  status: number;
  etag: string;
  body: Record<string, unknown>;
}

/** Запрос к API сценарного сервера теста; изменяющий — с CSRF и Idempotency-Key. */
export async function call(
  a: MockApp,
  method: string,
  path: string,
  o: { body?: unknown; ifMatch?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    const csrf = Object.values(a.scenario.state().sessions).at(-1)?.csrf;
    if (csrf) headers['X-CSRF-Token'] = csrf;
    headers['Idempotency-Key'] = crypto.randomUUID();
  }
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  if (o.ifMatch) headers['If-Match'] = o.ifMatch;
  const r = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
  });
  const text = await r.text();
  return {
    status: r.status,
    etag: r.headers.get('ETag') ?? '',
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

async function ok(p: Promise<Reply>, what: string): Promise<Reply> {
  const r = await p;
  if (r.status >= 300) throw new Error(`${what} ${r.status}: ${JSON.stringify(r.body)}`);
  return r;
}

export interface Made {
  url: string;
  form: string;
  versionId: string;
  token: string | null;
}

/**
 * Новая форма «Вся организация» организации `tenant`, опубликованная v1: вопросы `fields` на странице «Страница 1» (или
 * шаблон `templateId`), настройки `settings`.
 */
export async function makeForm(
  a: MockApp,
  tenant: string,
  o: {
    name: string;
    fields?: Record<string, unknown>[];
    settings?: Record<string, unknown>;
    templateId?: string;
  },
): Promise<Made> {
  const base = `/api/v1/tenants/${tenant}/forms`;
  const f = await ok(
    call(a, 'POST', base, {
      body: { name: o.name, orgUnitId: null, templateId: o.templateId ?? 'blank' },
    }),
    'createForm',
  );
  const url = `${base}/${String(f.body.id)}`;
  if (o.fields) {
    const d = await call(a, 'GET', `${url}/draft`);
    await ok(
      call(a, 'PUT', `${url}/draft`, {
        body: { definition: { pages: [{ id: 'p1', title: 'Страница 1' }], fields: o.fields } },
        ifMatch: d.etag,
      }),
      'saveFormDraft',
    );
  }
  if (o.settings) {
    const cur = await call(a, 'GET', url);
    await ok(
      call(a, 'PATCH', url, { body: { settings: o.settings }, ifMatch: cur.etag }),
      'updateForm',
    );
  }
  const d = await call(a, 'GET', `${url}/draft`);
  const cur = await call(a, 'GET', url);
  const pub = await ok(
    call(a, 'POST', `${url}/publish`, {
      body: { draftRevision: d.body.revision },
      ifMatch: cur.etag,
    }),
    'publishForm',
  );
  return {
    url,
    form: String(f.body.id),
    versionId: String(pub.body.publishedVersionId),
    token: (pub.body.share as { publicToken: string | null }).publicToken,
  };
}

/** Изменить форму (updateForm, If-Match по ETag). */
export async function patchForm(a: MockApp, url: string, body: unknown): Promise<void> {
  const cur = await call(a, 'GET', url);
  await ok(call(a, 'PATCH', url, { body, ifMatch: cur.etag }), 'updateForm');
}

/** Файл для поля «Файл или фото» (минимальный JPEG). */
export const jpeg = (name: string): File =>
  new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], name, { type: 'image/jpeg' });
