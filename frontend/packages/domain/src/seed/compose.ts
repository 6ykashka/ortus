// Сборка сида (план v2 §3.5 «Сид», B §5.3): база организации → установка модулей пилота →
// стадии SEED_STAGES ядра в порядке api.js:37–45 (normProjects → service → knowledge → docs →
// chats → cash; у «Лотоса» без normProjects и service). Хуки стадий пока пустые: их заменят
// модули этапов 4–7 одной строкой через интегратора. Часы сида — демо-«сейчас» ядра.
import { demoClock } from '../core/clock.ts';
import type { DomainModule } from '../core/module.ts';
import { runSeedHooks, type SeedHook, type SeedStage } from '../core/seed-hooks.ts';
import { createPilotModules, normProjectsHook } from '../modules/index.ts';
import { createAlta } from './alta.ts';
import { createLotos } from './lotos.ts';
import { createPlatform } from './platform.ts';
import type { BaseDb, OrgId, PilotDb, SeedOptions, SeedState } from './types.ts';

/** Хуки стадий модулей будущих этапов: пусто до прихода владельца (normProjects — W4.10). */
export const FUTURE_STAGE_HOOKS: Readonly<Record<SeedStage, SeedHook>> = {
  /** Проекты задач: процесс, доступ, T-65/T-66, автоматизация — W4.10 (P1a). */
  normProjects: normProjectsHook,
  /** Обращения: направления, типы, обращения «Альты» — W7.30 (P1h). */
  service: () => undefined,
  /** База знаний v2: пространства, дерево, роли пространств — W4.30 (P1c). */
  knowledge: () => undefined,
  /** Документы: папки, документы, роли папок — W7.21 (P1e). */
  docs: () => undefined,
  /** Чаты: чаты, сообщения, роли чатов — W7.10 (P1f). */
  chats: () => undefined,
  /** Касса: кассы, операции, смены, роль кассира — W5.30 (P1g). */
  cash: () => undefined,
};

export interface ComposeOptions extends SeedOptions {
  /** Модули пилота (по умолчанию — реестр `modules/index.ts`). */
  modules?: readonly DomainModule[];
  /** Хуки стадий (по умолчанию — `FUTURE_STAGE_HOOKS`). */
  hooks?: Partial<Record<SeedStage, SeedHook>>;
}

/** Сид режима `mock` и e2e: платформа и обе организации; каждый вызов — новые объекты. */
export function createSeed(opts: ComposeOptions = {}): SeedState {
  const platform = createPlatform();
  const modules = opts.modules ?? createPilotModules(opts);
  const hooks = opts.hooks ?? FUTURE_STAGE_HOOKS;
  const bases: Record<OrgId, BaseDb> = {
    't-alta': createAlta(platform),
    't-lotos': createLotos(platform),
  };
  for (const db of Object.values(bases)) {
    const seedOpts = { tenantId: db.tenantId, clock: demoClock };
    for (const m of modules) m.install(db, seedOpts);
    runSeedHooks(db, hooks, seedOpts);
  }
  return { platform, dbs: bases as Record<OrgId, PilotDb> };
}
