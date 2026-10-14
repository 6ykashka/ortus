// Сеть и консоль контекста: внешние хосты блокируются (эталон и mock-режим работают офлайн),
// запросы, ошибки консоли и страницы копятся для утверждений.
import type { BrowserContext } from '@playwright/test';

export interface Net {
  /** Заблокированные запросы к хостам вне allowlist. */
  external(): string[];
  /** Все запросы контекста. */
  requests(): string[];
  /** Хосты (host:port) всех запросов. */
  hosts(): Set<string>;
  /** console.error страниц контекста. */
  consoleErrors(): string[];
  /** Необработанные исключения страниц. */
  pageErrors(): string[];
}

const PASS_SCHEMES = new Set(['data:', 'blob:', 'about:']);

/** Подключает сбор и блокировку к контексту до создания страниц. */
export async function createNet(
  context: BrowserContext,
  allowHosts: readonly string[],
): Promise<Net> {
  const allow = new Set(allowHosts);
  const external: string[] = [];
  const requests: string[] = [];
  const hosts = new Set<string>();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (PASS_SCHEMES.has(url.protocol) || allow.has(url.host)) return route.continue();
    external.push(url.href);
    return route.abort('blockedbyclient');
  });
  context.on('request', (req) => {
    requests.push(req.url());
    const url = new URL(req.url());
    if (!PASS_SCHEMES.has(url.protocol)) hosts.add(url.host);
  });
  context.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  context.on('weberror', (err) => pageErrors.push(err.error().message));

  return {
    external: () => [...external],
    requests: () => [...requests],
    hosts: () => new Set(hosts),
    consoleErrors: () => [...consoleErrors],
    pageErrors: () => [...pageErrors],
  };
}
