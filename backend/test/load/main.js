/* global __ENV, open */
// Точка входа k6 (W0.16 → W2.47). Стадия — LOAD_STAGE: smoke (по умолчанию) | stand | pilot | stress.
// Профиль: profile.json; документ: docs/plan/v2/load-profile.md.
import { buildOptions } from './lib/model.js';
import { makeDriverShift } from './scenarios/driver-shift.js';
import { makeManagerShift } from './scenarios/manager-shift.js';
import { makeNoisyExport, makeNoisyUploads } from './scenarios/noisy-tenant.js';
import { planTrips } from './scenarios/plan-trips.js';

const profile = JSON.parse(open('./profile.json'));
const STAGE = __ENV.LOAD_STAGE || 'smoke';

export const options = buildOptions(profile, STAGE);

/** Логист планирует рейсы прогона на каждого водителя (A-27). */
export function setup() {
  return planTrips(profile, STAGE);
}

export const driverShift = makeDriverShift(profile, STAGE);
export const managerShift = makeManagerShift(profile, STAGE);
export const noisyExport = makeNoisyExport(profile, STAGE);
export const noisyUploads = makeNoisyUploads(profile, STAGE);
