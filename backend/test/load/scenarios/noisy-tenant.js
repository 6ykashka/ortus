// «Шумный» тенант (W0.16; 15-quality-security.md, 02-architecture.md §14): выгрузки набора данных
// постранично и поток фото. Его запросы не входят в пороги целей — проверяется, что пилот держит
// p95. Объём шума проверяют пороги flow_completed{flow:noisyExport|noisyUploads} (lib/flow.js).
// Вход — один раз на VU (options.noCookiesReset).
import exec from 'k6/execution';

import { Session, makeFiller, tenantOf } from '../lib/client.js';
import { track } from '../lib/flow.js';
import { datasetQuery, paramValues } from '../lib/model.js';

const PERSONA = 'load-noisy-owner-01';

function connect(scenario) {
  const s = new Session(PERSONA, scenario);
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
    conn = conn || connect('noisyExport');
    if (!conn) return 'login';
    const { s, tenantId } = conn;
    const catalog = s.call('listDatasets', { params: { tenantId } });
    if (!catalog.ok) return 'catalog';
    const items = (catalog.json && catalog.json.items) || [];
    const dataset = items.find((d) => d.moduleKey === 'fleet') || items[0];
    if (!dataset) return 'no_dataset';
    const select = dataset.fields.map((f) => f.key);
    let cursor;
    for (let page = 0; page < v.noisyExportPages; page++) {
      const res = s.call('queryDataset', {
        params: { tenantId, datasetId: dataset.id },
        body: datasetQuery({ select, limit: v.noisyExportPageSize, cursor }),
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
  let owner = null;

  return tracked('noisyUploads', () => {
    conn = conn || connect('noisyUploads');
    if (!conn) return 'login';
    const { s, tenantId } = conn;
    if (!owner) {
      const trips = s.call('listTrips', { params: { tenantId }, query: { limit: 1 } });
      const trip = trips.json && trips.json.items && trips.json.items[0];
      if (!trip) return 'no_trip';
      owner = { entityType: 'trip', entityId: trip.id };
    }
    const fileId = s.upload({
      tenantId,
      purpose: 'expense_receipt',
      owner,
      fileName: `noisy-${exec.scenario.iterationInTest}.jpg`,
      filler,
    });
    return fileId ? null : 'upload';
  });
}
