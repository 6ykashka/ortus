// W2.24 · Регистрация service worker приложения (S2-15). Только production-сборка без MSW: в режиме mock область `/`
// занимает /mockServiceWorker.js сценарного сервера (W0.13), в dev модули Vite не кэшируются. Подключается из
// main.tsx после рендера (точка интегратора). Ошибка регистрации не мешает работе приложения онлайн.
import { SW_PATH } from './manifest.ts';

export interface PwaEnv {
  PROD: boolean;
  VITE_ADAPTER?: string;
}

export function shouldRegister(env: PwaEnv): boolean {
  return env.PROD && env.VITE_ADAPTER !== 'mock';
}

/** Регистрирует /sw.js (область `/`); без поддержки service worker или вне сборки — `null`. */
export async function registerServiceWorker(
  env: PwaEnv,
  container: ServiceWorkerContainer | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator.serviceWorker,
): Promise<ServiceWorkerRegistration | null> {
  if (!shouldRegister(env) || !container) return null;
  try {
    return await container.register(SW_PATH, { scope: '/' });
  } catch {
    return null;
  }
}
