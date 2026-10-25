// W4.86: smoke check-k6.mjs не должен слушать порт API слота (8100 + N): стенд слота 0 перехватывал запросы k6 из Docker.
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { describe, it } from 'node:test';

import { fakeApiPort } from '../lib/port.mjs';
import { startFakeApi } from './fake-api.mjs';

describe('fakeApiPort', () => {
  it('без FAKE_API_PORT — 0 (порт назначает ОС), не 8100…8120', () => {
    assert.equal(fakeApiPort({}), 0);
    assert.equal(fakeApiPort({ ORTUS_SLOT: '0' }), 0);
    assert.equal(fakeApiPort({ FAKE_API_PORT: '' }), 0);
  });

  it('FAKE_API_PORT — явный порт; неверное значение — ошибка', () => {
    assert.equal(fakeApiPort({ FAKE_API_PORT: '18123' }), 18123);
    for (const bad of ['x', '-1', '70000', '1.5']) {
      assert.throws(() => fakeApiPort({ FAKE_API_PORT: bad }), /FAKE_API_PORT/);
    }
  });
});

describe('startFakeApi: порт 0', () => {
  it('возвращает фактический порт и url с ним, а занятый чужим процессом порт не мешает', async () => {
    const busy = createServer();
    await new Promise((r) => busy.listen(0, '127.0.0.1', r));
    const busyPort = busy.address().port;
    const api = await startFakeApi({ port: 0, host: '127.0.0.1' });
    try {
      assert.ok(api.port > 0 && api.port !== busyPort);
      assert.equal(api.url, `http://127.0.0.1:${api.port}`);
      const r = await fetch(`${api.url}/__stats`);
      assert.equal(r.status, 200);
    } finally {
      await api.close();
      await new Promise((r) => busy.close(r));
    }
  });
});
