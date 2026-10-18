// Подписи «Базы знаний» (knowledge.js 14.10:75–76, 112–118): подразделение, область пространства, запись.
import { objOf } from '../../core/entries.ts';
import type { CoreDb, Entry } from '../../core/types/index.ts';
import type { KbSpace } from './types.ts';

const ORG = 'вся организация';

export function unitName(db: CoreDb, id: string | null | undefined): string {
  const u = id ? db.units.find((x) => x.id === id) : undefined;
  return u ? u.name : ORG;
}

/** Область пространства: «фирма «…»», «регион «…»» или «вся организация». */
export function areaLabel(db: CoreDb, sp: Pick<KbSpace, 'unit'>): string {
  if (!sp.unit) return ORG;
  const u = db.units.find((x) => x.id === sp.unit);
  return (u?.type === 'region' ? 'регион «' : 'фирма «') + unitName(db, sp.unit) + '»';
}

export function entryLabel(db: CoreDb, e: Entry): string {
  switch (e.who) {
    case 'member':
      return db.members.find((m) => m.id === e.ref)?.name ?? 'Сотрудник';
    case 'group':
      return 'Группа «' + (db.groups?.find((g) => g.id === e.ref)?.name ?? e.ref) + '»';
    case 'role': {
      const r = db.roles.find((x) => x.id === e.ref);
      const tail = r?.space ? ' в пространстве' : e.unit ? ' · «' + unitName(db, e.unit) + '»' : '';
      return 'Роль «' + (r ? r.name : e.ref) + '»' + tail;
    }
    case 'relation': {
      const o = objOf(db, e.obj);
      return 'Прораб объекта' + (o ? ' «' + o.name + '»' : '');
    }
    default:
      return '—';
  }
}
