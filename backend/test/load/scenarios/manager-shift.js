// Смена логиста (W0.16 → W2.47), клиент W2.20/W2.21 на контракте 0.5.1-stage2: рабочее место, очередь «Приёмки
// смен», машины, дефекты; если в очереди есть смена — карточка, осмотры, расходы, все фото и решение «Принять»
// с If-Match свежего getTripPlan. Состав = requestsPerManagerIteration() модели. Вход — один раз на VU
// (options.noCookiesReset). Итог итерации — lib/flow.js; принятая смена — trips_reviewed.
import { sleep } from 'k6';
import exec from 'k6/execution';

import { Session, tenantOf } from '../lib/client.js';
import { track, tripReviewed } from '../lib/flow.js';
import { paramValues, personasFor, tripReview } from '../lib/model.js';

// Несколько логистов могут взять одну смену: 409/412 при гонке — ожидаемый ответ.
const RACE = [200, 409, 412];

export function makeManagerShift(profile, stage) {
  const v = paramValues(profile, stage);
  const personas = personasFor(profile, stage).managers;
  let session = null; // на VU: вход один раз
  let tenantId = null;
  let slot = null;

  function connect() {
    const s = new Session(personas[slot % personas.length], 'managerShift');
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
    const list = (query = {}) => ({
      params: { tenantId },
      query: { limit: v.listLimit, ...query },
    });
    const lists = [
      s.call('listTripPlans', list()),
      s.call('listVehicles', list()),
      s.call('listInspectionDefects', list()),
    ];
    const queue = s.call('listTripPlans', list({ state: 'submitted' }));
    if (!queue.ok || lists.some((r) => !r.ok)) return 'lists';
    const waiting = (queue.json && queue.json.items) || [];
    if (!waiting.length) return null;
    // Случайная смена очереди: одновременные логисты реже берут одну и ту же.
    const plan = waiting[Math.floor(Math.random() * waiting.length)];
    return review(s, tenantId, plan.id) ? null : 'review';
  }

  return function managerShift() {
    if (slot === null) slot = exec.scenario.iterationInTest;
    const outcome = track('managerShift');
    const reason = iteration();
    if (reason) outcome.abort(reason);
    else outcome.done();
    if (v.managerThinkSeconds > 0) sleep(v.managerThinkSeconds);
  };
}

/** Приёмка смены; false — неожиданный отказ (гонка 409/412 отказом не считается). */
function review(s, tenantId, tripId) {
  const card = s.call('getTripPlan', { params: { tenantId, tripId } });
  if (!card.ok || !card.json) return false;
  const files = [];
  for (const id of [card.json.departureInspectionId, card.json.returnInspectionId]) {
    if (!id) return false;
    const ins = s.call('getInspection', { params: { tenantId, inspectionId: id } });
    if (!ins.ok || !ins.json) return false;
    for (const p of ins.json.photos || []) files.push(p.fileId);
  }
  const expenses = s.call('listTripExpenses', { params: { tenantId, tripId } });
  if (!expenses.ok) return false;
  for (const e of (expenses.json && expenses.json.items) || [])
    files.push(...(e.receiptFileIds || []));
  // Миниатюры «Приёмки смен»: ссылка на каждое фото и само фото.
  for (const fileId of files) {
    const link = s.call('getFileDownload', { params: { tenantId, fileId } });
    if (!link.ok || !link.json || !s.download(link.json.downloadUrl)) return false;
  }
  const fresh = s.call('getTripPlan', { params: { tenantId, tripId } });
  if (!fresh.etag) return false;
  const decided = s.call('reviewTrip', {
    params: { tenantId, tripId },
    ifMatch: fresh.etag,
    body: tripReview(),
    expected: RACE,
  });
  if (decided.status === 200) tripReviewed();
  return decided.ok;
}
