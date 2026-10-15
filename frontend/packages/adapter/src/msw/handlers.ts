// Реестр хендлеров операций сценарного сервера (W0.13, B §5.3 P3): модуль адаптера — каталог
// `src/msw/<модуль>/` со своим реестром; новый модуль (например, `fleet/` — W2.00) добавляется одной строкой.
import { accessHandlers } from './access/index.ts';
import { authHandlers } from './auth/index.ts';
import { billingHandlers } from './billing/index.ts';
import { contextHandlers } from './context/index.ts';
import type { Registry } from './core/registry.ts';
import { filesHandlers } from './files/index.ts';
import { modulesHandlers } from './modules/index.ts';
import { platformHandlers } from './platform/index.ts';

export const defaultRegistry: Registry = {
  ...contextHandlers,
  ...authHandlers,
  ...platformHandlers,
  ...billingHandlers,
  ...accessHandlers,
  ...modulesHandlers,
  ...filesHandlers,
};
