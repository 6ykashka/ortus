// Смена менеджера (W0.16): списки по listLimit строк; если есть рейс на приёмке —
// решения по расходам и по рейсу с If-Match. Состав = requestsPerManagerIteration() модели.
// Вход — один раз на VU (options.noCookiesReset). Итог итерации — lib/flow.js.
import { sleep } from 'k6';
import exec from 'k6/execution';

import { Session, pad, tenantOf } from '../lib/client.js';
import { track } from '../lib/flow.js';
import { expenseReview, paramValues, tripReview } from '../lib/model.js';

// Несколько менеджеров могут взять один рейс: 409/412 при гонке — ожидаемый ответ.
const RACE = [200, 409, 412];

export function makeManagerShift(profile, stage) {
  const v = paramValues(profile, stage);
  const personas = v.managers + v.owners;
  let session = null; // на VU: вход один раз
  let tenantId = null;

  function connect() {
    const n = (exec.scenario.iterationInTest % personas) + 1;
    const s = new Session(`load-pilot-manager-${pad(n, 2)}`, 'managerShift');
    if (!s.login()) return 'login';
    const me = tenantOf(s);
    if (!me) return 'context';
    session = s;
    tenantId = me.tenantId;
    return null;
  }

  function iteration() {
    if (!session) {
      const reason = connect();
      if (reason) return reason;
    }
    const s = session;
    const list = { params: { tenantId }, query: { limit: v.listLimit } };

    const trips = s.call('listTrips', list);
    const others = [
      s.call('listVehicles', list),
      s.call('listReservations', list),
      s.call('listInspections', list),
    ];
    if (!trips.ok || others.some((r) => !r.ok)) return 'lists';

    const pending = ((trips.json && trips.json.items) || []).find(
      (t) => t.status === 'returned_pending_review',
    );
    if (pending && !review(s, tenantId, pending.id)) return 'review';
    return null;
  }

  return function managerShift() {
    const outcome = track('managerShift');
    const reason = iteration();
    if (reason) outcome.abort(reason);
    else outcome.done();
    if (v.managerThinkSeconds > 0) sleep(v.managerThinkSeconds);
  };
}

/** Приёмка рейса; false — неожиданный отказ (гонка 409/412 отказом не считается). */
function review(s, tenantId, tripId) {
  const trip = s.call('getTrip', { params: { tenantId, tripId } });
  if (!trip.ok) return false;
  const expenses = s.call('listTripExpenses', { params: { tenantId, tripId } });
  if (!expenses.ok) return false;
  const open = ((expenses.json && expenses.json.items) || []).filter(
    (e) => e.reviewState === 'pending',
  );
  for (const e of open) {
    const params = { tenantId, tripId, expenseId: e.id };
    const current = s.call('getTripExpense', { params });
    if (!current.etag) return false;
    const decided = s.call('reviewTripExpense', {
      params,
      ifMatch: current.etag,
      body: expenseReview(),
      expected: RACE,
    });
    if (!decided.ok) return false;
  }
  const fresh = s.call('getTrip', { params: { tenantId, tripId } });
  if (!fresh.etag) return false;
  return s.call('reviewTrip', {
    params: { tenantId, tripId },
    ifMatch: fresh.etag,
    body: tripReview(),
    expected: RACE,
  }).ok;
}
