import { defineConfig } from 'vitest/config';

// W2.55 · Сроки под нагрузкой: `pnpm -r run test` гонит пакеты параллельно, pre-push и `go build` рядом
// занимают ядра. `fonts.test.ts` читает и хеширует файлы шрифтов (0,4 с на свободной машине); 20 с — общий
// срок пакетов frontend (W2.53 для @ortus/web, tools/ci/vitest-timeouts.test.mjs).
const TEST_TIMEOUT_MS = 20_000;
// Половина ядер: пакеты идут параллельно, а воркеры по умолчанию — все ядра без одного (W2.55).
const MAX_WORKERS = '50%';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    maxWorkers: MAX_WORKERS,
    testTimeout: TEST_TIMEOUT_MS,
    hookTimeout: TEST_TIMEOUT_MS,
  },
});
