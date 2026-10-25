// Библиотека графика работ (W6.10): рабочий календарь, расчёт по связям («критический путь»),
// анализ (конфликты, внимание, предпросмотр, окна 3 недель) и геометрия диаграммы Ганта.
// Чистые функции без БД и часов: календарь, этапы и план передаются явно.
export type * from './types.ts';
export * from './calendar.ts';
export * from './cpm.ts';
export * from './analysis.ts';
export * from './gantt.ts';
export {
  OBJ42_LINKS,
  OBJ42_LOG,
  OBJ42_MODEL,
  OBJ42_PHASES,
  OBJ42_PLAN,
  OBJ42_STAGES,
  OBJ42_WHO,
  SCHEDULE_REASONS,
} from './obj42.ts';
