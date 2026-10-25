// Проекция «Ремонта и стройки» для участника (api.js 14.10/19.10:213–222): владелец и роли с
// приёмкой или ведением объектов видят все объекты, прораб — только свои (связь по id участника);
// работы, отметки, материалы и допработы — только видимых объектов; суммы объекта (`st.fin`) —
// только с правом финансов. Результат — копия: правки не попадают в БД.
import { can, grants } from '../../core/access/index.ts';
import { foremanIdOf } from '../../core/entries.ts';
import type { CoreDb } from '../../core/types/index.ts';
import { emptyRepairSlice } from './seed.ts';
import type { RepairDb, RepairSlice } from './types.ts';

export function repairView(db: RepairDb, actor: string): RepairSlice {
  const slice = db.repair;
  if (!slice) return emptyRepairSlice();
  // Видимость не зависит от того, подключён ли модуль: у отключённого история доступна для чтения.
  const on: CoreDb = { ...db, modules: { ...db.modules, repair: { enabled: true } } };
  const gs = grants(db, actor);
  const seesAll =
    gs.some((g) => g.roleObj.all) ||
    can(on, actor, 'repair', 'review').ok ||
    can(on, actor, 'repair', 'edit').ok;
  const fin = gs.some((g) => g.roleObj.all || g.roleObj.finance.read);
  const visible = new Set(
    slice.objects.filter((o) => seesAll || foremanIdOf(db, o.id) === actor).map((o) => o.id),
  );
  const mine = <T extends { obj: string }>(xs: T[]): T[] => xs.filter((x) => visible.has(x.obj));
  const out = structuredClone({
    objects: slice.objects.filter((o) => visible.has(o.id)),
    works: mine(slice.works),
    crew: slice.crew,
    materials: mine(slice.materials),
    changes: mine(slice.changes),
    logs: mine(slice.logs),
  });
  if (!fin) {
    for (const o of out.objects) if (o.st) delete o.st.fin;
  }
  return out;
}
