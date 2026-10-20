// Кейсы conformance по модулям (W0.13, B §5.3 P4): новый модуль — файл `cases/<модуль>.ts` и строка здесь.
import type { ConformanceCase } from '../types.ts';
import { accessCases } from './access.ts';
import { authCases } from './auth.ts';
import { billingCases } from './billing.ts';
import { billingW407Cases } from './billing-w407.ts';
import { calendarCases } from './calendar.ts';
import { contextCases } from './context.ts';
import { dataCases } from './data.ts';
import { dataW406Cases } from './data-w406.ts';
import { filesCases } from './files.ts';
import { fleetCases } from './fleet.ts';
import { knowledgeCases } from './knowledge.ts';
import { logisticsCases } from './logistics.ts';
import { modulesCases } from './modules.ts';
import { platformCases } from './platform.ts';
import { poolCases } from './pool.ts';
import { stage1bCases } from './stage1b.ts';
import { stage2bCases } from './stage2b.ts';
import { tasksCases } from './tasks.ts';
import { vehicleOfferCases } from './vehicle-offer.ts';
import { w262Cases } from './w262.ts';

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
  // W2.52 (0.6.1-stage2): ответы владельца 17.10 — справочник расходов, машина, фото, чек-лист, дефект, D-11.
  ...stage2bCases,
  // W4.06 (0.7.0-stage4): календарь ресурсов, сохранённые виды и выгрузка заданием «Данных».
  ...calendarCases,
  ...dataW406Cases,
  // W2.71 (0.7.1-stage4, в ветке 0.6.3-stage2): S2-20 «Машина для временного водителя» (D-35 комплекта).
  ...vehicleOfferCases,
  // W4.07 (0.8.0-stage4): места, тарифная сетка, заявки, «Использование», аккаунты, операторы, оформление.
  ...billingW407Cases,
  // W4.04 (контрактный PR 3 этапа 4): «База знаний».
  ...knowledgeCases,
  // W4.03 (0.10.0-stage4): «Задачи и проекты».
  ...tasksCases,
  // W2.62 (Q-W2.32-5, Q-W2.32-6): draining «Логистики» и роль «Временный водитель» как backend.
  ...w262Cases,
];
