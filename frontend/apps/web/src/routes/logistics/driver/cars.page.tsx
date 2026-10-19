// W2.22 · Страница «Автомобили» водителя (`driver-cars`; эталон pg.cars :850–867, carCards :3403–3420; S2-02,
// S2-03): машины фирмы водителя с причинами несовместимости рейсу смены, фильтр «Все / Подходят к рейсу /
// Свободны», «Забронировать» → бронь на сервере → «Сегодня». Крошки подразделения у водителя нет (нет
// org_units.read, бриф §10 п. 10).
import { format, logisticsDriver as L, logisticsManager as LM, shell } from '@ortus/texts';
import { Banner, EmptyState, Skeleton } from '@ortus/ui';
import { type ReactElement, useState } from 'react';

import { useShell } from '../../../shell/context.tsx';
import { problemText, useBusy } from '../../../shell/run.tsx';
import { useMyTrip, useVehicles } from './api.ts';
import { useBook } from './book.ts';
import { carCards, type CarsFilter, reserveBlock } from './model.ts';
import { useOutbox } from './outbox/hooks.ts';
import { BookCard, ConflictAlert, Head, useNetwork } from './parts.tsx';
import { DRIVER_TEXT as T } from './texts.ts';
import './driver.css';

const FILTERS: readonly { key: CarsFilter; label: string }[] = [
  { key: 'all', label: LM.fleet.filters.all },
  { key: 'fit', label: L.cars.fitTrip },
  { key: 'free', label: LM.fleet.filters.free },
];

export default function CarsPage(): ReactElement {
  const { tenantId: id, tenant, readOnly, go } = useShell();
  const tenantId = id ?? '';
  const online = useNetwork();
  // Очередь отправки водителя (W2.24): отправка и тосты «— принято сервером» и на «Автомобилях».
  useOutbox(tenantId);
  const [filter, setFilter] = useState<CarsFilter>('all');
  const trip = useMyTrip(tenantId);
  const vehicles = useVehicles(tenantId);
  const plan = trip.data ?? null;
  const { book, conflict, refresh } = useBook(tenantId, plan, online);
  const refreshing = useBusy('refresh');
  const busyAny = useBusy();
  const tenantState = tenant?.tenantState?.status;
  const blocked = reserveBlock(
    online,
    tenantState === 'read_only' || tenantState === 'suspended',
    readOnly,
  );

  let body: ReactElement;
  if (vehicles.isPending || trip.isPending) {
    body = <Skeleton lines={6} label={shell.a11y.loading} />;
  } else if (vehicles.isError || trip.isError) {
    const failed = vehicles.isError ? vehicles : trip;
    body = (
      <Banner
        tone="danger"
        title={format(vehicles.isError ? T.carsFailed : T.loadFailed, {
          error: problemText(failed.error),
        })}
        action={{ label: T.retry, onPress: () => void failed.refetch() }}
      />
    );
  } else if (!plan) {
    body = <EmptyState icon="event_busy" title={T.noTrip.title} text={T.noTrip.text} dashed />;
  } else {
    const cars = carCards(vehicles.data, plan, !!blocked, filter);
    body = (
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

  return (
    <section aria-labelledby="h-cars" className="ox-dr">
      <Head id="h-cars" title={shell.nav.items.cars} sub={L.cars.intro} />
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
      {conflict ? (
        <ConflictAlert text={conflict} busy={refreshing} onRefresh={() => void refresh()} />
      ) : null}
      {body}
    </section>
  );
}
