// Сид «Базы знаний»: сырая БЗ 14.10 (extra-data.js:24–54; «Лотос» — mock-data.js:54–55) и миграция v2
// (`installKnowledge`, knowledge.js:244–315) стадией `knowledge`. Отличие от эталона — KB-02:
// назначение Котовой в «Общем» — «Редактор» (роли «Автор» нет).
import { beforeAll, describe, expect, it } from 'vitest';
import type { TenantDb } from '../../core/types/index.ts';
import { createAlta } from '../../seed/alta.ts';
import { createLotos } from '../../seed/lotos.ts';
import { createPlatform } from '../../seed/platform.ts';
import { migrateKnowledgeV2 } from './migrate-v2.ts';
import { KB_OBJ_42, kbNode, makeSection } from './sections.ts';
import { knowledgeSeed } from './seed.ts';
import { kbKids, kbTop } from './tree.ts';
import type { KbNode, KbTenantDb, KnowledgeSlice } from './types.ts';

type Db = KbTenantDb & { knowledge: KnowledgeSlice };

const alta = (): Db => {
  const db = createAlta(createPlatform()) as TenantDb;
  return Object.assign(db, { knowledge: knowledgeSeed('t-alta') });
};
const lotos = (): Db => {
  const db = createLotos(createPlatform()) as TenantDb;
  return Object.assign(db, { knowledge: knowledgeSeed('t-lotos') });
};
const pg = (db: Db, id: string): KbNode => {
  const n = db.knowledge.pages.find((p) => p.id === id);
  if (!n) throw new Error('нет ' + id);
  return n;
};

describe('knowledgeSeed: сырая БЗ', () => {
  it('«Альта»: 3 пространства, 5 страниц, таблица осмотров', () => {
    const K = knowledgeSeed('t-alta');
    expect(K.spaces).toEqual([
      { id: 'sp-log', name: 'Логистика' },
      { id: 'sp-spa', name: 'Салон и SPA' },
      { id: 'sp-own', name: 'Руководство' },
    ]);
    expect(K.pages.map((p) => [p.id, p.space, p.access, p.versions.length])).toEqual([
      ['kb-1', 'sp-log', 'all', 2],
      ['kb-2', 'sp-log', 'all', 1],
      ['kb-5', 'sp-log', 'all', 1],
      ['kb-3', 'sp-spa', 'all', 1],
      ['kb-4', 'sp-own', 'owner', 1],
    ]);
    expect(K.pages[0]?.versions[1]).toMatchObject({ v: 2, at: '24.09.2026', by: 'Дарья Зимина' });
    expect(K.tables?.map((t) => [t.id, t.page, t.columns.length, t.rows.map((r) => r.id)])).toEqual(
      [['kt-insp', 'kb-5', 7, ['kr-2', 'kr-1']]],
    );
    expect(K.entries).toEqual([]);
  });

  it('«Лотос»: только «Салон и SPA»; таблицы и записи — своих страниц', () => {
    const K = knowledgeSeed('t-lotos');
    expect(K.spaces.map((s) => s.id)).toEqual(['sp-spa']);
    expect(K.pages.map((p) => p.id)).toEqual(['kb-3']);
    expect(K.tables).toEqual([]);
    expect(K.entries).toEqual([]);
  });

  it('новая организация — пустая БЗ; каждый вызов — новые объекты', () => {
    expect(knowledgeSeed('t-new')).toEqual({ spaces: [], pages: [], tables: [], entries: [] });
    const a = knowledgeSeed('t-alta');
    a.pages.pop();
    expect(knowledgeSeed('t-alta').pages).toHaveLength(5);
  });
});

describe('kbNode и makeSection', () => {
  it('узел шаблона: поля по умолчанию и первая версия', () => {
    expect(kbNode('kb-x', 'sp', null, 1, 'page', 'Т', { body: 'Текст' })).toEqual({
      id: 'kb-x',
      space: 'sp',
      parent: null,
      pos: 1,
      kind: 'page',
      title: 'Т',
      mode: 'inherit',
      list: [],
      status: 'active',
      owner: 'm-owner',
      access: 'all',
      versions: [{ v: 1, at: '20.09.2026', by: 'Дарья Зимина', body: 'Текст' }],
      body: 'Текст',
    });
    expect(
      kbNode('kb-y', 'sp', 'p', 2, 'folder', 'П', { at: '01.10.2026', by: 'Марина Котова' })
        .versions,
    ).toEqual([{ v: 1, at: '01.10.2026', by: 'Марина Котова', body: '' }]);
  });

  it('раздел объекта: папка по связи «прораб» и 5 подстраниц', () => {
    const db = alta();
    db.knowledge.pages.push(kbNode('fold', 'sp-rep', null, 1, 'folder', 'Объекты'));
    expect(makeSection(db, KB_OBJ_42, 'fold')).toBe('kb-o-obj-42');
    const f = pg(db, 'kb-o-obj-42');
    expect(f).toMatchObject({
      parent: 'fold',
      pos: 1,
      kind: 'folder',
      title: 'ЖК Речной · квартира 42',
      mode: 'listed',
      obj: 'obj-42',
      list: [
        { who: 'relation', ref: 'foreman', obj: 'obj-42', can: 'view' },
        { who: 'role', ref: 'r-kb-editor', can: 'edit' },
      ],
    });
    expect(kbKids(db.knowledge, 'kb-o-obj-42').map((x) => [x.title, x.kind, x.mode])).toEqual([
      ['Паспорт объекта', 'page', 'inherit'],
      ['Как попасть на объект', 'page', 'edit'],
      ['Акты скрытых работ', 'table', 'inherit'],
      ['Фотоотчёт', 'page', 'edit'],
      ['Гарантия', 'page', 'listed'],
    ]);
    expect(pg(db, 'kb-o-obj-42-1').versions[0]?.body).toBe(
      'Адрес: Москва, ул. Речная, 5, кв. 42. 51 м², 2 комнаты, капитальный ремонт. Заказчик: Ольга Смирнова. Договор: договор № 42. Сдача: 27.11.',
    );
    expect(pg(db, 'kb-o-obj-42-2').versions[0]?.body).toBe(
      'Подъезд 2, этаж 9, домофон 42К\n\nГрузовой лифт до 20:00, материалы заносить со двора\n\nКлючи у прораба, запасной комплект в офисе\n\nШумные работы: будни 9:00–19:00, перерыв 13:00–15:00',
    );
    expect(pg(db, 'kb-o-obj-42-2').list).toEqual([
      { who: 'relation', ref: 'foreman', obj: 'obj-42', can: 'edit' },
      { who: 'role', ref: 'r-kb-editor', can: 'edit' },
    ]);
    expect(pg(db, 'kb-o-obj-42-5').list).toEqual([
      { who: 'role', ref: 'r-kb-editor', can: 'edit' },
    ]);
  });

  it('объект без договора, сдачи и подсказок входа — текст по умолчанию', () => {
    const db = alta();
    makeSection(
      db,
      { id: 'obj-1', name: 'Дом', address: 'Истра', area: '120 м²', kind: 'дом', client: 'Иван' },
      'f',
    );
    expect(pg(db, 'kb-o-obj-1-1').versions[0]?.body).toBe(
      'Адрес: Истра. 120 м², дом. Заказчик: Иван.',
    );
    expect(pg(db, 'kb-o-obj-1-2').versions[0]?.body).toBe(
      'Адрес, вход, ключи, время шумных работ.',
    );
  });
});

describe('migrateKnowledgeV2: «Альта»', () => {
  // Сид и миграция — в beforeAll, а не в теле describe: заглушка, бросающая исключение, роняет
  // каждый тест по отдельности, а не загрузку файла («no tests»).
  let db: Db;
  let K: KnowledgeSlice;
  beforeAll(() => {
    db = alta();
    migrateKnowledgeV2(db);
    K = db.knowledge;
  });

  it('роли пространства добавлены один раз', () => {
    expect(db.roles.filter((r) => r.space).map((r) => r.id)).toEqual([
      'r-kb-lead',
      'r-kb-editor',
      'r-kb-reader',
    ]);
  });

  it('пять пространств с областью, значком, цветом и уровнем', () => {
    expect(K.spaces).toEqual([
      {
        id: 'sp-log',
        name: 'Логистика',
        icon: 'local_shipping',
        color: '#1F6B52',
        unit: 'f-msk-sever',
        access: 'limited',
      },
      {
        id: 'sp-spa',
        name: 'Салон и SPA',
        icon: 'spa',
        color: '#6B4A7A',
        unit: null,
        access: 'open',
      },
      {
        id: 'sp-own',
        name: 'Руководство',
        icon: 'shield_person',
        color: '#3A4844',
        unit: null,
        access: 'closed',
      },
      {
        id: 'sp-rep',
        name: 'Ремонт и стройка',
        icon: 'construction',
        color: '#7A5214',
        unit: null,
        access: 'limited',
      },
      {
        id: 'sp-gen',
        name: 'Общее',
        icon: 'apartment',
        color: '#2B5479',
        unit: null,
        access: 'open',
      },
    ]);
  });

  it('дерево: 35 узлов; корни «Логистики»', () => {
    expect(K.pages).toHaveLength(35);
    expect(kbTop(K, 'sp-log').map((p) => p.id)).toEqual([
      'kb-log-home',
      'kb-f-reg',
      'kb-5',
      'kb-d1',
      'kb-f-drv',
      'kb-fin',
      'kb-file1',
      'kb-lnk1',
    ]);
    expect(kbKids(K, 'kb-f-reg').map((p) => p.id)).toEqual(['kb-1', 'kb-2', 'kb-6']);
    expect(kbKids(K, 'kb-1').map((p) => p.id)).toEqual(['kb-1a', 'kb-1b']);
    expect(kbKids(K, 'kb-rep-obj').map((p) => p.id)).toEqual(['kb-o-obj-42']);
    for (const s of K.spaces) {
      expect(kbTop(K, s.id)[0]?.title).toBe('Обзор');
    }
  });

  it('старые страницы: KB-07 — «owner» → «Только выбранные», остальное «Как у родителя»', () => {
    expect(pg(db, 'kb-4')).toMatchObject({
      mode: 'listed',
      list: [],
      access: 'owner',
      sensitivity: 'finance',
      pos: 1,
    });
    expect(pg(db, 'kb-1')).toMatchObject({
      parent: 'kb-f-reg',
      pos: 1,
      mode: 'inherit',
      status: 'active',
      owner: 'm-owner',
      kind: 'page',
      reviewBy: '24.03.2027',
      ack: { v: 2, audience: { who: 'role', ref: 'r-driver', unit: 'f-msk-sever' }, done: [] },
    });
    expect(pg(db, 'kb-2')).toMatchObject({ reviewBy: '30.09.2026', owner: 'm-kotova' });
    expect(pg(db, 'kb-5')).toMatchObject({ parent: null, kind: 'table', pos: 2 });
    expect(pg(db, 'kb-3')).toMatchObject({
      ack: { v: 1, audience: { who: 'role', ref: 'r-therapist' }, done: ['m-morozova'] },
    });
  });

  it('назначения пространств: akb-3 — «Редактор» (KB-02)', () => {
    expect(db.assignments.filter((a) => a.id.startsWith('akb-'))).toEqual([
      {
        id: 'akb-1',
        member: 'm-kotova',
        role: 'r-kb-lead',
        scope: { type: 'space', id: 'sp-log' },
      },
      {
        id: 'akb-2',
        member: 'm-kotelnikova',
        role: 'r-kb-editor',
        scope: { type: 'space', id: 'sp-log' },
      },
      {
        id: 'akb-3',
        member: 'm-kotova',
        role: 'r-kb-editor',
        scope: { type: 'space', id: 'sp-gen' },
      },
    ]);
  });

  it('правила, журнал запусков, запросы, признак v2', () => {
    expect(K.rules?.map((r) => [r.id, r.space, r.kind, r.on])).toEqual([
      ['kr-1', 'sp-log', 'ack', true],
      ['kr-2', 'sp-log', 'review', true],
      ['kr-3', 'sp-rep', 'section', true],
      ['kr-4', 'sp-rep', 'ack', true],
      ['kr-5', 'sp-rep', 'review', false],
    ]);
    expect(K.runs?.map((r) => [r.id, r.rule, r.res])).toEqual([
      ['krr-1', 'kr-3', 'ok'],
      ['krr-2', 'kr-3', 'stopped'],
      ['krr-3', 'kr-1', 'ok'],
    ]);
    expect(K.requests).toEqual([]);
    expect(K.v2).toBe(true);
  });

  it('повторный вызов ничего не меняет', () => {
    const before = structuredClone(db);
    migrateKnowledgeV2(db);
    expect(db).toEqual(before);
  });
});

describe('migrateKnowledgeV2: «Лотос», без среза, раздел из среза ремонта', () => {
  it('«Лотос»: главная страница добавлена, область — вся организация', () => {
    const db = lotos();
    migrateKnowledgeV2(db);
    expect(db.knowledge.spaces).toEqual([
      {
        id: 'sp-spa',
        name: 'Салон и SPA',
        icon: 'spa',
        color: '#6B4A7A',
        unit: null,
        access: 'open',
      },
    ]);
    expect(db.knowledge.pages.map((p) => [p.id, p.pos, p.title])).toEqual([
      ['kb-3', 1, 'Технологические карты процедур'],
      ['kb-home-sp-spa', 0, 'Обзор'],
    ]);
    expect(pg(db, 'kb-home-sp-spa').versions[0]?.body).toBe(
      'Главная страница пространства «Салон и SPA».',
    );
    expect(db.roles.filter((r) => r.space)).toHaveLength(3);
    expect(db.knowledge.rules).toEqual([]);
  });

  it('незнакомое пространство и уже заданные поля сохраняются', () => {
    const db = lotos();
    db.knowledge.spaces.push({
      id: 'sp-x',
      name: 'Своё',
      unit: 'f-lotos-tver',
      access: 'closed',
      icon: 'school',
    });
    db.roles.push({
      id: 'r-kb-lead',
      name: 'Свой руководитель',
      kind: 'custom',
      space: true,
      actions: {},
      finance: { read: false, manage: false },
    });
    migrateKnowledgeV2(db);
    expect(db.knowledge.spaces[1]).toEqual({
      id: 'sp-x',
      name: 'Своё',
      unit: 'f-lotos-tver',
      access: 'closed',
      icon: 'school',
      color: '#2B5479',
    });
    expect(db.roles.find((r) => r.id === 'r-kb-lead')?.name).toBe('Свой руководитель');
    expect(kbTop(db.knowledge, 'sp-x')[0]?.id).toBe('kb-home-sp-x');
  });

  it('нет среза — ничего не делает', () => {
    const db = createAlta(createPlatform()) as KbTenantDb;
    migrateKnowledgeV2(db);
    expect(db.knowledge).toBeUndefined();
  });

  it('раздел объекта строится из среза ремонта, если он есть', () => {
    const db = alta();
    Object.assign(db, { repair: { objects: [{ ...KB_OBJ_42, name: 'Квартира 42 (ремонт)' }] } });
    migrateKnowledgeV2(db);
    expect(pg(db, 'kb-o-obj-42').title).toBe('Квартира 42 (ремонт)');
  });
});
