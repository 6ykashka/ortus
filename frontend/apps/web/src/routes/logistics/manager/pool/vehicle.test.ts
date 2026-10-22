// W2.73 · Модель S2-20 «Машина для временного водителя» (D-35; эталон design-2026-10-19b · «Временный водитель -
// варианты.dc.html»): блок «Машина» диалога 1a (renderVals :516–569), входящий запрос фирмы водителя 1b (:572–576),
// итог запроса у логиста 1f (:609–625). Ожидания — подписи макетов дословно на данных сида «Альты» (Р-211, машины
// «Север Логистик») и обычной машине Hyundai HD-35 «Юг Транс» макета.
import type { components } from '@ortus/api-client';
import { beforeAll, describe, expect, it } from 'vitest';

import { fleetData } from '../fleet/fixtures.test-util.ts';
import { POOL_TEXT } from './texts.ts';
import {
  carBlock,
  type CarBlock,
  carView,
  incomingCar,
  requestRows,
  transferView,
  vehicleBody,
} from './vehicle.ts';

type S = components['schemas'];

const MSK = 'Europe/Moscow';
const w = (from: string, to: string): S['TimeWindow'] => ({
  startsAt: `2026-10-01T${from}:00Z`,
  endsAt: `2026-10-01T${to}:00Z`,
  timeZone: MSK,
});

let trip: S['TripPlan'];
let vehicles: S['Vehicle'][];

beforeAll(async () => {
  const d = await fleetData('owner');
  const t = d.trips.find((x) => x.number === 'Р-211');
  if (!t) throw new Error('нет Р-211');
  trip = t;
  vehicles = d.vehicles;
});

/** Обычная машина макета (cars.home :504): рефрижератор −10…+10 °C, 1,8 т, 13 м³, кузов 3,6 м. */
const hyundai = (o: Partial<S['PoolUsualVehicle']> = {}): S['PoolUsualVehicle'] => ({
  vehicleId: 'v-hd35',
  displayName: 'Hyundai HD-35',
  registrationNumber: 'Н 384 ТК 77',
  bodyType: 'refrigerated',
  capacity: {
    payloadKg: '1800',
    volumeM3: '13',
    cargoLengthM: '3.6',
    cargoWidthM: '2',
    cargoHeightM: '1.9',
  },
  temperatureMinC: '-10',
  temperatureMaxC: '10',
  fit: { ok: true, reasons: [] },
  freeForWindow: true,
  ...o,
});

/** Та же машина без охлаждения (homeSpecs при homeCarFits=false :556). */
const hyundaiVan = (): S['PoolUsualVehicle'] => {
  const v = hyundai({
    bodyType: 'van',
    fit: { ok: false, reasons: ['Температура: без охлаждения, нужно +2…+6 °C'] },
  });
  delete v.temperatureMinC;
  delete v.temperatureMaxC;
  return v;
};

const block = (usual?: S['PoolUsualVehicle']): CarBlock =>
  carBlock({
    trip,
    vehicles,
    ...(usual ? { usual } : {}),
    home: 'Юг Транс',
    unit: 'Север Логистик',
  });

const REQ = () => trip.plannedWindow;

describe('1a · строки диалога', () => {
  it('«Рейс» с датой, «Груз», «Доступ», «Согласует» (:146–151)', () => {
    expect(requestRows(trip, REQ(), 'Юг Транс')).toEqual([
      { term: 'Рейс', value: 'Р-211 · Охлаждённая продукция · 01.10, 14:00–18:00' },
      { term: 'Груз', value: '0,6 т · 7 м³ · кузов от 2,4 м · +2…+6 °C' },
      { term: 'Доступ', value: 'С одобрения до 18:00, только этот рейс' },
      { term: 'Согласует', value: 'Менеджер фирмы Юг Транс' },
    ]);
  });

  it('водитель свободен с 15:00: «Доступ» — с начала срока (Q-W2.51-10)', () => {
    const rows = requestRows(trip, w('12:00', '15:00'), 'Восток Карго');
    expect(rows[2]).toEqual({ term: 'Доступ', value: 'С 15:00 до 18:00, только этот рейс' });
  });
});

describe('1a · блок «Машина»', () => {
  it('обычная машина подходит: варианты, подходящие свободные машины фирмы рейса, режим «Наша + можно свою»', () => {
    const b = block(hyundai());
    expect(b.usual).toEqual({
      id: 'v-hd35',
      model: 'Hyundai HD-35',
      plate: 'Н 384 ТК 77',
      firm: 'Юг Транс',
      specs: 'Рефрижератор · 1,8 т · 13 м³ · кузов 3,6 м · −10…+10 °C',
      fits: true,
      fitText: 'Подходит рейсу · свободна 14:00–18:00',
      approve: 'Машину тоже согласует Юг Транс.',
      short: '',
    });
    expect(b.hosts.map((h) => `${h.model} · ${h.plate}`)).toEqual(['Ford Transit · М 608 КТ 77']);
    expect(b.hostHint).toBe('Рейсу подходит 1 из 4 свободных машин Север Логистик.');
    expect(b.initial).toBe('choice');
  });

  it('«Наша + можно свою»: галочка отмечена, подсказка, итог из трёх пунктов и доступа (:533–547, :559)', () => {
    const b = block(hyundai());
    const v = carView({ block: b, mode: 'choice', hostId: b.hosts[0]?.id ?? null }, trip, REQ());
    expect(v).toMatchObject({
      homeOn: false,
      hostOn: true,
      choiceOn: true,
      choiceDisabled: false,
      blocked: false,
      eff: 'choice',
      choiceHint: 'Водитель выберет в день рейса до 13:30: Ford Transit или свою Hyundai HD-35.',
    });
    expect(v.summary).toEqual([
      {
        icon: 'event_available',
        text: 'Две брони до выбора на 14:00–18:00: Ford Transit и Hyundai HD-35. До рейса Hyundai работает в Юг Транс.',
        danger: false,
      },
      {
        icon: 'touch_app',
        text: 'Водитель выберет машину до 13:30. Вторая бронь снимется сразу.',
        danger: false,
      },
      {
        icon: 'schedule',
        text: 'Не выберет — останется Ford Transit, Hyundai вернётся в Юг Транс.',
        danger: false,
      },
      {
        icon: 'lock',
        text: 'Доступ водителя — только к рейсу Р-211 до 18:00. История и начисления остаются в Юг Транс.',
        danger: false,
      },
    ]);
    expect(vehicleBody({ block: b, mode: 'choice', hostId: b.hosts[0]?.id ?? null })).toEqual({
      mode: 'host_or_home',
      hostVehicleId: b.hosts[0]?.id,
    });
  });

  it('«Только наша»: бронь машины фирмы рейса, водителю нечего подтверждать; тело host', () => {
    const b = block(hyundai());
    const s = { block: b, mode: 'host' as const, hostId: b.hosts[0]?.id ?? null };
    const v = carView(s, trip, REQ());
    expect(v.choiceOn).toBe(false);
    expect(v.summary.map((x) => x.text).slice(0, 2)).toEqual([
      'Бронь Ford Transit на 14:00–18:00.',
      'Водителю нечего подтверждать: он сразу начинает осмотр.',
    ]);
    expect(v.summary.map((x) => x.icon)).toEqual(['event_available', 'photo_camera', 'lock']);
    expect(vehicleBody(s)).toEqual({ mode: 'host', hostVehicleId: b.hosts[0]?.id });
  });

  it('«Своя машина водителя»: бронь обычной, если фирма одобрит; тело home', () => {
    const b = block(hyundai());
    const s = { block: b, mode: 'home' as const, hostId: b.hosts[0]?.id ?? null };
    const v = carView(s, trip, REQ());
    expect(v).toMatchObject({ homeOn: true, hostOn: false, choiceOn: false, eff: 'home' });
    expect(v.summary.map((x) => [x.icon, x.text]).slice(0, 2)).toEqual([
      ['event_available', 'Бронь Hyundai HD-35 на 14:00–18:00, если Юг Транс одобрит машину.'],
      ['help', 'Одобрят только водителя — рейс попадёт в «Требует решения», машину поставите вы.'],
    ]);
    expect(vehicleBody(s)).toEqual({ mode: 'home' });
  });

  it('обычная не подходит: причина, галочка недоступна, «своя» блокирует отправку, запрос — host (:519–522, :532)', () => {
    const b = block(hyundaiVan());
    expect(b.usual).toMatchObject({
      specs: 'Фургон · 1,8 т · 13 м³ · кузов 3,6 м · без охлаждения',
      fits: false,
      fitText: 'Не подходит рейсу: нет охлаждения +2…+6 °C',
      short: 'нет охлаждения',
    });
    const choice = carView(
      { block: b, mode: 'choice', hostId: b.hosts[0]?.id ?? null },
      trip,
      REQ(),
    );
    expect(choice).toMatchObject({
      choiceOn: false,
      choiceDisabled: true,
      blocked: false,
      eff: 'host',
      choiceHint: 'Недоступно: обычная машина не подходит рейсу, нет охлаждения.',
    });
    expect(vehicleBody({ block: b, mode: 'choice', hostId: b.hosts[0]?.id ?? null })).toEqual({
      mode: 'host',
      hostVehicleId: b.hosts[0]?.id,
    });
    const home = carView({ block: b, mode: 'home', hostId: b.hosts[0]?.id ?? null }, trip, REQ());
    expect(home.blocked).toBe(true);
    expect(home.summary[0]).toEqual({
      icon: 'error',
      text: 'Обычная машина не подходит рейсу. Выберите «Ставим нашу машину».',
      danger: true,
    });
    expect(home.summary).toHaveLength(2);
  });

  it('обычная занята на время рейса — не подходит с причиной (правило 2)', () => {
    const b = block(hyundai({ freeForWindow: false }));
    expect(b.usual?.fits).toBe(false);
    expect(b.usual?.fitText).toBe('Не подходит рейсу: занята на время рейса');
  });

  it('обычная мала по грузоподъёмности — причина по шаблону POOL_TEXT.vehicle.reason (тексты не в коде)', () => {
    expect(POOL_TEXT.vehicle.reason).toBe('{check}: {value}, нужно {need}');
    const b = block(
      hyundai({
        capacity: {
          payloadKg: '500',
          volumeM3: '13',
          cargoLengthM: '3.6',
          cargoWidthM: '2',
          cargoHeightM: '1.9',
        },
        fit: { ok: false, reasons: ['Грузоподъёмность: 0,5 т, нужно от 0,6 т'] },
      }),
    );
    expect(b.usual).toMatchObject({
      fits: false,
      fitText: 'Не подходит рейсу: грузоподъёмность: 0,5 т, нужно от 0,6 т',
      short: 'грузоподъёмность: 0,5 т, нужно от 0,6 т',
    });
  });

  it('нет обычной машины (правило 1): варианта «своя» нет, режим «Только наша», тело host', () => {
    const b = block();
    expect(b.usual).toBeNull();
    expect(b.initial).toBe('host');
    // Итог и строка доступа — с фирмой водителя (а не фирмой обычной машины, которой нет).
    expect(
      carView({ block: b, mode: 'host', hostId: null }, trip, REQ()).summary.map((x) => x.text),
    ).toEqual([
      'Бронь Ford Transit на 14:00–18:00.',
      'Водителю нечего подтверждать: он сразу начинает осмотр.',
      'Доступ водителя — только к рейсу Р-211 до 18:00. История и начисления остаются в Юг Транс.',
    ]);
    expect(vehicleBody({ block: b, mode: 'host', hostId: b.hosts[0]?.id ?? null })).toEqual({
      mode: 'host',
      hostVehicleId: b.hosts[0]?.id,
    });
  });

  it('нет подходящей свободной машины фирмы рейса: «0 из 4», запрос без машины или «своя» (Q-W2.73-1)', () => {
    const busy = vehicles.map((v) =>
      v.registrationNumber === 'М 608 КТ 77' ? { ...v, status: 'maintenance' as const } : v,
    );
    const none = carBlock({ trip, vehicles: busy, home: 'Юг Транс', unit: 'Север Логистик' });
    expect(none.hosts).toEqual([]);
    expect(none.hostHint).toBe('Рейсу подходит 0 из 3 свободных машин Север Логистик.');
    expect(none.initial).toBe('host');
    expect(vehicleBody({ block: none, mode: 'host', hostId: null })).toBeUndefined();
    expect(carView({ block: none, mode: 'host', hostId: null }, trip, REQ()).summary[0]).toEqual({
      icon: 'info',
      text: 'Машину поставите после одобрения на «Рабочем месте логиста».',
      danger: false,
    });
    const withHome = carBlock({
      trip,
      vehicles: busy,
      usual: hyundai(),
      home: 'Юг Транс',
      unit: 'Север Логистик',
    });
    expect(withHome.initial).toBe('home');
    expect(vehicleBody({ block: withHome, mode: 'home', hostId: null })).toEqual({ mode: 'home' });
  });
});

const ford = (o: Partial<S['TransferVehicle']> = {}): S['TransferVehicle'] => ({
  vehicleId: 'v-ford',
  displayName: 'Ford Transit',
  registrationNumber: 'М 608 КТ 77',
  orgUnitId: 'u-sever',
  orgUnitName: 'Север Логистик',
  ...o,
});
const hd = (o: Partial<S['TransferVehicle']> = {}): S['TransferVehicle'] => ({
  vehicleId: 'v-hd35',
  displayName: 'Hyundai HD-35',
  registrationNumber: 'Н 384 ТК 77',
  orgUnitId: 'u-yug',
  orgUnitName: 'Юг Транс',
  ...o,
});

const transfer = (o: Partial<S['DriverTransfer']> = {}): S['DriverTransfer'] => ({
  id: 'tr-1',
  driverMemberId: 'm-104',
  sourceOrgUnitId: 'u-yug',
  targetOrgUnitId: 'u-sever',
  window: w('11:00', '15:00'),
  status: 'requested',
  revision: 1,
  tripId: 'trip-211',
  publicationId: 'pub-104',
  driverDisplayName: 'Водитель #104',
  sourceOrgUnitName: 'Юг Транс',
  targetOrgUnitName: 'Север Логистик',
  tripNumber: 'Р-211',
  reason: 'Запрос на рейс Р-211',
  requestedAt: '2026-10-01T09:40:00Z',
  ...o,
});

describe('1b · входящий запрос фирмы водителя', () => {
  it('«Наша + можно свою»: «Машина», «Ваша машина», что откроется, три кнопки (:572–576)', () => {
    const c = incomingCar(
      transfer({ vehicle: { mode: 'host_or_home', hostVehicle: ford(), homeVehicle: hd() } }),
    );
    expect(c).toEqual({
      when: '01.10, 14:00–18:00 · доступ до 18:00',
      car: 'Их Ford Transit или ваша Hyundai HD-35 — на выбор водителя',
      usual: {
        name: 'Hyundai HD-35',
        plate: 'Н 384 ТК 77',
        free: 'Свободна 14:00–18:00',
        hold: 'Удерживается на 14:00–18:00, пока водитель выбирает (до 13:30). Не выберет её — сразу вернётся к вам.',
      },
      opens: 'Что откроется Север Логистик',
      opensDriver: 'Имя и телефон водителя до 18:00',
      hidden: 'Начисления, история рейсов, другие машины Юг Транс',
      note: 'Отклонить можно только с причиной. Начисления по рейсу ведутся отдельной записью, Юг Транс их не получает автоматически.',
      withUsual: true,
    });
  });

  it('«Своя машина водителя»: «Ваша Hyundai HD-35 · Н 384 ТК 77», занята рейсом', () => {
    const c = incomingCar(transfer({ vehicle: { mode: 'home', homeVehicle: hd() } }));
    expect(c.car).toBe('Ваша Hyundai HD-35 · Н 384 ТК 77');
    expect(c.usual?.hold).toBe('Занята на 14:00–18:00 рейсом Р-211 Север Логистик.');
    expect(c.withUsual).toBe(true);
  });

  it('«Только наша»: «Их Ford Transit · М 608 КТ 77», без «Ваша машина», две кнопки', () => {
    const c = incomingCar(transfer({ vehicle: { mode: 'host', hostVehicle: ford() } }));
    expect(c.car).toBe('Их Ford Transit · М 608 КТ 77');
    expect(c.usual).toBeUndefined();
    expect(c.withUsual).toBe(false);
  });

  it('запрос без машины (0.6.2): строки «Машина» нет', () => {
    const c = incomingCar(transfer());
    expect(c.car).toBeUndefined();
    expect(c.withUsual).toBe(false);
  });
});

const approved = (vehicle: S['DriverTransferVehicle']): S['DriverTransfer'] =>
  transfer({
    status: 'approved',
    decidedAt: '2026-10-01T09:58:00Z',
    grant: {
      assignmentId: 'as-1',
      orgUnitId: 'u-sever',
      tripId: 'trip-211',
      validFrom: '2026-10-01T11:00:00Z',
      validUntil: '2026-10-01T15:00:00Z',
      state: 'scheduled',
    },
    vehicle,
  });

describe('1f · итог запроса у логиста', () => {
  const offer = {
    mode: 'host_or_home' as const,
    homeDecision: 'approved' as const,
    offerGroupId: 'g-1',
    chooseUntil: '2026-10-01T10:30:00Z',
  };

  it('брони до выбора: обе машины, журнал из трёх строк, сноска, «Оставить Ford Transit»', () => {
    const v = transferView(
      approved({
        ...offer,
        hostVehicle: ford({ reservationId: 'r-ford', reservationState: 'held' }),
        homeVehicle: hd({ reservationId: 'r-hd', reservationState: 'held' }),
      }),
      trip,
    );
    expect(v.trip).toBe('Р-211 · Охлаждённая продукция · 14:00–18:00');
    expect(v.access).toBe('До 18:00, только этот рейс');
    expect(v.cars).toEqual([
      {
        key: 'v-hd35',
        name: 'Hyundai HD-35',
        plate: 'Н 384 ТК 77',
        firm: 'Юг Транс · обычная машина водителя',
        chip: { label: 'Бронь до выбора', tone: 'warn', icon: 'hourglass_top' },
      },
      {
        key: 'v-ford',
        name: 'Ford Transit',
        plate: 'М 608 КТ 77',
        firm: 'Север Логистик · наша',
        chip: { label: 'Бронь до выбора', tone: 'warn', icon: 'hourglass_top' },
      },
    ]);
    expect(v.none).toBeNull();
    expect(v.journal).toEqual([
      { t: '12:40', x: 'Вы запросили водителя. Машина: наша Ford Transit, можно свою обычную.' },
      { t: '12:58', x: 'Юг Транс одобрил водителя с машиной.' },
      { t: '12:58', x: 'Брони до выбора на 14:00–18:00: Ford Transit и Hyundai HD-35.' },
    ]);
    expect(v.note).toBe(
      'Если водитель не выбирает до 13:30, остаётся Ford Transit, а Hyundai HD-35 возвращается в Юг Транс.',
    );
    expect(v.keep).toEqual({ reservationId: 'r-ford', label: 'Оставить Ford Transit' });
  });

  it('водитель выбрал обычную: «Выбрана · 13:12», «Освобождена · 13:12», строка журнала (:614, :621)', () => {
    const v = transferView(
      approved({
        ...offer,
        hostVehicle: ford({
          reservationId: 'r-ford',
          reservationState: 'released',
          releasedAt: '2026-10-01T10:12:00Z',
          releaseReason: 'chosen',
        }),
        homeVehicle: hd({
          reservationId: 'r-hd',
          reservationState: 'confirmed',
          chosenAt: '2026-10-01T10:12:00Z',
        }),
      }),
      trip,
    );
    expect(v.cars.map((c) => c.chip)).toEqual([
      { label: 'Выбрана · 13:12', tone: 'ok', icon: 'check_circle' },
      { label: 'Освобождена · 13:12', tone: 'neutral', icon: 'event_busy' },
    ]);
    expect(v.journal.at(-1)).toEqual({
      t: '13:12',
      x: 'Водитель выбрал Hyundai HD-35. Ford Transit освобождена.',
    });
    expect(v.keep).toBeNull();
  });

  it('логист оставил свою, срок прошёл — строки журнала без эталона (Q-W2.73-3)', () => {
    const kept = (reason: 'manager' | 'deadline') =>
      transferView(
        approved({
          ...offer,
          hostVehicle: ford({
            reservationId: 'r-ford',
            reservationState: 'confirmed',
            chosenAt: '2026-10-01T10:20:00Z',
          }),
          homeVehicle: hd({
            reservationId: 'r-hd',
            reservationState: 'released',
            releasedAt: '2026-10-01T10:20:00Z',
            releaseReason: reason,
          }),
        }),
        trip,
      ).journal.at(-1);
    expect(kept('manager')).toEqual({
      t: '13:20',
      x: 'Вы оставили Ford Transit. Hyundai HD-35 освобождена.',
    });
    expect(kept('deadline')).toEqual({
      t: '13:20',
      x: 'Срок выбора прошёл: остаётся Ford Transit, Hyundai HD-35 вернулась в Юг Транс.',
    });
  });

  it('одна машина: «Назначена на Р-211», «Бронь Ford Transit на 14:00–18:00.», «водителя.»', () => {
    const v = transferView(
      approved({
        mode: 'host',
        offerGroupId: 'g-2',
        hostVehicle: ford({ reservationId: 'r-ford', reservationState: 'confirmed' }),
      }),
      trip,
    );
    expect(v.cars.map((c) => c.chip)).toEqual([
      { label: 'Назначена на Р-211', tone: 'info', icon: 'event_available' },
    ]);
    expect(v.journal.map((j) => j.x)).toEqual([
      'Вы запросили водителя. Машина: наша Ford Transit.',
      'Юг Транс одобрил водителя.',
      'Бронь Ford Transit на 14:00–18:00.',
    ]);
    expect(v.note).toBeNull();
    expect(v.keep).toBeNull();
  });

  it('«Только водителя»: «Машины нет…», журнал «только водителя, без машины.» и «Требует решения»', () => {
    const v = transferView(
      approved({ mode: 'home', homeDecision: 'declined', homeVehicle: hd() }),
      trip,
    );
    expect(v.cars).toEqual([]);
    expect(v.none).toBe('Машины нет: Юг Транс выдал водителя без обычной машины.');
    expect(v.journal.map((j) => j.x)).toEqual([
      'Вы запросили водителя. Машина: обычная машина водителя.',
      'Юг Транс одобрил только водителя, без машины.',
      'Машины нет, рейс попал в «Требует решения».',
    ]);
  });

  it('машину поставили после «Только водителя»: строка машины рейса из списка машин', () => {
    const fordRow = vehicles.find((v) => v.registrationNumber === 'М 608 КТ 77');
    const v = transferView(
      approved({ mode: 'home', homeDecision: 'declined', homeVehicle: hd() }),
      { ...trip, vehicleId: fordRow?.id ?? '' },
      vehicles,
      'Север Логистик',
    );
    expect(v.none).toBeNull();
    expect(v.cars).toEqual([
      {
        key: fordRow?.id,
        name: 'Ford Transit',
        plate: 'М 608 КТ 77',
        firm: 'Север Логистик · наша',
        chip: { label: 'Назначена на Р-211', tone: 'info', icon: 'event_available' },
      },
    ]);
  });
});
