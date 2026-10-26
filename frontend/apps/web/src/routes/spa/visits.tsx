// W5.21 · Вкладка «Визиты» (эталон pg.spa :1870–1900, spaVM :4242–4262): баннер «Учёт материалов не завершён» с решением
// владельца, карточки визитов дня (время, услуга и длительность, статус, клиент · кабинет · оборудование, буферы,
// техкарта), «Завершить процедуру», «Перенести», «Отменить визит», «Записать клиента», остатки кабинета. Клиент —
// из названия брони календаря (Q-W5.21-1); услуги и остатки видны ролям с правами `spa.services.read` и склада.
import { type components, ProblemError } from '@ortus/api-client';
import { format, shell } from '@ortus/texts';
import { Button, EmptyState, Icon, Select, Skeleton, Status } from '@ortus/ui';
import { type ReactElement, useMemo, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import { useBusy, useRun } from '../../shell/run.tsx';
import { useToast } from '../../shell/toast.tsx';
import { LoadFailed } from '../company/modules/ui.tsx';
import { addDays, clock, dateTitle, localDate } from '../core/calendar/time.ts';
import {
  completeVisit,
  firstWarehouse,
  idemKeys,
  recordPerformance,
  useBalances,
  usePending,
} from './api.ts';
import type { SpaCtx } from './ctx.ts';
import { CancelDialog, VisitDialog } from './dialogs.tsx';
import {
  buffersText,
  chipOf,
  clientOf,
  durationText,
  moneyText,
  overridesOf,
  qtyText,
  recipeChips,
  type Resolve,
  shortages,
  shortageText,
  type Status as VisitStatus,
  unitLabel,
} from './model.ts';
import { SPA_TEXT as T } from './texts.ts';

type S = components['schemas'];
type Visit = S['Appointment'];

type Filter = 'all' | 'confirmed' | 'pending' | 'completed' | 'closed';

const FILTER_STATUS: Record<Filter, readonly VisitStatus[]> = {
  all: ['confirmed', 'performed_pending_posting', 'completed', 'cancelled', 'no_show'],
  confirmed: ['confirmed'],
  pending: ['performed_pending_posting'],
  completed: ['completed'],
  closed: ['cancelled', 'no_show'],
};

/** Порог «мало» в «Остатках кабинета» эталона (spaVM :4261: `x.qty < 20`). */
const LOW = 20;

const startOf = (v: Visit): number => Date.parse(v.window.startsAt);

/** Остаток позиции по всем складам (доступно). */
function haveOf(balances: readonly S['InventoryBalance'][]): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of balances) out.set(b.itemId, (out.get(b.itemId) ?? 0) + Number(b.available));
  return out;
}

/** Общий вид «Услуга · Клиент» визита: имя услуги и клиент (из брони, затем из справочников). */
function labelsOf(ctx: SpaCtx, v: Visit): { service: string; client: string } {
  const svc = ctx.services?.find((s) => s.id === v.serviceId);
  const title = ctx.titles.get(v.bookingId);
  const head = title?.split(' · ')[0];
  const service = svc?.name ?? head ?? T.visit.unknownService;
  return { service, client: clientOf(title, service) };
}

// ───────────────────────────── баннер «Учёт не завершён» ─────────────────────────────

function Issue(p: {
  ctx: SpaCtx;
  visit: Visit;
  names: ReadonlyMap<string, string>;
  have: ReadonlyMap<string, number> | null;
  onChanged: () => Promise<unknown>;
}): ReactElement {
  const { ctx, visit } = p;
  const api = useApi();
  const run = useRun();
  const busy = useBusy('spa');
  const [keys] = useState(idemKeys);
  const { service, client } = labelsOf(ctx, visit);
  const svc = ctx.services?.find((s) => s.id === visit.serviceId);
  const list = svc && p.have ? shortages(svc.recipe, p.have) : null;
  const text = list?.length
    ? shortageText(list, p.names, service, client)
    : `${service} (${client})`;

  const resolve = async (how: Resolve): Promise<void> => {
    const warehouseId = await firstWarehouse(api, ctx.tenantId).catch(() => null);
    if (!warehouseId) return;
    const body: S['AppointmentComplete'] = {
      warehouseId,
      overrides: overridesOf(list ?? [], how),
    };
    try {
      await run(
        'spa',
        () =>
          completeVisit({ api, tenantId: ctx.tenantId, seen: visit, body, key: keys.key(body) }),
        T.resolve[how].done,
      );
      keys.settle(body);
    } catch {
      // Тост показал `run`; ключ отработан только при определённом ответе — повтор с тем же телом узнает сервер.
    }
    await p.onChanged();
  };

  const canResolve = ctx.can.complete && (list?.length ? ctx.can.override : true);
  return (
    <div role="alert" className="ox-spa-issue">
      <Icon name="inventory" size={20} />
      <span className="ox-spa-issue-text">
        <strong>{T.banner.title}</strong> {text}
      </span>
      {canResolve && list ? (
        <div className="ox-spa-issue-actions">
          {list.length ? (
            (['reserve', 'actual'] as const).map((how) => (
              <button
                key={how}
                type="button"
                className="ox-spa-issue-btn"
                disabled={busy}
                onClick={() => void resolve(how)}
              >
                {T.resolve[how].label}
              </button>
            ))
          ) : (
            <button
              type="button"
              className="ox-spa-issue-btn"
              disabled={busy}
              onClick={() => void resolve('reserve')}
            >
              {T.banner.retry}
            </button>
          )}
        </div>
      ) : (
        <span className="ox-spa-issue-wait">{T.banner.waits}</span>
      )}
    </div>
  );
}

// ───────────────────────────── карточка визита ─────────────────────────────

function Card(p: {
  ctx: SpaCtx;
  visit: Visit;
  names: ReadonlyMap<string, string>;
  have: ReadonlyMap<string, number> | null;
  onMove: (v: Visit) => void;
  onCancel: (v: Visit) => void;
  onChanged: () => Promise<unknown>;
}): ReactElement {
  const { ctx, visit: v } = p;
  const api = useApi();
  const run = useRun();
  const toast = useToast();
  const busy = useBusy('spa');
  const [keys] = useState(idemKeys);
  const svc = ctx.services?.find((s) => s.id === v.serviceId);
  const booking = ctx.bookings.get(v.bookingId);
  const { service, client } = labelsOf(ctx, v);
  const from = startOf(v);
  const to = Date.parse(v.window.endsAt);
  const chip = chipOf(v.status);
  const room = ctx.resources.find((r) => r.id === v.roomId)?.name ?? T.visit.roomFallback;
  const equipment =
    v.equipmentIds
      .map((id) => ctx.resources.find((r) => r.id === id)?.name)
      .filter((x): x is string => !!x)
      .join(', ') || T.noEquipment;
  const before = booking?.prepMinutes ?? svc?.bufferBeforeMinutes ?? 0;
  const after = booking?.cleanupMinutes ?? svc?.bufferAfterMinutes ?? 0;
  const lines = svc
    ? recipeChips(svc.recipe, p.names).map((text, i) => {
        const line = svc.recipe[i];
        const have = line ? p.have?.get(line.itemId) : undefined;
        const lack =
          v.status === 'confirmed' && have !== undefined && line && have < Number(line.quantity);
        return {
          text: lack && line ? `${text} · ${T.have} ${qtyText(have)}` : text,
          lack: !!lack,
          unit: line ? unitLabel(line.unit) : '',
        };
      })
    : [];

  const finish = async (): Promise<void> => {
    const perfBody: S['AppointmentPerformance'] = {
      performedAt: new Date(Math.max(Date.now(), 0)).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    try {
      const result = await run(
        'spa',
        async (): Promise<'completed' | 'shortage' | 'performed'> => {
          const done = await recordPerformance({
            api,
            tenantId: ctx.tenantId,
            seen: v,
            body: perfBody,
            key: keys.key(perfBody),
          });
          if (!ctx.can.complete) return 'performed';
          const warehouseId = await firstWarehouse(api, ctx.tenantId).catch(() => null);
          if (!warehouseId) return 'performed';
          const body: S['AppointmentComplete'] = { warehouseId, overrides: [] };
          try {
            await completeVisit({
              api,
              tenantId: ctx.tenantId,
              seen: done,
              body,
              key: keys.key(body),
            });
            return 'completed';
          } catch (e) {
            if (e instanceof ProblemError && e.problem?.reason === 'insufficient_stock')
              return 'shortage';
            throw e;
          }
        },
        null,
      );
      keys.settle(perfBody);
      if (result === 'completed') toast(T.done.completed, 'ok');
      else if (result === 'shortage') toast(T.done.shortage, 'warn');
      else toast(T.done.performed, 'warn');
    } catch {
      // Тост ошибки показал `run`.
    }
    await p.onChanged();
  };

  return (
    <article className="ox-spa-card" data-status={v.status} aria-label={`${service}, ${client}`}>
      <span className="ox-spa-time">{clock(from, ctx.tz)}</span>
      <div className="ox-spa-body">
        <div className="ox-spa-row">
          <strong>
            {service} · {durationText(Math.round((to - from) / 60_000))}
          </strong>
          <Status tone={chip.tone} icon={chip.icon}>
            {chip.label}
          </Status>
        </div>
        <span className="ox-spa-meta">
          {client} · {room} · {equipment}
        </span>
        <span className="ox-spa-sub">{buffersText(before, after)}</span>
        {lines.length ? (
          <div className="ox-spa-chips">
            {lines.map((l) => (
              <span key={l.text} className="ox-spa-chip" data-lack={l.lack ? '' : undefined}>
                {l.text}
              </span>
            ))}
          </div>
        ) : null}
        {v.finalPrice ? (
          <span className="ox-spa-sub">
            {format(T.visit.price, { price: moneyText(v.finalPrice) })}
          </span>
        ) : null}
        {v.status === 'confirmed' && (ctx.can.perform || ctx.can.create) ? (
          <div className="ox-spa-actions">
            {ctx.can.perform ? (
              <Button
                icon="task_alt"
                disabled={busy}
                aria-label={`${T.actions.complete}: ${service}, ${client}`}
                onPress={() => void finish()}
              >
                {T.actions.complete}
              </Button>
            ) : null}
            {ctx.can.create ? (
              <>
                <Button
                  variant="secondary"
                  icon="edit_calendar"
                  aria-label={`${T.actions.reschedule}: ${service}, ${client}`}
                  onPress={() => p.onMove(v)}
                >
                  {T.actions.reschedule}
                </Button>
                <Button
                  variant="secondary"
                  icon="event_busy"
                  aria-label={`${T.actions.cancel}: ${service}, ${client}`}
                  onPress={() => p.onCancel(v)}
                >
                  {T.actions.cancel}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

// ───────────────────────────── вкладка ─────────────────────────────

export function VisitsTab(p: {
  ctx: SpaCtx;
  date: string;
  /** Визиты недели (запрос страницы). */
  visits: readonly Visit[];
  status: 'pending' | 'error' | 'success';
  error: unknown;
  onRetry: () => void;
  onDate: (date: string) => void;
}): ReactElement {
  const { ctx } = p;
  const [filter, setFilter] = useState<Filter>('all');
  const [move, setMove] = useState<Visit | null>(null);
  const [cancel, setCancel] = useState<Visit | null>(null);
  const [adding, setAdding] = useState(false);
  const pending = usePending(ctx.tenantId);
  const wantBalances = ctx.items !== null;
  const balances = useBalances(ctx.tenantId, wantBalances);
  const names = useMemo(() => new Map((ctx.items ?? []).map((i) => [i.id, i.name])), [ctx.items]);
  const have = useMemo(
    () => (wantBalances && balances.isSuccess ? haveOf(balances.data) : null),
    [wantBalances, balances.isSuccess, balances.data],
  );
  const today = localDate(ctx.now, ctx.tz);
  const day = useMemo(
    () =>
      p.visits
        .filter((v) => localDate(startOf(v), ctx.tz) === p.date)
        .sort((a, b) => startOf(a) - startOf(b)),
    [p.visits, p.date, ctx.tz],
  );
  const shown = day.filter((v) => FILTER_STATUS[filter].includes(v.status));
  const onChanged = ctx.refresh;

  const F = T.filter;
  const filterOptions = (['all', 'confirmed', 'pending', 'completed', 'closed'] as const).map(
    (k) => ({
      value: k,
      label: F[k],
    }),
  );

  let body: ReactElement;
  if (p.status === 'pending') {
    body = <Skeleton lines={4} label={shell.a11y.loading} />;
  } else if (p.status === 'error') {
    body = <LoadFailed error={p.error} onRetry={p.onRetry} />;
  } else if (!day.length) {
    body = <EmptyState icon="event_available" title={T.empty.day} text={T.empty.dayText} dashed />;
  } else if (!shown.length) {
    body = <EmptyState icon="filter_alt_off" title={T.empty.filtered} dashed />;
  } else {
    body = (
      <>
        {shown.map((v) => (
          <Card
            key={v.id}
            ctx={ctx}
            visit={v}
            names={names}
            have={have}
            onMove={setMove}
            onCancel={setCancel}
            onChanged={onChanged}
          />
        ))}
      </>
    );
  }

  return (
    <div className="ox-spa-visits">
      {(pending.data ?? []).map((v) => (
        <Issue key={v.id} ctx={ctx} visit={v} names={names} have={have} onChanged={onChanged} />
      ))}
      <div className="ox-spa-bar">
        <div role="group" aria-label={T.period.aria} className="ox-spa-days">
          <button
            type="button"
            className="ox-spa-pill"
            data-icon=""
            aria-label={T.period.prev}
            onClick={() => p.onDate(addDays(p.date, -1))}
          >
            <Icon name="chevron_left" size={20} />
          </button>
          <button
            type="button"
            className="ox-spa-pill"
            aria-pressed={p.date === today}
            onClick={() => p.onDate(today)}
          >
            {T.period.today}
          </button>
          <button
            type="button"
            className="ox-spa-pill"
            data-icon=""
            aria-label={T.period.next}
            onClick={() => p.onDate(addDays(p.date, 1))}
          >
            <Icon name="chevron_right" size={20} />
          </button>
          <span className="ox-spa-date">{dateTitle(p.date)}</span>
        </div>
        <div className="ox-spa-tools">
          <div className="ox-spa-filter">
            <Select
              aria-label={F.label}
              value={filter}
              options={filterOptions}
              onChange={(v) => setFilter(v)}
            />
          </div>
          {ctx.can.create && ctx.services ? (
            <Button icon="add" onPress={() => setAdding(true)}>
              {T.actions.add}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="ox-spa-layout">
        <div className="ox-spa-list">{body}</div>
        {have && ctx.items ? (
          <aside className="ox-spa-aside" aria-label={T.stock.title}>
            <h2 className="ox-spa-h2">{T.stock.title}</h2>
            {ctx.items.map((i) => {
              const q = have.get(i.id) ?? 0;
              return (
                <div key={i.id} className="ox-spa-stock">
                  <span>{i.name}</span>
                  <strong data-low={q < LOW ? '' : undefined}>
                    {qtyText(q)} {unitLabel(i.baseUnit)}
                  </strong>
                </div>
              );
            })}
          </aside>
        ) : null}
      </div>
      {adding ? (
        <VisitDialog ctx={ctx} date={p.date} visits={p.visits} onClose={() => setAdding(false)} />
      ) : null}
      {move ? (
        <VisitDialog
          ctx={ctx}
          visit={move}
          date={localDate(startOf(move), ctx.tz)}
          visits={p.visits}
          onClose={() => setMove(null)}
        />
      ) : null}
      {cancel ? <CancelDialog ctx={ctx} visit={cancel} onClose={() => setCancel(null)} /> : null}
    </div>
  );
}
