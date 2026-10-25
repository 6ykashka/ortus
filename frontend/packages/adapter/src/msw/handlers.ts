// Реестр хендлеров операций сценарного сервера (W0.13, B §5.3 P3): модуль адаптера — каталог
// `src/msw/<модуль>/` со своим реестром; новый модуль (например, `fleet/` — W2.00) добавляется одной строкой.
import { accessHandlers } from './access/index.ts';
import { peopleCardHandlers } from './access/people.ts';
import { authHandlers } from './auth/index.ts';
import { realtimeHandlers } from './auth/realtime.ts';
import { storageBreakdownHandlers } from './billing/breakdown.ts';
import { calendarHandlers } from './calendar/index.ts';
import { cashHandlers } from './cash/index.ts';
import { billingHandlers } from './billing/index.ts';
import { plansHandlers } from './billing/plans.ts';
import { brandingHandlers } from './branding/index.ts';
import { contextHandlers } from './context/index.ts';
import type { Registry } from './core/registry.ts';
import { dataExportHandlers } from './data/exports.ts';
import { dataHandlers } from './data/index.ts';
import { dataViewHandlers } from './data/views.ts';
import { filesHandlers } from './files/index.ts';
import { filesListHandlers } from './files/list.ts';
import { fleetHandlers } from './fleet/index.ts';
import { formsHandlers } from './forms/index.ts';
import { knowledgeHandlers } from './knowledge/index.ts';
import { moduleDeactivationHandlers } from './modules/deactivation.ts';
import { modulesHandlers } from './modules/index.ts';
import { accountsHandlers } from './platform/accounts.ts';
import { platformHandlers } from './platform/index.ts';
import { operatorHandlers } from './platform/operator.ts';
import { pricingHandlers } from './platform/pricing.ts';
import { usageHandlers } from './platform/usage.ts';
import { tasksHandlers } from './tasks/index.ts';

export const defaultRegistry: Registry = {
  ...contextHandlers,
  ...authHandlers,
  ...platformHandlers,
  ...billingHandlers,
  ...accessHandlers,
  ...modulesHandlers,
  ...filesHandlers,
  // 0.4.0-stage1 (W1.00): операции второго контрактного PR этапа 1.
  ...operatorHandlers,
  ...filesListHandlers,
  ...storageBreakdownHandlers,
  ...moduleDeactivationHandlers,
  ...realtimeHandlers,
  ...peopleCardHandlers,
  // 0.5.0-stage2 (W2.00): логистика этапа 2 и «Требует решения».
  ...fleetHandlers,
  // 0.6.0-stage2 (W2.51): наборы «Данных» этапа 2.
  ...dataHandlers,
  // 0.7.0-stage4 (W4.06): календарь ресурсов, сохранённые виды и выгрузка заданием «Данных».
  ...calendarHandlers,
  ...dataViewHandlers,
  ...dataExportHandlers,
  // 0.8.0-stage4 (W4.07): места и тарифная сетка, заявки, «Использование», каталог аккаунтов, операторы, оформление.
  ...plansHandlers,
  ...pricingHandlers,
  ...usageHandlers,
  ...accountsHandlers,
  ...brandingHandlers,
  // W4.04 (контрактный PR 3 этапа 4): «База знаний».
  ...knowledgeHandlers,
  // 0.10.0-stage4 (W4.03): «Задачи и проекты».
  ...tasksHandlers,
  // 0.11.0-stage4 (W4.05): «Формы и опросы».
  ...formsHandlers,
  // 0.12.0-stage5 (W5.00): «Касса».
  ...cashHandlers,
};
