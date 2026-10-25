// Контекст команд кассы для тестов: действующий участник и часы демо-«сейчас». Только для тестов.
import { demoClock } from '../../core/clock.ts';
import { createModuleCtx, type ModuleCtx, type ModuleCtxInit } from '../../core/module.ts';
import { createFakeTaskPort } from '../../core/testing/index.ts';
import { cashCommands, type CashApi } from './commands.ts';
import { altaCash, type CashDb } from './fixture.test-util.ts';

export interface Env {
  db: CashDb;
  ctx: ModuleCtx;
  api: CashApi;
  /** Сменить действующего участника. */
  as(actor: string | null): void;
}

/** Команды кассы над БД `db` от имени `actor` (по умолчанию — владелец); `init` подменяет часть ядра. */
export function env(
  db: CashDb = altaCash(),
  actor: string | null = 'm-owner',
  init: Partial<ModuleCtxInit> = {},
): Env {
  let me = actor;
  const ctx = createModuleCtx({
    getDb: () => db,
    getActor: () => me,
    clock: demoClock,
    tasks: createFakeTaskPort(),
    ...init,
  });
  return {
    db,
    ctx,
    api: cashCommands(ctx),
    as: (a) => {
      me = a;
    },
  };
}
