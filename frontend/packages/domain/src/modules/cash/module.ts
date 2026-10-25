// Модуль «Касса» по контракту `DomainModule` ядра (B §5.1): установка (роли, кассы, сид «Альты»),
// проекция для участника и 16 команд `cash*` с задержками. Регистрацию в `modules/index.ts` и хук
// стадии `cash` в `seed/compose.ts` подключает интегратор (план v2 §3.5, строка в отчёте W5.30).
import { ddmm, demoClock, type Clock } from '../../core/clock.ts';
import type { DomainModule } from '../../core/module.ts';
import { CASH_DELAYS, CASH_METHODS, cashCommands } from './commands.ts';
import { cashHook, installCash } from './seed.ts';
import type { CashTenantDb } from './types.ts';
import { cashView, type CashView } from './view.ts';

/**
 * `clock` — часы проверки сроков отчёта в проекции («сегодня» кассы), по умолчанию демо-«сейчас».
 * У `view` ядра нет `ModuleCtx`, поэтому часы проекции задаются модулю, а команды берут
 * `ctx.clock`; чтобы срок решался одинаково, команды собираются только с теми же часами.
 */
export function createCashModule(o: { clock?: Clock } = {}): DomainModule<CashView | undefined> {
  const clock = o.clock ?? demoClock;
  return {
    key: 'cash',
    install(db) {
      installCash(db as CashTenantDb);
    },
    view(db, actor) {
      return cashView(db as CashTenantDb, actor, { today: ddmm(clock) });
    },
    commands(ctx) {
      if (ctx.clock !== clock) {
        throw new Error(
          'Модуль cash: часы команд (ModuleCtx.clock) не совпадают с часами проекции — ' +
            'создайте модуль createCashModule({ clock }) с часами адаптера',
        );
      }
      return cashCommands(ctx) as unknown as ReturnType<DomainModule['commands']>;
    },
    methods: CASH_METHODS,
    delays: CASH_DELAYS,
  };
}

export const cashModule = createCashModule();

export { cashHook };
