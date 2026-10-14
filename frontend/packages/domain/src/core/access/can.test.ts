import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors/index.ts';
import { altaFixture, altaWithLogistics } from '../testing/fixture.ts';
import type { CanResult, ObjectRef } from '../types/index.ts';
import { assertCan, can, canAny, canEarnings, grants, moduleOn } from './index.ts';

const via = (r: CanResult): string | undefined => (r.ok ? r.via.id : undefined);
const reason = (r: CanResult): string | undefined => (r.ok ? undefined : r.reason);
const fleet: ObjectRef = { type: 'project', id: 'fleet' };

describe('moduleOn и grants', () => {
  it('ядро всегда подключено, отрасль — по db.modules', () => {
    const db = altaFixture();
    expect(moduleOn(db, 'tasks')).toBe(true);
    expect(moduleOn(db, 'logistics')).toBe(false);
    expect(moduleOn(db, 'spa')).toBe(true);
    expect(moduleOn(db, 'repair')).toBe(false);
  });

  it('grants: назначения участника с ролью, назначения на несуществующую роль отбрасываются', () => {
    const db = altaFixture();
    const own = grants(db, 'm-owner');
    expect(own.map((g) => g.id)).toEqual(['a1']);
    expect(own[0]?.roleObj.id).toBe('r-owner');
    db.assignments.push({ id: 'x1', member: 'm-ilyin', role: 'r-nope', scope: { type: 'tenant' } });
    expect(grants(db, 'm-ilyin')).toEqual([]);
    expect(grants(db, 'm-kotova').map((g) => g.id)).toEqual([
      'ap1',
      'as-svc1',
      'akb-1',
      'akb-3',
      'adoc-1',
      'ach-1',
      'ach-4',
    ]);
  });
});

describe('can: модуль → роль → область (WS-05 §6б, сид 14.10)', () => {
  it('отрасль не подключена → module_off; после подключения владелец проходит через a1', () => {
    expect(reason(can(altaFixture(), 'm-owner', 'logistics', 'view'))).toBe('module_off');
    expect(via(can(altaWithLogistics(), 'm-owner', 'logistics', 'view'))).toBe('a1');
  });

  it.each([
    ['m-vasiliev', 'review', 'f-msk-sever', 'no_permission'],
    ['m-vasiliev', 'view', 'f-msk-yug', 'no_scope'],
  ] as const)('%s logistics.%s в %s → %s', (mid, verb, unitId, want) => {
    expect(reason(can(altaWithLogistics(), mid, 'logistics', verb, unitId))).toBe(want);
  });

  it('водитель видит логистику своей фирмы через a2', () => {
    expect(via(can(altaWithLogistics(), 'm-vasiliev', 'logistics', 'view', 'f-msk-sever'))).toBe(
      'a2',
    );
  });

  it('ремонт выключен → module_off, выключен с историей → module_readonly', () => {
    const db = altaFixture();
    expect(reason(can(db, 'm-sokolov', 'repair', 'create'))).toBe('module_off');
    db.modules.repair = { enabled: false, history: true };
    expect(reason(can(db, 'm-sokolov', 'repair', 'create'))).toBe('module_readonly');
  });

  it('область «self» даёт право без подразделения, но не покрывает фирму', () => {
    const db = altaFixture();
    expect(via(can(db, 'm-morozova', 'spa', 'view'))).toBe('a3');
    expect(reason(can(db, 'm-morozova', 'spa', 'view', 'f-msk-sever'))).toBe('no_scope');
  });

  it('владелец проходит любое действие ядра', () => {
    expect(via(can(altaFixture(), 'm-owner', 'tasks', 'settings'))).toBe('a1');
    expect(via(can(altaFixture(), 'm-owner', 'tasks', 'settings', null, fleet))).toBe('a1');
  });

  it('неизвестный участник → no_permission', () => {
    expect(reason(can(altaFixture(), 'nobody', 'tasks', 'view'))).toBe('no_permission');
  });
});

describe('PD-53: роль с объектной областью не даёт права без объекта', () => {
  it('createProject: Котова (r-pm @ fleet) не получает tasks.settings во всей организации', () => {
    const db = altaFixture();
    expect(reason(can(db, 'm-kotova', 'tasks', 'settings'))).toBe('no_permission');
    expect(via(can(db, 'm-kotova', 'tasks', 'settings', null, fleet))).toBe('ap1');
    expect(
      reason(can(db, 'm-kotova', 'tasks', 'settings', null, { type: 'project', id: 'leads' })),
    ).toBe('no_permission');
  });

  it('saveKbPage: редактор пространства (r-kb-editor @ sp-log) не получает knowledge.create везде', () => {
    const db = altaFixture();
    expect(reason(can(db, 'm-kotelnikova', 'knowledge', 'create'))).toBe('no_permission');
    expect(
      via(can(db, 'm-kotelnikova', 'knowledge', 'create', null, { type: 'space', id: 'sp-log' })),
    ).toBe('akb-2');
    expect(
      reason(
        can(db, 'm-kotelnikova', 'knowledge', 'create', null, { type: 'space', id: 'sp-gen' }),
      ),
    ).toBe('no_permission');
    expect(
      reason(can(db, 'm-kotelnikova', 'knowledge', 'create', null, { type: 'page', id: 'sp-log' })),
    ).toBe('no_permission');
  });

  it('toggleTaskCheck: водитель (r-exec @ fleet) не получает tasks.edit без проекта', () => {
    const db = altaFixture();
    expect(reason(can(db, 'm-vasiliev', 'tasks', 'edit'))).toBe('no_permission');
    expect(via(can(db, 'm-vasiliev', 'tasks', 'edit', null, fleet))).toBe('ap2');
  });

  it('касса: кассир на кассе ca-spa действует только в ней', () => {
    const db = altaFixture();
    expect(reason(can(db, 'm-morozova', 'cash', 'create'))).toBe('no_permission');
    expect(
      via(can(db, 'm-morozova', 'cash', 'create', null, { type: 'account', id: 'ca-spa' })),
    ).toBe('a-cash1');
  });

  it('территориальная роль рядом с объектной продолжает действовать', () => {
    const db = altaFixture();
    expect(via(can(db, 'm-kotova', 'chat', 'create'))).toBe('ach-4');
    expect(reason(can(db, 'm-kotova', 'chat', 'settings'))).toBe('no_permission');
    expect(via(can(db, 'm-kotova', 'chat', 'settings', null, { type: 'chat', id: 'ch-drv' }))).toBe(
      'ach-1',
    );
  });

  it('объект засчитывается и при проверке подразделения; без объекта — нет', () => {
    const db = altaFixture();
    expect(via(can(db, 'm-kotova', 'tasks', 'view', 'f-msk-sever', fleet))).toBe('ap1');
    expect(reason(can(db, 'm-kotova', 'tasks', 'view', 'f-msk-sever'))).toBe('no_permission');
  });
});

describe('canAny: видимость раздела с учётом объектных ролей', () => {
  it('Котова видит «Задачи» и «Обращения» через роли проекта и направления', () => {
    const db = altaFixture();
    expect(via(canAny(db, 'm-kotova', 'tasks', 'view'))).toBe('ap1');
    expect(via(canAny(db, 'm-kotova', 'service', 'view'))).toBe('as-svc1');
    expect(reason(canAny(db, 'm-vasiliev', 'tasks', 'settings'))).toBe('no_permission');
    expect(reason(canAny(db, 'm-owner', 'logistics', 'view'))).toBe('module_off');
  });
});

describe('canEarnings: начисления', () => {
  it('функция «Водитель» блокирует, владелец видит, без финансов — нет права', () => {
    const db = altaFixture();
    expect(canEarnings(db, 'm-vasiliev')).toEqual({ ok: false, reason: 'driver_block' });
    expect(canEarnings(db, 'm-owner', 'f-smr-volga')).toEqual({ ok: true });
    expect(canEarnings(db, 'm-kotova')).toEqual({ ok: false, reason: 'no_permission' });
    expect(canEarnings(db, 'nobody')).toEqual({ ok: false, reason: 'no_permission' });
  });

  it('менеджер с финансами на фирме видит начисления только своей фирмы', () => {
    const db = altaFixture();
    db.assignments.push({
      id: 'x2',
      member: 'm-kotova',
      role: 'r-manager',
      scope: { type: 'firm', id: 'f-msk-sever' },
    });
    expect(canEarnings(db, 'm-kotova', 'f-msk-sever')).toEqual({ ok: true });
    expect(canEarnings(db, 'm-kotova', 'f-msk-yug')).toEqual({ ok: false, reason: 'no_scope' });
  });

  it('PD-53: финансовая роль с объектной областью начисления не открывает', () => {
    const db = altaFixture();
    db.assignments.push({
      id: 'x3',
      member: 'm-kotova',
      role: 'r-manager',
      scope: { type: 'project', id: 'fleet' },
    });
    expect(canEarnings(db, 'm-kotova')).toEqual({ ok: false, reason: 'no_permission' });
  });
});

describe('assertCan', () => {
  it('возвращает грант или бросает ApiError с текстом REASON', () => {
    const db = altaFixture();
    expect(assertCan(db, 'm-owner', 'tasks', 'edit').id).toBe('a1');
    expect(assertCan(db, 'm-vasiliev', 'tasks', 'edit', null, fleet).id).toBe('ap2');
    try {
      assertCan(db, 'm-vasiliev', 'tasks', 'edit');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe('no_permission');
      expect((e as ApiError).message).toBe('Ни одна роль сотрудника не разрешает это действие.');
    }
  });
});
