// Помощники тестов «Обращений»: без ! (правило no-non-null-assertion) и без s.
import type { ServiceSlice, ServiceTenantDb } from './types.ts';

/** Значение или ошибка теста. */
export function must<T>(x: T | null | undefined, what = 'значение'): T {
  if (x === null || x === undefined) throw new Error('В тесте нет: ' + what);
  return x;
}

/** Элемент массива по индексу или ошибка теста. */
export const at = <T>(a: readonly T[], i: number): T => must(a[i], 'элемент ' + i);

/** Срез «Обращений» организации. */
export const svc = (db: Pick<ServiceTenantDb, 'service'>): ServiceSlice =>
  must(db.service, 'db.service');
