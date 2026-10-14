// Записи доступа «кто» — общие для документов, Базы знаний и чатов (B §5.2 `entries.ts`, факт 15).
// Единая версия `entryHas` из documents.js:48–56 и knowledge.js:102–110 (14.10):
// заблокированный не входит ни в одну запись, `all` — все остальные, роль пространства действует
// только в пространстве из контекста, «прораб объекта» определяется по id участника.
import { scopeCovers } from './access/units.ts';
import type { CoreDb, Entry, Member } from './types/index.ts';

export interface EntryCtx {
  /** Пространство Базы знаний, в котором проверяется роль с `role.space`. */
  space?: { id: string };
}

export interface RepairObjectRef {
  id: string;
  name: string;
  /** ФИО прораба — так хранит сид эталона. */
  foreman?: string | null;
  /** id участника-прораба — основной способ связи. */
  foremanId?: string | null;
}

function repairObjects(db: CoreDb): RepairObjectRef[] {
  const repair = (db as { repair?: { objects?: RepairObjectRef[] } }).repair;
  return repair?.objects ?? [];
}

export const objOf = (db: CoreDb, id: string | undefined): RepairObjectRef | undefined =>
  repairObjects(db).find((o) => o.id === id);

/** id прораба объекта: `foremanId`, иначе участник с ФИО из `foreman` (совместимость с сидом). */
export function foremanIdOf(db: CoreDb, objId: string | undefined): string | undefined {
  const o = objOf(db, objId);
  if (!o) return undefined;
  if (o.foremanId) return o.foremanId;
  if (!o.foreman) return undefined;
  return db.members.find((m) => m.name === o.foreman)?.id;
}

export const relationHas = (db: CoreDb, memberId: string, objId: string | undefined): boolean =>
  foremanIdOf(db, objId) === memberId;

export function entryHas(db: CoreDb, memberId: string, e: Entry, ctx: EntryCtx = {}): boolean {
  const m = db.members.find((x) => x.id === memberId);
  if (!m || m.status === 'blocked') return false;
  switch (e.who) {
    case 'all':
      return true;
    case 'member':
      return e.ref === memberId;
    case 'group':
      return !!db.groups?.find((g) => g.id === e.ref)?.members.includes(memberId);
    case 'role': {
      const role = db.roles.find((r) => r.id === e.ref);
      if (!role) return false;
      return db.assignments.some(
        (a) =>
          a.member === memberId &&
          a.role === role.id &&
          (role.space
            ? a.scope.type === 'space' && a.scope.id === ctx.space?.id
            : !e.unit || scopeCovers(db, a.scope, e.unit)),
      );
    }
    case 'relation':
      return relationHas(db, memberId, e.obj);
    default:
      return false;
  }
}

/** Ключ записи для сравнения и дедупликации списков доступа. */
export const entryKey = (e: Entry): string =>
  [e.who, e.ref ?? '', e.unit ?? '', e.obj ?? ''].join(':');

const ICONS: Readonly<Record<Entry['who'], string>> = {
  all: 'apartment',
  member: 'person',
  group: 'groups',
  role: 'badge',
  relation: 'engineering',
};

export const entryIcon = (e: Entry): string => ICONS[e.who] ?? 'person';

/** Участники, которых охватывает запись (без заблокированных). */
export const entryPeople = (db: CoreDb, e: Entry, ctx?: EntryCtx): Member[] =>
  db.members.filter((m) => entryHas(db, m.id, e, ctx));
