// Экспорт-лист модуля «Обращения» (`modules/service/index.ts`). Расширяется только добавлением.
// Общие имена эталона (`hm`, `when`, `dur`, `CAL`, `isOpen`…) выходят с префиксом `svc`/`service`, чтобы
// не пересечься с ядром и другими модулями в баррелях `@ortus/domain` и `@ortus/domain/modules`.
import { describe, expect, it } from 'vitest';

const SERVICE_EXPORTS = [
  // модуль и сид
  'serviceModule',
  'serviceHook',
  'installService',
  'serviceSeed',
  'SVC_BASE',
  // справочники
  'SVC_ST',
  'SVC_FLOW',
  'SVC_KIND',
  'SVC_CH',
  'SVC_PRIO',
  'OUTCOMES',
  'OUTCOMES_ABOUT',
  'COMPENSATIONS',
  'outcomesFor',
  'flowError',
  // календарь и подписи
  'SERVICE_CAL',
  'addWorkMinutes',
  'workBetween',
  'isWorkDay',
  'weekdayOf',
  'dayStartMs',
  'svcHm',
  'svcDayLabel',
  'svcWhen',
  'svcDueText',
  'svcDur',
  'svcSpan',
  'fillTemplate',
  // сроки
  'slaFor',
  'slaOf',
  'slaHead',
  'resumeTimers',
  'isRequestOpen',
  // доступ и проекция
  'ownerOf',
  'seesDir',
  'canIn',
  'teamOf',
  'serviceView',
  // очереди
  'QUEUES',
  'requestQueue',
  'queueCounts',
  'directionCounts',
  'takeable',
  // команды
  'serviceCommands',
  'SERVICE_METHODS',
  'SERVICE_DELAYS',
  'UNKNOWN_PHONE',
];

describe('экспорт-лист модуля «Обращения»', () => {
  it('функции, справочники и модуль, ничего лишнего', async () => {
    const pkg = await import('./index.ts');
    expect(Object.keys(pkg).sort()).toEqual([...SERVICE_EXPORTS].sort());
  }, 60_000);
});
