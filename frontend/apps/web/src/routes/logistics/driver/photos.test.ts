// W2.22 · Загрузка фото по сессии (W1.09): initiate → PUT (ход передачи) → complete → ожидание проверки → id
// готового файла; сбой PUT отменяет сессию; отклонённый проверкой файл — UploadRejectedError.
import { createApiClient, devLogin } from '@ortus/api-client';
import type { CookieJar, ScenarioServer } from '@ortus/adapter/msw';
import { createNodeServer } from '@ortus/adapter/msw/node';
import { seedUuid } from '@ortus/domain/seed';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jpegWithGps, leaks } from '../../core/files/upload/metadata.fixtures.test-util.ts';
import { fitSize, prepareImage, transport, UploadRejectedError, uploadPhoto } from './photos.ts';

const BASE = 'http://ortus.test';
const ALTA = seedUuid('platform', 't-alta');
const TRIP = seedUuid('t-alta', 'Р-208');

type Org = {
  files: { id: string; status: string; sizeBytes: number; sha256: string }[];
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

const org = (s: ScenarioServer): Org => s.state().orgs[ALTA] as unknown as Org;
const file = () => new File([new Uint8Array([7, 7, 7])], 'front.jpg', { type: 'image/jpeg' });

beforeEach(() => {
  transport.pollMs = 5;
});
afterEach(() => {
  close?.();
  transport.put = realPut;
  transport.prepare = realPrepare;
});

// D-08 (ответ владельца продукта 17.10): фото сжимается на клиенте до 1600 px по большей стороне; перекодирование
// холстом снимает EXIF с геоданными (ПДн §6). Без декодера изображений (jsdom, битый файл) — файл как есть.
describe('сжатие фото на клиенте', () => {
  it('fitSize: большая сторона не больше 1600 px, пропорции сохраняются, малые — без изменений', () => {
    expect(fitSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitSize(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(fitSize(1601, 1)).toEqual({ width: 1600, height: 1 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('prepareImage без декодера изображений возвращает исходный файл', async () => {
    const f = file();
    expect(await prepareImage(f)).toBe(f);
  });

  it('uploadPhoto загружает подготовленный файл: размер и SHA-256 — у результата prepare', async () => {
    const { api, scenario } = await setup();
    const small = new Blob([new Uint8Array([9, 9])], { type: 'image/jpeg' });
    transport.prepare = async () => small;
    let sent = 0;
    transport.put = async (_url, f) => {
      sent = f.size;
    };
    const p = uploadPhoto(api, ALTA, file(), { purpose: 'inspection', tripId: TRIP });
    await new Promise((r) => setTimeout(r, 60));
    for (const f of org(scenario).files) if (f.status === 'quarantined') f.status = 'ready';
    const id = await p;
    expect(sent).toBe(2);
    expect(org(scenario).files.find((f) => f.id === id)?.sizeBytes).toBe(2);
  });
});

// W2.44 (модель данных 4, ПДн §6): геоданные вырезаются до PUT и при подготовке по умолчанию (без декодера jsdom).
describe('uploadPhoto · геоданные', () => {
  it('фото с GPS: тело PUT без геоданных, размер и SHA-256 — у очищенного файла', async () => {
    const { api, scenario } = await setup();
    let sent = new Uint8Array();
    transport.put = async (_url, f) => {
      sent = new Uint8Array(await f.arrayBuffer());
    };
    const gps = new File([jpegWithGps()], 'front.jpg', { type: 'image/jpeg' });
    const p = uploadPhoto(api, ALTA, gps, { purpose: 'inspection', tripId: TRIP });
    // Ждём файл в проверке опросом, а не фиксированной паузой: на загруженной машине подготовка дольше.
    await vi.waitFor(
      () => {
        const q = org(scenario).files.filter((f) => f.status === 'quarantined');
        expect(q).not.toHaveLength(0);
        for (const f of q) f.status = 'ready';
      },
      { timeout: 4000, interval: 10 },
    );
    const id = await p;
    expect(sent.length).toBeGreaterThan(0);
    expect(leaks(sent)).toEqual([]);
    expect(org(scenario).files.find((f) => f.id === id)?.sizeBytes).toBe(sent.length);
    const sum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', sent))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(org(scenario).files.find((f) => f.id === id)?.sha256).toBe(sum);
  });
});

describe('uploadPhoto', () => {
  it('initiate → PUT с ходом передачи → complete → проверка → id готового файла', async () => {
    const { api, scenario } = await setup();
    const seen: number[] = [];
    transport.put = async (_url, _f, type, _signal, onProgress) => {
      expect(type).toBe('image/jpeg');
      onProgress?.(30, 100);
      onProgress?.(100, 100);
    };
    const p = uploadPhoto(api, ALTA, file(), {
      purpose: 'inspection',
      tripId: TRIP,
      onProgress: (n) => seen.push(n),
    });
    await new Promise((r) => setTimeout(r, 60));
    for (const f of org(scenario).files) if (f.status === 'quarantined') f.status = 'ready';
    const id = await p;
    expect(org(scenario).files.find((f) => f.id === id)?.status).toBe('ready');
    expect(seen).toEqual([30, 99, 99]);
  });

  it('сбой PUT: сессия отменяется (резерв освобождён), ошибка пробрасывается', async () => {
    const { api, scenario } = await setup();
    transport.put = async () => {
      throw new TypeError('PUT 500');
    };
    await expect(
      uploadPhoto(api, ALTA, file(), { purpose: 'inspection', tripId: TRIP }),
    ).rejects.toThrow('PUT 500');
    expect(org(scenario).uploads.at(-1)?.state).toBe('aborted');
  });

  it('файл отклонён проверкой — UploadRejectedError', async () => {
    const { api, scenario } = await setup();
    transport.put = async () => undefined;
    const p = uploadPhoto(api, ALTA, file(), { purpose: 'expense_receipt', tripId: TRIP });
    await new Promise((r) => setTimeout(r, 60));
    for (const f of org(scenario).files) if (f.status === 'quarantined') f.status = 'rejected';
    await expect(p).rejects.toBeInstanceOf(UploadRejectedError);
  });
});
