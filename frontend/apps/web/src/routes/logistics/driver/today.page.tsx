// W2.22 · Страница «Сегодня» водителя (`driver-today`, h1 «Моя смена»; эталон pg.today :663–848, driverVM
// :3422–3531; S2-02…S2-09). Смена — свой рейс (listTripPlans → pickTrip); состояния рейса: бронь машины,
// осмотр перед выездом с пятью фото (сессии загрузки), выезд (submitInspection + startTrip, Q-W2.00-2),
// «Выезд заблокирован», маршрут и «Завершить рейс» (modal-finish-route), расходы, осмотр при сдаче и «Сдать
// машину» (submitInspection + returnTrip), доработка, ожидание приёмки, «Смена принята». Офлайн-очередь — W2.24.
import { ProblemError } from '@ortus/api-client';
import { format, logisticsDriver as L, shell as shellText, toast as toastText } from '@ortus/texts';
import { Banner, EmptyState, Icon, Skeleton } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, type ReactNode, useCallback, useRef, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useCan, useShell } from '../../../shell/context.tsx';
import { problemText, useBusy, useRun } from '../../../shell/run.tsx';
import { useToast } from '../../../shell/toast.tsx';
import { ConfirmModal } from '../../company/modules/dialog.tsx';
import {
  afterChange,
  createExpense,
  finishRoute,
  release,
  returnTrip,
  startTrip,
  submitInspection,
  useChecklist,
  useDefect,
  useExpenses,
  useInspection,
  useMyTrip,
  useVehicles,
} from './api.ts';
import { useBook } from './book.ts';
import { Expenses } from './expenses.tsx';
import { type SetSlot, useSlotUpload, useStopMarks } from './hooks.ts';
import { Inspection } from './inspection.tsx';
import {
  carCards,
  type Draft,
  emptyDraft,
  expenseBody,
  expenseErrors,
  type ExpenseForm,
  expenseRow,
  finishDialog,
  hasCritical,
  holdDetails,
  inspectionBody,
  isoDate,
  missingOf,
  MSK,
  newExpense,
  type Plan,
  reserveBlock,
  reworkSteps,
  type SideKey,
  steps,
  stopRows,
  summary,
  todayCrumb,
  tripChip,
  tripMeta,
  tripReq,
  type Vehicle,
} from './model.ts';
import {
  type ActLine,
  ActionBar,
  BookCard,
  Chip,
  ConflictAlert,
  Head,
  Steps,
  Sym,
  useFilePicker,
  useNetwork,
} from './parts.tsx';
import { DRIVER_TEXT as T } from './texts.ts';
import './driver.css';

const TR = toastText.driver;

/** Текст ответа сервера (Problem.detail) или текст по коду. */
const detailOf = (e: unknown): string =>
  e instanceof ProblemError && e.problem?.detail ? e.problem.detail : problemText(e);

function TripCard({ plan }: { plan: Plan }): ReactElement {
  return (
    <div className="ox-dr-card ox-dr-trip">
      <div className="ox-dr-row">
        <strong className="ox-dr-trip-title">{`${plan.number} · ${plan.title}`}</strong>
        <Chip chip={tripChip(plan.state)} />
      </div>
      <span className="ox-dr-sub">{tripMeta(plan)}</span>
      <div className="ox-dr-reqs">
        {tripReq(plan).map((r) => (
          <span key={r.text} className="ox-dr-req">
            <Icon name={r.icon} size={15} />
            {r.text}
          </span>
        ))}
      </div>
    </div>
  );
}

interface Ctx {
  tenantId: string;
  plan: Plan;
  vehicles: readonly Vehicle[];
  online: boolean;
}

// ---------------------------------------------------------------------------------------------
// Бронь (planned / assigned)

function Choose({
  ctx,
  blocked,
}: {
  ctx: Ctx;
  blocked: ReturnType<typeof reserveBlock>;
}): ReactElement {
  const { book, conflict, refresh } = useBook(ctx.tenantId, ctx.plan, ctx.online);
  const refreshing = useBusy('refresh');
  const busyAny = useBusy();
  const cars = carCards(ctx.vehicles, ctx.plan, !!blocked);
  return (
    <>
      {conflict ? (
        <ConflictAlert text={conflict} busy={refreshing} onRefresh={() => void refresh()} />
      ) : null}
      {blocked ? (
        <div role="status" className="ox-dr-note">
          <Sym name={blocked.icon} size={20} />
          <span style={{ textWrap: 'pretty' }}>{blocked.text}</span>
        </div>
      ) : null}
      <div>
        <h2 className="ox-dr-h2">{L.today.choose}</h2>
        <span className="ox-dr-sub">{L.today.chooseHint}</span>
      </div>
      {cars.map((c) => (
        <BookCard key={c.id} car={c} full disabled={busyAny} onBook={() => void book(c.id)} />
      ))}
      {cars.some((c) => c.ok) ? null : (
        <div className="ox-dr-empty">
          <Sym name="no_crash" size={32} />
          <strong style={{ fontWeight: 600 }}>{L.today.noneTitle}</strong>
          <span className="ox-dr-sub" style={{ textWrap: 'pretty' }}>
            {L.today.noneHint}
          </span>
          <button type="button" className="ox-dr-btn" onClick={() => void refresh()}>
            <Icon name="refresh" size={18} />
            {L.today.refresh}
          </button>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Осмотр (перед выездом и при сдаче)

type Kind = 'dep' | 'ret';

interface InspectionFlowProps {
  ctx: Ctx;
  kind: Kind;
  draft: Draft;
  update: (patch: (d: Draft) => Draft) => void;
  minOdo: number;
  pickPhoto: (side: SideKey) => void;
  retryPhoto: (side: SideKey) => void;
}

function useInspectionFlow({ ctx, kind, draft, minOdo }: InspectionFlowProps) {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const toast = useToast();
  const { plan, tenantId } = ctx;
  const checklist = useChecklist(tenantId, plan.vehicleId, kind === 'dep' ? 'departure' : 'return');
  const items = checklist.data?.items ?? [];
  const missing = checklist.data ? missingOf(draft, kind, minOdo, items) : [];
  const critical = hasCritical(draft, kind);
  /** Принятый сервером осмотр этой попытки: повтор после сбоя шлёт только вторую команду. */
  const accepted = useRef<{ key: string; id: string; blocked: boolean } | null>(null);
  const busyKey = kind === 'dep' ? 'dep' : 'ret';
  const busy = useBusy(busyKey);

  const submit = useCallback(async (): Promise<void> => {
    const list = checklist.data;
    if (!list || !plan.vehicleId) return;
    const body = inspectionBody(draft, {
      kind: kind === 'dep' ? 'departure' : 'return',
      checklist: list,
      vehicleId: plan.vehicleId,
      ...(kind === 'dep' && plan.reservationId ? { reservationId: plan.reservationId } : {}),
      ...(kind === 'ret' ? { tripId: plan.id } : {}),
      now: new Date().toISOString(),
    });
    // Отпечаток попытки: тот же осмотр после сбоя второй команды повторно не отправляется.
    const fp = JSON.stringify([
      body.photos,
      body.odometerKm,
      body.fuelPercent,
      body.checks,
      body.defects,
    ]);
    try {
      const text = await run(busyKey, async () => {
        let insp = accepted.current?.key === fp ? accepted.current : null;
        if (!insp) {
          const r = await submitInspection(api, tenantId, body, crypto.randomUUID());
          insp = { key: fp, id: r.id, blocked: r.status === 'requires_review' };
          accepted.current = insp;
        }
        if (kind === 'dep') {
          if (insp.blocked) return TR.departureBlocked;
          await startTrip(
            api,
            tenantId,
            { reservationId: plan.reservationId ?? '', departureInspectionId: insp.id },
            crypto.randomUUID(),
          );
          return TR.departed;
        }
        await returnTrip(api, tenantId, plan.id, insp.id, crypto.randomUUID());
        return TR.returnAccepted;
      });
      accepted.current = null;
      toast(text, text === TR.departureBlocked ? 'warn' : 'ok');
    } catch {
      // Тост показал run; принятый осмотр остаётся для повтора второй команды.
    } finally {
      await afterChange(qc, tenantId);
    }
  }, [api, qc, run, toast, tenantId, plan, draft, kind, checklist.data, busyKey]);

  return { checklist, items, missing, critical, busy, submit };
}

function InspectionBlock(
  p: InspectionFlowProps & { vehicle: Vehicle | undefined; children?: ReactNode },
): ReactElement {
  const f = useInspectionFlow(p);
  const isDep = p.kind === 'dep';
  const lines: ActLine[] = [];
  if (f.missing.length) {
    lines.push({
      key: 'missing',
      tone: 'warn',
      icon: 'pending',
      text: format(L.states.left, { missing: f.missing.join(', ') }),
    });
  }
  if (f.critical) {
    lines.push({ key: 'critical', tone: 'danger', icon: 'report', text: L.states.criticalNote });
  }
  if (isDep && !p.ctx.online) {
    lines.push({ key: 'net', tone: 'muted', icon: 'cloud_off', text: L.notes.offlineDeparture });
  }
  const label = f.busy
    ? L.inspection.sending
    : isDep
      ? f.critical
        ? L.inspection.sendToManager
        : L.inspection.depart
      : L.inspection.submitReturn;
  if (f.checklist.isError) {
    return (
      <Banner
        tone="danger"
        title={format(T.loadFailed, { error: problemText(f.checklist.error) })}
        action={{ label: T.retry, onPress: () => void f.checklist.refetch() }}
      />
    );
  }
  return (
    <>
      <Inspection
        kind={p.kind}
        model={p.vehicle?.displayName ?? ''}
        plate={p.vehicle?.registrationNumber ?? ''}
        draft={p.draft}
        update={p.update}
        items={f.items}
        minOdo={p.minOdo}
        onPhoto={p.pickPhoto}
        onRetry={p.retryPhoto}
      />
      {p.children}
      <ActionBar
        lines={lines}
        label={label}
        icon={isDep ? (f.critical ? 'report' : 'play_arrow') : 'assignment_return'}
        danger={f.critical}
        disabled={!f.checklist.data || f.missing.length > 0 || f.busy || (isDep && !p.ctx.online)}
        onPress={() => void f.submit()}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Маршрут и «Завершить рейс»

function RouteBlock({ ctx, children }: { ctx: Ctx; children: ReactNode }): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const { plan, tenantId } = ctx;
  const { marks, toggle } = useStopMarks(plan.id);
  const [open, setOpen] = useState(false);
  const busy = useBusy('finish');
  const rows = stopRows(plan, marks);
  const done = rows.filter((r) => r.done).length;
  const opener = useRef<HTMLDivElement>(null);
  const confirm = async (): Promise<void> => {
    try {
      await run(
        'finish',
        () => finishRoute(api, tenantId, plan.id, crypto.randomUUID()),
        TR.routeFinished,
      );
      setOpen(false);
      await afterChange(qc, tenantId);
    } catch {
      // Тост показал run; диалог остаётся открытым.
    }
  };
  return (
    <>
      <div className="ox-dr-card">
        <div className="ox-dr-row">
          <h2 className="ox-dr-h2">{L.today.route}</h2>
          <span className="ox-dr-sub">
            {format(L.today.stopsMarked, { done: String(done), total: String(rows.length) })}
          </span>
        </div>
        <ol className="ox-dr-stops">
          {rows.map((s, i) => (
            <li
              key={`${s.name}-${String(i)}`}
              className="ox-dr-stop"
              data-done={s.done || undefined}
            >
              <span className="ox-dr-stop-mark">{s.mark}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ox-dr-stop-name">{s.name}</div>
                <div className="ox-dr-sub">{s.meta}</div>
              </div>
              <button
                type="button"
                className="ox-dr-btn ox-dr-stop-btn"
                aria-pressed={s.done ? 'true' : 'false'}
                onClick={() => toggle(i)}
              >
                {s.button}
              </button>
            </li>
          ))}
        </ol>
      </div>
      {children}
      <div ref={opener}>
        <ActionBar
          lines={[{ key: 'note', tone: 'muted', icon: 'info', text: L.finish.note }]}
          label={L.finish.action}
          icon="flag"
          disabled={busy}
          onPress={() => setOpen(true)}
        />
      </div>
      {open ? (
        <ConfirmModal
          model={finishDialog(plan, done, rows.length)}
          busy={busy}
          onClose={() => setOpen(false)}
          onConfirm={() => void confirm()}
          fallbackFocus={() => opener.current?.querySelector('button') ?? null}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Расходы

function ExpensesBlock({
  ctx,
  pick,
}: {
  ctx: Ctx;
  pick: (cb: (f: File) => void) => void;
}): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const { plan, tenantId } = ctx;
  const list = useExpenses(tenantId, plan.id, true);
  const tz = plan.plannedWindow.timeZone || MSK;
  const [form, setForm] = useState<ExpenseForm | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const saving = useBusy('exp');
  const upload = useSlotUpload(tenantId, plan.id);
  const setReceipt: SetSlot = (patch) =>
    setForm((f) => (f ? { ...f, receipt: patch(f.receipt) } : f));
  const save = async (): Promise<void> => {
    if (!form) return;
    const tried = { ...form, tried: true };
    setForm(tried);
    setServerError(null);
    if (Object.keys(expenseErrors(tried)).length) return;
    try {
      await run(
        'exp',
        () => createExpense(api, tenantId, plan.id, expenseBody(tried), crypto.randomUUID()),
        TR.expenseAccepted,
        { quiet: ['validation_failed'] },
      );
      setForm(null);
      await afterChange(qc, tenantId);
    } catch (e) {
      if (e instanceof ProblemError && e.code === 'validation_failed') setServerError(detailOf(e));
    }
  };
  return (
    <Expenses
      rows={(list.data ?? []).map((e) => expenseRow(e, tz))}
      form={form}
      setForm={setForm}
      onOpen={() => setForm(newExpense(isoDate(plan.plannedWindow.startsAt, tz)))}
      onSave={() => void save()}
      saving={saving}
      serverError={serverError}
      onReceipt={() => pick((file) => upload('receipt', file, 'expense_receipt', setReceipt))}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Итоговые карточки

function Final({
  icon,
  tone,
  title,
  text,
  children,
}: {
  icon: 'hourglass_top' | 'verified';
  tone?: 'ok';
  title: string;
  text: string;
  children?: ReactNode;
}): ReactElement {
  return (
    <div role="status" className="ox-dr-final">
      <span className="ox-dr-final-icon" data-tone={tone}>
        <Sym name={icon} size={28} />
      </span>
      <h2 className="ox-dr-final-title">{title}</h2>
      <p className="ox-dr-final-text">{text}</p>
      {children}
    </div>
  );
}

function Submitted({ ctx }: { ctx: Ctx }): ReactElement {
  const { plan, tenantId } = ctx;
  const dep = useInspection(tenantId, plan.departureInspectionId);
  const ret = useInspection(tenantId, plan.returnInspectionId);
  const exps = useExpenses(tenantId, plan.id, true);
  return (
    <Final icon="hourglass_top" title={L.states.awaitingReview} text={L.states.awaitingText}>
      <div className="ox-dr-summary">
        {summary(dep.data, ret.data, exps.data ?? []).map((s) => (
          <span key={s.label}>
            <span className="ox-dr-muted">{s.label}</span>{' '}
            <strong style={{ fontWeight: 600 }}>{s.value}</strong>
          </span>
        ))}
      </div>
    </Final>
  );
}

// ---------------------------------------------------------------------------------------------
// Смена

function Shift({ ctx }: { ctx: Ctx }): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const can = useCan();
  const { tenant, readOnly } = useShell();
  const { plan, tenantId, online } = ctx;
  const st = plan.state;
  const vehicle = ctx.vehicles.find((v) => v.id === plan.vehicleId);
  const depInsp = useInspection(tenantId, plan.departureInspectionId);
  const defect = useDefect(tenantId, st === 'defect_review' ? plan.blockingDefectId : undefined);
  const { input, pick } = useFilePicker();
  const upload = useSlotUpload(tenantId, plan.id);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const manage = can('fleet.reservations.manage');

  const tenantState = tenant?.tenantState?.status;
  const blocked = reserveBlock(
    online,
    tenantState === 'read_only' || tenantState === 'suspended',
    readOnly,
  );

  const kind: Kind | null =
    st === 'inspection' ? 'dep' : st === 'returning' || st === 'rework' ? 'ret' : null;
  const draftKey =
    kind === 'dep'
      ? `${plan.id}:dep:${plan.reservationId ?? ''}`
      : `${plan.id}:ret:${String(plan.lastReview?.attempt ?? 0)}`;
  const draft = drafts[draftKey] ?? emptyDraft();
  const update = useCallback(
    (patch: (d: Draft) => Draft) =>
      setDrafts((all) => ({ ...all, [draftKey]: patch(all[draftKey] ?? emptyDraft()) })),
    [draftKey],
  );
  const setSlot =
    (side: SideKey): SetSlot =>
    (patch) =>
      update((d) => ({ ...d, photos: { ...d.photos, [side]: patch(d.photos[side]) } }));
  const files = useRef(new Map<string, File>());
  const pickPhoto = (side: SideKey) =>
    pick((file) => {
      files.current.set(`${draftKey}:${side}`, file);
      upload(`${draftKey}:${side}`, file, 'inspection', setSlot(side));
    });
  const retryPhoto = (side: SideKey) => {
    const file = files.current.get(`${draftKey}:${side}`);
    if (file) upload(`${draftKey}:${side}`, file, 'inspection', setSlot(side));
    else pickPhoto(side);
  };

  const cancelRes = async (): Promise<void> => {
    if (!plan.reservationId) return;
    await run(
      'release',
      () => release(api, tenantId, plan.reservationId ?? '', crypto.randomUUID()),
      TR.reservationCancelled,
    ).catch(() => undefined);
    await afterChange(qc, tenantId);
  };

  const minOdo =
    kind === 'ret' && depInsp.data
      ? Number(depInsp.data.odometerKm)
      : Number(vehicle?.odometerKm ?? 0);
  /** Менеджер разрешил выезд (осмотр approved) или старт не прошёл после принятого осмотра. */
  const departOnly = st === 'inspection' && !!plan.departureInspectionId;
  const expenses = <ExpensesBlock ctx={ctx} pick={pick} />;

  let body: ReactNode = null;
  if (st === 'planned' || st === 'assigned') {
    body = <Choose ctx={ctx} blocked={blocked} />;
  } else if (st === 'inspection' && departOnly) {
    body = (
      <DepartOnly
        ctx={ctx}
        inspectionId={plan.departureInspectionId ?? ''}
        allowed={depInsp.data?.status === 'approved'}
      />
    );
  } else if (st === 'inspection' || st === 'returning' || st === 'rework') {
    body = (
      <InspectionBlock
        ctx={ctx}
        kind={kind ?? 'dep'}
        draft={draft}
        update={update}
        minOdo={minOdo}
        pickPhoto={pickPhoto}
        retryPhoto={retryPhoto}
        vehicle={vehicle}
      >
        {kind === 'ret' ? expenses : null}
      </InspectionBlock>
    );
  } else if (st === 'defect_review') {
    const d = defect.data;
    body = (
      <div role="alert" className="ox-dr-defect">
        <span className="ox-dr-round">
          <Sym name="report" size={28} />
        </span>
        <h2 className="ox-dr-h2">{L.today.blocked}</h2>
        <p className="ox-dr-p">
          {format(L.today.blockedText, { defect: d ? `${d.zone}: ${d.description}` : '' })}
        </p>
        <p className="ox-dr-hint">{L.today.blockedHint}</p>
        {manage ? (
          <button
            type="button"
            className="ox-dr-btn"
            data-size="lg"
            onClick={() => void cancelRes()}
          >
            {L.today.otherVehicle}
          </button>
        ) : null}
      </div>
    );
  } else if (st === 'on_route') {
    body = (
      <RouteBlock key={plan.id} ctx={ctx}>
        {expenses}
      </RouteBlock>
    );
  } else if (st === 'submitted') {
    body = <Submitted ctx={ctx} />;
  } else if (st === 'accepted') {
    body = (
      <Final icon="verified" tone="ok" title={L.states.accepted} text={L.states.acceptedText} />
    );
  }

  return (
    <>
      <Steps label={L.today.stepsAria} steps={steps(st)} />
      <TripCard plan={plan} />
      {st === 'inspection' ? (
        <div role="status" className="ox-dr-held">
          <Sym name="cloud_done" size={20} />
          <span className="ox-dr-held-text">
            {format(L.today.reservedLine, { details: holdDetails(vehicle, plan) })}
          </span>
          {manage && !departOnly ? (
            <button type="button" className="ox-dr-link" onClick={() => void cancelRes()}>
              {L.today.cancelReservation}
            </button>
          ) : null}
        </div>
      ) : null}
      {st === 'rework' && plan.lastReview ? (
        <div role="alert" className="ox-dr-rework">
          <Sym name="undo" size={22} />
          <div className="ox-dr-col">
            <strong style={{ fontWeight: 600 }}>{L.today.rework}</strong>
            {plan.lastReview.comment ? (
              <span style={{ fontSize: 14, textWrap: 'pretty' }}>
                {`«${plan.lastReview.comment}»`}
              </span>
            ) : null}
            <span style={{ fontSize: 13 }}>
              {format(L.today.reworkFix, { steps: reworkSteps(plan.lastReview.steps) })}
            </span>
          </div>
        </div>
      ) : null}
      {body}
      {input}
    </>
  );
}

/** После «разрешить выезд» (Q-W2.00-2) или сбоя старта: только «Выехать на маршрут» (startTrip). */
function DepartOnly({
  ctx,
  inspectionId,
  allowed,
}: {
  ctx: Ctx;
  inspectionId: string;
  allowed: boolean;
}): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const busy = useBusy('dep');
  const { plan, tenantId, online } = ctx;
  const go = async (): Promise<void> => {
    await run(
      'dep',
      () =>
        startTrip(
          api,
          tenantId,
          { reservationId: plan.reservationId ?? '', departureInspectionId: inspectionId },
          crypto.randomUUID(),
        ),
      TR.departed,
    ).catch(() => undefined);
    await afterChange(qc, tenantId);
  };
  const lines: ActLine[] = online
    ? []
    : [{ key: 'net', tone: 'muted', icon: 'cloud_off', text: L.notes.offlineDeparture }];
  return (
    <>
      {allowed ? (
        <div role="status" className="ox-dr-held">
          <Sym name="verified" size={20} />
          <span className="ox-dr-held-text">{L.today.allowed}</span>
        </div>
      ) : null}
      <ActionBar
        lines={lines}
        label={busy ? L.inspection.sending : L.inspection.depart}
        icon="play_arrow"
        disabled={busy || !online}
        onPress={() => void go()}
      />
    </>
  );
}

export default function TodayPage(): ReactElement {
  const { me, tenantId: id } = useShell();
  const tenantId = id ?? '';
  const online = useNetwork();
  const trip = useMyTrip(tenantId);
  const plan = trip.data ?? null;
  const vehicles = useVehicles(tenantId, !!plan);
  const tz = plan?.plannedWindow.timeZone || MSK;
  const crumb = todayCrumb(
    me.displayName,
    plan?.plannedWindow.startsAt ?? new Date().toISOString(),
    tz,
  );

  let body: ReactNode;
  if (trip.isPending || (plan && vehicles.isPending)) {
    body = <Skeleton lines={6} label={shellText.a11y.loading} />;
  } else if (trip.isError) {
    body = (
      <Banner
        tone="danger"
        title={format(T.loadFailed, { error: problemText(trip.error) })}
        action={{ label: T.retry, onPress: () => void trip.refetch() }}
      />
    );
  } else if (!plan) {
    body = <EmptyState icon="event_busy" title={T.noTrip.title} text={T.noTrip.text} dashed />;
  } else if (vehicles.isError) {
    body = (
      <Banner
        tone="danger"
        title={format(T.carsFailed, { error: problemText(vehicles.error) })}
        action={{ label: T.retry, onPress: () => void vehicles.refetch() }}
      />
    );
  } else {
    body = <Shift ctx={{ tenantId, plan, vehicles: vehicles.data ?? [], online }} />;
  }

  return (
    <section aria-labelledby="h-today" className="ox-dr">
      <Head id="h-today" crumb={crumb} title={L.today.title} />
      {body}
    </section>
  );
}
