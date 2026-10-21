// W2.22 · Страница «Автомобили» водителя (`driver-cars`; эталон pg.cars :850–867, carCards :3403–3420; S2-02,
// S2-03): машины фирмы водителя с причинами несовместимости рейсу смены, фильтр «Все / Подходят к рейсу /
// Свободны», «Забронировать» → бронь на сервере → «Сегодня». Крошки подразделения у водителя нет (нет
// org_units.read, бриф §10 п. 10).
// W2.74 (S2-20, D-35): у временного водителя — только машины, предложенные на рейс смены, без «Забронировать» и
// «Подтвердить бронь» (выбор — на «Моей смене»); чип — «Ваша обычная» / «Поставил логист».
// Возврат 1: временный рейс — пояснение о машинах рейса и без фильтра (Q-W2.74-8); ошибка списка броней —
// «Не удалось загрузить машины» и «Повторить», как ошибка списка машин; машины нет — «Машину ещё не поставили» (1c);
// начатый рейс (в продолжении после срока listVehicles — 403, D09; Q-W2.61-2) — список машин не запрашивается,
// машина рейса и сдача — на «Моей смене».
import { format, logisticsDriver as L, logisticsManager as LM, shell } from '@ortus/texts';
import { Banner, EmptyState, Skeleton } from '@ortus/ui';
import { type ReactElement, useState } from 'react';

import { useShell } from '../../../shell/context.tsx';
import { useOrgUnits } from '../../../shell/scope.ts';
import { problemText, useBusy } from '../../../shell/run.tsx';
import { useMyTrip, useReservations, useVehicles } from './api.ts';
import { useBook } from './book.ts';
import { type CarCard, carCards, type CarsFilter, needsCars, reserveBlock } from './model.ts';
import { firmsOf, isTemporaryTrip, offeredVehicleIds, offerOf } from './offer.ts';
import { OFFER_NO_REFERENCE as N } from './offer-texts.ts';
import { OfferNone } from './offer.tsx';
import { useOutbox } from './outbox/hooks.ts';
import { BookCard, ConflictAlert, Head, useNetwork } from './parts.tsx';
import { DRIVER_TEXT as T } from './texts.ts';
import './driver.css';

const FILTERS: readonly { key: CarsFilter; label: string }[] = [
  { key: 'all', label: LM.fleet.filters.all },
  { key: 'fit', label: L.cars.fitTrip },
  { key: 'free', label: LM.fleet.filters.free },
];

type Plan = NonNullable<ReturnType<typeof useMyTrip>['data']>;
type Reservations = NonNullable<ReturnType<typeof useReservations>['data']>;

/**
 * Карточки «Автомобилей»: рейс с предложением машин или рейс чужой фирмы (временный водитель) — только предложенные
 * машины в порядке предложения (1c), без брони и с чипом вида машины; иначе — как W2.22.
 */
function offerCars(
  plan: Plan,
  vehicles: Parameters<typeof carCards>[0],
  reservations: Reservations,
  o: { temporary: boolean; blocked: boolean; filter: CarsFilter },
): CarCard[] {
  if (!o.temporary) return carCards(vehicles, plan, o.blocked, o.filter);
  const offer = offerOf(reservations, plan, vehicles);
  const ids = offeredVehicleIds(reservations, plan);
  const order = offer?.state === 'two' ? offer.cars : offer ? [offer.car] : [];
  const cards = carCards(
    vehicles.filter((v) => ids.has(v.id)),
    plan,
    true,
  );
  return order.flatMap((car) => {
    const c = cards.find((x) => x.id === car.vehicleId);
    return c ? [{ ...c, chip: car.tag }] : [];
  });
}

export default function CarsPage(): ReactElement {
  const { tenantId: id, tenant, readOnly, go } = useShell();
  const tenantId = id ?? '';
  const online = useNetwork();
  // Очередь отправки водителя (W2.24): отправка и тосты «— принято сервером» и на «Автомобилях».
  useOutbox(tenantId);
  const [filter, setFilter] = useState<CarsFilter>('all');
  const trip = useMyTrip(tenantId);
  const plan = trip.data ?? null;
  const caps = tenant?.capabilities ?? [];
  // Временный рейс (рейс чужой фирмы без права брони в ней, Q-W2.74-5) или рейс с предложением машин (ниже).
  const foreign =
    !!plan && isTemporaryTrip(plan, { orgUnitIds: tenant?.orgUnitIds ?? [], caps }, false);
  // Начатый временный рейс машины не выбирает: список машин и броней не нужен (в продолжении после срока — 403).
  const started = foreign && !!plan && !needsCars(plan.state);
  const lists = !!plan && !started;
  const vehicles = useVehicles(tenantId, lists);
  const reservations = useReservations(tenantId, lists);
  const units = useOrgUnits(
    tenantId,
    foreign && caps.some((c) => c.permission === 'org_units.read'),
  );
  const { book, conflict, refresh } = useBook(tenantId, plan, online);
  const refreshing = useBusy('refresh');
  const busyAny = useBusy();
  const tenantState = tenant?.tenantState?.status;
  const blocked = reserveBlock(
    online,
    tenantState === 'read_only' || tenantState === 'suspended',
    readOnly,
  );
  const offered = !!plan && !!reservations.data && !!offerOf(reservations.data, plan, []);
  const temporary = foreign || offered;

  let body: ReactElement;
  if (trip.isPending || (lists && (vehicles.isPending || reservations.isPending))) {
    body = <Skeleton lines={6} label={shell.a11y.loading} />;
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
  } else if (started) {
    body = (
      <EmptyState
        icon="local_shipping"
        title={N.carsStartedTitle}
        text={format(N.carsStartedText, { trip: plan.number })}
        action={{ label: N.openToday, icon: 'today', onPress: () => go('today') }}
        dashed
      />
    );
  } else if (vehicles.isError || (foreign && reservations.isError)) {
    // Ошибка списка броней на временном рейсе — как ошибка списка машин: без броней предложенных машин не узнать.
    const failed = vehicles.isError ? vehicles : reservations;
    body = (
      <Banner
        tone="danger"
        title={format(T.carsFailed, { error: problemText(failed.error) })}
        action={{ label: T.retry, onPress: () => void failed.refetch() }}
      />
    );
  } else {
    const cars = offerCars(plan, vehicles.data ?? [], reservations.data ?? [], {
      temporary,
      blocked: !!blocked,
      filter,
    });
    body =
      temporary && !cars.length ? (
        <OfferNone firms={firmsOf(units.data, plan, tenant?.orgUnitIds[0])} />
      ) : (
        <>
          {cars.map((c) => (
            <BookCard
              key={c.id}
              car={c}
              full={false}
              disabled={busyAny}
              onBook={() =>
                void book(c.id).then((ok) => {
                  if (ok) go('today');
                })
              }
            />
          ))}
          {cars.length ? null : <div className="ox-dr-empty-small">{L.cars.empty}</div>}
        </>
      );
  }

  // Временный рейс: свой текст пояснения и без фильтра — «Свободны» у него всегда пусто (Q-W2.74-8).
  const plain = !plan || !temporary;
  return (
    <section aria-labelledby="h-cars" className="ox-dr">
      <Head
        id="h-cars"
        title={shell.nav.items.cars}
        sub={plain ? L.cars.intro : format(N.carsIntro, { trip: plan.number })}
      />
      {plain ? (
        <div role="group" aria-label={LM.fleet.filterAria} className="ox-dr-filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className="ox-dr-pill"
              aria-pressed={filter === f.key ? 'true' : 'false'}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : null}
      {conflict ? (
        <ConflictAlert text={conflict} busy={refreshing} onRefresh={() => void refresh()} />
      ) : null}
      {body}
    </section>
  );
}
