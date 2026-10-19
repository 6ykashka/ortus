// W2.23 · Диалог `modal-driver-request` «Запросить водителя» (эталон :2290–2298, modalVM :4026–4028, saveRequest
// :2816–2820): «{псевдоним} · {фирма}»; «Рейс», «Срок» (пересечение окна рейса и свободного окна, Q-W2.51-10),
// «Согласует»; «Комментарий для фирмы-владельца» (необязательно; пусто — reason «Запрос на рейс {номер}», Q-W2.00-3);
// пояснение; «Отмена» / «Отправить запрос» → requestDriverTransfer. Тост — «Запрос отправлен фирме {фирма}» (без
// демо-хвоста, PD-54). 409 «Запрос уже отправлен», 422 (`window`, `tripId`), 404 — текст сервера в диалоге (role=alert).
import type { components } from '@ortus/api-client';
import { format, logisticsManager, shell } from '@ortus/texts';
import { Dialog, Icon } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useId, useMemo, useRef, useState } from 'react';

import { useApi } from '../../../../app/api.tsx';
import { problemCode, problemText, useBusy, useRun } from '../../../../shell/run.tsx';
import { afterChange, idemKeys, requestDriver } from './api.ts';
import { type DriverCard, intersect, periodText, requestBody, tripLabel } from './model.ts';

type S = components['schemas'];

const R = logisticsManager.request;
const P = logisticsManager.pool;

/** Ответы, которые показывает сам диалог (текст сервера), а не тост `run`. */
const QUIET = ['invalid_transition', 'validation_failed', 'not_found', 'resources_unavailable'];

const detail = (e: unknown): string | undefined =>
  (e as { problem?: { detail?: string } }).problem?.detail || undefined;

export interface RequestDialogProps {
  open: boolean;
  tenantId: string;
  card: DriverCard | null;
  trip: S['TripPlan'] | null;
  onClose: () => void;
}

export function RequestDialog(p: RequestDialogProps): ReactElement | null {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const busy = useBusy('pool:request');
  const [comment, setComment] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const keys = useMemo(() => idemKeys(), []);
  const session = useRef(0);
  const id = useId();
  const { card, trip } = p;
  if (!card || !trip) return null;

  const req =
    (card.freeWindow && intersect(trip.plannedWindow, card.freeWindow)) ?? trip.plannedWindow;

  const close = (): void => {
    // «Отмена» во время отправки (эталон :2296 блокирует только «Отправить запрос»): ответ этой отправки уже не
    // закрывает следующий диалог и не пишет в него ошибку.
    session.current += 1;
    setComment('');
    setErr(null);
    p.onClose();
  };

  const send = async (): Promise<void> => {
    setErr(null);
    const mine = session.current;
    const body = requestBody(card, trip, comment);
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
          <button type="button" className="ox-pl-btn ox-pl-btn-lg" onClick={close}>
            {shell.modal.cancel}
          </button>
          <button
            type="button"
            className="ox-pl-btn ox-pl-btn-lg"
            data-variant="primary"
            disabled={busy}
            onClick={() => void send()}
          >
            {R.submit}
          </button>
        </>
      }
    >
      <div className="ox-pl-dlg">
        <span className="ox-pl-dlg-sub">
          {format(R.driverValue, { driver: card.code, firm: card.home })}
        </span>
        <dl className="ox-pl-dlg-dl">
          <dt>{R.trip}</dt>
          <dd>{tripLabel(trip)}</dd>
          <dt>{R.period}</dt>
          <dd>{periodText(trip.plannedWindow, req)}</dd>
          <dt>{R.approver}</dt>
          <dd>{format(R.approverValue, { firm: card.home })}</dd>
        </dl>
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
        <div className="ox-pl-dlg-note">
          <Icon name="info" size={18} />
          <span>{R.note}</span>
        </div>
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
