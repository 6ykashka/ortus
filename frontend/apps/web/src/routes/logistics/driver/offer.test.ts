// W2.74 · Модель машин на выбор водителю (S2-20, D-35; макеты 1c–1e «Временный водитель - варианты.dc.html»,
// renderVals :516–628): состояния предложения по броням рейса (две на выбор, одна, выбрана, срок прошёл), карточки 1c,
// лист 1d «Берёте …?», статус 1e, временный рейс без машины, только предложенные машины на «Автомобилях», имена
// невыбранной машины после выбора (сервер её больше не показывает), подписи с фирмами и без их названий.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  firmsOf,
  heldBanner,
  isTemporaryTrip,
  noneText,
  type Offer,
  offerBlock,
  offerChip,
  offerClosedShown,
  offeredVehicleIds,
  offerOf,
  oneNote,
  recallNames,
  rememberNames,
  sheetOf,
  twoLines,
  whoInspects,
} from './offer.ts';

type S = components['schemas'];

const MSK = 'Europe/Moscow';
const W = { startsAt: '2026-10-01T11:00:00Z', endsAt: '2026-10-01T15:00:00Z', timeZone: MSK };
const UNTIL = '2026-10-01T10:30:00Z';
const ME = 'm-akh';
const YUG = 'unit-yug';
const SEVER = 'unit-sever';

const plan = (o: Partial<S['TripPlan']> = {}): S['TripPlan'] => ({
  id: 'trip-1',
  number: 'Р-212',
  title: 'Сборный груз',
  orgUnitId: YUG,
  state: 'planned',
  plannedWindow: W,
  distanceKm: '35',
  cargo: {
    description: 'Сухой груз · 6 паллет-мест',
    weightKg: '500',
    volumeM3: '6',
    lengthM: '2',
  },
  stops: [],
  driverMemberId: ME,
  revision: 3,
  ...o,
});

const vehicle = (
  id: string,
  name: string,
  plate: string,
  unit: string,
  o: Partial<S['Vehicle']> = {},
): S['Vehicle'] => ({
  id,
  orgUnitId: unit,
  registrationNumber: plate,
  displayName: name,
  bodyType: 'van',
  capacity: {
    payloadKg: '1600',
    volumeM3: '14',
    cargoLengthM: '4.3',
    cargoWidthM: '2',
    cargoHeightM: '2',
  },
  equipment: [],
  status: 'reserved',
  odometerKm: '84370',
  revision: 1,
  heldByTripId: 'trip-1',
  depot: 'Склад № 1',
  ...o,
});

const SPRINTER = vehicle('v6', 'Mercedes Sprinter', 'Т 771 ЕХ 77', SEVER, {
  depot: 'Стоянка Север',
});
const ELF = vehicle('v5', 'Isuzu Elf', 'К 120 РУ 77', YUG, {
  bodyType: 'refrigerated',
  temperatureMinC: '-18',
  temperatureMaxC: '8',
  capacity: {
    payloadKg: '1200',
    volumeM3: '11',
    cargoLengthM: '3.4',
    cargoWidthM: '2',
    cargoHeightM: '2',
  },
  depot: 'У места погрузки: Склад № 1, Лобня',
});

const res = (
  o: Partial<S['Reservation']> & Pick<S['Reservation'], 'id' | 'vehicleId'>,
): S['Reservation'] => ({
  driverMemberId: ME,
  window: W,
  state: 'held',
  holdExpiresAt: UNTIL,
  revision: 1,
  tripId: 'trip-1',
  offerGroupId: 'g-1',
  offeredToMemberId: ME,
  chooseUntil: UNTIL,
  ...o,
});

const HOST = res({ id: 'r-host', vehicleId: 'v5', offerKind: 'host' });
const USUAL = res({ id: 'r-usual', vehicleId: 'v6', offerKind: 'usual' });

describe('offerOf — состояние предложения по броням рейса', () => {
  it('две брони held одной группы — «Выберите машину»: обычная первой, затем машина логиста (1c)', () => {
    const o = offerOf([HOST, USUAL], plan(), [SPRINTER, ELF]);
    expect(o?.state).toBe('two');
    const two = o as Extract<Offer, { state: 'two' }>;
    expect(two.chooseUntil).toBe(UNTIL);
    expect(two.cars.map((c) => [c.reservationId, c.kind, c.model, c.plate])).toEqual([
      ['r-usual', 'usual', 'Mercedes Sprinter', 'Т 771 ЕХ 77'],
      ['r-host', 'host', 'Isuzu Elf', 'К 120 РУ 77'],
    ]);
    expect(two.cars.map((c) => c.tag)).toEqual([
      { label: 'Ваша обычная', tone: 'neutral', icon: 'history' },
      { label: 'Поставил логист', tone: 'info', icon: 'assignment_ind' },
    ]);
    expect(two.cars[1]).toMatchObject({
      icon: 'ac_unit',
      // Знак минуса — как у характеристик машин этапа 2 (tempLabel домена, carCards :3410).
      specs: 'Рефрижератор · 1,2 т · 11 м³ · кузов 3,4 м · -18…+8 °C',
      place: 'У места погрузки: Склад № 1, Лобня',
      fits: true,
    });
    expect(two.cars[0]).toMatchObject({ icon: 'local_shipping', place: 'Стоянка Север' });
  });

  it('выбрана водителем: confirmed и снятая с причиной chosen — сразу осмотр, освобождённая машина (1e)', () => {
    const chosen = {
      ...USUAL,
      state: 'confirmed' as const,
      chosenAt: '2026-10-01T10:12:00Z',
      holdExpiresAt: W.endsAt,
    };
    const released = {
      ...HOST,
      state: 'released' as const,
      releasedAt: '2026-10-01T10:12:00Z',
      releaseReason: 'chosen' as const,
    };
    const o = offerOf(
      [released, chosen],
      plan({ state: 'assigned', vehicleId: 'v6', reservationId: 'r-usual' }),
      [SPRINTER],
    );
    expect(o).toMatchObject({
      state: 'one',
      chosen: true,
      car: { reservationId: 'r-usual', kind: 'usual', model: 'Mercedes Sprinter' },
      // Машины логиста в списке водителя больше нет — имени нет без памяти экрана.
      released: { model: '', plate: '', at: '2026-10-01T10:12:00Z' },
    });
    const named = offerOf(
      [released, chosen],
      plan({ state: 'assigned', vehicleId: 'v6', reservationId: 'r-usual' }),
      [SPRINTER],
      { v5: { model: 'Isuzu Elf', plate: 'К 120 РУ 77' } },
    );
    expect(named).toMatchObject({ released: { model: 'Isuzu Elf', plate: 'К 120 РУ 77' } });
  });

  it('одна машина — confirmed без снятых: «Машина на сегодня», выбора нет (вариант (b))', () => {
    const one = { ...HOST, state: 'confirmed' as const, holdExpiresAt: W.endsAt };
    delete (one as Partial<S['Reservation']>).chooseUntil;
    expect(
      offerOf([one], plan({ state: 'assigned', vehicleId: 'v5', reservationId: 'r-host' }), [ELF]),
    ).toMatchObject({
      state: 'one',
      chosen: false,
      released: null,
      car: { kind: 'host', model: 'Isuzu Elf' },
    });
  });

  it('срок выбора прошёл: машина логиста confirmed, обычная снята (deadline) — «Машина на сегодня» и освобождённая', () => {
    const host = { ...HOST, state: 'confirmed' as const, chosenAt: UNTIL, holdExpiresAt: W.endsAt };
    const usual = {
      ...USUAL,
      state: 'released' as const,
      releasedAt: UNTIL,
      releaseReason: 'deadline' as const,
    };
    expect(offerOf([host, usual], plan({ state: 'assigned' }), [ELF, SPRINTER])).toMatchObject({
      state: 'one',
      chosen: false,
      released: { model: 'Mercedes Sprinter', plate: 'Т 771 ЕХ 77', at: UNTIL },
    });
  });

  it('без предложения, другие рейсы и снятые переводом — не предложение', () => {
    expect(offerOf([], plan(), [])).toBeNull();
    expect(
      offerOf([res({ id: 'x', vehicleId: 'v5', tripId: 'trip-2' })], plan(), [ELF]),
    ).toBeNull();
    const plain = res({ id: 'p', vehicleId: 'v5' });
    delete (plain as Partial<S['Reservation']>).offerGroupId;
    expect(offerOf([plain], plan(), [ELF])).toBeNull();
    const ended = [HOST, USUAL].map((r) => ({
      ...r,
      state: 'released' as const,
      releaseReason: 'transfer_ended' as const,
    }));
    expect(offerOf(ended, plan(), [ELF, SPRINTER])).toBeNull();
    // Предложено другому водителю — не моё.
    expect(
      offerOf(
        [
          { ...HOST, offeredToMemberId: 'm-other' },
          { ...USUAL, offeredToMemberId: 'm-other' },
        ],
        plan(),
        [],
      ),
    ).toBeNull();
  });

  it('409 offer_closed: сообщение — пока предложение той же группы; новое предложение логиста его снимает', () => {
    const two = offerOf([HOST, USUAL], plan(), [SPRINTER, ELF]);
    expect(two).toMatchObject({ state: 'two', groupId: 'g-1' });
    // Срок прошёл: та же группа — машина логиста на сегодня, сообщение остаётся.
    const host = { ...HOST, state: 'confirmed' as const, chosenAt: UNTIL, holdExpiresAt: W.endsAt };
    const usual = { ...USUAL, state: 'released' as const, releaseReason: 'deadline' as const };
    const after = offerOf([host, usual], plan({ state: 'assigned' }), [ELF, SPRINTER]);
    expect(after).toMatchObject({ state: 'one', groupId: 'g-1' });
    expect(offerClosedShown('g-1', after)).toBe(true);
    // Логист предложил машины снова (новая группа, снова выбор) — старое сообщение не показывается.
    const again = offerOf(
      [
        { ...HOST, id: 'r-host-2', offerGroupId: 'g-2' },
        { ...USUAL, id: 'r-usual-2', offerGroupId: 'g-2' },
      ],
      plan(),
      [SPRINTER, ELF],
    );
    expect(again).toMatchObject({ state: 'two', groupId: 'g-2' });
    expect(offerClosedShown('g-1', again)).toBe(false);
    expect(offerClosedShown('g-1', null)).toBe(false);
    expect(offerClosedShown(null, after)).toBe(false);
  });

  it('машина брони не видна в списке — карточка без характеристик, модель «—»', () => {
    const o = offerOf([HOST, USUAL], plan(), [SPRINTER]) as Extract<Offer, { state: 'two' }>;
    expect(o.cars[1]).toMatchObject({ model: '—', plate: '', specs: '', place: '', fits: false });
  });
});

describe('подписи 1c–1e', () => {
  const firms = firmsOf(undefined, plan(), SEVER);
  const named = firmsOf(
    [
      { id: YUG, name: 'Юг Транс' },
      { id: SEVER, name: 'Север Логистик' },
    ],
    plan(),
    SEVER,
  );
  const two = offerOf([HOST, USUAL], plan(), [SPRINTER, ELF]) as Extract<Offer, { state: 'two' }>;
  const [usual, host] = two.cars as [
    NonNullable<(typeof two.cars)[0]>,
    NonNullable<(typeof two.cars)[1]>,
  ];

  it('1c: срок выбора и чат рейса без ссылки (Q-W2.70-4)', () => {
    expect(twoLines(two, plan())).toEqual({
      sub: 'До 13:30. Вторую бронь снимем сразу после выбора.',
      footer: 'Нужна другая машина — напишите логисту в чат рейса Р-212.',
    });
  });

  it('1d: «Берёте обычную?» — вторая вернётся в фирму рейса, осмотр увидят обе фирмы', () => {
    expect(sheetOf(usual, host, plan(), named)).toEqual({
      title: 'Берёте Mercedes Sprinter?',
      sub: 'Т 771 ЕХ 77 · ваша обычная',
      items: [
        {
          icon: 'event_busy',
          tone: 'warn',
          text: 'Бронь Isuzu Elf К 120 РУ 77 снимется, машина вернётся в Юг Транс.',
        },
        { icon: 'photo_camera', text: 'Дальше осмотр: 5 фото, пробег, топливо и чек-лист.' },
        {
          icon: 'visibility',
          text: 'Осмотр и дефекты увидят Юг Транс (рейс) и Север Логистик (машина).',
        },
        { icon: 'undo', text: 'Поменять машину после выбора может только логист.' },
      ],
    });
  });

  it('1d без названий фирм (нет org_units.read) — нейтральные формулировки', () => {
    expect(sheetOf(host, usual, plan(), firms).items.map((i) => i.text)).toEqual([
      'Бронь Mercedes Sprinter Т 771 ЕХ 77 снимется, машина вернётся в свою фирму.',
      'Дальше осмотр: 5 фото, пробег, топливо и чек-лист.',
      'Осмотр увидит фирма рейса.',
      'Поменять машину после выбора может только логист.',
    ]);
    expect(sheetOf(usual, host, plan(), firms).items[2]?.text).toBe(
      'Осмотр и дефекты увидят фирма рейса и фирма машины.',
    );
    expect(sheetOf(host, usual, plan(), firms).sub).toBe('К 120 РУ 77 · поставил логист');
  });

  it('1e: статус брони до конца окна и освобождённая машина; без имени — «Вторая машина»', () => {
    const one: Extract<Offer, { state: 'one' }> = {
      state: 'one',
      groupId: 'g-1',
      chosen: true,
      car: usual,
      released: { model: 'Isuzu Elf', plate: 'К 120 РУ 77', at: '2026-10-01T10:12:00Z' },
    };
    expect(heldBanner(one, plan())).toEqual({
      held: 'Бронь подтверждена сервером · Mercedes Sprinter до 18:00',
      released: 'Isuzu Elf К 120 РУ 77 освобождена в 13:12',
    });
    expect(
      heldBanner({ ...one, released: { model: '', plate: '', at: '2026-10-01T10:12:00Z' } }, plan())
        .released,
    ).toBe('Вторая машина освобождена в 13:12');
    expect(heldBanner({ ...one, released: null }, plan()).released).toBeNull();
    expect(whoInspects(usual, plan(), named)).toBe(
      'Осмотр увидят Юг Транс (рейс) и Север Логистик (машина).',
    );
    expect(whoInspects(usual, plan(), firms)).toBe('Осмотр увидят фирма рейса и фирма машины.');
    expect(whoInspects(host, plan(), named)).toBe('Осмотр увидит Юг Транс.');
    expect(whoInspects(host, plan(), firms)).toBe('Осмотр увидит фирма рейса.');
  });

  it('1c одна машина и машины нет — с названиями фирм и без', () => {
    expect(oneNote(host, named)).toBe(
      'Логист поставил машину при согласовании. Подтверждать бронь не нужно: первый снимок осмотра закрепит её за вами.',
    );
    expect(oneNote(usual, named)).toBe(
      'Север Логистик выдал вашу машину на этот рейс. Подтверждать бронь не нужно: первый снимок осмотра закрепит её за вами.',
    );
    expect(oneNote(usual, firms)).toBe(
      'Ваша фирма выдала вашу машину на этот рейс. Подтверждать бронь не нужно: первый снимок осмотра закрепит её за вами.',
    );
    expect(noneText(named)).toBe(
      'Север Логистик выдал вас на рейс без обычной машины. Логист Юг Транс поставит машину, придёт уведомление.',
    );
    expect(noneText(firms)).toBe(
      'Ваша фирма выдала вас на рейс без обычной машины. Логист фирмы рейса поставит машину, придёт уведомление.',
    );
  });

  it('чип рейса 1c по состоянию предложения', () => {
    expect(offerChip('two')).toEqual({ label: 'Выберите машину', tone: 'warn', icon: 'touch_app' });
    expect(offerChip('one')).toEqual({
      label: 'Машина назначена',
      tone: 'info',
      icon: 'event_available',
    });
    expect(offerChip('none')).toEqual({
      label: 'Ждёт машину',
      tone: 'warn',
      icon: 'hourglass_top',
    });
  });
});

describe('временный рейс, связь, «Автомобили»', () => {
  const cap = (permission: string, kind: string, ids: string[] = []) => ({
    permission,
    scope: { kind, resourceIds: ids, includeDescendants: true },
  });

  it('рейс чужой фирмы без права брони в ней — временный; своя фирма и бронь в ней — нет', () => {
    const caps = [
      cap('fleet.reservations.create', 'org_unit', [SEVER]),
      cap('fleet.reservations.choose', 'self'),
    ];
    expect(isTemporaryTrip(plan(), { orgUnitIds: [SEVER], caps }, false)).toBe(true);
    expect(isTemporaryTrip(plan({ orgUnitId: SEVER }), { orgUnitIds: [SEVER], caps }, false)).toBe(
      false,
    );
    expect(
      isTemporaryTrip(
        plan(),
        { orgUnitIds: [SEVER], caps: [cap('fleet.reservations.create', 'tenant')] },
        false,
      ),
    ).toBe(false);
    // Есть предложение — выбор вместо брони, рейс временного водителя или свой (правило 9).
    expect(isTemporaryTrip(plan({ orgUnitId: SEVER }), { orgUnitIds: [SEVER], caps }, true)).toBe(
      true,
    );
    // Подразделения участника в контексте пусты (сид mock) — решают права: бронь только в своей фирме — временный.
    expect(isTemporaryTrip(plan(), { orgUnitIds: [], caps }, false)).toBe(true);
    expect(isTemporaryTrip(plan({ orgUnitId: SEVER }), { orgUnitIds: [], caps }, false)).toBe(
      false,
    );
    // Бронь «на себя» — свои рейсы любой фирмы (W2.22).
    expect(
      isTemporaryTrip(
        plan(),
        { orgUnitIds: [], caps: [cap('fleet.reservations.create', 'self')] },
        false,
      ),
    ).toBe(false);
  });

  it('выбор только со связью (правило 5, D-09); пробный период и модуль — причины брони', () => {
    expect(offerBlock(false, false, false)).toEqual({
      text: 'Нет связи: выбор машины требует подтверждения сервера.',
      icon: 'cloud_off',
    });
    expect(offerBlock(true, true, false)?.icon).toBe('lock_clock');
    expect(offerBlock(true, false, false)).toBeNull();
  });

  it('«Автомобили»: машины действующих броней предложения рейса', () => {
    const released = { ...HOST, state: 'released' as const, releaseReason: 'chosen' as const };
    const chosen = { ...USUAL, state: 'confirmed' as const };
    expect([...offeredVehicleIds([HOST, USUAL], plan())].sort()).toEqual(['v5', 'v6']);
    expect([...offeredVehicleIds([released, chosen], plan())]).toEqual(['v6']);
    expect(offeredVehicleIds([], plan()).size).toBe(0);
  });

  it('имена машин предложения переживают перезагрузку (sessionStorage), сбой хранилища не ломает экран', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const two = offerOf([HOST, USUAL], plan(), [SPRINTER, ELF]) as Extract<Offer, { state: 'two' }>;
    rememberNames(storage, 'g-1', two.cars);
    expect(recallNames(storage, 'g-1')).toEqual({
      v6: { model: 'Mercedes Sprinter', plate: 'Т 771 ЕХ 77' },
      v5: { model: 'Isuzu Elf', plate: 'К 120 РУ 77' },
    });
    expect(recallNames(storage, 'g-2')).toEqual({});
    // Стенд (возврат 1): после выбора список машин перечитан раньше броней — машина логиста в нём уже не видна,
    // карточка без номера; запись имён не затирает то, что водитель видел до выбора.
    const [usualCar, hostCar] = two.cars as [(typeof two.cars)[0], (typeof two.cars)[0]];
    rememberNames(storage, 'g-1', [usualCar, { ...hostCar, model: '—', plate: '' }]);
    expect(recallNames(storage, 'g-1')).toEqual({
      v6: { model: 'Mercedes Sprinter', plate: 'Т 771 ЕХ 77' },
      v5: { model: 'Isuzu Elf', plate: 'К 120 РУ 77' },
    });
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => rememberNames(broken, 'g-1', two.cars)).not.toThrow();
    expect(recallNames(broken, 'g-1')).toEqual({});
    expect(recallNames(null, 'g-1')).toEqual({});
  });
});
