// Vitest для @ortus/domain (W0.11). Часы домена всегда в Europe/Moscow: тесты гоняются
// при TZ хоста America/New_York, чтобы зависимость от часового пояса машины падала сразу.
import { defineConfig } from 'vitest/config';

process.env.TZ = 'America/New_York';

// W2.55 · Сроки под нагрузкой. Тесты экспорт-листов (`modules/index.test.ts`, `seed/index.test.ts`,
// `knowledge/index.test.ts`) делают `await import('./index.ts')` внутри теста: преобразование всего графа
// модулей с инструментированием покрытия (`--coverage`) идёт в срок теста — 0,3–0,7 с на свободной машине
// и больше 5 с, когда `pnpm -r run test` гонит пакеты параллельно, а рядом `go build` (воспроизведено:
// «Test timed out in 5000ms» в обоих файлах). 20 с — общий срок пакетов frontend (W2.53 для @ortus/web,
// tools/ci/vitest-timeouts.test.mjs).
const TEST_TIMEOUT_MS = 20_000;
// Половина ядер. Преобразование модулей для всех воркеров идёт в одном главном процессе Vitest, и импорт
// всего графа в тестах экспорт-листов стоит в его очереди за остальными воркерами. Под нагрузкой 22 потоков
// CPU: по умолчанию (все ядра без одного) — 98 с и тест экспорт-листа 20 с (тайм-аут), с половиной ядер —
// 65 с и 9 с; на свободной машине разницы нет (W2.55, отчёт).
const MAX_WORKERS = '50%';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    maxWorkers: MAX_WORKERS,
    testTimeout: TEST_TIMEOUT_MS,
    hookTimeout: TEST_TIMEOUT_MS,
    coverage: {
      provider: 'v8',
      // W0.12: те же пороги для модулей пилота и сида; эталон для тестов паритета — не код пакета.
      include: ['src/core/**/*.ts', 'src/modules/**/*.ts', 'src/seed/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/core/types/**',
        'src/modules/**/types.ts',
        'src/seed/reference.ts',
      ],
      reporter: ['text', 'text-summary'],
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
