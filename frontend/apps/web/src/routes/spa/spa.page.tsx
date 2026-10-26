// W5.21 · Страница «Салон и SPA» (ключи `spa-appointments`, `spa-services`; маршрут `/t/:tenantId/spa`; эталон
// design-2026-10-19 «Ортус CRM.dc.html» pg.spa :1870–1900, spaVM :4242–4262; no-reference B-6 для записи, переноса,
// отмены и услуг). У владельца и офиса — «Салон и SPA», у специалиста (область «своё») — «Мой день». Вкладка «Визиты»
// — день `?date=`, вкладка «Услуги и техкарты» — `?tab=services` (только с `spa.services.read`). Права и область —
// на сервере: визиты специалиста — только свои; кнопки скрыты по ключам прав из /me/context.
import { format } from '@ortus/texts';
import { Tabs } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { type ReactElement, useState } from 'react';

import { AccessGate } from '../../shell/AccessGate.tsx';
import { useCan, useShell } from '../../shell/context.tsx';
import { problemCode } from '../../shell/run.tsx';
import {
  addDays,
  dateTitle,
  dayStart,
  isIsoDate,
  localDate,
  mondayOf,
} from '../core/calendar/time.ts';
import {
  calendarKey,
  inventoryKey,
  spaKey,
  useBookings,
  useItems,
  useResources,
  useServices,
  useVisits,
} from './api.ts';
import type { SpaCtx } from './ctx.ts';
import { ServicesTab } from './services.tsx';
import { SPA_TEXT as T } from './texts.ts';
import { VisitsTab } from './visits.tsx';
import '../company/modules/modules.css';
import './spa.css';

/** Пояс по умолчанию — пояс организаций сида («Москва (UTC+3)»). */
const MSK = 'Europe/Moscow';

const NO_PERMISSION = {
  kind: 'deny',
  reason: 'no_permission',
  branch: 'A',
  chip: 'noPermission',
  title: 'noRole',
  domainModule: 'spa',
  label: null,
  owner: false,
} as const;

interface SpaSearch {
  tab?: 'services';
  date?: string;
}

const searchOf = (raw: Record<string, unknown>): SpaSearch => ({
  ...(raw.tab === 'services' ? { tab: 'services' as const } : {}),
  ...(isIsoDate(raw.date) ? { date: raw.date } : {}),
});

export default function SpaPage(): ReactElement {
  const { tenantId: id, audience, tenant, me } = useShell();
  const tenantId = id ?? '';
  const can = useCan();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const search = searchOf(location.search as Record<string, unknown>);
  const [now] = useState(() => Date.now());

  const resources = useResources(tenantId);
  const tz = resources.data?.[0]?.timeZone ?? MSK;
  const date = search.date ?? localDate(now, tz);
  const first = mondayOf(date);
  const win = { from: dayStart(first, tz), to: dayStart(addDays(first, 7), tz) };
  const visits = useVisits(tenantId, win);
  const bookings = useBookings(tenantId, win);
  const services = useServices(tenantId);
  const items = useItems(tenantId);
  // Названия броней копятся: отменённая бронь исчезает из календаря, клиент визита остаётся на экране.
  const [seen, setSeen] = useState<ReadonlyMap<string, string>>(() => new Map());
  const fresh = (bookings.data ?? []).filter((b) => seen.get(b.id) !== b.title);
  if (fresh.length)
    setSeen(new Map([...seen, ...fresh.map((b): [string, string] => [b.id, b.title])]));

  const caps = {
    create: can('spa.appointments.create'),
    perform: can('spa.appointments.perform'),
    complete: can('spa.appointments.complete') && can('inventory.consume'),
    override: can('inventory.consumption.override'),
    servicesRead: can('spa.services.read'),
    servicesManage: can('spa.services.manage'),
  };

  const refresh = (): Promise<unknown> =>
    Promise.all([
      qc.invalidateQueries({ queryKey: [...spaKey(tenantId)] }),
      qc.invalidateQueries({ queryKey: [...calendarKey(tenantId)] }),
      qc.invalidateQueries({ queryKey: [...inventoryKey(tenantId)] }),
    ]);

  const ctx: SpaCtx = {
    tenantId,
    tz,
    now,
    can: caps,
    services: services.data ?? null,
    resources: resources.data ?? [],
    items: items.data ?? null,
    bookings: new Map((bookings.data ?? []).map((b) => [b.id, b])),
    titles: seen,
    refresh,
  };
  if (visits.isError && problemCode(visits.error) === 'forbidden_action') {
    return <AccessGate access={NO_PERMISSION} />;
  }

  const go = (patch: Partial<SpaSearch>, replace = false): void => {
    const next = { ...search, ...patch };
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
    void navigate({
      to: '/t/$tenantId/$page',
      params: { tenantId, page: 'spa' },
      search: clean as never,
      replace,
    });
  };

  const practitioner = audience === 'practitioner';
  const tab = search.tab === 'services' && caps.servicesRead ? 'services' : 'visits';
  const crumb = practitioner
    ? format(T.crumbPractitioner, { name: me.displayName, date: dateTitle(date) })
    : format(T.crumbOwner, { org: tenant?.name ?? '' });

  const content =
    tab === 'services' ? (
      <ServicesTab
        ctx={ctx}
        status={services.status}
        error={services.error}
        onRetry={() => void services.refetch()}
      />
    ) : (
      <VisitsTab
        ctx={ctx}
        date={date}
        visits={visits.data ?? []}
        status={visits.status}
        error={visits.error}
        onRetry={() => void visits.refetch()}
        onDate={(d) => go({ date: d })}
      />
    );

  return (
    <section aria-labelledby="h-spa" className="ox-spa">
      <div className="ox-spa-head">
        <div className="ox-spa-crumb">{crumb}</div>
        <h1 id="h-spa" className="ox-spa-title" tabIndex={-1}>
          {practitioner ? T.title.practitioner : T.title.owner}
        </h1>
      </div>
      {caps.servicesRead ? (
        <Tabs
          aria-label={T.tabsAria}
          value={tab}
          onChange={(v) => go({ tab: v === 'services' ? 'services' : undefined })}
          items={[
            { id: 'visits', label: T.tabs.visits },
            { id: 'services', label: T.tabs.services },
          ]}
        >
          {content}
        </Tabs>
      ) : (
        content
      )}
    </section>
  );
}
