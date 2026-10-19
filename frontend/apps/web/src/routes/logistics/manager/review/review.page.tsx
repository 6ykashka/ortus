// W2.21 · Страница «Приёмка смен» (`logistics-review`, S2-10, S2-11, S2-12, S2-17; эталон design-stage-2 ·
// «Ортус CRM.dc.html» pg.review :566–662, reviewVM :3330–3382, accept/rework/decideDefect :2764–2786; 03-logistics.md
// §7). Разметка и стили — по рендеру эталона (review.css). Очередь — listTripPlans; карточка дефекта —
// getInspectionDefect + decideInspectionDefect; карточка смены — осмотры, фото, расходы (проверка расходов: приёмка
// подтверждает все, S2-11), начисление (getTripEarnings, только с fleet.earnings.read), решение — reviewTrip
// (`rework` + `steps[]` / `approve` через диалог `modal-accept-shift`). Выбранная смена — `?trip=` (ADR-0001).
import type { components } from '@ortus/api-client';
import { format, logisticsManager, shell, toast as toastText } from '@ortus/texts';
import { Banner, ConfirmDialog, Icon, Skeleton } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { type ReactElement, useState } from 'react';

import { useApi } from '../../../../app/api.tsx';
import { useCan, useShell } from '../../../../shell/context.tsx';
import { problemCode, problemText, useBusy, useRun } from '../../../../shell/run.tsx';
import { useToast } from '../../../../shell/toast.tsx';
import { useExpenseCategories } from '../../settings/api.ts';
import { labelsOf } from '../../settings/model.ts';
import {
  afterChange,
  decideDefect,
  reviewTrip,
  useDefect,
  useDownload,
  useExpenses,
  useInspection,
  useTripEarnings,
  useTripPlans,
  useVehicles,
} from './api.ts';
import { ChipView } from './chip.tsx';
import { useCrumb } from './crumb.ts';
import {
  checks,
  decidedText,
  defectCard,
  defectLines,
  expenseLine,
  expensesTotal,
  money,
  photoRows,
  queueItem,
  REWORK_STEPS,
  reviewQueue,
  reworkError,
  shiftHead,
  stats,
} from './model.ts';
import { REVIEW_TEXT as T } from './texts.ts';
import './review.css';

type S = components['schemas'];

const L = logisticsManager.review;
const D = L.acceptDialog;
const EC = logisticsManager.expenseCategories;

const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const detail = (e: unknown): string | undefined =>
  (e as { problem?: { detail?: string } }).problem?.detail ?? undefined;

/** Миниатюра фото (:616–617): ссылка getFileDownload; без файла — «нет», без ссылки — полосы. */
function Thumb({ tenantId, fileId }: { tenantId: string; fileId: string | undefined }) {
  const url = useDownload(tenantId, fileId).data;
  const [broken, setBroken] = useState(false);
  return (
    <div className="ox-rv-thumb" data-empty={fileId ? undefined : ''}>
      {fileId && url && !broken ? (
        <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : null}
      <span className="ox-rv-thumb-tag">{fileId ? T.photoTag : T.photoNone}</span>
    </div>
  );
}

/** Карточка критического дефекта (:592–602). */
function DefectView(p: {
  tenantId: string;
  trip: S['TripPlan'];
  vehicle: S['Vehicle'] | undefined;
  locked: boolean;
}): ReactElement {
  const { tenantId, trip } = p;
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const toast = useToast();
  const busy = useBusy('defect');
  const defect = useDefect(tenantId, trip.blockingDefectId);
  const dep = useInspection(tenantId, trip.departureInspectionId).data;
  if (defect.isPending) return <Skeleton lines={4} label={shell.a11y.loading} />;
  if (defect.isError) {
    return (
      <Banner
        tone="danger"
        role="alert"
        title={format(T.cardFailed, { error: problemText(defect.error) })}
        action={{ label: T.retry, onPress: () => void defect.refetch() }}
      />
    );
  }
  const f = defectCard(trip, defect.data, p.vehicle, dep);
  const decide = async (decision: S['DefectDecision']['decision']): Promise<void> => {
    try {
      await run(
        'defect',
        () => decideDefect(api, tenantId, defect.data.id, { decision }),
        decision === 'allow_departure'
          ? toastText.manager.defectAllowed
          : toastText.manager.defectConfirmed,
        { quiet: ['invalid_transition'] },
      );
    } catch (e) {
      // Дефект решён другим менеджером (409): текст сервера, экран перечитывается.
      if (problemCode(e) === 'invalid_transition') toast(detail(e) ?? problemText(e), 'error');
    } finally {
      await afterChange(qc, tenantId);
    }
  };
  return (
    <div role="alert" className="ox-rv-defect">
      <div className="ox-rv-defect-head">
        <span className="ox-rv-defect-icon">
          <Icon name="report" size={24} />
        </span>
        <div>
          <h2 className="ox-rv-h2">{format(L.critical, { vehicle: f.vehicle })}</h2>
          <span className="ox-rv-sub">{f.sub}</span>
        </div>
      </div>
      <p className="ox-rv-p">
        <strong>{f.zone}:</strong> {f.text}
      </p>
      <p className="ox-rv-note">{L.criticalText}</p>
      <div className="ox-rv-actions">
        <button
          type="button"
          className="ox-rv-btn ox-rv-hit"
          disabled={busy || p.locked}
          onClick={() => void decide('allow_departure')}
        >
          {L.allowDeparture}
        </button>
        <button
          type="button"
          className="ox-rv-btn ox-rv-hit"
          data-variant="danger"
          disabled={busy || p.locked}
          onClick={() => void decide('confirm_out_of_service')}
        >
          {L.confirmDefect}
        </button>
      </div>
    </div>
  );
}

/** Блок «Решение» (:642–655) и диалог «Принять смену» (:2764–2776). */
function Decision(p: {
  tenantId: string;
  trip: S['TripPlan'];
  earnings: boolean;
  locked: boolean;
}): ReactElement {
  const { tenantId, trip } = p;
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const busy = useBusy('rev');
  const [comment, setComment] = useState('');
  const [steps, setSteps] = useState<ReadonlySet<S['ReworkStep']>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  /**
   * Команда решения. Успех: поля очищаются, `onDone` (закрыть диалог) — до перечитывания, чтобы кнопка диалога не
   * стала снова доступной на время `afterChange` (повторный reviewTrip — 409). Ошибка: диалог остаётся открытым.
   */
  const send = async (body: S['TripReview'], ok: string, onDone?: () => void): Promise<void> => {
    try {
      await run('rev', () => reviewTrip(api, tenantId, trip.id, body), ok);
      setComment('');
      setSteps(new Set());
      onDone?.();
    } catch {
      // Ошибку показал тост `run`.
    } finally {
      await afterChange(qc, tenantId);
    }
  };

  const rework = (): void => {
    const picked = REWORK_STEPS.filter(([k]) => steps.has(k)).map(([k]) => k);
    const e = reworkError(comment, picked);
    setErr(e);
    if (e) return;
    void send({ decision: 'rework', comment, steps: picked }, toastText.manager.reworkSent);
  };

  const accept = (): Promise<void> =>
    send(
      { decision: 'approve', ...(comment.trim() ? { comment } : {}) },
      toastText.manager.shiftAccepted,
      () => setConfirm(false),
    );

  const toggle = (k: S['ReworkStep']): void => {
    setSteps((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
    setErr(null);
  };

  return (
    <div className="ox-rv-card ox-rv-decision">
      <h3 className="ox-rv-h3">{L.decision}</h3>
      <label className="ox-rv-label">
        {L.remarks}
        <textarea
          rows={3}
          value={comment}
          placeholder={L.remarksPlaceholder}
          disabled={p.locked}
          onChange={(e) => {
            setComment(e.target.value);
            setErr(null);
          }}
        />
      </label>
      <fieldset className="ox-rv-steps">
        <legend>{L.reworkWhat}</legend>
        <div className="ox-rv-steps-list">
          {REWORK_STEPS.map(([k, label]) => (
            <label key={k} className="ox-rv-step" data-checked={steps.has(k) ? '' : undefined}>
              <input
                type="checkbox"
                checked={steps.has(k)}
                disabled={p.locked}
                onChange={() => toggle(k)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {err ? (
        <div role="alert" className="ox-rv-error">
          <Icon name="error" size={18} />
          {err}
        </div>
      ) : null}
      <div className="ox-rv-actions">
        <button
          type="button"
          className="ox-rv-btn ox-rv-btn-lg"
          disabled={busy || p.locked}
          onClick={rework}
        >
          <Icon name="undo" size={18} />
          {L.rework}
        </button>
        <button
          type="button"
          className="ox-rv-btn ox-rv-btn-lg"
          data-variant="primary"
          disabled={busy || p.locked}
          onClick={() => setConfirm(true)}
        >
          <Icon name="check" size={18} />
          {L.accept}
        </button>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => void accept()}
        icon="verified"
        title={format(D.title, { trip: trip.number })}
        text={D.text}
        consequences={[
          {
            title: T.consequences,
            items: [
              { icon: 'local_shipping', tone: 'ok', text: D.vehicleBack },
              { icon: 'receipt_long', tone: 'info', text: D.expenses },
              ...(p.earnings ? [{ icon: 'lock', tone: 'warn' as const, text: D.earnings }] : []),
            ],
          },
        ]}
        confirmLabel={L.accept}
        busy={busy}
      />
    </div>
  );
}

/** Карточка смены (:603–657). */
function ShiftView(p: {
  tenantId: string;
  trip: S['TripPlan'];
  vehicle: S['Vehicle'] | undefined;
  canReview: boolean;
  canEarnings: boolean;
  locked: boolean;
}): ReactElement {
  const { tenantId, trip } = p;
  const depQ = useInspection(tenantId, trip.departureInspectionId);
  const retQ = useInspection(tenantId, trip.returnInspectionId);
  const expenses = useExpenses(tenantId, trip.id, true);
  // W2.41 · подписи категорий — справочник тенанта с архивными (до загрузки — словарь посева). Не загрузился —
  // свои категории видны кодами, поэтому в «Расходах в пути» ошибка и повтор (возврат 1).
  const categories = useExpenseCategories(tenantId);
  const catalog = labelsOf(categories.data);
  // Начисление создаёт приёмка (Q-55): до неё GET вернёт 404 — не запрашиваем.
  const earnings = useTripEarnings(
    tenantId,
    trip.id,
    p.canEarnings && trip.state === 'accepted',
  ).data;
  if (depQ.isLoading || retQ.isLoading) return <Skeleton lines={6} label={shell.a11y.loading} />;
  const dep = depQ.data;
  const ret = retQ.data;
  const head = shiftHead(trip, p.vehicle);
  const lines = defectLines(dep, ret);
  const list = expenses.data ?? [];
  const decided = decidedText(trip);
  return (
    <>
      <div className="ox-rv-card">
        <div className="ox-rv-shift-head">
          <div>
            <span className="ox-rv-sub ox-rv-sub-sm">{head.sub}</span>
            <h2 className="ox-rv-h2 ox-rv-h2-lg">{head.title}</h2>
          </div>
          <ChipView chip={head.chip} />
        </div>
        <div className="ox-rv-stats">
          {stats(dep, ret).map((s) => (
            <div key={s.label} className="ox-rv-stat">
              <div className="ox-rv-stat-label">{s.label}</div>
              <div className="ox-rv-stat-value">{s.value}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="ox-rv-card ox-rv-photos">
        <h3 className="ox-rv-h3">{L.photos}</h3>
        <div className="ox-rv-photo-grid ox-rv-photo-cols">
          <span />
          <span>{L.before}</span>
          <span>{L.after}</span>
        </div>
        {photoRows(dep, ret).map((r) => (
          <div key={r.role} className="ox-rv-photo-grid">
            <span className="ox-rv-photo-label">{r.label}</span>
            <Thumb tenantId={tenantId} fileId={r.before} />
            <Thumb tenantId={tenantId} fileId={r.after} />
          </div>
        ))}
      </div>
      <div className="ox-rv-pair">
        <div className="ox-rv-card ox-rv-half">
          <h3 className="ox-rv-h3">{L.inspection}</h3>
          {checks(dep, ret).map((c) => (
            <div key={c} className="ox-rv-check">
              <Icon name="check_circle" size={18} />
              {c}
            </div>
          ))}
          {lines.map((x) => (
            <div
              key={x.text}
              className="ox-rv-defect-line"
              data-critical={x.critical ? '' : undefined}
            >
              <Icon name={x.critical ? 'report' : 'build'} size={18} />
              <span>{x.text}</span>
            </div>
          ))}
          {lines.length === 0 ? <span className="ox-rv-muted">{L.noDefects}</span> : null}
          {ret?.comment ? (
            <div className="ox-rv-comment">
              <span className="ox-rv-muted-inline">{L.driverComment} </span>
              {ret.comment}
            </div>
          ) : null}
        </div>
        <div className="ox-rv-card ox-rv-half ox-rv-expenses">
          <h3 className="ox-rv-h3">{L.expenses}</h3>
          {list.map((e) => {
            const x = expenseLine(e, catalog);
            return (
              <div key={e.id} className="ox-rv-expense">
                <Icon name={x.icon} size={20} />
                <div className="ox-rv-expense-text">
                  <div className="ox-rv-expense-label">{x.label}</div>
                  <div className="ox-rv-expense-meta">{x.meta}</div>
                </div>
                <span className="ox-rv-amount">{x.amount}</span>
              </div>
            );
          })}
          {categories.isError && !categories.isFetching && list.length > 0 ? (
            <Banner
              tone="warn"
              role="alert"
              title={format(EC.loadFailed, { error: problemText(categories.error) })}
              action={{ label: EC.retry, onPress: () => void categories.refetch() }}
            />
          ) : null}
          {expenses.isError ? (
            // Расходы неизвестны — итога нет: «0 ₽» ввёл бы в заблуждение перед приёмкой (S2-11).
            <Banner
              tone="danger"
              role="alert"
              title={format(T.expensesFailed, { error: problemText(expenses.error) })}
              action={{ label: T.retry, onPress: () => void expenses.refetch() }}
            />
          ) : null}
          {expenses.isSuccess && list.length === 0 ? (
            <span className="ox-rv-muted">{L.noExpenses}</span>
          ) : null}
          {expenses.isSuccess ? (
            <div className="ox-rv-total">
              <span>{L.total}</span>
              <span className="ox-rv-amount">{expensesTotal(list)}</span>
            </div>
          ) : null}
        </div>
      </div>
      {earnings ? (
        <div className="ox-rv-earn">
          <div className="ox-rv-earn-text">
            <Icon name="lock" size={20} />
            <div>
              <strong>{L.earnings}</strong>
              <div className="ox-rv-earn-note">{L.earningsNote}</div>
            </div>
          </div>
          <strong className="ox-rv-earn-sum">{money(earnings.amount)}</strong>
        </div>
      ) : null}
      {trip.state === 'submitted' && p.canReview ? (
        <Decision
          key={trip.id}
          tenantId={tenantId}
          trip={trip}
          earnings={p.canEarnings}
          locked={p.locked}
        />
      ) : null}
      {decided ? (
        <div
          role="status"
          className="ox-rv-decided"
          data-tone={trip.state === 'accepted' ? 'ok' : 'warn'}
        >
          <Icon name={trip.state === 'accepted' ? 'verified' : 'undo'} size={20} />
          <span>{decided}</span>
        </div>
      ) : null}
    </>
  );
}

export default function ReviewPage(): ReactElement {
  const { tenantId: id, audience, readOnly, go } = useShell();
  const tenantId = id ?? '';
  const can = useCan();
  const owner = audience === 'owner';
  const navigate = useNavigate();
  const location = useLocation();
  const tripParam = text((location.search as Record<string, unknown>).trip);
  const trips = useTripPlans(tenantId);
  const vehicles = useVehicles(tenantId);
  const crumbText = useCrumb('fleet.trips.review');
  const queue = reviewQueue(trips.data ?? []);
  const sel = queue.find((t) => t.id === tripParam) ?? queue[0];
  const vehicleOf = (t: S['TripPlan']) => vehicles.data?.find((v) => v.id === t.vehicleId);
  const canReview = owner || can('fleet.trips.review');
  const canEarnings = owner || can('fleet.earnings.read');
  const canDefects = owner || can('fleet.inspections.review');
  const canCategories = owner || can('modules.settings.manage');

  const select = (tripId: string): void =>
    void navigate({
      to: '/t/$tenantId/$page',
      params: { tenantId, page: 'review' },
      search: { trip: tripId } as never,
    });

  let body: ReactElement;
  if (trips.isPending) {
    body = <Skeleton lines={6} label={shell.a11y.loading} />;
  } else if (trips.isError) {
    body = (
      <Banner
        tone="danger"
        role="alert"
        title={format(T.loadFailed, { error: problemText(trips.error) })}
        action={{ label: T.retry, onPress: () => void trips.refetch() }}
      />
    );
  } else if (!sel) {
    body = (
      <div className="ox-rv-empty">
        <span className="ox-rv-empty-icon">
          <Icon name="fact_check" size={28} />
        </span>
        <strong>{L.empty}</strong>
        <span>{L.emptyHint}</span>
      </div>
    );
  } else {
    body = (
      <div className="ox-rv-layout">
        <div className="ox-rv-queue">
          {queue.map((t) => {
            const q = queueItem(t, vehicleOf(t));
            const active = t.id === sel.id;
            return (
              <button
                key={t.id}
                type="button"
                className="ox-rv-queue-item"
                aria-pressed={active ? 'true' : 'false'}
                onClick={() => select(t.id)}
              >
                <span className="ox-rv-queue-head">
                  <strong>{q.title}</strong>
                  <ChipView chip={q.chip} />
                </span>
                <span className="ox-rv-sub">{q.sub}</span>
              </button>
            );
          })}
        </div>
        <div className="ox-rv-detail">
          {sel.state === 'defect_review' ? (
            <DefectView
              key={sel.id}
              tenantId={tenantId}
              trip={sel}
              vehicle={vehicleOf(sel)}
              locked={readOnly || !(owner || can('fleet.inspections.review'))}
            />
          ) : (
            <ShiftView
              key={sel.id}
              tenantId={tenantId}
              trip={sel}
              vehicle={vehicleOf(sel)}
              canReview={canReview}
              canEarnings={canEarnings}
              locked={readOnly}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby="h-rev" className="ox-rv">
      <div className="ox-rv-top">
        <div className="ox-rv-crumb">{crumbText}</div>
        <h1 id="h-rev" className="ox-rv-title" tabIndex={-1}>
          {shell.nav.items.review}
        </h1>
        <p className="ox-rv-intro">{L.intro}</p>
      </div>
      {canDefects || canEarnings || canCategories ? (
        // Входы на страницы вне меню (no-reference): очередь дефектов (S2-17), начисления (S2-12) и справочник
        // категорий расходов (W2.41, Q-W2.41-2).
        <nav aria-label={T.linksAria} className="ox-rv-links">
          {canDefects ? (
            <button type="button" className="ox-rv-link" onClick={() => go('defects')}>
              <Icon name="report" size={18} />
              {T.toDefects}
            </button>
          ) : null}
          {canEarnings ? (
            <button type="button" className="ox-rv-link" onClick={() => go('earnings')}>
              <Icon name="payments" size={18} />
              {T.toEarnings}
            </button>
          ) : null}
          {canCategories ? (
            <button type="button" className="ox-rv-link" onClick={() => go('expenseCategories')}>
              <Icon name="receipt_long" size={18} />
              {shell.nav.items.expenseCategories}
            </button>
          ) : null}
        </nav>
      ) : null}
      {body}
    </section>
  );
}
