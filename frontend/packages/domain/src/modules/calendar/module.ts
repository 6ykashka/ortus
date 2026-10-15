// Модуль «Календарь» по контракту `DomainModule` ядра. `moveBooking` и правила ресурсов этапа 4
// добавит W4.40; здесь — установка сида и проекция.
import type { DomainModule } from '../../core/module.ts';
import { calendarSeed } from './seed.ts';
import type { CalendarSlice } from './types.ts';
import { calendarView } from './view.ts';

export function createCalendarModule(
  opts: { prototypeLeaks?: boolean } = {},
): DomainModule<CalendarSlice | undefined> {
  return {
    key: 'calendar',
    install(db, seedOpts) {
      db.calendar ??= calendarSeed(seedOpts.tenantId, opts);
    },
    view: (db, actor) => (db.calendar ? calendarView(db, actor) : null),
    commands: () => ({}),
    methods: [],
    delays: {},
  };
}
