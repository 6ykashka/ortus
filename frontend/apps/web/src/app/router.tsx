// Роутер приложения (TanStack Router, маршруты в коде; URL-схема ADR-0001, W1.20):
//   /                    — старт: стартовая страница организации по умолчанию или «Организации» оператора;
//   /t/$tenantId/$page   — оболочка организации, страница из реестра (`src/app/pages.tsx`);
//   /platform/$page      — оболочка оператора;
//   /auth/login          — вход (W1.22, src/routes/auth/LoginPage.tsx);
//   /auth/invitation     — принятие приглашения по ссылке письма #token= (W1.22, Q-W1.41-3).
// Неизвестный маршрут и неизвестная страница — «Страница не найдена» (404).
import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
} from '@tanstack/react-router';

import { IndexScreen, ShellScreen } from '../shell/ShellScreen.tsx';
import { GlobalNotFound } from '../shell/states.tsx';

const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: GlobalNotFound });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexScreen,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/login',
  component: lazyRouteComponent(() => import('../routes/auth/LoginPage.tsx')),
});

const invitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/invitation',
  component: lazyRouteComponent(() => import('../routes/auth/InvitationPage.tsx')),
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
  invitationRoute,
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
