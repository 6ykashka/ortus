// W1.20 · Оболочка приложения (эталон design-stage-1 «Ортус CRM.dc.html» :28–203, :2165–2291; 01-shell.md):
// фрейм, шапка, меню (боковая панель / рейл / нижняя навигация и лист «Все разделы»), баннеры, AccessGate или
// страница, тост. Данные — GET /me/context (меню и гейты по манифестам @ortus/domain/nav, D-23).
import { type MeContext, type TenantContext, unwrap } from '@ortus/api-client';
import { initials } from '@ortus/domain';
import {
  type Area,
  buildNav,
  moduleBanner,
  type NavItem,
  navContext,
  type PageKey,
  pageAccess,
  pageLabel,
  PAGES,
} from '@ortus/domain/nav';
import { company, format, shell } from '@ortus/texts';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useApi } from '../app/api.tsx';
import { PageSlot } from '../app/pages.tsx';
import { useStoredQueueStatus } from '../pwa/status.ts';
import { clearDeviceData } from '../pwa/store.ts';
import { AccessGate } from './AccessGate.tsx';
import { Banners, OfflineBootBanner } from './Banners.tsx';
import { applyBrand, brandHeader, brandNav } from './brand.ts';
import { ShellContext, type ShellValue } from './context.tsx';
import { Header, type Popover, ProfilePopover } from './Header.tsx';
import { InboxButton, InboxPopover, useUnreadCount } from './inbox.tsx';
import { navLabel } from './labels.ts';
import { activeTenants, ME_CONTEXT_KEY } from './me.ts';
import { BottomNav, MoreSheet, Sidebar } from './Nav.tsx';
import { pageTarget } from './paths.ts';
import { hasOrgRoles } from './profile.ts';
import { useOnline } from './online.ts';
import { useBusy, useRun } from './run.tsx';
import { ALL_UNITS, useScopeView, useTenantScope } from './scope.ts';
import { BootSkeleton, LoadError, NotFound } from './states.tsx';
import { SHELL_TEXT } from './texts.ts';
import { ToastHost } from './toast.tsx';

/** Каркас фрейма: skip-link (PD-29), шапка, тело с меню и основной областью, нижняя навигация, оверлеи. */
export function Frame({
  header,
  sidebar,
  bottom,
  overlay,
  audience,
  children,
}: {
  header: ReactNode;
  sidebar?: ReactNode;
  bottom?: ReactNode;
  overlay?: ReactNode;
  audience?: string;
  children: ReactNode;
}): ReactElement {
  const main = useRef<HTMLElement>(null);
  return (
    <div className="ox-app">
      <a
        className="ox-skip"
        href="#ox-main"
        data-a11y-extra="PD-29"
        onClick={(e) => {
          e.preventDefault();
          main.current?.focus();
        }}
      >
        {SHELL_TEXT.skipLink}
      </a>
      <div className="ox-viewport">
        <div className="ox-frame">
          {header}
          <div className="ox-body">
            {sidebar}
            <main id="ox-main" ref={main} tabIndex={-1} className="ox-main">
              <div className="ox-main-inner" data-audience={audience}>
                {children}
              </div>
            </main>
          </div>
          {bottom}
          {overlay}
          <ToastHost />
        </div>
      </div>
    </div>
  );
}

/**
 * Кадр до ответа /me/context (VM :2821–2823): шапка без знака — «Ортус», «Загрузка…», без колокольчика; меню
 * без пунктов с подписью «Данные других организаций изолированы» (:149–170); пустая нижняя навигация (:2165).
 * W2.24 (возврат 2): без связи запрос /me/context ждёт связи — в шапке «Нет связи», над скелетоном баннер «Нет
 * связи.» с числом ожидающих на устройстве; связь появилась — запрос уходит сам.
 */
export function BootFrame({
  error,
  offline = false,
  tenantId = null,
}: {
  error?: string;
  offline?: boolean;
  tenantId?: string | null;
}): ReactElement {
  return (
    <Frame
      header={
        <Header
          chrome="light"
          brand={false}
          sub={shell.header.business}
          title={SHELL_TEXT.bootTenant}
          scope={{ kind: 'text', text: SHELL_TEXT.bootScope }}
          scopeValue={ALL_UNITS}
          onScope={() => undefined}
          tenants={[]}
          currentTenantId={null}
          onSelectTenant={() => undefined}
          online={!offline}
          initials=""
          popover={null}
          setPopover={() => undefined}
          profile={null}
        />
      }
      sidebar={
        <Sidebar groups={[]} page={null} onGo={() => undefined} note={shell.nav.sideNote.tenant} />
      }
      bottom={<nav className="ox-bottom" aria-label={shell.a11y.bottomNav} />}
    >
      {offline ? <OfflineBootBanner tenantId={tenantId} /> : null}
      {error === undefined ? <BootSkeleton /> : <LoadError text={error} />}
    </Frame>
  );
}

export interface AppShellProps {
  me: MeContext;
  area: Area;
  tenant: TenantContext | null;
  /** Страница маршрута; `null` — неизвестный сегмент (404 внутри оболочки). */
  page: PageKey | null;
}

/** Выход ждёт очистки устройства не дольше, мс (W2.24, возврат 1). */
const CLEAR_WAIT_MS = 1500;

export function AppShell({ me, area, tenant, page }: AppShellProps): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const run = useRun();
  const loggingOut = useBusy('logout');
  const online = useOnline();
  const tenantId = tenant?.tenantId ?? null;
  const ctx = useMemo(
    () => navContext(area === 'tenant' ? tenant : null, me.platformOperator),
    [area, tenant, me.platformOperator],
  );
  // W4.62: оформление организации (TenantContext.branding) — меню, знак шапки и акцент; у оператора — Ортус.
  const theme = area === 'tenant' ? (tenant?.branding ?? null) : null;
  const groups = useMemo(() => brandNav(buildNav(ctx), theme), [ctx, theme]);
  const access = page ? pageAccess(ctx, page) : ({ kind: 'not_found' } as const);
  const readOnly = access.kind === 'allow' && access.readOnly;
  const owner = ctx.audience === 'owner';
  const operator = area === 'platform';

  const [popover, setPopover] = useState<Popover>(null);
  const [sheet, setSheet] = useState(false);
  const [scope, setScope] = useTenantScope(tenantId);
  const more = useRef<HTMLButtonElement>(null);
  const scopeView = useScopeView(ctx.audience, tenantId ?? undefined, ctx.capabilities);
  const unread = useUnreadCount(operator ? null : tenantId);
  // W2.24 (возврат 1): «(ожидают отправки: N)» после перезапуска на любой странице — из очереди на устройстве.
  useStoredQueueStatus(operator ? null : tenantId, me.userId);

  const accent = theme?.accentUsed ?? null;
  useEffect(() => applyBrand(accent), [accent]);
  // Переход закрывает поповеры и лист (setPage :2452–2455), основная область — к началу.
  const where = `${tenantId ?? ''}/${page ?? ''}`;
  const [shown, setShown] = useState(where);
  if (shown !== where) {
    setShown(where);
    setPopover(null);
    setSheet(false);
  }
  useEffect(() => {
    document.getElementById('ox-main')?.scrollTo?.({ top: 0 });
  }, [where]);

  const closeSheet = useCallback(() => {
    setSheet(false);
    more.current?.focus();
  }, []);

  // Escape закрывает лист или поповер и возвращает фокус на открывшую его кнопку (PD-29; в эталоне возврата нет):
  // у открытого поповера она одна в шапке с aria-expanded="true".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (sheet) {
        closeSheet();
        return;
      }
      if (!popover) return;
      const trigger = document.querySelector<HTMLElement>('.ox-header [aria-expanded="true"]');
      setPopover(null);
      trigger?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet, closeSheet, popover]);

  const go = useCallback(
    (key: PageKey) => void navigate(pageTarget(area, tenantId, key)),
    [navigate, area, tenantId],
  );
  const onGo = (it: NavItem) => go(it.key);

  const selectTenant = async (id: string) => {
    setPopover(null);
    if (id === tenantId) return;
    const next = await run('selectTenant', async () =>
      unwrap(
        await api.PUT('/api/v1/me/selected-tenant', {
          params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
          body: { tenantId: id },
        }),
      ),
    ).catch(() => null);
    if (!next) return;
    qc.setQueryData(ME_CONTEXT_KEY, next);
    const target = next.tenants.find((t) => t.tenantId === id);
    const start = target ? buildNav(navContext(target, next.platformOperator)) : [];
    const first = start[0]?.items[0]?.key ?? 'home';
    void navigate(pageTarget('tenant', id, first));
  };

  // Сбой выхода (нет связи, 5xx) — тост команды, страница и сессия остаются: иначе экран входа при живой
  // серверной сессии. После выхода — сначала уход на /auth/login; кэш запросов очищается, когда оболочка уже
  // размонтирована (W1.49): очистка при смонтированной оболочке перезапускает её запросы и получает 401.
  const signedOut = useRef(false);
  useEffect(
    () => () => {
      if (!signedOut.current) return;
      // Очистка — после всех очисток удаляемого дерева: наблюдатели запросов уже отписаны.
      queueMicrotask(() => {
        void qc.cancelQueries();
        qc.clear();
      });
    },
    [qc],
  );
  const logout = async () => {
    const ok = await run('logout', async () =>
      unwrap(
        await api.POST('/api/v1/auth/logout', {
          params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
        }),
      ),
    ).then(
      () => true,
      () => false,
    );
    if (!ok) return;
    // W2.24 (15-quality-security): очередь, черновики и фото этого пользователя удаляются с устройства — очередь в
    // памяти закрывается сразу, удаление ключей этого пользователя ждём до CLEAR_WAIT_MS (возврат 1: закрытое
    // сразу после выхода приложение не оставляет данные), дольше — дочищается в фоне.
    let wait: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      clearDeviceData(me.userId).catch(() => undefined),
      new Promise((r) => {
        wait = setTimeout(r, CLEAR_WAIT_MS);
      }),
    ]);
    clearTimeout(wait);
    signedOut.current = true;
    void navigate({ to: '/auth/login' });
  };

  const profileLines = operator
    ? [shell.popovers.operatorLines.tenants, shell.popovers.operatorLines.noData]
    : owner
      ? [
          format(shell.popovers.assignment, {
            role: SHELL_TEXT.ownerRole,
            scope: company.dialogs.assign.types.tenant,
          }),
        ]
      : hasOrgRoles(ctx.capabilities)
        ? []
        : [shell.popovers.noRoles];

  const value: ShellValue = {
    me,
    tenant,
    tenantId,
    page,
    audience: ctx.audience,
    nav: ctx,
    readOnly,
    scope,
    setScope,
    go,
  };

  let content: ReactNode;
  if (access.kind === 'deny') {
    content = <AccessGate access={access} onOpenModules={() => go('modules')} />;
  } else if (access.kind === 'allow' && page) {
    const label = PAGES.get(page)?.nav?.[ctx.audience]?.label ?? pageLabel(page);
    content = <PageSlot page={page} title={label ? navLabel(label) : page} />;
  } else {
    content = <NotFound />;
  }

  return (
    <ShellContext value={value}>
      <Frame
        audience={ctx.audience}
        header={
          <Header
            chrome={operator ? 'dark' : 'light'}
            mark={brandHeader(theme)}
            sub={operator ? shell.header.platform : shell.header.business}
            title={operator ? shell.header.platformTitle : (tenant?.name ?? '')}
            scope={scopeView}
            scopeValue={scope}
            onScope={setScope}
            tenants={operator ? [] : activeTenants(me)}
            currentTenantId={tenantId}
            onSelectTenant={(id) => void selectTenant(id)}
            online={online}
            initials={operator ? 'ОП' : initials(me.displayName)}
            popover={popover}
            setPopover={setPopover}
            inbox={
              operator || !tenantId
                ? undefined
                : {
                    button: (
                      <InboxButton
                        count={unread}
                        open={popover === 'notifications'}
                        onToggle={() =>
                          setPopover(popover === 'notifications' ? null : 'notifications')
                        }
                      />
                    ),
                    panel: (
                      <InboxPopover
                        tenantId={tenantId}
                        unreadCount={unread}
                        onClose={() => setPopover(null)}
                      />
                    ),
                  }
            }
            profile={
              <ProfilePopover
                name={me.displayName}
                title={operator ? shell.demo.personas.operator : (tenant?.name ?? '')}
                linesTitle={operator ? shell.popovers.rights : shell.popovers.assignments}
                lines={profileLines}
                onLogout={() => void logout()}
                busy={loggingOut}
              />
            }
          />
        }
        sidebar={
          <Sidebar
            groups={groups}
            page={page}
            onGo={onGo}
            note={operator ? shell.nav.sideNote.operator : shell.nav.sideNote.tenant}
          />
        }
        bottom={
          <BottomNav
            groups={groups}
            page={page}
            onGo={onGo}
            sheetOpen={sheet}
            onMore={() => setSheet(true)}
            moreRef={more}
          />
        }
        overlay={
          sheet ? (
            <MoreSheet
              groups={groups}
              page={page}
              onGo={(it) => {
                setSheet(false);
                onGo(it);
              }}
              onClose={closeSheet}
            />
          ) : null
        }
      >
        {operator || !tenantId ? null : (
          <Banners
            tenantId={tenantId}
            page={page}
            owner={owner}
            online={online}
            tenantReadOnly={ctx.tenantReadOnly}
            storageBlocked={ctx.storageBlocked}
            readonlyModule={page ? moduleBanner(ctx, page) : null}
            goModules={() => go('modules')}
          />
        )}
        {content}
      </Frame>
    </ShellContext>
  );
}
