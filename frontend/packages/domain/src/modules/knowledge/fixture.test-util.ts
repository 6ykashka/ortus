// Помощники табличных тестов «Базы знаний»: «Альта» сырого сида 14.10 (люди, роли, назначения),
// роли пространства, объект ремонта obj-42 и небольшое дерево по образцу миграции v2. Только для тестов.
import { DEMO } from '../../core/clock.ts';
import { ApiError } from '../../core/errors/index.ts';
import type { Assignment, TenantDb } from '../../core/types/index.ts';
import { createAlta } from '../../seed/alta.ts';
import { createPlatform } from '../../seed/platform.ts';
import { KB_ROLES } from './dictionaries.ts';
import type { KbAccessEntry, KbNode, KbOpts, KbSpace, KnowledgeSlice } from './types.ts';

export type KbDb = TenantDb & { knowledge: KnowledgeSlice };

/** Дата часов домена для сроков назначений (PD-60): демо-«сегодня» базы знаний 01.10.2026. */
export const T: KbOpts = { today: DEMO.kbToday };

export const ED: KbAccessEntry = { who: 'role', ref: 'r-kb-editor', can: 'edit' };
const REL = { who: 'relation', ref: 'foreman', obj: 'obj-42' } as const;

export function mkNode(
  id: string,
  space: string,
  parent: string | null,
  pos: number,
  o: Partial<KbNode> = {},
): KbNode {
  return {
    id,
    space,
    parent,
    pos,
    kind: 'page',
    title: 'Страница ' + id,
    mode: 'inherit',
    list: [],
    status: 'active',
    owner: 'm-owner',
    access: 'all',
    versions: [{ v: 1, at: '20.09.2026', by: 'Дарья Зимина', body: 'Текст ' + id }],
    ...o,
  };
}

export const SPACES = (): KbSpace[] => [
  { id: 'sp-log', name: 'Логистика', unit: 'f-msk-sever', access: 'limited' },
  { id: 'sp-gen', name: 'Общее', unit: null, access: 'open' },
  { id: 'sp-own', name: 'Руководство', unit: null, access: 'closed' },
  { id: 'sp-rep', name: 'Ремонт и стройка', unit: null, access: 'limited' },
];

export const PAGES = (): KbNode[] => [
  mkNode('log-home', 'sp-log', null, 0, { title: 'Обзор' }),
  mkNode('f-reg', 'sp-log', null, 1, { kind: 'folder', title: 'Регламенты' }),
  mkNode('kb-1', 'sp-log', 'f-reg', 1, { title: 'Регламент приёмки смены' }),
  mkNode('kb-1a', 'sp-log', 'kb-1', 1, { title: 'Чек-лист приёмки' }),
  mkNode('f-drv', 'sp-log', null, 2, {
    kind: 'folder',
    title: 'Водителям',
    mode: 'listed',
    list: [{ who: 'role', ref: 'r-driver', unit: 'f-msk-sever', can: 'view' }, ED],
  }),
  mkNode('drv-1', 'sp-log', 'f-drv', 1, { title: 'Памятка водителя' }),
  mkNode('drv-4', 'sp-log', 'f-drv', 2, { kind: 'diagram', title: 'Маршруты', mode: 'edit' }),
  mkNode('fin', 'sp-log', null, 3, {
    title: 'Тарифы и начисления',
    sensitivity: 'finance',
    mode: 'listed',
    list: [
      { who: 'member', ref: 'm-kotova', can: 'view' },
      { who: 'member', ref: 'm-kotelnikova', can: 'view' },
    ],
  }),
  mkNode('fin-1', 'sp-log', 'fin', 1, { title: 'Ставки по маршрутам' }),
  mkNode('arch', 'sp-log', null, 4, { title: 'Старый регламент', archived: true }),
  mkNode('gen-home', 'sp-gen', null, 0, { title: 'Обзор' }),
  mkNode('gen-1', 'sp-gen', null, 1, { title: 'Контакты офиса', owner: 'm-kotova' }),
  mkNode('gen-2', 'sp-gen', null, 2, { title: 'Как пользоваться Ортусом', owner: 'm-akhmedov' }),
  mkNode('gen-3', 'sp-gen', null, 3, {
    title: 'Дежурства',
    mode: 'edit',
    list: [
      { who: 'member', ref: 'm-vasiliev', can: 'view' },
      { who: 'group', ref: 'g-drv', can: 'edit' },
    ],
  }),
  mkNode('own-1', 'sp-own', null, 1, { title: 'Политика начислений водителям', mode: 'listed' }),
  mkNode('obj', 'sp-rep', null, 1, {
    kind: 'folder',
    title: 'ЖК Речной · квартира 42',
    mode: 'listed',
    list: [{ ...REL, can: 'view' }, ED],
    obj: 'obj-42',
  }),
  mkNode('o-1', 'sp-rep', 'obj', 1, { title: 'Паспорт объекта' }),
  mkNode('o-2', 'sp-rep', 'obj', 2, {
    title: 'Как попасть на объект',
    mode: 'edit',
    list: [{ ...REL, can: 'edit' }, ED],
  }),
  mkNode('o-5', 'sp-rep', 'obj', 5, { title: 'Гарантия', mode: 'listed', list: [ED] }),
];

export const KB_ASSIGNMENTS = (): Assignment[] => [
  { id: 'akb-1', member: 'm-kotova', role: 'r-kb-lead', scope: { type: 'space', id: 'sp-log' } },
  {
    id: 'akb-2',
    member: 'm-kotelnikova',
    role: 'r-kb-editor',
    scope: { type: 'space', id: 'sp-log' },
  },
  { id: 'akb-3', member: 'm-kotova', role: 'r-kb-editor', scope: { type: 'space', id: 'sp-gen' } },
];

/** «Альта» с ролями пространств, obj-42 и деревом; `extra` — дополнительные назначения. */
export function kbDb(o: { extra?: Assignment[]; pages?: KbNode[]; spaces?: KbSpace[] } = {}): KbDb {
  const db = createAlta(createPlatform()) as TenantDb;
  db.roles.push(...KB_ROLES.map((r) => structuredClone(r)));
  db.assignments.push(...KB_ASSIGNMENTS(), ...(o.extra ?? []));
  Object.assign(db, {
    repair: {
      objects: [
        { id: 'obj-42', name: 'ЖК Речной · квартира 42', foreman: 'Алексей Соколов' },
        { id: 'obj-45', name: 'Дом 120 м², Истра', foreman: null },
      ],
    },
  });
  return Object.assign(db, {
    knowledge: {
      spaces: o.spaces ?? SPACES(),
      pages: o.pages ?? PAGES(),
      tables: [],
      entries: [],
      requests: [],
      rules: [],
      runs: [],
      v2: true,
    },
  });
}

export const node = (db: KbDb, id: string): KbNode => {
  const n = db.knowledge.pages.find((p) => p.id === id);
  if (!n) throw new Error('нет узла ' + id);
  return n;
};

export const space = (db: KbDb, id: string): KbSpace => {
  const s = db.knowledge.spaces.find((x) => x.id === id);
  if (!s) throw new Error('нет пространства ' + id);
  return s;
};

/** Код и текст `ApiError`, которую бросает `f`. */
export function apiErr(f: () => unknown): { code: string; message: string } {
  try {
    f();
  } catch (e) {
    if (e instanceof ApiError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error('ошибки нет');
}
