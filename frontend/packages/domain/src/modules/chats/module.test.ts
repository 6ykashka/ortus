// Модуль «Чаты» по контракту `DomainModule`: ключ, реестр команд, проекция, стадия сида `chats`.
// Подключение к реестру и `seed/compose.ts` — интегратор: здесь модуль и хук собираются явно.
import { describe, expect, it } from 'vitest';
import { demoClock } from '../../core/clock.ts';
import {
  composeCommands,
  composeDelays,
  createModuleCtx,
  type DomainModule,
} from '../../core/module.ts';
import { createFakeTaskPort } from '../../core/testing/index.ts';
import type { TenantDb } from '../../core/types/index.ts';
import { createSeed, FUTURE_STAGE_HOOKS } from '../../seed/compose.ts';
import { createAlta } from '../../seed/alta.ts';
import { createPlatform } from '../../seed/platform.ts';
import { createPilotModules } from '../index.ts';
import { CHAT_METHODS } from './commands.ts';
import { chatsModule } from './module.ts';
import { chatsHook } from './seed.ts';
import type { ChatsTenantDb } from './types.ts';

const seeded = () =>
  createSeed({
    modules: [...createPilotModules(), chatsModule as DomainModule],
    hooks: { ...FUTURE_STAGE_HOOKS, chats: chatsHook },
  });

describe('chatsModule', () => {
  it('ключ chat, методы и задержки; команды собираются в реестр без дублей', () => {
    expect(chatsModule.key).toBe('chat');
    expect(chatsModule.methods).toEqual(CHAT_METHODS);
    const db = createAlta(createPlatform()) as TenantDb;
    const ctx = createModuleCtx({
      getDb: () => db,
      getActor: () => 'm-owner',
      clock: demoClock,
      tasks: createFakeTaskPort(),
    });
    const mods = [...createPilotModules(), chatsModule as DomainModule];
    const cmds = composeCommands(mods, ctx);
    for (const name of CHAT_METHODS) expect(typeof cmds[name]).toBe('function');
    const delays = composeDelays(mods);
    expect(delays['chatOpen']).toBe(0);
    expect(delays['chatCleanup']).toBe(320);
  });

  it('createSeed: стадия chats — чаты «Альты» и «Лотоса», роли и назначения', () => {
    const { dbs } = seeded();
    const alta = dbs['t-alta'] as ChatsTenantDb;
    const lotos = dbs['t-lotos'] as ChatsTenantDb;
    expect(alta.chats?.items.map((c) => c.id)).toEqual([
      'ch-news',
      'ch-drv',
      'ch-trip',
      'ch-obj42',
      'ch-dkv',
      'ch-dzs',
    ]);
    expect(lotos.chats?.items.map((c) => c.id)).toEqual(['ch-news', 'ch-tver']);
    expect(alta.roles.some((r) => r.id === 'r-chat-owner')).toBe(true);
    expect(alta.assignments.some((a) => a.id === 'ach-1')).toBe(true);
    expect(lotos.assignments.some((a) => a.scope.type === 'chat')).toBe(false);
  });

  it('install не создаёт срез: без стадии chats модуль «не установлен»', () => {
    const db = createAlta(createPlatform()) as ChatsTenantDb;
    chatsModule.install(db, { tenantId: 't-alta', clock: demoClock });
    expect(db.chats).toBeUndefined();
    expect(chatsModule.view(db, 'm-owner', undefined)).toBeNull();
  });

  it('view: проекция для участника; снимок среза не меняется', () => {
    const { dbs } = seeded();
    const db = dbs['t-alta'] as ChatsTenantDb;
    const before = JSON.stringify(db.chats);
    const v = chatsModule.view(db as TenantDb, 'm-vasiliev', undefined);
    expect(v?.items.map((c) => c.id)).toEqual(['ch-news', 'ch-drv', 'ch-dkv']);
    expect(JSON.stringify(db.chats)).toBe(before);
    const snap = structuredClone(db.chats);
    const w = chatsModule.view(db as TenantDb, 'm-kotova', snap);
    expect(w?.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(snap)).toBe(JSON.stringify(db.chats));
  });
});
