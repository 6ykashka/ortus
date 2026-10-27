// Роутер приложения (TanStack Router, маршруты в коде; URL-схема ADR-0001, W1.20):
//   /                    — старт: стартовая страница организации по умолчанию или «Организации» оператора;
//   /t/$tenantId/$page   — оболочка организации, страница из реестра (`src/app/pages.tsx`);
//   /platform/$page      — оболочка оператора;
//   /auth/login          — вход (W1.22, src/routes/auth/LoginPage.tsx);
//   /auth/invitation     — принятие приглашения по ссылке письма #token= (W1.22, Q-W1.41-3);
//   /forms/$formId       — заполнение формы сотрудником без оболочки (W4.70, Q-W4.00-forms-21);
//   /f/$token            — публичная форма гостя без сессии, `?embed=1` — встраивание (W4.70);
//   /s/$slug             — страница направления для клиента без сессии, `?w=` — токен работы (W7.33);
//   /r/$token            — обращение клиента по личной ссылке (W7.33).
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

const formFillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forms/$formId',
  component: lazyRouteComponent(() => import('../routes/core/forms/fill/FormFillScreen.tsx')),
});

const publicFormRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/f/$token',
  component: lazyRouteComponent(() => import('../routes/public-form/PublicFormScreen.tsx')),
});

// W6.23 · График объекта «Ремонта и стройки» страницей (вкладку карточки W6.20 встраивает `ScheduleTab`).
const repairScheduleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/t/$tenantId/repair/$projectId/schedule',
  component: lazyRouteComponent(() => import('../routes/repair/child/gantt/ScheduleScreen.tsx')),
});

const servicePageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/s/$slug',
  component: lazyRouteComponent(() => import('../routes/service-portal/PageScreen.tsx')),
});

const serviceRequestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/r/$token',
  component: lazyRouteComponent(() => import('../routes/service-portal/RequestScreen.tsx')),
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
  formFillRoute,
  publicFormRoute,
  repairScheduleRoute,
  servicePageRoute,
  serviceRequestRoute,
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
