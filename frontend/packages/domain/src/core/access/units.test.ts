import { describe, expect, it } from 'vitest';
import { altaFixture } from '../testing/fixture.ts';
import type { Scope } from '../types/index.ts';
import {
  OBJECT_SCOPE_TYPES,
  firmsOf,
  isObjectScope,
  scopeCovers,
  scopeLabel,
  unit,
  unitLabel,
} from './index.ts';

const db = altaFixture();

describe('оргструктура: unit, unitLabel, firmsOf', () => {
  it('unit находит подразделение по id', () => {
    expect(unit(db, 'r-msk')?.name).toBe('Москва');
    expect(unit(db, 'x')).toBeUndefined();
  });

  it.each([
    ['f-msk-sever', 'Москва / Север Логистик'],
    ['r-smr', 'Самара'],
    ['nope', '—'],
  ])('unitLabel(%s) = %s', (id, want) => {
    expect(unitLabel(db, id)).toBe(want);
  });

  it('firmsOf: все 12 фирм или фирмы региона', () => {
    expect(firmsOf(db)).toHaveLength(12);
    expect(firmsOf(db, 'r-smr').map((u) => u.id)).toEqual([
      'f-smr-volga',
      'f-smr-truck',
      'f-smr-zhig',
      'f-smr-priv',
    ]);
  });
});

describe('scopeCovers: территориальные области', () => {
  it.each<[Scope | undefined, string, boolean]>([
    [{ type: 'region', id: 'r-msk' }, 'f-msk-yug', true],
    [{ type: 'region', id: 'r-msk' }, 'r-msk', true],
    [{ type: 'region', id: 'r-msk' }, 'f-smr-volga', false],
    [{ type: 'firm', id: 'f-msk-sever' }, 'f-msk-yug', false],
    [{ type: 'firm', id: 'f-msk-sever' }, 'f-msk-sever', true],
    [{ type: 'self' }, 'f-msk-sever', false],
    [{ type: 'tenant' }, 'anything', true],
    [undefined, 'r-msk', false],
    [{ type: 'firm', id: 'f-msk-sever' }, 'nope', false],
  ])('scopeCovers(%j, %s) = %s', (scope, unitId, want) => {
    expect(scopeCovers(db, scope, unitId)).toBe(want);
  });

  it('объектные области подразделения не покрывают (их проверяют движки модулей)', () => {
    for (const type of OBJECT_SCOPE_TYPES) {
      expect(scopeCovers(db, { type, id: 'f-msk-sever' }, 'f-msk-sever')).toBe(false);
    }
  });
});

describe('объектные области', () => {
  it('семь объектных видов', () => {
    expect([...OBJECT_SCOPE_TYPES]).toEqual([
      'project',
      'space',
      'page',
      'folder',
      'doc',
      'chat',
      'account',
    ]);
  });

  it('isObjectScope', () => {
    expect(isObjectScope({ type: 'project', id: 'fleet' })).toBe(true);
    expect(isObjectScope({ type: 'account', id: 'ca-spa' })).toBe(true);
    expect(isObjectScope({ type: 'firm', id: 'f-msk-sever' })).toBe(false);
    expect(isObjectScope({ type: 'self' })).toBe(false);
    expect(isObjectScope(undefined)).toBe(false);
  });
});

describe('scopeLabel: 11 видов областей (models.js 14.10)', () => {
  it.each<[Scope | undefined, string]>([
    [undefined, 'Область не выбрана'],
    [{ type: 'tenant' }, 'Вся организация'],
    [{ type: 'region', id: 'r-msk' }, 'Регион Москва'],
    [{ type: 'firm', id: 'f-msk-sever' }, 'Москва / Север Логистик'],
    [{ type: 'self' }, 'Только назначенное лично'],
    [{ type: 'project', id: 'fleet' }, 'Проект «Логистика · Север»'],
    [{ type: 'project', id: 'svc-grz' }, 'Направление «Грузоперевозки»'],
    [{ type: 'project', id: 'nope' }, 'Только назначенное лично'],
    [{ type: 'space', id: 'sp-log' }, 'Пространство «Логистика»'],
    [{ type: 'space', id: 'sp-x' }, 'Пространство «sp-x»'],
    [{ type: 'page', id: 'kb-1' }, 'Страница «Регламент приёмки смены»'],
    [{ type: 'page', id: 'kb-x' }, 'Страница «kb-x»'],
    [{ type: 'folder', id: 'fd-log' }, 'Папка «Север Логистик»'],
    [{ type: 'folder', id: 'fd-x' }, 'Папка «fd-x»'],
    [{ type: 'chat', id: 'ch-drv' }, 'Чат «Водители · Север Логистик»'],
    [{ type: 'chat', id: 'ch-dm' }, 'Чат «личный»'],
    [{ type: 'chat', id: 'ch-x' }, 'Чат «ch-x»'],
    [{ type: 'doc', id: 'doc-l1' }, 'Документ «Правила записи и отмены визитов»'],
    [{ type: 'doc', id: 'doc-x' }, 'Документ «doc-x»'],
    [{ type: 'account', id: 'ca-spa' }, 'Касса «Касса салона · ресепшен»'],
    [{ type: 'account', id: 'ca-x' }, 'Касса «ca-x»'],
  ])('scopeLabel(%j) = %s', (scope, want) => {
    expect(scopeLabel(db, scope)).toBe(want);
  });

  it('без срезов модулей подписи строятся по id', () => {
    const bare = { ...altaFixture(), projects: undefined };
    const core = {
      tenantId: bare.tenantId,
      seq: bare.seq,
      units: bare.units,
      modules: bare.modules,
      members: bare.members,
      roles: bare.roles,
      assignments: bare.assignments,
    };
    expect(scopeLabel(core, { type: 'space', id: 'sp-log' })).toBe('Пространство «sp-log»');
    expect(scopeLabel(core, { type: 'project', id: 'fleet' })).toBe('Только назначенное лично');
    expect(scopeLabel(core, { type: 'region', id: 'r-x' })).toBe('Регион —');
  });
});
