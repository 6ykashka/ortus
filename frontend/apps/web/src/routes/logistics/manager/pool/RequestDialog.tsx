// W2.23 · Диалог `modal-driver-request` «Запросить водителя» (эталон design-stage-2 :2290–2298, modalVM :4026–4028,
// saveRequest :2816–2820). W2.73 (S2-20, D-35): раскладка 1a «Временный водитель - варианты.dc.html» (:144–184,
// design-2026-10-19b): «{псевдоним} · {фирма} · {квалификации}»; «Рейс» с датой, «Груз», «Доступ», «Согласует»; группа
// «Машина» (обычная машина водителя, машина фирмы рейса, «Можно взять свою обычную»); «Что произойдёт после одобрения»;
// «Комментарий для фирмы-владельца» (пусто — reason «Запрос на рейс {номер}», Q-W2.00-3); «Отмена» / «Отправить
// запрос» → requestDriverTransfer с `vehicle` (недоступна, если выбрана своя машина, а она не подходит). Срок — пересечение
// окна рейса и свободного окна (Q-W2.51-10). Тост — «Запрос отправлен фирме {фирма}» (PD-54). 409 «Запрос уже
// отправлен», `vehicle_incompatible`, `reservation_overlap`, 422, 404 — текст сервера в диалоге (role=alert).
// Возврат 3: пока машины фирмы рейса (listVehicles) грузятся — скелетон блока «Машина», не загрузились — role=alert с
// «Повторить»; в обоих случаях итога нет и «Отправить запрос» недоступна (режим по умолчанию — по загруженному списку).
// После ответа отправки фокус, снятый браузером с недоступной на время отправки кнопки, возвращается в диалог.
import type { components } from '@ortus/api-client';
import { format, logisticsManager, shell } from '@ortus/texts';
import { Banner, Dialog, Icon, Skeleton } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useEffect, useId, useMemo, useRef, useState } from 'react';

import { useApi } from '../../../../app/api.tsx';
import { problemCode, problemText, useBusy, useRun } from '../../../../shell/run.tsx';
import { afterChange, idemKeys, requestDriver } from './api.ts';
import { type DriverCard, intersect, requestBody } from './model.ts';
import { CarChoice, CarSummary } from './S220.tsx';
import { POOL_TEXT } from './texts.ts';
import { carBlock, carView, type Mode, requestRows, vehicleBody } from './vehicle.ts';

type S = components['schemas'];

const R = logisticsManager.request;
const P = logisticsManager.pool;

/** Ответы, которые показывает сам диалог (текст сервера), а не тост `run`. */
const QUIET = [
  'invalid_transition',
  'validation_failed',
  'not_found',
  'resources_unavailable',
  'vehicle_incompatible',
  'reservation_overlap',
];

const detail = (e: unknown): string | undefined =>
  (e as { problem?: { detail?: string } }).problem?.detail || undefined;

export interface RequestDialogProps {
  open: boolean;
  tenantId: string;
  card: DriverCard | null;
  trip: S['TripPlan'] | null;
  /** W2.73 · машины области логиста — подбор «Ставим нашу машину». */
  vehicles: readonly S['Vehicle'][];
  /** W2.73 · фирма рейса («Рейсу подходит … машин Север Логистик.»). */
  unitName: string;
  /** Возврат 3 · список машин фирмы рейса: грузится, не загрузился (`vehiclesError` — текст ошибки) или готов. */
  vehiclesState?: VehiclesState;
  onRetryVehicles?: () => void;
  onClose: () => void;
}

export type VehiclesState =
  { status: 'ready' } | { status: 'pending' } | { status: 'error'; error: string };

const READY: VehiclesState = { status: 'ready' };

export function RequestDialog(p: RequestDialogProps): ReactElement | null {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const busy = useBusy('pool:request');
  const [comment, setComment] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [hostSub, setHostSub] = useState<Mode | null>(null);
  const [hostId, setHostId] = useState<string | null>(null);
  const keys = useMemo(() => idemKeys(), []);
  const session = useRef(0);
  const sendRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const wasBusy = useRef(false);
  const id = useId();
  const { card, trip, open } = p;

  // «Отправить запрос» недоступна на время отправки, и браузер переносит фокус с неё на body: Escape и Tab диалога
  // перестают работать. После ответа (диалог открыт — ошибка) фокус возвращается на кнопку (или «Отмена»).
  useEffect(() => {
    const ended = wasBusy.current && !busy;
    wasBusy.current = busy;
    if (!ended || !open) return;
    const at = document.activeElement;
    if (at && at !== document.body) return;
    const target =
      sendRef.current && !sendRef.current.disabled ? sendRef.current : cancelRef.current;
    target?.focus();
  }, [busy, open]);

  if (!card || !trip) return null;
  const fleet = p.vehiclesState ?? READY;
  const ready = fleet.status === 'ready';

  const req =
    (card.freeWindow && intersect(trip.plannedWindow, card.freeWindow)) ?? trip.plannedWindow;
  const block = carBlock({
    trip,
    vehicles: p.vehicles,
    ...(card.usualVehicle ? { usual: card.usualVehicle } : {}),
    home: card.home,
    unit: p.unitName,
  });
  const state = { block, mode: mode ?? block.initial, hostId };
  const view = carView(state, trip, req);

  const close = (): void => {
    // «Отмена» во время отправки (эталон :2296 блокирует только «Отправить запрос»): ответ этой отправки уже не
    // закрывает следующий диалог и не пишет в него ошибку.
    session.current += 1;
    setComment('');
    setErr(null);
    setMode(null);
    setHostSub(null);
    setHostId(null);
    p.onClose();
  };

  const pick = (m: Mode): void => {
    setErr(null);
    // Клик по «Ставим нашу машину» возвращает последний выбор галочки (onHost :562).
    setMode(m === 'host' ? (hostSub ?? (block.usual ? 'choice' : 'host')) : m);
  };

  const send = async (): Promise<void> => {
    // Без списка машин фирмы рейса режим «Машина» не выбран — запрос не уходит (кнопка и так недоступна).
    if (!ready) return;
    setErr(null);
    const mine = session.current;
    const vehicle = vehicleBody(state);
    const body = { ...requestBody(card, trip, comment), ...(vehicle ? { vehicle } : {}) };
    try {
      await run(
        'pool:request',
        () => requestDriver(api, p.tenantId, body, keys.of(body)),
        format(P.requestSent, { firm: card.home }),
        { quiet: QUIET },
      );
      keys.settle(body);
      if (session.current === mine) close();
    } catch (e) {
      keys.settle(body, e);
      if (session.current === mine && QUIET.includes(problemCode(e))) {
        setErr(detail(e) ?? problemText(e));
      }
    } finally {
      await afterChange(qc, p.tenantId);
    }
  };

  return (
    <Dialog
      open={p.open}
      onClose={close}
      title={R.title}
      busy={busy}
      footer={
        <>
          <button ref={cancelRef} type="button" className="ox-pl-btn ox-pl-btn-lg" onClick={close}>
            {shell.modal.cancel}
          </button>
          <button
            ref={sendRef}
            type="button"
            className="ox-pl-btn ox-pl-btn-lg"
            data-variant="primary"
            data-blocked={view.blocked || !ready ? '' : undefined}
            disabled={busy || view.blocked || !ready}
            onClick={() => void send()}
          >
            {R.submit}
          </button>
        </>
      }
    >
      <div className="ox-pl-dlg">
        <span className="ox-pl-dlg-sub">
          {card.qual
            ? format(R.driverQualValue, { driver: card.code, firm: card.home, qual: card.qual })
            : format(R.driverValue, { driver: card.code, firm: card.home })}
        </span>
        <dl className="ox-pl-dlg-dl">
          {requestRows(trip, req, card.home).map((r) => (
            <div key={r.term} className="ox-pl-dl-row">
              <dt>{r.term}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
        {ready ? (
          <>
            <CarChoice
              block={block}
              view={view}
              hostId={hostId}
              onMode={pick}
              onHost={(v) => {
                setErr(null);
                setHostId(v);
              }}
              onChoice={() => {
                setErr(null);
                const next: Mode = view.choiceOn ? 'host' : 'choice';
                setMode(next);
                setHostSub(next);
              }}
            />
            <CarSummary lines={view.summary} />
          </>
        ) : (
          <div role="group" className="ox-pl-cars" aria-labelledby={`${id}-car`}>
            <span id={`${id}-car`} className="ox-pl-cars-title">
              {R.vehicle}
            </span>
            {fleet.status === 'error' ? (
              <Banner
                tone="danger"
                role="alert"
                title={format(POOL_TEXT.vehicle.loadFailed, { error: fleet.error })}
                {...(p.onRetryVehicles
                  ? { action: { label: POOL_TEXT.retry, onPress: p.onRetryVehicles } }
                  : {})}
              />
            ) : (
              <Skeleton lines={3} label={shell.a11y.loading} />
            )}
          </div>
        )}
        <label className="ox-pl-label" htmlFor={`${id}-comment`}>
          {R.comment}
          <textarea
            id={`${id}-comment`}
            rows={2}
            value={comment}
            placeholder={R.commentPlaceholder}
            onChange={(e) => {
              setComment(e.target.value);
              setErr(null);
            }}
          />
        </label>
        {err ? (
          <div role="alert" className="ox-pl-error">
            <Icon name="error" size={18} />
            <span>{err}</span>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
