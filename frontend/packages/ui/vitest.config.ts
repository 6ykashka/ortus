import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// W2.55 · Сроки под нагрузкой: `pnpm -r run test` гонит пакеты параллельно, pre-push и `go build` рядом
// занимают ядра. Первый тест файла на холодную импортирует компоненты и jsdom (ScopeSelect, Textarea —
// около 1 с на свободной машине), `no-color-literals.test.ts` обходит все исходники (1,8 с). 20 с — общий
// срок пакетов frontend (W2.53 для @ortus/web, tools/ci/vitest-timeouts.test.mjs).
const TEST_TIMEOUT_MS = 20_000;
// Половина ядер: пакеты идут параллельно, а воркеры по умолчанию — все ядра без одного (W2.55).
const MAX_WORKERS = '50%';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    maxWorkers: MAX_WORKERS,
    testTimeout: TEST_TIMEOUT_MS,
    hookTimeout: TEST_TIMEOUT_MS,
  },
});
