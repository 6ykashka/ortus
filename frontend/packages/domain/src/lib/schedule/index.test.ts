// Экспорт-лист библиотеки графика (W6.10): публичные имена не теряются при правках.
import { describe, expect, it } from 'vitest';
import * as schedule from './index.ts';

describe('lib/schedule: публичные функции', () => {
  it('экспортирует расчёт, анализ, Гант и сид объекта 42', () => {
    for (const name of [
      'createCalendar',
      'REPAIR_CALENDAR',
      'todayIndex',
      'schedule',
      'normalizePlan',
      'criticalIds',
      'previewChange',
      'scheduleSummary',
      'scheduleStatus',
      'upcomingWindows',
      'ganttLayout',
      'OBJ42_MODEL',
      'OBJ42_PLAN',
      'SCHEDULE_REASONS',
    ]) {
      expect(schedule, name).toHaveProperty(name);
    }
  });

  it('семь причин переноса — дословно из эталона', () => {
    expect(schedule.SCHEDULE_REASONS).toEqual([
      'Задержка подрядчика',
      'Поставка материалов',
      'Решение заказчика',
      'Технологическая пауза',
      'Нет доступа на объект',
      'Добавили людей на этап',
      'Уточнили объём работ',
    ]);
  });
});
