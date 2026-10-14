// ESLint flat config для всего монорепозитория (W0.03). Пакеты не держат своих конфигов:
// дополнения (testing-library, playwright и т. п.) добавляются сюда через интегратора.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    'design/',
    '.claude/',
    'docs/',
    '**/node_modules/',
    '**/dist/',
    '**/build/',
    '**/coverage/',
    '**/storybook-static/',
    '**/playwright-report/',
    '**/test-results/',
    '.playwright-mcp/',
    '**/routeTree.gen.ts',
    'frontend/packages/api-client/src/generated/',
    // Вендорные файлы эталона (W0.05): React UMD байт-в-байт по SRI.
    'tools/vendor/',
  ]),
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    extends: [js.configs.recommended],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.strict],
  },
  {
    files: ['**/*.tsx'],
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    files: ['frontend/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['**/*.{js,mjs,cjs}', 'tools/**', '**/*.config.{ts,mjs}'],
    languageOptions: { globals: globals.node },
  },
  prettier,
]);
