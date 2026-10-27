// W5.33 · Загрузка фото чека подотчёта по сессии Files: initiateUpload (purpose expense_receipt, владелец —
// счёт подотчёта cash/account) → PUT по билету → completeUpload → ожидание проверки файла → id готового файла.
import { createApiClient, devLogin } from '@ortus/api-client';
import type { CookieJar, ScenarioServer } from '@ortus/adapter/msw';
import { createNodeServer } from '@ortus/adapter/msw/node';
import { seedUuid } from '@ortus/domain/seed';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReceiptRejectedError, transport, uploadReceiptPhoto } from './upload.ts';

const BASE = 'http://ortus.test';
const ALTA = seedUuid('platform', 't-alta');
const ACCOUNT = seedUuid('t-alta', 'ca-adv-vas');

type Org = {
  files: { id: string; status: string }[];
  uploads: {
    uploadId: string;
    fileId: string;
    state: string;
    purpose: string;
    owner: { moduleKey: string; entityType: string; entityId: string };
  }[];
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
  await devLogin('driver', { baseUrl: BASE });
  const api = createApiClient({ baseUrl: BASE, csrfToken: () => store.get('ortus_csrf') });
  return { api, scenario };
}

const org = (s: ScenarioServer): Org => s.state().orgs[ALTA] as unknown as Org;

/** Ставит итог проверки файлу сессии, начатой после снимка `from`, когда загрузка дошла до completeUpload. */
async function scan(s: ScenarioServer, from: number, to: 'ready' | 'rejected'): Promise<void> {
  await vi.waitFor(() => expect(org(s).uploads[from]?.state).toBe('completed'), {
    timeout: 10_000,
    interval: 2,
  });
  const f = org(s).files.find((x) => x.id === org(s).uploads[from]?.fileId);
  if (!f) throw new Error('нет файла сессии загрузки');
  f.status = to;
}

const file = () => new File([new Uint8Array([7, 7, 7])], 'check.jpg', { type: 'image/jpeg' });

beforeEach(() => {
  transport.pollMs = 5;
  transport.prepare = async (f) => f;
  transport.put = async () => undefined;
});
afterEach(() => {
  close?.();
  transport.put = realPut;
  transport.prepare = realPrepare;
});

describe('uploadReceiptPhoto', () => {
  it('сессия: purpose expense_receipt, владелец cash/account; возвращает id готового файла', async () => {
    const { api, scenario } = await setup();
    const from = org(scenario).uploads.length;
    const p = uploadReceiptPhoto(api, ALTA, ACCOUNT, file());
    await scan(scenario, from, 'ready');
    const id = await p;
    const u = org(scenario).uploads[from];
    expect(u?.purpose).toBe('expense_receipt');
    expect(u?.owner).toEqual({ moduleKey: 'cash', entityType: 'account', entityId: ACCOUNT });
    expect(u?.fileId).toBe(id);
  });

  it('ход передачи доходит до 99 %, 100 % — только после проверки', async () => {
    const { api, scenario } = await setup();
    const seen: number[] = [];
    transport.put = async (_u, f, _t, _s, onProgress) => onProgress?.(f.size, f.size);
    const from = org(scenario).uploads.length;
    const p = uploadReceiptPhoto(api, ALTA, ACCOUNT, file(), { onProgress: (n) => seen.push(n) });
    await scan(scenario, from, 'ready');
    await p;
    expect(Math.max(...seen)).toBe(99);
  });

  it('сбой PUT отменяет сессию и пробрасывается', async () => {
    const { api, scenario } = await setup();
    transport.put = async () => {
      throw new TypeError('PUT 500');
    };
    await expect(uploadReceiptPhoto(api, ALTA, ACCOUNT, file())).rejects.toThrow('PUT 500');
    await vi.waitFor(() => expect(org(scenario).uploads.at(-1)?.state).not.toBe('issued'), {
      timeout: 5_000,
    });
  });

  it('файл отклонён проверкой — ReceiptRejectedError', async () => {
    const { api, scenario } = await setup();
    const from = org(scenario).uploads.length;
    const p = uploadReceiptPhoto(api, ALTA, ACCOUNT, file());
    const failed = expect(p).rejects.toBeInstanceOf(ReceiptRejectedError);
    await scan(scenario, from, 'rejected');
    await failed;
  });
});
