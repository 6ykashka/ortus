// Помощники тестов ядра документов: «Альта» сырого сида 14.10 с установленными документами и
// объектом ремонта, эталон 19.10 для паритета. Только для тестов.
import { DEMO } from '../../../core/clock.ts';
import type { TenantDb } from '../../../core/types/index.ts';
import { createAlta } from '../../../seed/alta.ts';
import { createLotos } from '../../../seed/lotos.ts';
import { createPlatform } from '../../../seed/platform.ts';
import { installDocs } from './seed.ts';
import type { DocFolder, DocItem, DocOpts, DocsTenantDb } from './types.ts';

/** Дата часов домена для сроков назначений (PD-60): демо-«сегодня» документов 01.10.2026. */
export const T: DocOpts = { today: DEMO.docToday };

export type DocsDb = DocsTenantDb & { docs: NonNullable<DocsTenantDb['docs']> };

/** Объект ремонта сида эталона: ремонт не входит в пилот, поэтому его кладёт тест (obj-42, прораб Соколов). */
export const REPAIR_OBJECTS = () => [
  {
    id: 'obj-42',
    name: 'ЖК Речной · квартира 42',
    address: 'Москва, ул. Речная, 5, кв. 42',
    area: '51 м², 2 комнаты',
    client: 'Ольга Смирнова',
    foreman: 'Алексей Соколов',
  },
  { id: 'obj-45', name: 'Кофейня на Покровке', foreman: null },
];

/** «Альта» с установленными документами и объектами ремонта. */
export function altaDocs(): DocsDb {
  const db = createAlta(createPlatform()) as TenantDb;
  Object.assign(db, { repair: { objects: REPAIR_OBJECTS() } });
  installDocs(db);
  return db as DocsDb;
}

/** «Лотос» с установленными документами. */
export function lotosDocs(): DocsDb {
  const db = createLotos(createPlatform()) as TenantDb;
  installDocs(db);
  return db as DocsDb;
}

export const doc = (db: DocsDb, id: string): DocItem => {
  const d = db.docs.items.find((x) => x.id === id);
  if (!d) throw new Error('нет документа ' + id);
  return d;
};

export const folder = (db: DocsDb, id: string): DocFolder => {
  const f = db.docs.folders.find((x) => x.id === id);
  if (!f) throw new Error('нет папки ' + id);
  return f;
};
