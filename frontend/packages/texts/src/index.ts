// Сгенерировано scripts/gen-index.mjs (W0.14) — не править руками:
// corepack pnpm --filter @ortus/texts gen
import { banners } from './banners.ts';
import { calendar } from './calendar.ts';
import { company } from './company.ts';
import { data } from './data.ts';
import { errors } from './errors.ts';
import { gate } from './gate.ts';
import { home } from './home.ts';
import { knowledge } from './knowledge.ts';
import { logisticsDriver } from './logistics-driver.ts';
import { logisticsManager } from './logistics-manager.ts';
import { platform } from './platform.ts';
import { screenLabels } from './screen-labels.ts';
import { shell } from './shell.ts';
import { tasks } from './tasks.ts';
import { toast } from './toast.ts';

export {
  banners,
  calendar,
  company,
  data,
  errors,
  gate,
  home,
  knowledge,
  logisticsDriver,
  logisticsManager,
  platform,
  screenLabels,
  shell,
  tasks,
  toast,
};
export { IcuSyntaxError, argNames, format, parseMessage } from './icu.ts';
export type { MessageNode, MessageValues, TextTree } from './types.ts';

/** Все домены словаря — для охранников и сверок подписей. */
export const ALL = {
  banners,
  calendar,
  company,
  data,
  errors,
  gate,
  home,
  knowledge,
  logisticsDriver,
  logisticsManager,
  platform,
  screenLabels,
  shell,
  tasks,
  toast,
} as const;
