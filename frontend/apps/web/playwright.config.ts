// Playwright @ortus/web: проекты, порты по слоту, режимы mock/stand, эталон — @ortus/e2e-kit (W0.05).
// Переменные окружения — frontend/packages/e2e-kit/README.md.
import { defineHarnessConfig } from '@ortus/e2e-kit/config';

export default defineHarnessConfig({ appDir: import.meta.dirname });
