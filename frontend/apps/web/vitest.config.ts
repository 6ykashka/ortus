// Vitest @ortus/web (W0.09): jsdom, тесты рядом с кодом в src/.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// W2.53 · Сроки экранных тестов. Экранный тест рендерит приложение целиком на MSW-сценарном сервере
// (app/testing.tsx): первый тест файла на холодную импортирует ленивые маршруты, оболочку и сид — 1–1,5 с
// на свободной машине и 4–12 с, когда все ядра заняты (воркеры Vitest на все ядра плюс `go build`, e2e или
// второй прогон в pre-push). Срок по умолчанию 5 с был меньше ожиданий самих тестов (`SLOW` у findBy — 5–8 с),
// поэтому под нагрузкой тесты падали «Test timed out in 5000ms», не дойдя до проверки. 20 с — запас на
// нагрузку; зависший тест по-прежнему падает (ожидания findBy/waitFor — vitest.setup.ts).
const SCREEN_TEST_TIMEOUT_MS = 20_000;
// W2.55 · Половина ядер: `pnpm -r run test` гонит пакеты параллельно, а воркеры по умолчанию — все ядра без
// одного. Под нагрузкой 22 потоков CPU по умолчанию падало 50 тестов из 772 (холодный первый рендер не
// укладывался в ожидания), с половиной ядер — 6 при том же времени прогона; на машине без лишней нагрузки
// прогон не медленнее (88 с → 83 с).
const MAX_WORKERS = '50%';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    maxWorkers: MAX_WORKERS,
    testTimeout: SCREEN_TEST_TIMEOUT_MS,
    hookTimeout: SCREEN_TEST_TIMEOUT_MS,
  },
});
