// Кейс conformance (W0.13, B §5.3 P4): файл кейсов на модуль `cases/<модуль>.ts`, общий раннер
// `runner.test.ts`, проверка покрытия `coverage.test.ts`. Кейс не знает цели: режим `mock` — msw/node,
// режим `stand` (W1.x) подставит свой `Target`.
import type { ScenarioServer } from '../../src/msw/server.ts';
import type { Client, Reply, Session } from './client.ts';

export interface CaseContext {
  api: Client;
  as(persona: string): Promise<Session>;
  anon(): Session;
  /** Управление сервером режима mock (часы, пресеты, состояние). На стенде — нет. */
  server: ScenarioServer;
  /** UUID сида: `P('t-alta')` — область platform, `A('m-kotova')` — «Альта», `L('m-owner')` — «Лотос». */
  P(id: string): string;
  A(id: string): string;
  L(id: string): string;
  /** `/api/v1/tenants/<uuid «Альты»>` и `/api/v1/tenants/<uuid «Лотоса»>`. */
  alta: string;
  lotos: string;
  /** Тело примера `operationId/имя`. */
  example(name: string): unknown;
  /** Ответ совпадает с примером (с учётом deviations.ts) и его статусом. */
  expectExample(reply: Reply, name: string, status?: number): void;
  /** Ответ — Problem с кодом `code` (и статусом реестра). */
  expectProblem(reply: Reply, code: string): void;
}

export interface ConformanceCase {
  /** Уникальный id: `<модуль>/<операция>/<что>`. */
  id: string;
  title: string;
  module: string;
  operationId: string;
  /** Что кейс доказывает про операцию: успешный ответ или ошибку. */
  expect: 'success' | 'error';
  /** Пример контракта, который кейс воспроизводит (`operationId/имя`). */
  example?: string;
  run(ctx: CaseContext): Promise<void>;
}

/** Помощник объявления кейсов модуля. */
export const cases =
  (module: string) =>
  (list: Omit<ConformanceCase, 'module' | 'id'>[]): ConformanceCase[] =>
    list.map((c) => ({
      ...c,
      module,
      id: `${module}/${c.operationId}/${c.example?.split('/')[1] ?? c.title}`,
    }));
