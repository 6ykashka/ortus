// Учёт итераций сценариев (W0.16): flow_completed — итерация дошла до конца, flow_aborted —
// прервана (тег reason). Пороги объёма — buildVolumeThresholds() модели (допущение A-24).
import { Counter } from 'k6/metrics';

import { FLOW_ABORTED, FLOW_COMPLETED } from './model.js';

const completed = new Counter(FLOW_COMPLETED);
const aborted = new Counter(FLOW_ABORTED);

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
