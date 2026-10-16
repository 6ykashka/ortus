// Сгенерировано src/nav/gen-registry.mjs (W1.20) — не править руками:
// node --experimental-strip-types frontend/packages/domain/src/nav/gen-registry.mjs
import { manifest as calendar } from './modules/calendar.ts';
import { manifest as cash } from './modules/cash.ts';
import { manifest as chat } from './modules/chat.ts';
import { manifest as company } from './modules/company.ts';
import { manifest as data } from './modules/data.ts';
import { manifest as docs } from './modules/docs.ts';
import { manifest as files } from './modules/files.ts';
import { manifest as fleet } from './modules/fleet.ts';
import { manifest as forms } from './modules/forms.ts';
import { manifest as knowledge } from './modules/knowledge.ts';
import { manifest as overview } from './modules/overview.ts';
import { manifest as platform } from './modules/platform.ts';
import { manifest as repairs } from './modules/repairs.ts';
import { manifest as service } from './modules/service.ts';
import { manifest as spa } from './modules/spa.ts';
import { manifest as tasks } from './modules/tasks.ts';
import type { NavManifest } from './types.ts';

/** Манифесты модулей навигации (`modules/<id>.ts`), по имени файла. */
export const MANIFESTS: readonly NavManifest[] = [
  calendar,
  cash,
  chat,
  company,
  data,
  docs,
  files,
  fleet,
  forms,
  knowledge,
  overview,
  platform,
  repairs,
  service,
  spa,
  tasks,
];
