// Модуль «База знаний» по контракту `DomainModule` ядра (B §5.1): установка сырой БЗ, проекция и
// 17 команд с задержками. Миграция v2 — отдельный хук стадии сида `knowledge` (`SEED_STAGES` ядра).
// Регистрацию в `modules/index.ts` и хук в `seed/compose.ts` подключает интегратор (план v2 §3.5).
import { ddmmyyyy, demoClock, type Clock } from '../../core/clock.ts';
import type { DomainModule } from '../../core/module.ts';
import type { SeedHook } from '../../core/seed-hooks.ts';
import { KB_DELAYS, KB_METHODS, knowledgeCommands } from './commands.ts';
import { migrateKnowledgeV2 } from './migrate-v2.ts';
import { knowledgeSeed } from './seed.ts';
import type { KbTenantDb, KnowledgeSlice } from './types.ts';
import { kbView } from './view.ts';

/**
 * `clock` — часы проверки сроков назначений (PD-60) в проекции, по умолчанию демо-«сейчас». У `view`
 * ядра нет `ModuleCtx`, поэтому часы проекции задаются модулю, а команды берут `ctx.clock`. Чтобы
 * срок решался одинаково, команды собираются только с теми же часами (`composeCommands` падает).
 */
export function createKnowledgeModule(
  o: { clock?: Clock } = {},
): DomainModule<KnowledgeSlice | undefined> {
  const clock = o.clock ?? demoClock;
  return {
    key: 'knowledge',
    install(db, opts) {
      (db as KbTenantDb).knowledge ??= knowledgeSeed(opts.tenantId);
    },
    view(db, actor, slice) {
      const kdb = db as KbTenantDb;
      if (!kdb.knowledge) return null;
      const C = structuredClone(slice ?? kdb.knowledge);
      return kbView(kdb, actor, C, { today: ddmmyyyy(clock) }) ?? null;
    },
    commands(ctx) {
      if (ctx.clock !== clock) {
        throw new Error(
          'Модуль knowledge: часы команд (ModuleCtx.clock) не совпадают с часами проекции — ' +
            'создайте модуль createKnowledgeModule({ clock }) с часами адаптера',
        );
      }
      return knowledgeCommands(ctx);
    },
    methods: KB_METHODS,
    delays: KB_DELAYS,
  };
}

export const knowledgeModule = createKnowledgeModule();

/** Хук стадии `knowledge` для `createSeed({ hooks })`: переход БЗ на v2. */
export const knowledgeHook: SeedHook = (db) => {
  migrateKnowledgeV2(db as KbTenantDb);
};
