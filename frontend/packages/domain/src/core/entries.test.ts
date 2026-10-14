import { describe, expect, it } from 'vitest';
import {
  entryHas,
  entryIcon,
  entryKey,
  entryPeople,
  foremanIdOf,
  objOf,
  relationHas,
} from './entries.ts';
import { altaFixture, type FixtureDb } from './testing/fixture.ts';
import type { CoreDb, Entry } from './types/index.ts';

const db = altaFixture();

describe('entryHas: кто входит в запись доступа (documents.js / knowledge.js 14.10)', () => {
  it('«все сотрудники» — любой активный или приглашённый, кроме заблокированных', () => {
    const e: Entry = { who: 'all' };
    expect(entryHas(db, 'm-kotova', e)).toBe(true);
    expect(entryHas(db, 'm-petrova', e)).toBe(true);
    expect(entryHas(db, 'm-gromov', e)).toBe(false);
    expect(entryHas(db, 'nobody', e)).toBe(false);
  });

  it('конкретный сотрудник', () => {
    const e: Entry = { who: 'member', ref: 'm-kotova' };
    expect(entryHas(db, 'm-kotova', e)).toBe(true);
    expect(entryHas(db, 'm-owner', e)).toBe(false);
  });

  it('группа', () => {
    expect(entryHas(db, 'm-kotova', { who: 'group', ref: 'g-disp' })).toBe(true);
    expect(entryHas(db, 'm-vasiliev', { who: 'group', ref: 'g-disp' })).toBe(false);
    expect(entryHas(db, 'm-kotova', { who: 'group', ref: 'g-nope' })).toBe(false);
  });

  it('роль в подразделении: назначение должно покрывать unit', () => {
    expect(entryHas(db, 'm-vasiliev', { who: 'role', ref: 'r-driver', unit: 'f-msk-sever' })).toBe(
      true,
    );
    expect(entryHas(db, 'm-vasiliev', { who: 'role', ref: 'r-driver', unit: 'f-msk-yug' })).toBe(
      false,
    );
    expect(entryHas(db, 'm-vasiliev', { who: 'role', ref: 'r-driver' })).toBe(true);
    expect(entryHas(db, 'm-kotova', { who: 'role', ref: 'r-driver' })).toBe(false);
    expect(entryHas(db, 'm-kotova', { who: 'role', ref: 'r-nope' })).toBe(false);
  });

  it('роль пространства действует только в своём пространстве', () => {
    const e: Entry = { who: 'role', ref: 'r-kb-editor', can: 'edit' };
    expect(entryHas(db, 'm-kotelnikova', e, { space: { id: 'sp-log' } })).toBe(true);
    expect(entryHas(db, 'm-kotelnikova', e, { space: { id: 'sp-gen' } })).toBe(false);
    expect(entryHas(db, 'm-kotelnikova', e)).toBe(false);
  });

  it('«прораб объекта» — по id участника, для сида — по ФИО', () => {
    const rel = (obj: string): Entry => ({ who: 'relation', ref: 'foreman', obj });
    expect(entryHas(db, 'm-sokolov', rel('obj-42'))).toBe(true);
    expect(entryHas(db, 'm-kotova', rel('obj-42'))).toBe(false);
    expect(entryHas(db, 'm-sokolov', rel('obj-45'))).toBe(false);
    expect(entryHas(db, 'm-sokolov', rel('obj-99'))).toBe(true);
    expect(entryHas(db, 'm-sokolov', rel('obj-none'))).toBe(false);
  });

  it('неизвестный вид записи — нет доступа', () => {
    expect(entryHas(db, 'm-kotova', { who: 'robot' } as unknown as Entry)).toBe(false);
  });
});

describe('прораб объекта', () => {
  it('objOf и foremanIdOf: foremanId важнее ФИО', () => {
    expect(objOf(db, 'obj-42')?.name).toBe('ЖК Речной · квартира 42');
    expect(objOf(db, 'nope')).toBeUndefined();
    expect(foremanIdOf(db, 'obj-42')).toBe('m-sokolov');
    expect(foremanIdOf(db, 'obj-99')).toBe('m-sokolov');
    expect(foremanIdOf(db, 'obj-45')).toBeUndefined();
    expect(foremanIdOf(db, 'nope')).toBeUndefined();
  });

  it('relationHas', () => {
    expect(relationHas(db, 'm-sokolov', 'obj-42')).toBe(true);
    expect(relationHas(db, 'm-owner', 'obj-42')).toBe(false);
  });

  it('без среза ремонта объектов нет', () => {
    const bare: CoreDb = { ...altaFixture() };
    delete (bare as Partial<FixtureDb>).repair;
    expect(objOf(bare, 'obj-42')).toBeUndefined();
    expect(relationHas(bare, 'm-sokolov', 'obj-42')).toBe(false);
  });
});

describe('ключ, значок и состав записи', () => {
  it('entryKey', () => {
    expect(entryKey({ who: 'role', ref: 'r-driver', unit: 'f-msk-sever' })).toBe(
      'role:r-driver:f-msk-sever:',
    );
    expect(entryKey({ who: 'relation', ref: 'foreman', obj: 'obj-42' })).toBe(
      'relation:foreman::obj-42',
    );
    expect(entryKey({ who: 'all' })).toBe('all:::');
  });

  it.each([
    ['all', 'apartment'],
    ['member', 'person'],
    ['group', 'groups'],
    ['role', 'badge'],
    ['relation', 'engineering'],
    ['robot', 'person'],
  ])('entryIcon(%s) = %s', (who, icon) => {
    expect(entryIcon({ who } as Entry)).toBe(icon);
  });

  it('entryPeople: участники записи без заблокированных', () => {
    expect(entryPeople(db, { who: 'group', ref: 'g-drv' }).map((m) => m.id)).toEqual([
      'm-vasiliev',
    ]);
    expect(
      entryPeople(db, { who: 'role', ref: 'r-kb-editor' }, { space: { id: 'sp-log' } }).map(
        (m) => m.id,
      ),
    ).toEqual(['m-kotelnikova']);
  });
});
