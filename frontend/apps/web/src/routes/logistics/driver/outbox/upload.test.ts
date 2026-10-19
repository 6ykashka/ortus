// W2.24 · Загрузка фото из очереди и исправления Q-W2.22-11 (`photos.ts`): фото на устройстве уже сжато —
// повторно не перекодируется (`prepared`); перекодированный JPEG получает имя `.jpg`; отказ проверки файла 404/403
// не «глотается» опросом; сбой completeUpload отменяет сессию (резерв места освобождается).
import { createApiClient, devLogin, ProblemError } from '@ortus/api-client';
import type { CookieJar, ScenarioServer } from '@ortus/adapter/msw';
import { createNodeServer } from '@ortus/adapter/msw/node';
import { seedUuid } from '@ortus/domain/seed';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { transport, uploadPhoto } from '../photos.ts';

const BASE = 'http://ortus.test';
const ALTA = seedUuid('platform', 't-alta');
const TRIP = seedUuid('t-alta', 'Р-208');

type Org = {
  files: { id: string; status: string; fileName: string }[];
  uploads: { uploadId: string; state: string }[];
};

let close: (() => void) | undefined;
const realPut = transport.put;
const realPrepare = transport.prepare;

async function setup(): Promise<{
  api: ReturnType<typeof createApiClient>;
  scenario: ScenarioServer;
}> {
  const store = new Map<string, string>();
  const jar: CookieJar = {
    read: () => Object.fromEntries(store),
    write: (_h, cookies) => {
      for (const c of cookies) store.set(c.name, c.value);
    },
  };
  const { server, scenario } = createNodeServer({ cookies: jar });
  server.listen({ onUnhandledRequest: 'error' });
  close = () => server.close();
  scenario.applyPreset('logistics-ready');
  await devLogin('driver', { baseUrl: BASE });
  const api = createApiClient({ baseUrl: BASE, csrfToken: () => store.get('ortus_csrf') });
  return { api, scenario };
}

// Сессия загрузки на MSW node под нагрузкой общего ПК — дольше 5 с.
vi.setConfig({ testTimeout: 20_000 });

const org = (s: ScenarioServer): Org => s.state().orgs[ALTA] as unknown as Org;
const settle = () => new Promise((r) => setTimeout(r, 60));

/**
 * Проверка файла завершается, пока загрузка не закончится: под нагрузкой сессия загрузки дольше фиксированной паузы
 * (возврат 1 — флейк «scan timeout» в полном прогоне).
 */
async function scanned<T>(s: ScenarioServer, p: Promise<T>): Promise<T> {
  const t = setInterval(() => {
    for (const f of org(s).files) if (f.status === 'quarantined') f.status = 'ready';
  }, 5);
  try {
    return await p;
  } finally {
    clearInterval(t);
  }
}

beforeEach(() => {
  transport.pollMs = 5;
  transport.put = async () => undefined;
});
afterEach(() => {
  close?.();
  transport.put = realPut;
  transport.prepare = realPrepare;
});

describe('uploadPhoto для очереди и Q-W2.22-11', () => {
  it('prepared: Blob с устройства уходит как есть — без повторного сжатия', async () => {
    const { api, scenario } = await setup();
    let prepared = 0;
    transport.prepare = async (f) => {
      prepared++;
      return f;
    };
    const blob = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
    const p = uploadPhoto(api, ALTA, blob, { purpose: 'inspection', tripId: TRIP, prepared: true });
    await scanned(scenario, p);
    expect(prepared).toBe(0);
  });

  it('перекодированный JPEG — имя файла с расширением .jpg', async () => {
    const { api, scenario } = await setup();
    transport.prepare = async () => new Blob([new Uint8Array([9])], { type: 'image/jpeg' });
    const heic = new File([new Uint8Array([1])], 'IMG_0042.HEIC', { type: 'image/heic' });
    const p = uploadPhoto(api, ALTA, heic, { purpose: 'inspection', tripId: TRIP });
    const id = await scanned(scenario, p);
    expect(org(scenario).files.find((f) => f.id === id)?.fileName).toBe('IMG_0042.jpg');
  });

  it('файл исчез при проверке (404) — ошибка, а не опрос до таймаута', async () => {
    const { api, scenario } = await setup();
    const p = uploadPhoto(
      api,
      ALTA,
      new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' }),
      {
        purpose: 'inspection',
        tripId: TRIP,
      },
    );
    await settle();
    const o = org(scenario);
    o.files = o.files.filter((f) => f.status !== 'quarantined');
    await expect(p).rejects.toBeInstanceOf(ProblemError);
  });

  it('сбой completeUpload — сессия отменена, ошибка пробрасывается', async () => {
    const { api, scenario } = await setup();
    scenario.setScenario('completeUpload=rate_limited');
    await expect(
      uploadPhoto(api, ALTA, new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' }), {
        purpose: 'inspection',
        tripId: TRIP,
      }),
    ).rejects.toBeInstanceOf(ProblemError);
    expect(org(scenario).uploads.at(-1)?.state).toBe('aborted');
  });
});
