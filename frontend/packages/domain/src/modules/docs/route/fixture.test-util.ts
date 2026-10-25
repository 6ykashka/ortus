// Помощники тестов маршрута документа: «Альта» с документами, реальный `TaskPort` задач (W4.10)
// и команды маршрута на часах демо. Только для тестов.
import { demoClock } from '../../../core/clock.ts';
import { createIdGen } from '../../../core/ids.ts';
import { createModuleCtx, type ModuleCtx } from '../../../core/module.ts';
import { createTaskPort } from '../../tasks/task-port.ts';
import { altaDocs, type DocsDb } from '../core/fixture.test-util.ts';
import { createDocsRouteCommands, type DocsRouteCommands } from './commands.ts';

export interface RouteRig {
  db: DocsDb;
  ctx: ModuleCtx;
  cmds: DocsRouteCommands;
  /** Сменить актора: следующие команды идут от его имени. */
  as(id: string | null): void;
}

export function routeRig(db: DocsDb = altaDocs()): RouteRig {
  let actor: string | null = 'm-owner';
  const ids = createIdGen(() => db);
  const ctx = createModuleCtx({
    getDb: () => db,
    getActor: () => actor,
    clock: demoClock,
    ids,
    tasks: createTaskPort(() => db, ids),
  });
  return {
    db,
    ctx,
    cmds: createDocsRouteCommands(ctx),
    as: (id) => {
      actor = id;
    },
  };
}

/** Маршрут «согласовать → утвердить → ознакомить» по приказу № 14 (автор документа — Котова). */
export const ORDER_STEPS = [
  { kind: 'approve', mode: 'all', who: ['m-kotova'], days: 2 },
  { kind: 'sign', who: ['m-owner'], days: 1 },
  { kind: 'ack', audience: [{ who: 'group', ref: 'g-disp' }], days: 3 },
] as const;
