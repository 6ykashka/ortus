import type { ApiClient } from '@ortus/api-client';
import { createContext, use } from 'react';

const ApiContext = createContext<ApiClient | null>(null);

export const ApiProvider = ApiContext.Provider;

/** Клиент API приложения (в тестах — клиент на тестовый сервер). */
export function useApi(): ApiClient {
  const api = use(ApiContext);
  if (!api) throw new Error('useApi: нет ApiProvider');
  return api;
}
