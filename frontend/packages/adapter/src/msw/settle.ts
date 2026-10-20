// Досчёт времени и процессов организации (W2.62): сервер сценариев не держит фоновых задач, поэтому то, что backend
// досчитывает при чтении и воркером, досчитывается перед шлюзом каждого запроса организации и при сборке /me/context —
// до проверки модуля и прав. Порядок: пул водителей (сроки переводов, назначения роли «Временный водитель» — их видит
// шлюз), затем draining модулей (начатые рейсы после досчёта пула; modulesreg Installations → settle). Явный список,
// без init().
import type { Org } from './core/state.ts';
import { syncTemporaryGrants } from './fleet/temporary.ts';
import { settleDraining } from './modules/draining.ts';

/** Досчитать организацию к моменту `now`. */
export function settleOrg(org: Org, now: string): void {
  syncTemporaryGrants(org, now);
  settleDraining(org);
}
