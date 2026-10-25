// Доступ к «Обращениям» (service.js 19.10:215–232 `ownerOf`, `seesDir`, `serviceView`).
// Правило PD-53 (план v2 §7): команда проверяется с объектом-направлением (`can` с областью
// `project = direction.project`), а не «хоть где-то в организации». Гейт раздела и пункта меню —
// `canAny` (Q-W0.11-1). Жалобу на сотрудника сам он не видит (404, а не 403).
import { canAny, can, grants } from '../../core/access/index.ts';
import { maskPhone } from '../../core/format.ts';
import type { CoreDb, Verb } from '../../core/types/index.ts';
import type { Direction, DirectionView, RequestView, ServiceSlice, ServiceView } from './types.ts';

type ServiceDb = CoreDb & { service?: ServiceSlice | null };

/** Системная роль владельца бизнеса (`all`). */
export const ownerOf = (db: CoreDb, actor: string): boolean =>
  grants(db, actor).some((g) => !!g.roleObj.all);

/**
 * Направление видно владельцу или по назначению с областью «проект = направление» и непустыми
 * действиями модуля; уровень `view` не проверяется (эталон).
 */
export const seesDir = (db: CoreDb, actor: string, d: Pick<Direction, 'project'>): boolean =>
  ownerOf(db, actor) ||
  grants(db, actor).some(
    (g) =>
      g.scope.type === 'project' &&
      g.scope.id === d.project &&
      (g.roleObj.actions['service'] ?? []).length > 0,
  );

/** Право на действие в конкретном направлении (PD-53). */
export const canIn = (
  db: CoreDb,
  actor: string,
  d: Pick<Direction, 'project'>,
  verb: Verb,
): boolean => can(db, actor, 'service', verb, undefined, { type: 'project', id: d.project }).ok;

/** Исполнители направления: активные участники, видящие его и имеющие право «Отвечать». */
export const teamOf = (db: CoreDb, d: Pick<Direction, 'project'>): string[] =>
  db.members
    .filter((m) => m.status === 'active' && seesDir(db, m.id, d) && canIn(db, m.id, d, 'edit'))
    .map((m) => m.name);

/**
 * Ответ сервера участнику: только его направления, без жалоб на него самого; телефон — только тем,
 * кому его показали, остальным маска. `null` — у организации нет срезa «Обращений».
 */
export function serviceView(db: ServiceDb, actor: string): ServiceView | null {
  const S = db.service;
  if (!S) return null;
  if (!canAny(db, actor, 'service', 'view').ok) {
    return { directions: [], types: [], templates: [], requests: [], ratings: [], hidden: true };
  }
  const dirs = S.directions.filter((d) => seesDir(db, actor, d));
  const ids = new Set(dirs.map((d) => d.id));
  const owner = ownerOf(db, actor);
  const directions: DirectionView[] = structuredClone(dirs).map((d) => ({
    ...d,
    team: teamOf(db, d),
    canContacts: owner || d.lead === actor,
  }));
  const requests = S.requests
    .filter((r) => ids.has(r.dir) && r.about !== actor)
    .map((r): RequestView => {
      const { shown, ...rest } = structuredClone(r);
      const client = { ...rest.client, phoneMasked: maskPhone(r.client.phone) };
      if (!(shown ?? []).includes(actor)) delete client.phone;
      return { ...rest, client };
    });
  return {
    directions,
    types: structuredClone(S.types.filter((t) => ids.has(t.dir))),
    templates: structuredClone(S.templates),
    requests,
    ratings: structuredClone(S.ratings.filter((x) => ids.has(x.dir))),
  };
}
