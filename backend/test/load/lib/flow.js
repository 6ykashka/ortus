// Учёт итераций сценариев (W0.16 → W2.47): flow_completed — итерация дошла до конца, flow_aborted — прервана
// (тег reason), trips_reviewed — логист принял смену. Пороги объёма — buildVolumeThresholds() модели (A-24).
import { Counter } from 'k6/metrics';

import { FLOW_ABORTED, FLOW_COMPLETED, TRIPS_REVIEWED } from './model.js';

const completed = new Counter(FLOW_COMPLETED);
const aborted = new Counter(FLOW_ABORTED);
const reviewed = new Counter(TRIPS_REVIEWED);

/** Итерация сценария flow: done() или abort(reason) — ровно один раз за итерацию. */
export function track(flow) {
  return {
    done() {
      completed.add(1, { flow });
    },
    abort(reason) {
      aborted.add(1, { flow, reason });
    },
  };
}

/** Смена принята (reviewTrip 200). */
export function tripReviewed() {
  reviewed.add(1);
}
