// Модуль «Документы · ядро» (W7.21, P1e docs-core) по контракту `DomainModule` ядра (B §5.1):
// установка среза, проекция для участника. Команд у ядра нет: маршрут и PDF — W7.22, остальные
// команды mock-адаптера — W7.27. Регистрацию в `modules/index.ts` и хук стадии `docs` в
// `seed/compose.ts` подключает интегратор (план v2 §3.5).
import { ddmmyyyy, demoClock, type Clock } from '../../../core/clock.ts';
import type { DomainModule } from '../../../core/module.ts';
import type { SeedHook } from '../../../core/seed-hooks.ts';
import { installDocs } from './seed.ts';
import type { DocsSlice, DocsTenantDb } from './types.ts';
import { docsView } from './view.ts';

/**
 * `clock` — часы проверки сроков назначений (PD-60) в проекции, по умолчанию демо-«сейчас». У `view`
 * ядра нет `ModuleCtx`, поэтому часы проекции задаются модулю, а команды берут `ctx.clock`; чтобы срок
 * решался одинаково, команды собираются только с теми же часами.
 */
export function createDocsCoreModule(
  o: { clock?: Clock } = {},
): DomainModule<DocsSlice | undefined> {
  const clock = o.clock ?? demoClock;
  return {
    key: 'docs',
    install(db) {
      installDocs(db);
    },
    view(db, actor, slice) {
      const ddb = db as DocsTenantDb;
      if (!ddb.docs) return null;
      const C = structuredClone(slice ?? ddb.docs);
      return docsView(ddb, actor, C, { today: ddmmyyyy(clock) });
    },
    commands(ctx) {
      if (ctx.clock !== clock) {
        throw new Error(
          'Модуль docs: часы команд (ModuleCtx.clock) не совпадают с часами проекции — ' +
            'создайте модуль createDocsCoreModule({ clock }) с часами адаптера',
        );
      }
      return {};
    },
    methods: [],
    delays: {},
  };
}

export const docsCoreModule = createDocsCoreModule();

/** Хук стадии `docs` для `createSeed({ hooks })`: после ремонта и БЗ, до чатов. */
export const docsHook: SeedHook = (db) => {
  installDocs(db);
};
