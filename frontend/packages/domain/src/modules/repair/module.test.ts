// Модуль «Ремонт и стройка» по контракту `DomainModule` ядра (B §5.1, W6.10): установка сида,
// проекция, команды с задержками. Регистрацию в `modules/index.ts` делает интегратор.
import { describe, expect, it } from 'vitest';
import { composeCommands, composeDelays } from '../../core/module.ts';
import type { TenantDb } from '../../core/types/index.ts';
import { createAlta } from '../../seed/alta.ts';
import { createLotos } from '../../seed/lotos.ts';
import { createPlatform } from '../../seed/platform.ts';
import { clock, harness } from './fixture.test-util.ts';
import { repairModule } from './module.ts';
import { REPAIR_DELAYS, REPAIR_METHODS } from './commands.ts';
import type { RepairDb } from './types.ts';

const opts = (tenantId: string) => ({ tenantId, clock });
const slice = (db: TenantDb) => (db as RepairDb).repair;

describe('repairModule', () => {
  it('ключ, методы и задержки', () => {
    expect(repairModule.key).toBe('repair');
    expect(repairModule.methods).toEqual(REPAIR_METHODS);
    expect(repairModule.delays).toEqual(REPAIR_DELAYS);
  });

  it('install: у «Альты» срез эталона, у «Лотоса» пустой; повторная установка идемпотентна', () => {
    const alta = createAlta(createPlatform()) as TenantDb;
    repairModule.install(alta, opts('t-alta'));
    expect(slice(alta)?.objects).toHaveLength(6);
    const works = slice(alta)?.works;
    repairModule.install(alta, opts('t-alta'));
    expect(slice(alta)?.works).toBe(works);
    const lotos = createLotos(createPlatform()) as TenantDb;
    repairModule.install(lotos, opts('t-lotos'));
    expect(slice(lotos)).toEqual({
      objects: [],
      works: [],
      crew: [],
      materials: [],
      changes: [],
      logs: [],
    });
  });

  it('install не затирает срез, который уже есть', () => {
    const db = createAlta(createPlatform()) as TenantDb;
    Object.assign(db, { repair: { objects: [{ id: 'x', name: 'X', foreman: null }] } });
    repairModule.install(db, opts('t-alta'));
    expect(slice(db)).toEqual({ objects: [{ id: 'x', name: 'X', foreman: null }] });
  });

  it('view: проекция участника; нет среза — null', () => {
    const h = harness((c) => c);
    const mine = repairModule.view(h.db, 'm-sokolov', undefined);
    expect(mine?.objects.map((o) => o.id)).toEqual(['obj-42', 'obj-38', 'obj-31', 'obj-27']);
    const bare = createAlta(createPlatform()) as TenantDb;
    expect(repairModule.view(bare, 'm-owner', undefined)).toBeNull();
  });

  it('commands работают через реестр ядра: composeCommands и composeDelays', () => {
    const h = harness((c) => c);
    const cmds = composeCommands([repairModule], h.ctx);
    expect(Object.keys(cmds)).toEqual([...REPAIR_METHODS]);
    expect(composeDelays([repairModule])).toEqual(REPAIR_DELAYS);
    const accept = cmds['acceptWorkLog'];
    h.as('m-owner');
    accept?.('WL-09' as never);
    expect(h.db.repair.logs.find((l) => l.id === 'WL-09')?.status).toBe('Принят');
  });
});
