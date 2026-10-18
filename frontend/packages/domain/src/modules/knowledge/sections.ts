// Узлы шаблонов и раздел объекта ремонта (knowledge.js 14.10:224–242). `kbNode` повторяет `N()`
// эталона: поля по умолчанию, первая версия из `body/at/by`, затем поля `o` поверх.
import type { KbAccessEntry, KbKind, KbMode, KbNode, KbTenantDb, KbVersion } from './types.ts';
import { kbKids } from './tree.ts';

/** Объект ремонта — то, что нужно разделу (поля `repair.objects[]` сида). */
export interface KbSectionObject {
  id: string;
  name: string;
  address: string;
  area: string;
  kind: string;
  client: string;
  contract?: string;
  due?: string;
  foreman?: string | null;
  access?: readonly (readonly [string, string])[];
}

/**
 * Объект «ЖК Речной · квартира 42» сида (extra-data.js:82–83): раздел в БЗ сида строится из него,
 * пока модуль «Ремонт и стройка» (W6.x) не установлен и `db.repair` нет.
 */
export const KB_OBJ_42: KbSectionObject = {
  id: 'obj-42',
  name: 'ЖК Речной · квартира 42',
  address: 'Москва, ул. Речная, 5, кв. 42',
  area: '51 м², 2 комнаты',
  kind: 'капитальный ремонт',
  contract: 'договор № 42',
  due: '27.11',
  client: 'Ольга Смирнова',
  foreman: 'Алексей Соколов',
  access: [
    ['door_front', 'Подъезд 2, этаж 9, домофон 42К'],
    ['elevator', 'Грузовой лифт до 20:00, материалы заносить со двора'],
    ['key', 'Ключи у прораба, запасной комплект в офисе'],
    ['volume_up', 'Шумные работы: будни 9:00–19:00, перерыв 13:00–15:00'],
  ],
};

/** Запись «Редакторы пространства правят». */
export const kbEditors = (): KbAccessEntry => ({ who: 'role', ref: 'r-kb-editor', can: 'edit' });

const firstVersion = (body?: string, at?: string, by?: string): KbVersion[] => [
  { v: 1, at: at || '20.09.2026', by: by || 'Дарья Зимина', body: body || '' },
];

export function kbNode(
  id: string,
  space: string,
  parent: string | null,
  pos: number,
  kind: KbKind,
  title: string,
  o: Partial<KbNode> = {},
): KbNode {
  return {
    id,
    space,
    parent: parent || null,
    pos,
    kind,
    title,
    mode: 'inherit',
    list: [],
    status: 'active',
    owner: 'm-owner',
    access: 'all',
    versions: firstVersion(o.body, o.at, o.by),
    ...o,
  };
}

/** Раздел объекта в папке `folderId` пространства «Ремонт и стройка»: папка по связи и 5 подстраниц. */
export function makeSection(db: KbTenantDb, o: KbSectionObject, folderId: string): string {
  const K = db.knowledge;
  if (!K) throw new Error('База знаний не подключена');
  const id = 'kb-o-' + o.id;
  const rel = { who: 'relation', ref: 'foreman', obj: o.id } as const;
  const pos = kbKids(K, folderId, true).length + 1;
  const folder = kbNode(id, 'sp-rep', folderId, pos, 'folder', o.name, {
    mode: 'listed',
    list: [{ ...rel, can: 'view' }, kbEditors()],
    obj: o.id,
  });
  K.pages.push(folder);
  const passport =
    'Адрес: ' +
    o.address +
    '. ' +
    o.area +
    ', ' +
    o.kind +
    '. Заказчик: ' +
    o.client +
    '.' +
    (o.contract ? ' Договор: ' + o.contract + '.' : '') +
    (o.due ? ' Сдача: ' + o.due + '.' : '');
  const entry =
    (o.access ?? []).map((a) => a[1]).join('\n\n') || 'Адрес, вход, ключи, время шумных работ.';
  const kids: [string, KbKind, KbMode, string][] = [
    ['Паспорт объекта', 'page', 'inherit', passport],
    ['Как попасть на объект', 'page', 'edit', entry],
    [
      'Акты скрытых работ',
      'table',
      'inherit',
      'Строки добавляются, когда заказчик подписывает акт.',
    ],
    [
      'Фотоотчёт',
      'page',
      'edit',
      'Фото по этапам: до начала, скрытые работы, черновая и чистовая отделка.',
    ],
    [
      'Гарантия',
      'page',
      'listed',
      'Гарантийные обязательства и контакты для обращений. Прораб увидит страницу после сдачи объекта.',
    ],
  ];
  kids.forEach(([t, k, mode, body], i) => {
    const list: KbAccessEntry[] =
      mode === 'edit'
        ? [{ ...rel, can: 'edit' }, kbEditors()]
        : mode === 'listed'
          ? [kbEditors()]
          : [];
    K.pages.push(kbNode(id + '-' + (i + 1), 'sp-rep', id, i + 1, k, t, { body, mode, list }));
  });
  return id;
}
