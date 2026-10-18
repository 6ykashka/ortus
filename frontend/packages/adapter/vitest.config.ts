// Vitest @ortus/adapter (W0.13): сценарный сервер через msw/node, conformance — test/conformance/.
import { defineConfig } from 'vitest/config';

// W2.55 · Сроки под нагрузкой. Самый тяжёлый тест — `contract.test.ts` «свежий относительно api/»:
// разбор бандла YAML и prettier на 0,5 МБ JSON — 4 с отдельно и ~11 с рядом с остальными воркерами пакета
// на свободной машине. `pnpm -r run test` гонит пакеты параллельно, pre-push и `go build` рядом занимают
// ядра, поэтому срок по умолчанию 5 с был мал и для тестов, и для хуков (сценарный сервер и msw/node в beforeAll/beforeEach).
// 20 с — общий срок пакетов frontend (W2.53 для @ortus/web, tools/ci/vitest-timeouts.test.mjs).
const TEST_TIMEOUT_MS = 20_000;
// Половина ядер: пакеты идут параллельно, а воркеры по умолчанию — все ядра без одного. Под нагрузкой
// 22 потоков CPU прогон пакета — 117 с по умолчанию и 93 с с половиной ядер (W2.55, отчёт).
const MAX_WORKERS = '50%';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    maxWorkers: MAX_WORKERS,
    testTimeout: TEST_TIMEOUT_MS,
    hookTimeout: TEST_TIMEOUT_MS,
  },
});
