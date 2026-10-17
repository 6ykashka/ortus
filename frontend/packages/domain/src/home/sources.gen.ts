// Сгенерировано src/home/gen-sources.mjs (W2.25) — не править руками:
// node --experimental-strip-types frontend/packages/domain/src/home/gen-sources.mjs
import { source as access } from './sources/access.ts';
import { source as fleet } from './sources/fleet.ts';
import { source as tenant } from './sources/tenant.ts';
import type { HomeSource } from './types.ts';

/** Источники «Требует решения» (`sources/<id>.ts`), по имени файла. */
export const HOME_SOURCES: readonly HomeSource[] = [access, fleet, tenant];
