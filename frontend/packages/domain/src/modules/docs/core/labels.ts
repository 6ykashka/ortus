// Подписи документов (documents.js 14.10:40, 57–64): подразделение и запись списка доступа.
import { objOf } from '../../../core/entries.ts';
import type { CoreDb, Entry } from '../../../core/types/index.ts';

export const unitName = (db: CoreDb, id: string | null | undefined): string =>
  db.units.find((u) => u.id === id)?.name || 'вся организация';

export function entryLabel(db: CoreDb, e: Entry): string {
  switch (e.who) {
    case 'all':
      return 'Все сотрудники организации';
    case 'member':
      return db.members.find((m) => m.id === e.ref)?.name || 'Сотрудник';
    case 'group':
      return 'Группа «' + (db.groups?.find((g) => g.id === e.ref)?.name || e.ref) + '»';
    case 'role': {
      const r = db.roles.find((x) => x.id === e.ref);
      return (
        'Роль «' +
        (r ? r.name : e.ref) +
        '»' +
        (e.unit ? ' · «' + unitName(db, e.unit) + '»' : ' · вся организация')
      );
    }
    case 'relation': {
      const o = objOf(db, e.obj);
      return 'Прораб объекта' + (o ? ' «' + o.name + '»' : '');
    }
    default:
      return '—';
  }
}
