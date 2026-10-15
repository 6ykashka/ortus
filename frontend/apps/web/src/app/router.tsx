// Роутер каркаса (TanStack Router, маршруты в коде; схема — ADR-0001). Маршруты страниц добавляют их WS.
import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';

import { ContextPage } from './ContextPage.tsx';
import { LoginPage } from './LoginPage.tsx';

const rootRoute = createRootRoute({ component: Outlet });
const contextRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: ContextPage,
});
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/login',
  component: LoginPage,
});

const routeTree = rootRoute.addChildren([contextRoute, loginRoute]);

/** Роутер приложения; initialUrl — память вместо адресной строки (тесты). */
export function createAppRouter(initialUrl?: string) {
  const history = initialUrl
    ? createMemoryHistory({ initialEntries: [initialUrl] })
    : createBrowserHistory();
  return createRouter({ routeTree, history });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
