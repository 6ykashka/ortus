// Хуки сида (B §5.3, план v2 §3.5 «Сид»): базовый сид организации, затем install-функции модулей
// в порядке `api.js:37–45`. Порядок важен: документы до чатов (сид чатов ищет документ), БЗ и
// документы после ремонта (связь с obj-42), касса последней (предложения читают рейсы и SPA).
// `seed/compose.ts` (W0.12 / интегратор) регистрирует хуки модулей и вызывает `runSeedHooks`.
import type { SeedOpts } from './module.ts';
import type { TenantDb } from './types/index.ts';

export type SeedStage = 'normProjects' | 'service' | 'knowledge' | 'docs' | 'chats' | 'cash';

export const SEED_STAGES: readonly SeedStage[] = [
  'normProjects',
  'service',
  'knowledge',
  'docs',
  'chats',
  'cash',
];

export type SeedHook = (db: TenantDb, opts: SeedOpts) => void;

/** Стадии по организациям эталона: у «Лотоса» нет проектов задач и обращений (`db.service = null`). */
const SEED_PLAN: Readonly<Record<string, readonly SeedStage[]>> = {
  't-alta': SEED_STAGES,
  't-lotos': ['knowledge', 'docs', 'chats', 'cash'],
};

export const seedStagesFor = (tenantId: string): readonly SeedStage[] =>
  SEED_PLAN[tenantId] ?? SEED_STAGES;

/** Вызывает зарегистрированные хуки стадий организации по порядку; возвращает выполненные стадии. */
export function runSeedHooks(
  db: TenantDb,
  hooks: Partial<Record<SeedStage, SeedHook>>,
  opts: SeedOpts,
): SeedStage[] {
  const ran: SeedStage[] = [];
  for (const stage of seedStagesFor(opts.tenantId)) {
    const hook = hooks[stage];
    if (!hook) continue;
    hook(db, opts);
    ran.push(stage);
  }
  return ran;
}
