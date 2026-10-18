// W2.53 · Хранилище режима mock: PUT по билету загрузки (`uploadUrl` initiateUpload, presigned PUT W1.09) и
// завершение проверки файла без dev-маршрута — ручной путь водителя в браузере (Q-W1.24-15, блокер W2.22 и Q-W2.90-4).
// Как MinIO стенда: ключ — сессия загрузки, тип содержимого — из билета, объект не больше заявленного размера;
// после PUT сессия `uploaded`, после completeUpload файл на проверке, проверка сама завершается через `scanAfterMs`.
import { seedUuid } from '@ortus/domain/seed';
import { setupServer } from 'msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { storageEnabled, STORAGE_ORIGIN } from '../src/msw/files/storage.ts';
import { createNodeServer } from '../src/msw/node.ts';
import { createScenarioServer, type ScenarioServer } from '../src/msw/server.ts';
import { Client, type Session } from './conformance/client.ts';

const ALTA = seedUuid('platform', 't-alta');
const TENANT = `/api/v1/tenants/${ALTA}`;
const SHA = 'a3f1c9e2b7d4058e6c1f2a9b3d7e4c5f8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d';
const MISSING = '00000000-0000-5000-8000-000000000000';
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

interface Ticket {
  uploadId: string;
  fileId: string;
  uploadUrl: string;
  requiredContentType: string;
}

let server: ScenarioServer;
let owner: Session;

async function initiate(s: Session, sizeBytes = BYTES.byteLength): Promise<Ticket> {
  const r = await s.post(`${TENANT}/files/uploads`, {
    fileName: 'Р-208 · спереди.jpg',
    contentType: 'image/jpeg',
    sizeBytes,
    sha256: SHA,
    purpose: 'inspection',
    owner: { moduleKey: 'fleet', entityType: 'reservation', entityId: MISSING },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as Ticket;
}

const put = (url: string, body: BodyInit = BYTES, type = 'image/jpeg'): Promise<Response> =>
  server.put(new Request(url, { method: 'PUT', headers: { 'Content-Type': type }, body }));

const session = async (t: Ticket) =>
  ((await owner.get(`${TENANT}/files/uploads/${t.uploadId}`)).body as { state: string }).state;

const fileStatus = async (id: string) =>
  ((await owner.get(`${TENANT}/files/${id}`)).body as { status: string }).status;

const complete = (t: Ticket) =>
  owner.post(`${TENANT}/files/uploads/${t.uploadId}/complete`, { sha256: SHA });

function start(o: Parameters<typeof createScenarioServer>[0] = {}): void {
  server = createScenarioServer(o);
}

beforeEach(async () => {
  start();
  owner = await new Client({ base: 'http://ortus.test', fetch: (r) => server.handle(r) }).as(
    'owner',
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PUT по билету загрузки', () => {
  it('объект принят: 200, сессия uploaded; complete — файл на проверке', async () => {
    const t = await initiate(owner);
    expect(t.uploadUrl).toBe(`${STORAGE_ORIGIN}/uploads/${t.uploadId}`);
    const r = await put(t.uploadUrl);
    expect(r.status).toBe(200);
    expect(r.headers.get('ETag')).toMatch(/^"[0-9a-f]+"$/);
    expect(await session(t)).toBe('uploaded');
    expect((await complete(t)).status).toBe(202);
    expect(await fileStatus(t.fileId)).toBe('quarantined');
  });

  it('неизвестная сессия — 404, тип не из билета и объект больше заявленного — отказ, сессия issued', async () => {
    const t = await initiate(owner);
    expect((await put(`${STORAGE_ORIGIN}/uploads/${MISSING}`)).status).toBe(404);
    expect((await put(t.uploadUrl, BYTES, 'image/png')).status).toBe(403);
    expect((await put(t.uploadUrl, new Uint8Array(BYTES.byteLength + 1))).status).toBe(400);
    expect(await session(t)).toBe('issued');
  });

  it('билет истёк, сессия отменена или завершена — 403', async () => {
    const late = await initiate(owner);
    server.setNow('2099-01-01T00:00:00Z');
    expect((await put(late.uploadUrl)).status).toBe(403);
    start();
    owner = await new Client({ base: 'http://ortus.test', fetch: (r) => server.handle(r) }).as(
      'owner',
    );
    const aborted = await initiate(owner);
    expect((await owner.delete(`${TENANT}/files/uploads/${aborted.uploadId}`)).status).toBe(204);
    expect((await put(aborted.uploadUrl)).status).toBe(403);
    const done = await initiate(owner);
    expect((await put(done.uploadUrl)).status).toBe(200);
    expect((await complete(done)).status).toBe(202);
    expect((await put(done.uploadUrl)).status).toBe(403);
  });

  it('обработчик MSW: fetch по uploadUrl в msw/node отвечает хранилище mock', async () => {
    const node = createNodeServer();
    node.server.listen({ onUnhandledRequest: 'error' });
    try {
      server = node.scenario;
      const s = await new Client({ base: 'http://ortus.test', fetch: (r) => fetch(r) }).as('owner');
      const t = await initiate(s);
      const r = await fetch(t.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: BYTES,
      });
      expect(r.status).toBe(200);
      expect(node.scenario.state().orgs[ALTA]?.uploads.at(-1)?.state).toBe('uploaded');
    } finally {
      node.server.close();
    }
  });

  it('обработчики хранилища — отдельно от API: только PUT /uploads/:uploadId', () => {
    const msw = setupServer(...server.storage);
    expect(server.storage).toHaveLength(1);
    expect(msw.listHandlers()).toHaveLength(1);
  });
});

describe('проверка файла без dev-маршрута (scanAfterMs)', () => {
  it('через scanAfterMs после completeUpload файл ready, остальные файлы на проверке не трогаются', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    start({ scanAfterMs: 1500 });
    owner = await new Client({ base: 'http://ortus.test', fetch: (r) => server.handle(r) }).as(
      'owner',
    );
    const t = await initiate(owner);
    await put(t.uploadUrl);
    const other = await initiate(owner);
    await put(other.uploadUrl);
    const org = server.state().orgs[ALTA];
    const before = org?.files.filter((f) => f.status === 'quarantined').map((f) => f.id) ?? [];
    expect((await complete(t)).status).toBe(202);
    vi.advanceTimersByTime(1499);
    expect(await fileStatus(t.fileId)).toBe('quarantined');
    vi.advanceTimersByTime(1);
    expect(await fileStatus(t.fileId)).toBe('ready');
    for (const id of before) expect(await fileStatus(id)).toBe('quarantined');
    expect(await fileStatus(other.fileId)).toBe('pending_upload');
  });

  it('без scanAfterMs проверка ждёт dev-маршрута scanFiles (e2e и экранные тесты)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const t = await initiate(owner);
    await put(t.uploadUrl);
    await complete(t);
    vi.advanceTimersByTime(60_000);
    expect(await fileStatus(t.fileId)).toBe('quarantined');
    await owner.post('/api/v1/dev/scenario', { scanFiles: true });
    expect(await fileStatus(t.fileId)).toBe('ready');
  });

  it('изменение состояния сохраняется (onChange) после PUT и после проверки', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const saved: string[] = [];
    start({
      scanAfterMs: 10,
      onChange: (s) => {
        const u = s.orgs[ALTA]?.uploads.at(-1);
        const f = s.orgs[ALTA]?.files.find((x) => x.id === u?.fileId);
        saved.push(`${u?.state}/${f?.status}`);
      },
    });
    owner = await new Client({ base: 'http://ortus.test', fetch: (r) => server.handle(r) }).as(
      'owner',
    );
    const t = await initiate(owner);
    await put(t.uploadUrl);
    await complete(t);
    vi.advanceTimersByTime(10);
    expect(saved).toContain('uploaded/pending_upload');
    expect(saved.at(-1)).toBe('completed/ready');
  });
});

describe('когда браузер включает хранилище mock', () => {
  it('вручную — да; под Playwright (navigator.webdriver) — нет: PUT и проверку ведёт e2e', () => {
    expect(storageEnabled({ webdriver: false })).toBe(true);
    expect(storageEnabled({ webdriver: true })).toBe(false);
  });

  it('явный выбор сильнее: опция startMockWorker, затем sessionStorage `ortus:msw:storage`', () => {
    expect(storageEnabled({ webdriver: true, stored: 'on' })).toBe(true);
    expect(storageEnabled({ webdriver: false, stored: 'off' })).toBe(false);
    expect(storageEnabled({ webdriver: true, stored: 'off', option: true })).toBe(true);
    expect(storageEnabled({ webdriver: false, stored: 'on', option: false })).toBe(false);
    expect(storageEnabled({ webdriver: false, stored: 'nonsense' })).toBe(true);
  });
});
