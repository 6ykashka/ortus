// Vitest для @ortus/domain (W0.11). Часы домена всегда в Europe/Moscow: тесты гоняются
// при TZ хоста America/New_York, чтобы зависимость от часового пояса машины падала сразу.
import { defineConfig } from 'vitest/config';

process.env.TZ = 'America/New_York';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
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
