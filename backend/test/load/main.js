/* global __ENV, open */
// Точка входа k6 (W0.16). Стадия — LOAD_STAGE: smoke (по умолчанию) | pilot | stress.
// Профиль: profile.json; документ: docs/plan/v2/load-profile.md.
import { buildOptions } from './lib/model.js';
import { makeDriverShift } from './scenarios/driver-shift.js';
import { makeManagerShift } from './scenarios/manager-shift.js';
import { makeNoisyExport, makeNoisyUploads } from './scenarios/noisy-tenant.js';

const profile = JSON.parse(open('./profile.json'));
const STAGE = __ENV.LOAD_STAGE || 'smoke';

export const options = buildOptions(profile, STAGE);

export const driverShift = makeDriverShift(profile, STAGE);
export const managerShift = makeManagerShift(profile, STAGE);
export const noisyExport = makeNoisyExport(profile, STAGE);
export const noisyUploads = makeNoisyUploads(profile, STAGE);
