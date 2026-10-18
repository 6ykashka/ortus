// Модули пилота (W0.12) и их публичные функции. Реестр — горячая точка (план v2 §3.5): модули
// следующих этапов добавляются сюда одной строкой через интегратора.
import type { DomainModule } from '../core/module.ts';
import type { SeedOptions } from '../seed/types.ts';
import { createCalendarModule } from './calendar/module.ts';
import { filesModule } from './files/module.ts';
import { logisticsModule } from './logistics/module.ts';
import { tasksModule } from './tasks/module.ts';

export * from './logistics/index.ts';
export * from './calendar/index.ts';
export * from './files/index.ts';
export * from './people/index.ts';
export * from './platform/index.ts';
export * from './tasks/index.ts';

/** Модули пилота в порядке установки; `prototypeLeaks` — см. `SeedOptions`. */
export const createPilotModules = (opts: SeedOptions = {}): DomainModule[] => [
  logisticsModule as DomainModule,
  createCalendarModule(opts) as DomainModule,
  filesModule as DomainModule,
  tasksModule as DomainModule,
];

export const PILOT_MODULES: readonly DomainModule[] = createPilotModules();
