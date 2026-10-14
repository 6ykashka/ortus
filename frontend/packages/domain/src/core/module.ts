// Контракт модуля домена (B §5.1). Модуль эталона 14.10 = `installX` + `xView` + `xApi`;
// в домене это `DomainModule`: установка в сид, проекция для участника и команды по строковому
// имени метода (`api[m](...a)` оболочки). Межмодульные связи — только через ядро: часы, id,
// события, доступ и `TaskPort`. Регистрацию модулей (`modules/index.ts`) держит интегратор.
import { type Clock } from './clock.ts';
import {
  assertCan,
  can,
  canAny,
  canEarnings,
  grants,
  moduleOn,
  scopeCovers,
} from './access/index.ts';
import { ApiError } from './errors/index.ts';
import { createEmitter, type Emit } from './events.ts';
import { createIdGen, type IdGen } from './ids.ts';
import type { TaskPort } from './task-port.ts';
import type { ModuleKey, TenantDb } from './types/index.ts';

/** Команда модуля: синхронная функция над БД текущей организации; задержку и `view` добавляет адаптер. */
export type CommandFn = (...args: never[]) => unknown;

export interface SeedOpts {
  tenantId: string;
  clock: Clock;
}

/** Функции доступа ядра, которые получает модуль (подменяются в тестах адаптера). */
export const ACCESS = {
  can,
  canAny,
  canEarnings,
  assertCan,
  grants,
  moduleOn,
  scopeCovers,
} as const;
export type AccessApi = typeof ACCESS;

export interface ModuleCtx {
  getDb(): TenantDb;
  getActor(): string | null;
  clock: Clock;
  ids: IdGen;
  ApiError: typeof ApiError;
  can: AccessApi;
  emit: Emit;
  tasks: TaskPort;
}

export interface DomainModule<S = unknown> {
  key: ModuleKey;
  /** Идемпотентная миграция и сид среза модуля в БД организации. */
  install(db: TenantDb, opts: SeedOpts): void;
  /** Серверная проекция среза для участника; `null` — модуль не установлен. */
  view(db: TenantDb, actor: string, slice: S): S | null;
  commands(ctx: ModuleCtx): Record<string, CommandFn>;
  methods: readonly string[];
  /** Задержка mock-адаптера, мс (0 — без сети: `chatOpen`, `docJobPoll`). */
  delays: Readonly<Record<string, number>>;
}

export interface ModuleCtxInit {
  getDb: () => TenantDb;
  getActor: () => string | null;
  clock: Clock;
  tasks: TaskPort;
  ids?: IdGen;
  emit?: Emit;
}

export function createModuleCtx(init: ModuleCtxInit): ModuleCtx {
  const ids = init.ids ?? createIdGen(init.getDb);
  return {
    getDb: init.getDb,
    getActor: init.getActor,
    clock: init.clock,
    ids,
    ApiError,
    can: ACCESS,
    emit: init.emit ?? createEmitter(init.getDb, init.clock, ids),
    tasks: init.tasks,
  };
}

function checkDelays(m: DomainModule): void {
  for (const name of m.methods) {
    const d = m.delays[name];
    if (d === undefined || d < 0)
      throw new Error('Модуль ' + m.key + ': нет задержки для «' + name + '»');
  }
}

export function composeDelays(mods: readonly DomainModule[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of mods) {
    checkDelays(m);
    for (const name of m.methods) out[name] = m.delays[name] as number;
  }
  return out;
}

/** Реестр команд всех модулей. Дубль метода, расхождение `methods`/`commands` или нет задержки — ошибка. */
export function composeCommands(
  mods: readonly DomainModule[],
  ctx: ModuleCtx,
): Record<string, CommandFn> {
  const out: Record<string, CommandFn> = {};
  const owner = new Map<string, ModuleKey>();
  for (const m of mods) {
    const cmds = m.commands(ctx);
    for (const name of m.methods) {
      const fn = cmds[name];
      if (!fn) throw new Error('Модуль ' + m.key + ': нет команды «' + name + '»');
      const prev = owner.get(name);
      if (prev) throw new Error('Метод «' + name + '» объявлен в модулях ' + prev + ' и ' + m.key);
      owner.set(name, m.key);
      out[name] = fn;
    }
    for (const name of Object.keys(cmds)) {
      if (!m.methods.includes(name)) {
        throw new Error('Модуль ' + m.key + ': команда «' + name + '» не объявлена в methods');
      }
    }
    checkDelays(m);
  }
  return out;
}
