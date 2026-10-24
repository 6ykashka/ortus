// W4.13 · Вкладки проекта «Участники», «Процесс», «Автоматизация» для страницы `tasks` (W4.12): шапка проекта и
// tablist «Разделы проекта» рисует страница, содержимое вкладки — `ProjectSettingsTab`. Адрес — ADR-0001
// `/t/:tenantId/tasks?project=<id>&view=people|workflow|automation`.
export { ProjectSettingsTab, SETTINGS_VIEWS, type SettingsView, isSettingsView } from './tab.tsx';
export { TS as SETTINGS_TEXT } from './texts.ts';
