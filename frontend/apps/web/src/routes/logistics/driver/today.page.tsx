// W2.22 · Страница «Сегодня» водителя (`driver-today`, h1 «Моя смена»; эталон pg.today :663–848, driverVM
// :3422–3531; S2-02…S2-09). Смена — свой рейс (listTripPlans → pickTrip); состояния рейса: бронь машины,
// осмотр перед выездом с пятью фото (сессии загрузки), выезд (submitInspection + startTrip, Q-W2.00-2),
// «Выезд заблокирован», маршрут и «Завершить рейс» (modal-finish-route), расходы, осмотр при сдаче и «Сдать
// машину» (submitInspection + returnTrip), доработка, ожидание приёмки, «Смена принята».
// W2.24 (S2-15, D-09): без связи фото осмотра — «На устройстве · ждёт связи», черновик осмотра — на устройстве,
// расход и сдача — в очередь отправки (outbox/), карточка «Сдача сохранена на устройстве»; бронь и выезд — только
// онлайн. Повтор команды — тот же Idempotency-Key (idemKeys, Q-W2.22-9).
// W2.61 (Q-W2.32-2): список машин (listVehicles) нужен только до выезда (needsCars); начатый рейс — без него.
// W2.74 (S2-20, D-35): машины на выбор — «Выберите машину» из предложенных и лист «Берёте …?», «Машина на сегодня»,
// «Машину ещё не поставили», осмотр на выбранной машине со статусом брони (offer.tsx); у временного водителя нет
// «Подтвердить бронь» и «Забронировать».
import { type components, ProblemError } from '@ortus/api-client';
import {
  format,
  logisticsDriver as L,
  logisticsManager,
  shell as shellText,
  toast as toastText,
} from '@ortus/texts';
import { Banner, EmptyState, Icon, Skeleton } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useApi } from '../../../app/api.tsx';
import { deviceStore } from '../../../pwa/store.ts';
import { useCan, useShell } from '../../../shell/context.tsx';
import { useOrgUnits } from '../../../shell/scope.ts';
import { problemText, useBusy, useRun } from '../../../shell/run.tsx';
import { useToast } from '../../../shell/toast.tsx';
import { ConfirmModal } from '../../company/modules/dialog.tsx';
import { useExpenseCategories } from '../settings/api.ts';
import { activeOptions, labelsOf } from '../settings/model.ts';
import {
  afterChange,
  createExpense,
  finishRoute,
  idemKeys,
  release,
  returnTrip,
  startTrip,
  submitInspection,
  useChecklist,
  useDefect,
  useExpenses,
  useInspection,
  useMyTrip,
  useReservations,
  useVehicles,
} from './api.ts';
import { useBook } from './book.ts';
import { Expenses } from './expenses.tsx';
import { type SetSlot, useSlotUpload, useStopMarks } from './hooks.ts';
import { Inspection } from './inspection.tsx';
import { getPhoto } from './outbox/drafts.ts';
import { asFile, type OutboxView, useDeviceDraft, useOutbox } from './outbox/hooks.ts';
import { expenseLabel, localExpenseRow, QueuedReturn } from './outbox/parts.tsx';
import { transport } from './photos.ts';
import {
  carCards,
  type Chip as ChipModel,
  type Draft,
  EMPTY_SLOT,
  emptyDraft,
  expenseBody,
  expenseErrors,
  type ExpenseForm,
  expenseKindOptions,
  expenseRow,
  finishDialog,
  hasCritical,
  holdDetails,
  inspectionBody,
  isoDate,
  missingOf,
  MSK,
  needsCars,
  newExpense,
  type Plan,
  reserveBlock,
  reworkSteps,
  type SideKey,
  SIDES,
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
  firmsOf,
  isTemporaryTrip,
  type NameBook,
  offerBlock,
  offerChip,
  offerClosedShown,
  offerInspectionSub,
  offerOf,
  recallNames,
  sessionStore,
  whoInspects,
} from './offer.ts';
import { OfferChoose, OfferClosed, OfferHeld, OfferNone, OfferOne } from './offer.tsx';
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

type Reservation = components['schemas']['Reservation'];

const TR = toastText.driver;
const EC = logisticsManager.expenseCategories;

/** Текст ответа сервера (Problem.detail) или текст по коду. */
const detailOf = (e: unknown): string =>
  e instanceof ProblemError && e.problem?.detail ? e.problem.detail : problemText(e);

function TripCard({ plan, chip }: { plan: Plan; chip?: ChipModel | undefined }): ReactElement {
  return (
    <div className="ox-dr-card ox-dr-trip">
      <div className="ox-dr-row">
        <strong className="ox-dr-trip-title">{`${plan.number} · ${plan.title}`}</strong>
        <Chip chip={chip ?? tripChip(plan.state)} />
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
  /** W2.74: брони водителя — предложение машин на рейс смены (до выезда). */
  reservations: readonly Reservation[];
  online: boolean;
  /** Очередь отправки водителя (W2.24). */
  outbox: OutboxView;
}

/** Фото, выбранное водителем: сжатие на клиенте сразу (D-08) — на устройстве хранится уже сжатый JPEG без EXIF. */
async function prepared(file: File): Promise<File> {
  return asFile(await transport.prepare(file), file.name || 'photo.jpg');
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
  /** Ключ черновика шага (фото на устройстве). */
  draftKey: string;
  pickPhoto: (side: SideKey) => void;
  retryPhoto: (side: SideKey) => void;
}

function useInspectionFlow({ ctx, kind, draft, update, minOdo, draftKey }: InspectionFlowProps) {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const toast = useToast();
  const { plan, tenantId, outbox } = ctx;
  const checklist = useChecklist(tenantId, plan.vehicleId, kind === 'dep' ? 'departure' : 'return');
  const items = checklist.data?.items ?? [];
  const missing = checklist.data ? missingOf(draft, kind, minOdo, items) : [];
  const critical = hasCritical(draft, kind);
  /** Принятый сервером осмотр этой попытки: повтор после сбоя шлёт только вторую команду. */
  const accepted = useRef<{ key: string; id: string; blocked: boolean } | null>(null);
  /** Повтор той же команды — тот же Idempotency-Key и то же тело (Q-W2.22-9). */
  const keys = useRef(idemKeys());
  const sent = useRef(new Map<string, ReturnType<typeof inspectionBody>>());
  const busyKey = kind === 'dep' ? 'dep' : 'ret';
  const busy = useBusy(busyKey);
  /** Фото на устройстве ещё не на сервере: со связью они уходят сами, команда ждёт их. */
  const queued = SIDES.some((s) => draft.photos[s.key].state === 'queued');

  const body = useCallback(() => {
    const list = checklist.data;
    if (!list || !plan.vehicleId) return null;
    return inspectionBody(draft, {
      kind: kind === 'dep' ? 'departure' : 'return',
      checklist: list,
      vehicleId: plan.vehicleId,
      ...(kind === 'dep' && plan.reservationId ? { reservationId: plan.reservationId } : {}),
      ...(kind === 'ret' ? { tripId: plan.id } : {}),
      now: new Date().toISOString(),
    });
  }, [checklist.data, plan, draft, kind]);

  /** Без связи — сдача в очередь отправки (submitRet :2599–2603): фото — файлы сервера или Blob с устройства. */
  const saveLocal = useCallback(async (): Promise<void> => {
    const b = body();
    if (!b) return;
    const store = deviceStore();
    const photos = await Promise.all(
      SIDES.map(async (s) => {
        const slot = draft.photos[s.key];
        const capturedAt = slot.capturedAt ?? b.capturedAt;
        if (slot.state === 'ready' && slot.fileId) return { fileId: slot.fileId, capturedAt };
        const blob = await getPhoto(store, outbox.scope, draftKey, s.key);
        return blob ? { blob, capturedAt } : { capturedAt };
      }),
    );
    await outbox.box.saveReturn({ tripId: plan.id, inspection: b, photos });
    // Фото и осмотр теперь у элемента очереди: черновик шага пуст — его фото «На устройстве» не загружаются второй
    // раз между отправкой сдачи и перечитыванием рейса (возврат 1).
    update(() => emptyDraft());
    toast(TR.returnSavedLocal, 'warn');
  }, [body, draft, outbox, draftKey, plan.id, toast, update]);

  const submit = useCallback(async (): Promise<void> => {
    const b = body();
    if (!b) return;
    if (kind === 'ret' && !ctx.online) {
      await saveLocal();
      return;
    }
    // Отпечаток попытки: тот же осмотр после сбоя второй команды повторно не отправляется; повтор первой команды —
    // то же тело и тот же ключ (сервер узнаёт повтор).
    const fp = JSON.stringify([
      b.photos,
      b.odometerKm,
      b.fuelPercent,
      b.checks,
      b.defects,
      b.comment,
    ]);
    const first = sent.current.get(fp) ?? b;
    sent.current.set(fp, first);
    try {
      const text = await run(busyKey, async () => {
        let insp = accepted.current?.key === fp ? accepted.current : null;
        if (!insp) {
          const r = await submitInspection(api, tenantId, first, keys.current('inspection', fp));
          insp = { key: fp, id: r.id, blocked: r.status === 'requires_review' };
          accepted.current = insp;
        }
        if (kind === 'dep') {
          if (insp.blocked) return TR.departureBlocked;
          const start = { reservationId: plan.reservationId ?? '', departureInspectionId: insp.id };
          await startTrip(api, tenantId, start, keys.current('start', start));
          return TR.departed;
        }
        await returnTrip(
          api,
          tenantId,
          plan.id,
          insp.id,
          keys.current('return', [plan.id, insp.id]),
        );
        return TR.returnAccepted;
      });
      accepted.current = null;
      toast(text, text === TR.departureBlocked ? 'warn' : 'ok');
    } catch {
      // Тост показал run; принятый осмотр остаётся для повтора второй команды.
    } finally {
      await afterChange(qc, tenantId);
    }
  }, [api, qc, run, toast, tenantId, plan, kind, busyKey, body, saveLocal, ctx.online]);
  return { checklist, items, missing, critical, busy, submit, queued };
}

function InspectionBlock(
  p: InspectionFlowProps & {
    vehicle: Vehicle | undefined;
    /** W2.74 (1e): подзаголовок осмотра на выбранной машине. */
    sub?: string | undefined;
    children?: ReactNode;
  },
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
  const online = p.ctx.online;
  if (!online) {
    lines.push({
      key: 'net',
      tone: 'muted',
      icon: 'cloud_off',
      text: isDep ? L.notes.offlineDeparture : L.notes.offlineReturn,
    });
  }
  const label = f.busy
    ? L.inspection.sending
    : isDep
      ? f.critical
        ? L.inspection.sendToManager
        : L.inspection.depart
      : online
        ? L.inspection.submitReturn
        : L.inspection.saveReturnLocal;
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
        sub={p.sub}
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
        disabled={
          !f.checklist.data ||
          f.missing.length > 0 ||
          f.busy ||
          (isDep && !online) ||
          (online && f.queued)
        }
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
  /** Повтор «Завершить рейс» после сбоя — тот же Idempotency-Key (Q-W2.22-9, возврат 2 W2.24). */
  const keys = useRef(idemKeys());
  const confirm = async (): Promise<void> => {
    try {
      await run(
        'finish',
        () => finishRoute(api, tenantId, plan.id, keys.current('finish', plan.id)),
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
                <a
                  className="ox-dr-stop-nav"
                  href={s.nav}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={format(T.navigatorNamed, { address: s.name })}
                >
                  {T.navigator}
                  <Icon name="open_in_new" size={16} />
                </a>
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
  const toast = useToast();
  const { plan, tenantId, online, outbox } = ctx;
  const list = useExpenses(tenantId, plan.id, true);
  // W2.41 · категории — справочник тенанта (активные — в форме, с архивными — подписи строк). Не загрузился — в
  // форме посев, под «Категорией» ошибка и повтор (возврат 1: без признака архивная у тенанта давала 422).
  const categories = useExpenseCategories(tenantId);
  const catalog = categories.data;
  const kinds = expenseKindOptions(activeOptions(catalog));
  const labels = labelsOf(catalog);
  const catalogError =
    categories.isError && !categories.isFetching
      ? {
          text: format(EC.loadFailed, { error: problemText(categories.error) }),
          retryLabel: EC.retry,
          onRetry: () => void categories.refetch(),
        }
      : null;
  const tz = plan.plannedWindow.timeZone || MSK;
  const [form, setForm] = useState<ExpenseForm | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const saving = useBusy('exp');
  const upload = useSlotUpload(tenantId, plan.id);
  /** Сжатое фото чека открытой формы (без связи уходит в очередь вместе с расходом). */
  const receipt = useRef<File | null>(null);
  /** Ключи идемпотентности формы: повтор того же расхода — тот же ключ (Q-W2.22-9). */
  const keys = useRef(idemKeys());
  const setReceipt: SetSlot = useCallback(
    (patch) => setForm((f) => (f ? { ...f, receipt: patch(f.receipt) } : f)),
    [setForm],
  );
  const queuedReceipt = form?.receipt.state === 'queued';
  // Связь появилась — чек с устройства загружается сам (flush :2529).
  useEffect(() => {
    if (!online || !queuedReceipt || !receipt.current) return;
    upload('receipt', receipt.current, 'expense_receipt', setReceipt, { prepared: true });
  }, [online, queuedReceipt, upload, setReceipt]);

  const save = async (): Promise<void> => {
    if (!form) return;
    const tried = { ...form, tried: true };
    setForm(tried);
    setServerError(null);
    if (Object.keys(expenseErrors(tried, kinds)).length) return;
    const body = expenseBody(tried);
    if (!online || tried.receipt.state === 'queued') {
      // saveExp :2622–2625: без связи или чек ещё на устройстве — расход в очередь отправки.
      await outbox.box.addExpense({
        tripId: plan.id,
        label: expenseLabel(body, labels),
        body,
        receipt: tried.receipt.fileId ? null : receipt.current,
        key: keys.current('expense', body),
      });
      setForm(null);
      receipt.current = null;
      toast(TR.expenseSavedLocal, 'warn');
      return;
    }
    try {
      await run(
        'exp',
        () => createExpense(api, tenantId, plan.id, body, keys.current('expense', body)),
        TR.expenseAccepted,
        { quiet: ['validation_failed'] },
      );
      setForm(null);
      receipt.current = null;
      await afterChange(qc, tenantId);
    } catch (e) {
      if (e instanceof ProblemError && e.code === 'validation_failed') setServerError(detailOf(e));
    }
  };
  const local = outbox.items
    .filter((i) => i.kind === 'expense' && i.tripId === plan.id)
    .map((i) =>
      localExpenseRow(
        i as Parameters<typeof localExpenseRow>[0],
        (id) => void outbox.box.retry(id),
        labels,
      ),
    );
  return (
    <Expenses
      rows={[...(list.data ?? []).map((e) => expenseRow(e, tz, labels)), ...local]}
      form={form}
      setForm={setForm}
      kinds={kinds}
      catalogError={catalogError}
      onOpen={() => {
        keys.current = idemKeys();
        receipt.current = null;
        setForm(newExpense(isoDate(plan.plannedWindow.startsAt, tz), kinds[0]?.kind));
      }}
      onSave={() => void save()}
      saving={saving}
      serverError={serverError}
      saveLabel={online ? L.expenses.save : L.expenses.saveLocal}
      onReceipt={() =>
        pick((file) => {
          void prepared(file).then((f) => {
            receipt.current = f;
            upload('receipt', f, 'expense_receipt', setReceipt, { prepared: true });
          });
        })
      }
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
  const manage = can('fleet.reservations.manage');

  const tenantState = tenant?.tenantState?.status;
  const tenantReadOnly = tenantState === 'read_only' || tenantState === 'suspended';
  const blocked = reserveBlock(online, tenantReadOnly, readOnly);

  // W2.74 · Предложение машин на рейс (S2-20): брони рейса с offerGroupId; имена машин — и те, что водитель видел до
  // выбора (sessionStorage), фирмы — по подразделениям, если они ему видны.
  const caps = tenant?.capabilities;
  const units = useOrgUnits(tenantId, !!caps?.some((c) => c.permission === 'org_units.read'));
  const names = useMemo((): NameBook => {
    const groups = new Set(
      ctx.reservations.filter((r) => r.tripId === plan.id).map((r) => r.offerGroupId ?? ''),
    );
    return Object.assign({}, ...[...groups].map((g) => recallNames(sessionStore(), g))) as NameBook;
  }, [ctx.reservations, plan.id]);
  // Предложение — по данным запросов (ссылки стабильны между отрисовками): эффекты 1c не перезапускаются зря.
  const offer = useMemo(
    () => offerOf(ctx.reservations, plan, ctx.vehicles, names),
    [ctx.reservations, plan, ctx.vehicles, names],
  );
  const firms = firmsOf(units.data, plan, tenant?.orgUnitIds[0]);
  const pre = st === 'planned' || st === 'assigned';
  const temporary = isTemporaryTrip(
    plan,
    { orgUnitIds: tenant?.orgUnitIds ?? [], caps: caps ?? [] },
    !!offer,
  );
  /** «Начать осмотр» на единственной машине (1c) — до перезагрузки вкладки. */
  const [started, setStarted] = useState(false);
  /**
   * 409 offer_closed: группа закрытого предложения — сообщение переживает перечитывание (та же группа: машина на
   * сегодня), новое предложение логиста или конец перевода его снимают (возврат 1).
   */
  const [closedGroup, setClosedGroup] = useState<string | null>(null);
  const closed = offerClosedShown(closedGroup, offer);
  const one = offer?.state === 'one' ? offer : null;
  const offerInspect = pre && !!one && (one.chosen || started) && !!plan.reservationId;

  const kind: Kind | null =
    st === 'inspection' || offerInspect
      ? 'dep'
      : st === 'returning' || st === 'rework'
        ? 'ret'
        : null;
  const draftKey =
    kind === 'dep'
      ? `${plan.id}:dep:${plan.reservationId ?? ''}`
      : `${plan.id}:ret:${String(plan.lastReview?.attempt ?? 0)}`;
  const { outbox } = ctx;
  const queuedReturn = outbox.items.find((i) => i.kind === 'return' && i.tripId === plan.id);
  // Черновик осмотра на устройстве (W2.24); шага осмотра нет — черновики смены удаляются.
  const { draft, update, loaded, savePhoto } = useDeviceDraft(outbox.scope, kind ? draftKey : null);
  // Чек-лист шага запрашивается вместе с чтением черновика, а не после него (осмотр ждёт черновик — возврат 2).
  useChecklist(
    tenantId,
    kind ? plan.vehicleId : undefined,
    kind === 'ret' ? 'return' : 'departure',
  );
  const setSlot = useCallback(
    (side: SideKey): SetSlot =>
      (patch) =>
        update((d) => ({ ...d, photos: { ...d.photos, [side]: patch(d.photos[side]) } })),
    [update],
  );
  const files = useRef(new Map<string, File>());
  const slotId = (side: SideKey) => `${draftKey}:${side}`;
  /** Фото с устройства: из памяти вкладки или из хранилища (после перезапуска). */
  const photoOf = useCallback(
    async (side: SideKey): Promise<File | undefined> => {
      const mem = files.current.get(`${draftKey}:${side}`);
      if (mem) return mem;
      const blob = await getPhoto(deviceStore(), outbox.scope, draftKey, side);
      return blob ? asFile(blob, `${side}.jpg`) : undefined;
    },
    [draftKey, outbox.scope],
  );
  const pickPhoto = (side: SideKey) =>
    pick((file) => {
      const capturedAt = new Date().toISOString();
      void prepared(file).then(async (f) => {
        // Выход из аккаунта во время сжатия: фото не пишется на устройство и не загружается (возврат 2).
        if (!(await savePhoto(side, f))) return;
        files.current.set(slotId(side), f);
        upload(slotId(side), f, 'inspection', setSlot(side), { prepared: true, capturedAt });
      });
    });
  const retryPhoto = (side: SideKey) => {
    void photoOf(side).then((file) => {
      if (file) upload(slotId(side), file, 'inspection', setSlot(side), { prepared: true });
      else pickPhoto(side);
    });
  };
  // Связь есть — фото «На устройстве · ждёт связи» загружаются сами (flush :2528). Сдача в очереди отправляет свои фото.
  const queuedSides = queuedReturn
    ? ''
    : SIDES.filter((s) => draft.photos[s.key].state === 'queued')
        .map((s) => s.key)
        .join(',');
  const starting = useRef(new Set<string>());
  useEffect(() => {
    if (!online || !loaded || !queuedSides) return;
    for (const side of queuedSides.split(',') as SideKey[]) {
      const id = `${draftKey}:${side}`;
      if (starting.current.has(id)) continue;
      starting.current.add(id);
      const capturedAt = draft.photos[side].capturedAt;
      void photoOf(side).then((file) => {
        starting.current.delete(id);
        if (file) {
          upload(id, file, 'inspection', setSlot(side), {
            prepared: true,
            ...(capturedAt ? { capturedAt } : {}),
          });
        } else setSlot(side)(() => EMPTY_SLOT);
      });
    }
  }, [online, loaded, queuedSides, draftKey, draft.photos, photoOf, upload, setSlot]);
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

  /** 1e: кто увидит осмотр выбранной машины — под осмотром перед выездом. */
  const who = one ? (
    <span className="ox-dr-offer-who">
      <Sym name="visibility" size={17} />
      <span>{whoInspects(one.car, plan, firms)}</span>
    </span>
  ) : null;

  let body: ReactNode = null;
  if (pre && offerInspect && !loaded) {
    body = <Skeleton lines={6} label={shellText.a11y.loading} />;
  } else if (pre && offerInspect && one) {
    // 1e: осмотр на выбранной (или единственной) машине — первый снимок закрепляет бронь (assigned → inspection).
    body = (
      <InspectionBlock
        ctx={ctx}
        kind="dep"
        draft={draft}
        update={update}
        minOdo={minOdo}
        draftKey={draftKey}
        pickPhoto={pickPhoto}
        retryPhoto={retryPhoto}
        vehicle={vehicle}
        sub={offerInspectionSub(one.car)}
      >
        {who}
      </InspectionBlock>
    );
  } else if (pre && offer?.state === 'two') {
    body = (
      <OfferChoose
        tenantId={tenantId}
        plan={plan}
        offer={offer}
        firms={firms}
        block={offerBlock(online, tenantReadOnly, readOnly)}
        onClosed={() => setClosedGroup(offer.groupId)}
      />
    );
  } else if (pre && one) {
    body = (
      <OfferOne
        offer={one}
        firms={firms}
        onStart={() => {
          setClosedGroup(null);
          setStarted(true);
        }}
      />
    );
  } else if (pre && temporary) {
    body = <OfferNone firms={firms} />;
  } else if (pre) {
    body = <Choose ctx={ctx} blocked={blocked} />;
  } else if (st === 'inspection' && departOnly) {
    body = (
      <DepartOnly
        ctx={ctx}
        inspectionId={plan.departureInspectionId ?? ''}
        allowed={depInsp.data?.status === 'approved'}
      />
    );
  } else if ((st === 'returning' || st === 'rework') && queuedReturn?.kind === 'return') {
    // dr.sQueued :3433: сдача на устройстве вместо осмотра при сдаче и расходов.
    body = (
      <QueuedReturn item={queuedReturn} onRetry={() => void outbox.box.retry(queuedReturn.id)} />
    );
  } else if ((st === 'inspection' || st === 'returning' || st === 'rework') && !loaded) {
    // Черновик шага ещё читается с устройства (возврат 2): без кадра «Фото · 0 из 5» и пустого пробега.
    body = <Skeleton lines={6} label={shellText.a11y.loading} />;
  } else if (st === 'inspection' || st === 'returning' || st === 'rework') {
    body = (
      <InspectionBlock
        ctx={ctx}
        kind={kind ?? 'dep'}
        draft={draft}
        update={update}
        minOdo={minOdo}
        draftKey={draftKey}
        pickPhoto={pickPhoto}
        retryPhoto={retryPhoto}
        vehicle={vehicle}
        {...(kind === 'dep' && one ? { sub: offerInspectionSub(one.car) } : {})}
      >
        {kind === 'ret' ? expenses : kind === 'dep' ? who : null}
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

  // Предложение: чип рейса 1c (c.chip :582–584); осмотр на выбранной машине (1e) — шаг «Осмотр», без карточки рейса.
  const offerHeld =
    one && (offerInspect || st === 'inspection') && plan.reservationId === one.car.reservationId;
  return (
    <>
      <Steps label={L.today.stepsAria} steps={steps(offerInspect ? 'inspection' : st)} />
      {offerInspect ? null : (
        <TripCard
          plan={plan}
          chip={pre && (offer || temporary) ? offerChip(offer?.state ?? 'none') : undefined}
        />
      )}
      {closed && pre && !offerInspect ? <OfferClosed /> : null}
      {offerHeld && one ? (
        <OfferHeld offer={one} plan={plan} />
      ) : st === 'inspection' ? (
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
  const keys = useRef(idemKeys());
  const { plan, tenantId, online } = ctx;
  const go = async (): Promise<void> => {
    const start = { reservationId: plan.reservationId ?? '', departureInspectionId: inspectionId };
    await run(
      'dep',
      () => startTrip(api, tenantId, start, keys.current('start', start)),
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
  const { me, tenant, tenantId: id } = useShell();
  const tenantId = id ?? '';
  const online = useNetwork();
  const outbox = useOutbox(tenantId);
  const trip = useMyTrip(tenantId);
  const plan = trip.data ?? null;
  const vehicles = useVehicles(tenantId, !!plan);
  // W2.61 (Q-W2.32-2): список машин нужен только до выезда. Начатый рейс его не ждёт и не показывает его ошибку —
  // машина и рейс из рейса (у временного водителя в продолжении после срока listVehicles — 403); название машины
  // в осмотре при сдаче — из списка, если он загружен.
  const cars = !!plan && needsCars(plan.state);
  // W2.74 (S2-20): брони водителя — машины на выбор; нужны до выезда, как список машин. Ошибка списка броней — смена
  // без предложения (W2.22), у временного рейса — «Не удалось загрузить смену» и «Повторить».
  const reservations = useReservations(tenantId, cars);
  const tz = plan?.plannedWindow.timeZone || MSK;
  const crumb = todayCrumb(
    me.displayName,
    plan?.plannedWindow.startsAt ?? new Date().toISOString(),
    tz,
  );

  const foreignTrip =
    !!plan &&
    isTemporaryTrip(
      plan,
      { orgUnitIds: tenant?.orgUnitIds ?? [], caps: tenant?.capabilities ?? [] },
      false,
    );

  let body: ReactNode;
  if (trip.isPending || (cars && (vehicles.isPending || reservations.isPending)) || !outbox.ready) {
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
  } else if (cars && vehicles.isError) {
    body = (
      <Banner
        tone="danger"
        title={format(T.carsFailed, { error: problemText(vehicles.error) })}
        action={{ label: T.retry, onPress: () => void vehicles.refetch() }}
      />
    );
  } else if (cars && reservations.isError && foreignTrip) {
    body = (
      <Banner
        tone="danger"
        title={format(T.loadFailed, { error: problemText(reservations.error) })}
        action={{ label: T.retry, onPress: () => void reservations.refetch() }}
      />
    );
  } else {
    body = (
      <Shift
        ctx={{
          tenantId,
          plan,
          vehicles: vehicles.data ?? [],
          reservations: (cars && reservations.data) || [],
          online,
          outbox,
        }}
      />
    );
  }

  return (
    <section aria-labelledby="h-today" className="ox-dr">
      <Head id="h-today" crumb={crumb} title={L.today.title} />
      {body}
    </section>
  );
}
