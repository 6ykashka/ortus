// Проекция календаря (api.js 14.10:212). Брони машин видит владелец и тот, кто видит логистику
// подразделения машины; остальные брони и ресурсы — все участники организации.
// Эталон проверяет жёстко фирму «Север Логистик» (`seesFleet('f-msk-sever')`); здесь — фирму
// машины из источника брони. На сиде результат тот же: все машины с бронями — «Север Логистик».
// Машины нет в организации (утечка в «Лотос», Q-31) — бронь видит только владелец.
import { can, grants } from '../../core/access/index.ts';
import type { TenantDb } from '../../core/types/index.ts';
import type { Booking, CalendarSlice } from './types.ts';

export function calendarView(db: TenantDb, actor: string): CalendarSlice {
  const cal = db.calendar ?? { resources: [], bookings: [] };
  const owner = grants(db, actor).some((g) => g.roleObj.all);
  const on = { ...db, modules: { ...db.modules, logistics: { enabled: true } } };
  const visible = (b: Booking): boolean => {
    if (owner || b.source?.kind !== 'vehicle') return true;
    const id = b.source.id;
    const v = (db.vehicles ?? []).find((x) => x.id === id);
    return !!v && can(on, actor, 'logistics', 'view', v.unit).ok;
  };
  return structuredClone({ resources: cal.resources, bookings: cal.bookings.filter(visible) });
}
