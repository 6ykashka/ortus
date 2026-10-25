// Модуль «Обращения» (W7.30, P1h service): рабочий календарь, сроки SLA, доступ, очереди и 10 команд
// из прототипа 19.10 (`design/ortus/service.js`). Общие имена эталона выходят с префиксом `svc`,
// чтобы не пересечься с ядром (`hm`, `plural`) и модулями в баррелях.
export type * from './types.ts';
export type { CallRequestInput, ReplyInput, ServiceApi } from './commands.ts';
export type {
  QueueDef,
  QueueKey,
  QueueQuery,
  QueueRequest,
  QueueRow,
  QueueSource,
} from './queues.ts';
export type { TemplateVars } from './format.ts';
export type { WorkCalendar } from './calendar.ts';
export { serviceModule } from './module.ts';
export { installService, serviceHook, serviceSeed, SVC_BASE } from './seed.ts';
export {
  COMPENSATIONS,
  flowError,
  OUTCOMES,
  OUTCOMES_ABOUT,
  outcomesFor,
  SVC_CH,
  SVC_FLOW,
  SVC_KIND,
  SVC_PRIO,
  SVC_ST,
} from './dictionaries.ts';
export {
  addWorkMinutes,
  CAL as SERVICE_CAL,
  dayStartMs,
  isWorkDay,
  weekdayOf,
  workBetween,
} from './calendar.ts';
export {
  dayLabel as svcDayLabel,
  dueText as svcDueText,
  dur as svcDur,
  fillTemplate,
  hm as svcHm,
  span as svcSpan,
  when as svcWhen,
} from './format.ts';
export { isOpen as isRequestOpen, resumeTimers, slaFor, slaHead, slaOf } from './sla.ts';
export { canIn, ownerOf, seesDir, serviceView, teamOf } from './access.ts';
export { directionCounts, QUEUES, queueCounts, requestQueue, takeable } from './queues.ts';
export { SERVICE_DELAYS, SERVICE_METHODS, serviceCommands, UNKNOWN_PHONE } from './commands.ts';
