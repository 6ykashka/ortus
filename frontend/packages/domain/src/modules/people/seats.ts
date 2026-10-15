// Места и владельцы (api.js 14.10:55–57). Место занимает каждый участник со входом (активен или
// приглашён); заблокированные и карточки без входа — бесплатно.
import { grants } from '../../core/access/index.ts';
import type { CoreDb } from '../../core/types/index.ts';

export const seatsUsed = (db: CoreDb): number =>
  db.members.filter((m) => m.status === 'active' || m.status === 'invited').length;

/** Участники с системной ролью «Владелец бизнеса» — адресаты событий организации. */
export const owners = (db: CoreDb): string[] =>
  db.members.filter((m) => grants(db, m.id).some((g) => g.roleObj.all)).map((m) => m.id);
