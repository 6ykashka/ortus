// Кейсы conformance по модулям (W0.13, B §5.3 P4): новый модуль — файл `cases/<модуль>.ts` и строка здесь.
import type { ConformanceCase } from '../types.ts';
import { accessCases } from './access.ts';
import { authCases } from './auth.ts';
import { billingCases } from './billing.ts';
import { contextCases } from './context.ts';
import { dataCases } from './data.ts';
import { filesCases } from './files.ts';
import { fleetCases } from './fleet.ts';
import { logisticsCases } from './logistics.ts';
import { modulesCases } from './modules.ts';
import { platformCases } from './platform.ts';
import { poolCases } from './pool.ts';
import { stage1bCases } from './stage1b.ts';

export const ALL_CASES: readonly ConformanceCase[] = [
  ...contextCases,
  ...authCases,
  ...platformCases,
  ...billingCases,
  ...accessCases,
  ...modulesCases,
  ...filesCases,
  ...logisticsCases,
  ...stage1bCases,
  ...fleetCases,
  // W2.51 (0.6.0-stage2): пул водителей (S2-14) и «Данные» (S2-16).
  ...poolCases,
  ...dataCases,
];
