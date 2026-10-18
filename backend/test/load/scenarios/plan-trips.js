// Планирование рейсов прогона в setup() (W2.47, допущение A-27): логист входит, читает участников организации и
// рейсы в планировании и планирует createTripPlan на каждого активного водителя — tripsPerDriver рейсов за вычетом
// уже запланированных, окна подряд без пересечений (planningFor модели). Водитель потом берёт свой самый ранний
// подходящий рейс (driver-shift.js). Запросы — kind:setup, вне порогов.
import exec from 'k6/execution';

import { Session, tenantOf } from '../lib/client.js';
import {
  driverPacing,
  personasFor,
  planningFor,
  tripPlanCreate,
  tripsPerDriver,
} from '../lib/model.js';

const PAGE = 200;
const MAX_PAGES = 20;

function fail(message) {
  exec.test.abort(`setup: ${message}`);
  throw new Error(message); // abort завершает прогон; throw — для k6 inspect и тестов
}

/** Все страницы списка операции. */
function allPages(s, opId, tenantId, query) {
  const out = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = s.call(opId, { params: { tenantId }, query: { limit: PAGE, ...query, cursor } });
    if (!res.ok || !res.json) fail(`${opId} → ${res.status}`);
    out.push(...res.json.items);
    cursor = res.json.nextCursor;
    if (!cursor) break;
  }
  return out;
}

export function planTrips(profile, stage) {
  const { planner } = personasFor(profile, stage);
  const s = new Session(planner, 'setup', { kind: 'setup' });
  if (!s.login()) fail(`вход логиста ${planner}`);
  const me = tenantOf(s);
  if (!me) fail(`нет организации у ${planner}`);
  const members = allPages(s, 'listMembers', me.tenantId, {});
  const planned = allPages(s, 'listTripPlans', me.tenantId, { state: 'planned' });
  const todo = planningFor({
    members,
    planned,
    perDriver: tripsPerDriver(profile, stage),
    at: new Date(),
    cycleSeconds: driverPacing(profile, stage, 0).cycleSeconds,
  });
  for (const [i, t] of todo.entries()) {
    const res = s.call('createTripPlan', {
      params: { tenantId: me.tenantId },
      body: tripPlanCreate({
        orgUnitId: t.orgUnitId || me.orgUnitIds[0],
        driverMemberId: t.driverMemberId,
        window: t.window,
        title: `Нагрузка · рейс ${i + 1}`,
      }),
    });
    if (!res.ok) {
      fail(`createTripPlan для ${t.driverMemberId} → ${res.status} ${JSON.stringify(res.json)}`);
    }
  }
  return { planned: todo.length };
}
