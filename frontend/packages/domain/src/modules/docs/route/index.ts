// Маршрут документа (W7.22, P2 docs-route): запуск, согласование, утверждение ПЭП по коду из SMS,
// ознакомление, PDF/A-копия и зеркало задачи через `TaskPort`. Восемь команд собираются в модуль
// `docs` вместе с ядром (W7.21) и остальными командами (W7.27); подключение — интегратор.
export type * from './types.ts';
export { createRouteEngine, type RouteEngine } from './engine.ts';
export {
  createDocsRouteCommands,
  ROUTE_DELAYS,
  ROUTE_METHODS,
  type DocsRouteCommands,
} from './commands.ts';
export { routeSheet } from './sheet.ts';
