// W4.86: порт API-двойника для check-k6.mjs. По умолчанию 0 — порт назначает ОС: фиксированный 8100 + N совпадал с
// API слота, и стенд слота 0 перехватывал запросы k6 из Docker.
/** FAKE_API_PORT — явный порт (0…65535); пусто — 0. */
export function fakeApiPort(env = process.env) {
  const raw = env.FAKE_API_PORT;
  if (raw === undefined || raw === '') return 0;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n > 65535) {
    throw new RangeError(`FAKE_API_PORT=${JSON.stringify(raw)}: нужен порт 0…65535`);
  }
  return n;
}
