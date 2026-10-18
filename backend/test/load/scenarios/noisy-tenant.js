// «Шумный» тенант (W0.16 → W2.47; 15-quality-security.md, 02-architecture.md §14): выгрузка рейсов постранично
// и поток фото. Наборов данных (queryDataset) на сервере этапа 2 нет (501), поэтому выгрузка — listTripPlans по
// noisyExportPageSize строк по курсору. Его запросы не входят в пороги целей — проверяется, что пилот держит p95.
// Объём шума — пороги flow_completed{flow:noisyExport|noisyUploads} (lib/flow.js). Вход — один раз на VU.
import exec from 'k6/execution';

import { Session, makeFiller, tenantOf } from '../lib/client.js';
import { track } from '../lib/flow.js';
import { paramValues, personasFor } from '../lib/model.js';

function connect(profile, stage, scenario) {
  const s = new Session(personasFor(profile, stage).noisy, scenario);
  if (!s.login()) return null;
  const me = tenantOf(s);
  return me ? { s, tenantId: me.tenantId } : null;
}

/** Обёртка итерации: body() возвращает причину прерывания или null. */
function tracked(flow, body) {
  return function () {
    const outcome = track(flow);
    const reason = body();
    if (reason) outcome.abort(reason);
    else outcome.done();
  };
}

export function makeNoisyExport(profile, stage) {
  const v = paramValues(profile, stage);
  let conn = null;

  return tracked('noisyExport', () => {
    conn = conn || connect(profile, stage, 'noisyExport');
    if (!conn) return 'login';
    const { s, tenantId } = conn;
    let cursor;
    for (let page = 0; page < v.noisyExportPages; page++) {
      const res = s.call('listTripPlans', {
        params: { tenantId },
        query: { limit: v.noisyExportPageSize, cursor },
      });
      if (!res.ok) return 'page';
      cursor = res.json && res.json.nextCursor;
      if (!cursor) break;
    }
    return null;
  });
}

export function makeNoisyUploads(profile, stage) {
  const v = paramValues(profile, stage);
  const filler = makeFiller(v.photoSizeBytes);
  let conn = null;
  let tripId = null;

  return tracked('noisyUploads', () => {
    conn = conn || connect(profile, stage, 'noisyUploads');
    if (!conn) return 'login';
    const { s, tenantId } = conn;
    if (!tripId) {
      const trips = s.call('listTripPlans', { params: { tenantId }, query: { limit: 1 } });
      const trip = trips.json && trips.json.items && trips.json.items[0];
      if (!trip) return 'no_trip';
      tripId = trip.id;
    }
    const r = s.upload({
      tenantId,
      purpose: 'expense_receipt',
      tripId,
      fileName: `noisy-${exec.scenario.iterationInTest}.jpg`,
      filler,
      wait: false,
    });
    return r.fileId ? null : 'upload';
  });
}
