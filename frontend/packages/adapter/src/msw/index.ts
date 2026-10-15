// @ortus/adapter/msw (W0.13): сценарный сервер режима mock — общий для браузера (msw/browser),
// Node (msw/node: conformance, тесты экранов) и скриптов. Публичные имена расширяются только аддитивно.
export {
  createScenarioServer,
  headerCookies,
  type CookieJar,
  type HandlerContext,
  type OperationHandler,
  type Registry,
  type ScenarioServer,
  type ScenarioServerOptions,
} from './server.ts';
export { createScenarioState, SEED_NOW, type ScenarioState } from './core/state.ts';
export { PRESETS, type PresetName } from './core/presets.ts';
export { parseScenario, type Directive, type ScenarioItem } from './core/scenario.ts';
export { PERSONAS } from './core/session.ts';
export { contract, findOperation, operation } from './contract/index.ts';
