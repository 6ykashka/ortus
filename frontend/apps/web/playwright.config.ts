// Playwright @ortus/web: проекты, порты по слоту, режимы mock/stand, эталон — @ortus/e2e-kit (W0.05).
// Переменные окружения — frontend/packages/e2e-kit/README.md.
// W2.31: проекты устройств (devices-*, S2-19) — e2e/devices/projects.ts; spec e2e/devices/ идут только на них.
import { defineHarnessConfig } from '@ortus/e2e-kit/config';

import { withDeviceProjects } from './e2e/devices/projects.ts';

export default withDeviceProjects(defineHarnessConfig({ appDir: import.meta.dirname }));
