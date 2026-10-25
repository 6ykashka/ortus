// Тег Repairs сценарного сервера (W6.00, контракт 0.12.0-stage6): «Ремонт и стройка» — объекты, отметки, допработы, замер,
// сметы, справочник и шаблоны, график, документы, снабжение, финансы, подрядчики, ссылка и публичный кабинет заказчика.
// Сид — данные эталона design-2026-10-19 «Альты» (data.ts, seed.ts); расчёты — calc.ts; тексты ошибок — эталон.
import type { Registry } from '../core/registry.ts';
import { cabinetHandlers } from './cabinet.ts';
import { estimatesHandlers } from './estimates.ts';
import { projectsHandlers } from './projects.ts';
import { scheduleHandlers } from './schedule.ts';
import './seed.ts';
import { supplyHandlers } from './supply.ts';

export const repairsHandlers: Registry = {
  ...projectsHandlers,
  ...estimatesHandlers,
  ...scheduleHandlers,
  ...supplyHandlers,
  ...cabinetHandlers,
};
