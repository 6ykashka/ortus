// W1.24 · Команды «Модули и место»: подключение и отключение с If-Match по ETag свежего GET
// (setModuleInstallation: без If-Match — 428, с устаревшим — 412). Клиент API подменяется объектом с методами
// GET/PUT (не мок fetch): проверяется только, что без ETag команда не уходит с пустым If-Match.
import { type ApiClient, ProblemError } from '@ortus/api-client';
import { describe, expect, it, vi } from 'vitest';

import { setModule } from './api.ts';

const manifest = { moduleKey: 'fleet', state: 'uninstalled' };

function client(etag: string | null) {
  const headers = new Headers(etag ? { ETag: etag } : {});
  const GET = vi.fn(() =>
    Promise.resolve({ data: manifest, response: new Response(null, { status: 200, headers }) }),
  );
  const PUT = vi.fn(() =>
    Promise.resolve({ data: manifest, response: new Response(null, { status: 200 }) }),
  );
  return { api: { GET, PUT } as unknown as ApiClient, GET, PUT };
}

describe('setModule', () => {
  it('If-Match — ETag свежего GET', async () => {
    const c = client('"r3"');
    await setModule(c.api, 't1', 'fleet', true);
    const opts = (c.PUT.mock.calls[0] as unknown[] | undefined)?.[1] as {
      params: { header: Record<string, string> };
    };
    expect(opts.params.header['If-Match']).toBe('"r3"');
  });

  it('GET без ETag: ошибка 428 («Не указана версия данных.»), PUT с пустым If-Match не уходит', async () => {
    const c = client(null);
    const err = await setModule(c.api, 't1', 'fleet', true).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProblemError);
    expect((err as ProblemError).status).toBe(428);
    expect(c.PUT).not.toHaveBeenCalled();
  });
});
