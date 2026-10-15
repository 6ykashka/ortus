// Сценарный сервер в Node (W0.13): msw/node для conformance, тестов экранов и скриптов (снимки примеров).
import { setupServer, type SetupServer } from 'msw/node';

import { createScenarioServer, type ScenarioServer, type ScenarioServerOptions } from './server.ts';

export function createNodeServer(o: ScenarioServerOptions = {}): {
  server: SetupServer;
  scenario: ScenarioServer;
} {
  const scenario = createScenarioServer(o);
  return { server: setupServer(...scenario.handlers), scenario };
}
