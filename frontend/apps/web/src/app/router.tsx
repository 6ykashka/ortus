// Роутер приложения (TanStack Router, маршруты в коде; URL-схема ADR-0001, W1.20):
//   /                    — старт: стартовая страница организации по умолчанию или «Организации» оператора;
//   /t/$tenantId/$page   — оболочка организации, страница из реестра (`src/app/pages.tsx`);
//   /platform/$page      — оболочка оператора;
//   /auth/login          — вход (заглушка до W1.22).
// Неизвестный маршрут и неизвестная страница — «Страница не найдена» (404).
import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';

import { IndexScreen, ShellScreen } from '../shell/ShellScreen.tsx';
import { GlobalNotFound } from '../shell/states.tsx';
import { LoginPage } from './LoginPage.tsx';

const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: GlobalNotFound });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexScreen,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/login',
  component: LoginPage,
});

const tenantRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/t/$tenantId',
  component: function TenantStart() {
    const { tenantId } = tenantRoute.useParams();
    return <ShellScreen area="tenant" tenantId={tenantId} />;
  },
});

export const tenantPageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/t/$tenantId/$page',
  component: function TenantPage() {
    const { tenantId, page } = tenantPageRoute.useParams();
    return <ShellScreen area="tenant" tenantId={tenantId} segment={page} />;
  },
});

const platformRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/platform',
  component: function PlatformStart() {
    return <ShellScreen area="platform" />;
  },
});

export const platformPageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/platform/$page',
  component: function PlatformPage() {
    const { page } = platformPageRoute.useParams();
    return <ShellScreen area="platform" segment={page} />;
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  tenantRoute,
  tenantPageRoute,
  platformRoute,
  platformPageRoute,
]);

/** Роутер приложения; initialUrl — память вместо адресной строки (тесты). */
export function createAppRouter(initialUrl?: string) {
  const history = initialUrl
    ? createMemoryHistory({ initialEntries: [initialUrl] })
    : createBrowserHistory();
  return createRouter({ routeTree, history });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
