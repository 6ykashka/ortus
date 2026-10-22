// W2.74 · «Моя смена» с машинами на выбор (S2-20, D-35; макеты «Временный водитель - варианты.dc.html» 1c–1e):
// «Выберите машину» из предложенных и лист «Берёте …?» (1c, 1d) — chooseReservation только со связью (правило 5,
// D-09), 409 offer_closed — сообщение и перечитывание смены; «Машина на сегодня» с «Начать осмотр» (одна машина,
// вариант (b)); «Машину ещё не поставили»; статус брони над осмотром на выбранной машине (1e). «Подтвердить бронь»
// и «Забронировать» здесь нет — бронь создал сервер при одобрении (вариант (a) отклонён).
import { errors, logisticsDriver as L, toast as toastText } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useApi } from '../../../app/api.tsx';
import { problemCode, useBusy, useRun } from '../../../shell/run.tsx';
import { useDialogKeys } from '../../company/modules/dialog.tsx';
import { afterChange, chooseReservation, idemKeys } from './api.ts';
import type { Plan } from './model.ts';
import {
  type Firms,
  heldBanner,
  noneText,
  type Offer,
  type OfferCar,
  oneNote,
  rememberNames,
  sessionStore,
  sheetOf,
  twoLines,
} from './offer.ts';
import { OFFER as O } from './offer-texts.ts';
import { Chip, ReasonNote, Sym } from './parts.tsx';

type Two = Extract<Offer, { state: 'two' }>;
type One = Extract<Offer, { state: 'one' }>;
type Block = { text: string; icon: Parameters<typeof Sym>[0]['name'] } | null;

/**
 * Карточка предложенной машины (1c :264–274, :281–290): «Подходит рейсу …» — только у машин на выбор (у «Машины на
 * сегодня» :281–290 строки нет); `picked` — выделение карточки (card() :578–581).
 */
function OfferCard({
  car,
  picked,
  fits = true,
  children,
}: {
  car: OfferCar;
  picked?: boolean;
  fits?: boolean;
  children: ReactElement;
}): ReactElement {
  return (
    <article className="ox-dr-car ox-dr-offer" data-picked={picked ? 'true' : undefined}>
      <div className="ox-dr-car-head">
        <span className="ox-dr-car-icon">
          <Icon name={car.icon} size={24} />
        </span>
        <div className="ox-dr-car-main">
          <div className="ox-dr-car-model">{car.model}</div>
          <div className="ox-dr-plate">{car.plate}</div>
        </div>
        <Chip chip={car.tag} />
      </div>
      {car.specs ? <span className="ox-dr-specs">{car.specs}</span> : null}
      {car.place ? (
        <span className="ox-dr-offer-place">
          <Sym name="local_parking" size={17} />
          {car.place}
        </span>
      ) : null}
      {fits && car.fits ? (
        <span className="ox-dr-fits">
          <Sym name="check_circle" size={17} />
          {O.fits}
        </span>
      ) : null}
      {children}
    </article>
  );
}

/** 1d · Лист «Берёте {модель}?»: последствия выбора, «Взять и начать осмотр» и «Назад» (:332–343). */
function OfferSheet({
  car,
  other,
  plan,
  firms,
  block,
  busy,
  onClose,
  onConfirm,
}: {
  car: OfferCar;
  other: OfferCar | undefined;
  plan: Plan;
  firms: Firms;
  block: Block;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}): ReactElement {
  const dialog = useRef<HTMLDivElement>(null);
  const ok = useRef<HTMLButtonElement>(null);
  const m = sheetOf(car, other, plan, firms);
  // Фокус — на «Взять и начать осмотр»; без связи она недоступна — на сам лист (фокус-ловушка, PD-29).
  useEffect(() => {
    const b = ok.current;
    (b && !b.disabled ? b : dialog.current)?.focus();
  }, []);
  useDialogKeys(dialog, busy ? null : onClose);
  const host = document.querySelector('.ox-frame') ?? document.body;
  return createPortal(
    <div
      className="ox-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialog}
        className="ox-dialog ox-dr-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dr-offer-title"
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <span className="ox-dr-sheet-grip" aria-hidden="true" />
        <div>
          <h2 id="dr-offer-title" className="ox-dr-sheet-title">
            {m.title}
          </h2>
          <span className="ox-dr-plate">{m.sub}</span>
        </div>
        <ul className="ox-dr-sheet-list">
          {m.items.map((it) => (
            <li key={it.text} data-tone={it.tone}>
              <Sym name={it.icon} size={20} />
              <span>{it.text}</span>
            </li>
          ))}
        </ul>
        {block ? (
          <span className="ox-dr-act-line" data-tone="muted">
            <Icon name={block.icon} size={18} />
            <span>{block.text}</span>
          </span>
        ) : null}
        <button
          ref={ok}
          type="button"
          className="ox-dr-btn ox-dr-act-btn"
          data-kind="primary"
          disabled={busy || !!block}
          onClick={onConfirm}
        >
          <Icon name="photo_camera" size={20} />
          {busy ? L.inspection.sending : O.takeAndInspect}
        </button>
        <button
          type="button"
          className="ox-dr-btn ox-dr-sheet-back"
          disabled={busy}
          onClick={onClose}
        >
          {O.back}
        </button>
      </div>
    </div>,
    host,
  );
}

/** 1c · «Выберите машину»: предложенные машины, срок выбора; «Взять эту машину» → лист 1d → chooseReservation. */
export function OfferChoose({
  tenantId,
  plan,
  offer,
  firms,
  block,
  onClosed,
}: {
  tenantId: string;
  plan: Plan;
  offer: Two;
  firms: Firms;
  block: Block;
  /** 409 offer_closed: сообщение показывает смена (оно переживает смену состояния предложения). */
  onClosed: () => void;
}): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const busy = useBusy('choose');
  const [picked, setPicked] = useState<string | null>(null);
  // Выделенная карточка (card() :578–581): по умолчанию — обычная машина (pick = 'home' макета), затем — последняя
  // взятая; выделение остаётся и после «Назад».
  const [chosen, setChosen] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const keys = useRef(idemKeys());
  const lines = twoLines(offer, plan);
  // Имена машин — до выбора: после него невыбранную сервер водителю не показывает (строка 1e). Предложение смена
  // запоминает (useMemo по данным запросов) — запись в sessionStorage только при новых машинах, не на каждой отрисовке.
  useEffect(() => {
    rememberNames(sessionStore(), offer.groupId, offer.cars);
  }, [offer.groupId, offer.cars]);
  const car = offer.cars.find((c) => c.reservationId === picked);
  const other = offer.cars.find((c) => c.reservationId !== picked);
  const highlight =
    offer.cars.find((c) => c.reservationId === chosen)?.reservationId ??
    (offer.cars.find((c) => c.kind === 'usual') ?? offer.cars[0])?.reservationId;

  const close = (): void => {
    setPicked(null);
    const back = opener.current;
    if (back?.isConnected) back.focus();
  };
  const confirm = async (): Promise<void> => {
    if (!car || block) return;
    try {
      await run(
        'choose',
        () =>
          chooseReservation(
            api,
            tenantId,
            car.reservationId,
            keys.current('choose', car.reservationId),
          ),
        toastText.driver.reserved,
        { quiet: ['offer_closed'] },
      );
      setPicked(null);
    } catch (e) {
      if (problemCode(e) === 'offer_closed') {
        setPicked(null);
        onClosed();
      }
      // Прочие отказы — тост `run`; лист остаётся открытым для повтора тем же ключом.
    } finally {
      await afterChange(qc, tenantId);
    }
  };

  return (
    <>
      {/* Почему выбор недоступен; «Взять эту машину» недоступна у всех машин — плашка цель Tab (W2.76, Q-W2.32-12). */}
      {block ? <ReasonNote icon={block.icon} text={block.text} tabStop /> : null}
      <div>
        <h2 className="ox-dr-h2">{O.choose}</h2>
        <span className="ox-dr-sub">{lines.sub}</span>
      </div>
      {offer.cars.map((c) => (
        <OfferCard key={c.reservationId} car={c} picked={c.reservationId === highlight}>
          <button
            type="button"
            className="ox-dr-btn ox-dr-book"
            data-kind="primary"
            disabled={!!block || busy}
            onClick={(e) => {
              opener.current = e.currentTarget;
              setChosen(c.reservationId);
              setPicked(c.reservationId);
            }}
          >
            <Icon name="key" size={20} />
            {O.take}
          </button>
        </OfferCard>
      ))}
      <span className="ox-dr-sub" style={{ textWrap: 'pretty' }}>
        {lines.footer}
      </span>
      {car ? (
        <OfferSheet
          car={car}
          other={other}
          plan={plan}
          firms={firms}
          block={block}
          busy={busy}
          onClose={close}
          onConfirm={() => void confirm()}
        />
      ) : null}
    </>
  );
}

/** 1c · «Машина на сегодня»: одна машина, подтверждать не нужно — «Начать осмотр» (вариант (b)). */
export function OfferOne({
  offer,
  firms,
  onStart,
}: {
  offer: One;
  firms: Firms;
  onStart: () => void;
}): ReactElement {
  return (
    <>
      <div>
        <h2 className="ox-dr-h2">{O.oneTitle}</h2>
        <span className="ox-dr-sub" style={{ textWrap: 'pretty' }}>
          {oneNote(offer.car, firms)}
        </span>
      </div>
      <OfferCard car={offer.car} fits={false}>
        <button
          type="button"
          className="ox-dr-btn ox-dr-book"
          data-kind="primary"
          onClick={onStart}
        >
          <Icon name="photo_camera" size={20} />
          {O.startInspection}
        </button>
      </OfferCard>
    </>
  );
}

/** 1c · «Машину ещё не поставили»: фирма выдала водителя без машины; «Написать логисту» — этап 7 (Q-W2.70-4). */
export function OfferNone({ firms }: { firms: Firms }): ReactElement {
  return (
    <div className="ox-dr-empty">
      <Sym name="no_crash" size={32} />
      <strong style={{ fontWeight: 600 }}>{O.noneTitle}</strong>
      <span className="ox-dr-sub" style={{ textWrap: 'pretty' }}>
        {noneText(firms)}
      </span>
    </div>
  );
}

/** 1e · «Бронь подтверждена сервером · {модель} до …» и освобождённая вторая машина (:376–379). */
export function OfferHeld({ offer, plan }: { offer: One; plan: Plan }): ReactElement {
  const b = heldBanner(offer, plan);
  return (
    <div role="status" className="ox-dr-offer-held">
      <span className="ox-dr-offer-held-line">
        <Sym name="cloud_done" size={19} />
        <span>{b.held}</span>
      </span>
      {b.released ? (
        <span className="ox-dr-offer-held-line" data-muted>
          <Sym name="event_busy" size={19} />
          <span>{b.released}</span>
        </span>
      ) : null}
    </div>
  );
}

/** 409 offer_closed: выбор закрыт сервером (срок или уже выбрано) — смена перечитана. */
export function OfferClosed(): ReactElement {
  return (
    <div role="alert" className="ox-dr-alert">
      <div className="ox-dr-alert-body">
        <Sym name="sync_problem" size={22} />
        <div className="ox-dr-alert-text">{errors.problem.offer_closed}</div>
      </div>
    </div>
  );
}
