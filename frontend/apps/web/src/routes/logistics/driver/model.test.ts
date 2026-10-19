// W2.22 · Модель экрана водителя: смена, этапы, карточка рейса, машины и совместимость (сид «Альты» 14.10 в
// строках контракта, как отдаёт MSW W2.00), осмотр → InspectionCreate, «Осталось», расход → TripExpenseCreate,
// итоги сдачи, разделы доработки, диалог «Завершить рейс».
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  carCards,
  crumbDate,
  emptyDraft,
  EXPENSE_KINDS,
  expenseBody,
  expenseErrors,
  expenseKindOptions,
  expenseRow,
  finishDialog,
  holdDetails,
  inspectionBody,
  isoDate,
  missingOf,
  newExpense,
  odoHint,
  photoCount,
  photoView,
  pickTrip,
  reserveBlock,
  reworkSteps,
  SIDES,
  steps,
  stopRows,
  summary,
  todayCrumb,
  tripChip,
  tripMeta,
  tripReq,
  type Draft,
} from './model.ts';

type S = components['schemas'];
const NB = ' ';
const W208 = {
  startsAt: '2026-10-01T06:00:00Z',
  endsAt: '2026-10-01T10:00:00Z',
  timeZone: 'Europe/Moscow',
};

const plan = (o: Partial<S['TripPlan']> = {}): S['TripPlan'] => ({
  id: 'trip-208',
  number: 'Р-208',
  title: 'Северный маршрут',
  orgUnitId: 'unit-sever',
  state: 'planned',
  plannedWindow: W208,
  distanceKm: '46',
  cargo: {
    description: 'Сухой груз · 14 паллет-мест',
    weightKg: '1100',
    volumeM3: '12',
    lengthM: '3',
  },
  stops: [
    {
      sequence: 1,
      op: 'load',
      address: 'Склад № 1, Лобня',
      plannedAt: '2026-10-01T06:00:00Z',
      weightKg: '1100',
      volumeM3: '12',
    },
    {
      sequence: 2,
      op: 'unload',
      address: 'Химки, ул. Заводская, 8',
      plannedAt: '2026-10-01T07:15:00Z',
      weightKg: '700',
      volumeM3: '8',
    },
    {
      sequence: 3,
      op: 'unload',
      address: 'Долгопрудный, Лихачёвский пр., 4',
      plannedAt: '2026-10-01T08:30:00Z',
      weightKg: '400',
      volumeM3: '4',
    },
  ],
  driverMemberId: 'm-vasiliev',
  driverDisplayName: 'Илья Васильев',
  revision: 1,
  ...o,
});

const vehicle = (
  id: string,
  name: string,
  plate: string,
  cap: [string, string, string],
  o: Partial<S['Vehicle']> = {},
): S['Vehicle'] => ({
  id,
  orgUnitId: 'unit-sever',
  registrationNumber: plate,
  displayName: name,
  bodyType: 'van',
  capacity: {
    payloadKg: cap[0],
    volumeM3: cap[1],
    cargoLengthM: cap[2],
    cargoWidthM: '2',
    cargoHeightM: '2',
  },
  equipment: [],
  status: 'available',
  odometerKm: '84370',
  revision: 1,
  depot: 'Склад № 1',
  ...o,
});

const FLEET: S['Vehicle'][] = [
  vehicle('v1', 'ГАЗель Next', 'А 412 МР 77', ['1500', '16', '4.2'], { bodyType: 'tent' }),
  vehicle('v6', 'Mercedes Sprinter', 'Т 771 ЕХ 77', ['1600', '14', '4.3']),
  vehicle('v2', 'Ford Transit', 'М 608 КТ 77', ['1200', '11', '3.4'], {
    bodyType: 'refrigerated',
    temperatureMinC: '-18',
    temperatureMaxC: '8',
  }),
  vehicle('v3', 'Hyundai Porter', 'В 233 ОС 77', ['900', '9', '3.1'], { bodyType: 'tent' }),
  vehicle('v4', 'ГАЗон Next', 'Е 905 НА 77', ['4500', '30', '5.1'], {
    status: 'maintenance',
    statusNote: 'Плановое ТО до 03.10',
  }),
];

describe('смена водителя', () => {
  it('первый незавершённый рейс по окну; иначе последний принятый; отменённые не считаются', () => {
    const a = plan({
      id: 'a',
      state: 'accepted',
      plannedWindow: { ...W208, startsAt: '2026-10-01T04:00:00Z' },
    });
    const b = plan({
      id: 'b',
      state: 'planned',
      plannedWindow: { ...W208, startsAt: '2026-10-01T09:00:00Z' },
    });
    const c = plan({ id: 'c', state: 'cancelled' });
    expect(pickTrip([b, a, c])?.id).toBe('b');
    expect(pickTrip([a, c])?.id).toBe('a');
    expect(pickTrip([c])).toBeUndefined();
    expect(pickTrip([])).toBeUndefined();
  });

  it('этапы: «Машина» текущий у запланированного, «Рейс» — у рейса в пути, все пройдены у принятого', () => {
    expect(steps('planned').map((s) => `${s.label}:${s.state}`)).toEqual([
      'Машина:current',
      'Осмотр:todo',
      'Рейс:todo',
      'Сдача:todo',
      'Приёмка:todo',
    ]);
    expect(steps('on_route').map((s) => s.state)).toEqual([
      'done',
      'done',
      'current',
      'todo',
      'todo',
    ]);
    expect(steps('rework')[3]?.state).toBe('current');
    expect(steps('accepted').every((s) => s.state === 'done')).toBe(true);
    expect(steps('defect_review')[1]?.state).toBe('current');
  });

  it('карточка рейса: мета, требования, чип состояния', () => {
    expect(tripMeta(plan())).toBe(
      '01.10.2026 · 09:00–13:00 · 3 точки · 46 км · Сухой груз · 14 паллет-мест',
    );
    expect(tripReq(plan()).map((r) => r.text)).toEqual([
      'от 1,1 т',
      'от 12 м³',
      'кузов от 3 м',
      'без охлаждения',
    ]);
    const cold = plan({ cargo: { ...plan().cargo, temperatureMinC: '2', temperatureMaxC: '6' } });
    expect(tripReq(cold)[3]?.text).toBe('+2…+6 °C');
    expect(tripChip('defect_review')).toEqual({
      label: 'Дефект на проверке',
      tone: 'danger',
      icon: 'report',
    });
    expect(tripChip('on_route').label).toBe('В рейсе');
  });

  // Эталон зашивает «среда, 1 октября» (:665); 01.10.2026 — четверг: день недели считается по дате рейса.
  it('крошка «Илья Васильев · четверг, 1 октября» и дата для поля «Дата»', () => {
    expect(crumbDate(W208.startsAt)).toBe('четверг, 1 октября');
    expect(todayCrumb('Илья Васильев', W208.startsAt)).toBe('Илья Васильев · четверг, 1 октября');
    expect(isoDate('2026-09-30T22:30:00Z')).toBe('2026-10-01');
  });
});

describe('машины рейса (carCards)', () => {
  it('порядок, подписи, причины: подходящие с «Забронировать», затем неподходящие', () => {
    const cards = carCards(FLEET, plan(), false);
    expect(cards.map((c) => c.model)).toEqual([
      'ГАЗель Next',
      'Mercedes Sprinter',
      'ГАЗон Next',
      'Ford Transit',
      'Hyundai Porter',
    ]);
    const [gazel, , gazon, ford, porter] = cards;
    expect(gazel).toMatchObject({
      canBook: true,
      fitOk: true,
      bookLabel: 'Забронировать',
      plate: 'А 412 МР 77',
      icon: 'local_shipping',
      chip: { label: 'Свободна', tone: 'ok', icon: 'check_circle' },
    });
    expect(gazel?.specs).toBe('Тент · 1,5 т · 16 м³ · кузов 4,2 м');
    expect(ford?.reasons).toEqual(['Объём: 11 м³, нужно от 12 м³']);
    expect(ford?.specs).toBe('Рефрижератор · 1,2 т · 11 м³ · кузов 3,4 м · -18…+8 °C');
    expect(ford?.icon).toBe('ac_unit');
    expect(ford?.noBookLabel).toBe('Не подходит рейсу');
    expect(porter?.reasons).toEqual([
      'Грузоподъёмность: 0,9 т, нужно от 1,1 т',
      'Объём: 9 м³, нужно от 12 м³',
    ]);
    expect(gazon?.reasons).toEqual(['Доступность: Недоступна · Плановое ТО до 03.10']);
    expect(gazon?.noBookLabel).toBe('Недоступна');
    expect(gazon?.chip.label).toBe('Недоступна');
  });

  it('бронь недоступна (офлайн, пробный период, модуль отключён): «Бронь недоступна»', () => {
    const cards = carCards(FLEET, plan(), true);
    expect(cards.some((c) => c.canBook)).toBe(false);
    expect(cards.find((c) => c.model === 'ГАЗель Next')?.noBookLabel).toBe('Бронь недоступна');
    expect(reserveBlock(false, false, false)).toEqual({
      text: 'Нет связи: бронь требует подтверждения сервера.',
      icon: 'cloud_off',
    });
    expect(reserveBlock(true, true, true)?.text).toBe(
      'Пробный период организации завершён: новые брони недоступны.',
    );
    expect(reserveBlock(true, false, true)?.text).toBe(
      'Модуль «Логистика» отключён: новые брони недоступны.',
    );
    expect(reserveBlock(true, false, false)).toBeNull();
  });

  it('своя бронь: «Ваша бронь» / «Назначена логистом», в смене — «Машина в вашей смене»', () => {
    const held = FLEET.map((v) =>
      v.id === 'v1' ? { ...v, status: 'reserved' as const, heldByTripId: 'trip-208' } : v,
    );
    const assigned = carCards(held, plan({ state: 'assigned', vehicleId: 'v1' }), false);
    const mine = assigned.find((c) => c.model === 'ГАЗель Next');
    expect(mine).toMatchObject({ mine: true, canBook: true, bookLabel: 'Подтвердить бронь' });
    expect(mine?.chip).toEqual({
      label: 'Назначена логистом',
      tone: 'info',
      icon: 'event_available',
    });
    const insp = carCards(held, plan({ state: 'inspection', vehicleId: 'v1' }), false);
    expect(insp.find((c) => c.model === 'ГАЗель Next')).toMatchObject({
      canBook: false,
      noBookLabel: 'Машина в вашей смене',
      chip: { label: 'Ваша бронь' },
    });
    expect(insp.find((c) => c.model === 'Mercedes Sprinter')?.noBookLabel).toBe('Смена уже идёт');
  });

  it('фильтры «Подходят к рейсу» и «Свободны»', () => {
    expect(carCards(FLEET, plan(), false, 'fit').map((c) => c.model)).toEqual([
      'ГАЗель Next',
      'Mercedes Sprinter',
      'ГАЗон Next',
    ]);
    expect(carCards(FLEET, plan(), false, 'free').map((c) => c.model)).not.toContain('ГАЗон Next');
  });

  it('бронь «держится до» — срок удержания сервера (Q-W2.00-4)', () => {
    const p = plan({ state: 'inspection', holdExpiresAt: '2026-10-01T08:00:00Z' });
    expect(holdDetails(FLEET[0], p)).toBe('ГАЗель Next А 412 МР 77 · держится до 11:00');
  });
});

const CHECKLIST: S['InspectionChecklist'] = {
  versionId: 'cl-dep-1',
  kind: 'departure',
  items: [
    { key: 'body', label: 'Кузов и стёкла осмотрены', required: true, failureBlocksRelease: false },
    {
      key: 'tires',
      label: 'Шины и световые приборы исправны',
      required: true,
      failureBlocksRelease: false,
    },
    {
      key: 'docs',
      label: 'Документы и комплект на месте',
      required: true,
      failureBlocksRelease: false,
    },
  ],
  requiredPhotoRoles: ['front', 'rear', 'left', 'right', 'odometer'],
};

const ready = (d: Draft): Draft => ({
  ...d,
  photos: Object.fromEntries(
    SIDES.map((s, i) => [
      s.key,
      { state: 'ready', progress: 100, fileId: `f${i + 1}`, capturedAt: '2026-10-01T07:31:00Z' },
    ]),
  ) as Draft['photos'],
});

describe('осмотр', () => {
  it('ракурсы эталона и роли контракта: back → rear, odo → odometer', () => {
    expect(SIDES.map((s) => `${s.label}:${s.role}`)).toEqual([
      'Спереди:front',
      'Сзади:rear',
      'Слева:left',
      'Справа:right',
      'Одометр:odometer',
    ]);
  });

  it('слот фото: подписи состояний и aria-label', () => {
    expect(photoView({ state: 'empty', progress: 0 }, 'Спереди')).toMatchObject({
      status: 'Не снято',
      icon: 'photo_camera',
      border: '1.5px dashed #AEB9B2',
      aria: 'Спереди: Не снято. Нажмите, чтобы снять или выбрать фото',
    });
    expect(photoView({ state: 'uploading', progress: 40 }, 'Сзади').status).toBe('Загрузка 40%');
    expect(photoView({ state: 'failed', progress: 0 }, 'Слева')).toMatchObject({
      status: 'Ошибка загрузки',
      failed: true,
      fg: '#A13A33',
    });
    expect(photoView({ state: 'ready', progress: 100 }, 'Справа')).toMatchObject({
      status: 'Загружено',
      ready: true,
      stIcon: 'cloud_done',
    });
  });

  it('«Осталось»: начальное — 5 фото, пробег, топливо, 3 пункта; пробег меньше — «пробег не меньше»', () => {
    const d = emptyDraft();
    expect(missingOf(d, 'dep', 84370, CHECKLIST.items)).toEqual([
      '5 фото',
      'пробег',
      'уровень топлива',
      '3 пункта чек-листа',
    ]);
    const low = { ...ready(d), odometer: '84000', fuel: 'h' as const, checks: { body: true } };
    expect(missingOf(low, 'dep', 84370, CHECKLIST.items)).toEqual([
      `пробег не меньше 84${NB}370 км`,
      '2 пункта чек-листа',
    ]);
    const full = { ...low, odometer: '84 500', checks: { body: true, tires: true, docs: true } };
    expect(missingOf(full, 'dep', 84370, CHECKLIST.items)).toEqual([]);
    expect(photoCount(full)).toBe(5);
    expect(photoCount(d)).toBe(0);
  });

  it('подсказка пробега: ошибка, предупреждение +3000, пояснение по виду осмотра', () => {
    expect(odoHint('84000', 'dep', 84370)).toEqual({
      text: `Пробег не может быть меньше 84${NB}370 км`,
      error: true,
    });
    expect(odoHint('90000', 'dep', 84370).text).toBe(
      `Больше начального на 5${NB}630 км — проверьте показания`,
    );
    expect(odoHint('84500', 'dep', 84370)).toEqual({
      text: `Последний зафиксированный пробег: 84${NB}370 км`,
      error: false,
    });
    expect(odoHint('', 'ret', 84500).text).toBe(
      `Пробег при выезде: 84${NB}500 км — значение не может быть меньше`,
    );
  });

  it('InspectionCreate выезда: версия, пробег без пробелов, топливо в процентах, фото, критический — blocking', () => {
    const d: Draft = {
      ...ready(emptyDraft()),
      odometer: '84 500',
      fuel: 'h',
      checks: { body: true, tires: true, docs: true },
      defects: [
        { zone: 'Стёкла', text: ' Скол ', critical: true },
        { zone: 'Кузов', text: 'Царапина', critical: false },
      ],
    };
    const body = inspectionBody(d, {
      kind: 'departure',
      checklist: CHECKLIST,
      vehicleId: 'v1',
      reservationId: 'r1',
      now: '2026-10-01T07:40:00Z',
    });
    expect(body).toEqual({
      checklistVersionId: 'cl-dep-1',
      vehicleId: 'v1',
      kind: 'departure',
      odometerKm: '84500',
      fuelPercent: 50,
      checks: [
        { key: 'body', result: 'pass' },
        { key: 'tires', result: 'pass' },
        { key: 'docs', result: 'pass' },
      ],
      photos: SIDES.map((s, i) => ({
        role: s.role,
        fileId: `f${i + 1}`,
        capturedAt: '2026-10-01T07:31:00Z',
      })),
      capturedAt: '2026-10-01T07:40:00Z',
      reservationId: 'r1',
      defects: [
        { zone: 'Стёкла', description: 'Скол', severity: 'blocking' },
        { zone: 'Кузов', description: 'Царапина', severity: 'minor' },
      ],
    });
  });

  it('InspectionCreate сдачи: по рейсу, критичность не выбирается, комментарий для менеджера', () => {
    const d: Draft = {
      ...ready(emptyDraft()),
      odometer: '84560',
      fuel: 'f',
      checks: { cargo: true, personal: true, keys: true },
      defects: [{ zone: 'Салон', text: 'Пятно', critical: true }],
      comment: '  Всё в порядке ',
    };
    const body = inspectionBody(d, {
      kind: 'return',
      checklist: { ...CHECKLIST, kind: 'return', versionId: 'cl-ret-1', items: [] },
      vehicleId: 'v1',
      tripId: 'trip-208',
      now: '2026-10-01T09:40:00Z',
    });
    expect(body).toMatchObject({
      kind: 'return',
      tripId: 'trip-208',
      fuelPercent: 100,
      defects: [{ zone: 'Салон', description: 'Пятно', severity: 'minor' }],
      comment: 'Всё в порядке',
    });
    expect(body.reservationId).toBeUndefined();
  });
});

describe('расходы', () => {
  it('ошибки формы — тексты validateExpense эталона', () => {
    const f = newExpense('2026-10-01');
    expect(expenseErrors(f)).toEqual({ amount: 'Укажите сумму', receipt: 'Добавьте фото чека' });
    expect(expenseErrors({ ...f, amount: '-500' }).amount).toBe('Сумма должна быть больше нуля');
    expect(expenseErrors({ ...f, amount: '300000' }).amount).toBe(
      'Больше 200 000 ₽ — проверьте сумму',
    );
    expect(expenseErrors({ ...f, amount: 'abc' }).amount).toBe('Сумма должна быть числом');
    expect(expenseErrors({ ...f, receipt: { state: 'uploading', progress: 30 } }).receipt).toBe(
      'Дождитесь окончания загрузки чека',
    );
    expect(expenseErrors({ ...f, date: '' }).date).toBe('Укажите дату');
    expect(
      expenseErrors({
        ...f,
        amount: '2500',
        receipt: { state: 'ready', progress: 100, fileId: 'r' },
      }),
    ).toEqual({});
  });

  it('TripExpenseCreate: копейки, полдень даты по Москве, литры только у топлива, комментарий', () => {
    const f = {
      ...newExpense('2026-10-01'),
      amount: '2 500,50',
      liters: '40,5',
      comment: ' АЗС на Ленинградском шоссе ',
      receipt: { state: 'ready' as const, progress: 100, fileId: 'rc1' },
    };
    expect(expenseBody(f)).toEqual({
      kind: 'fuel',
      occurredAt: '2026-10-01T09:00:00Z',
      amount: { amountMinor: 250050, currency: 'RUB' },
      quantity: '40.5',
      receiptFileIds: ['rc1'],
      comment: 'АЗС на Ленинградском шоссе',
    });
    const wash = expenseBody({ ...f, kind: 'wash', amount: '400', comment: '' });
    expect(wash.quantity).toBeUndefined();
    expect(wash.comment).toBeUndefined();
    expect(wash.amount.amountMinor).toBe(40000);
  });

  it('строка расхода: «Топливо · 2 500 ₽», «01.10.2026 · комментарий · чек приложен», «Принято сервером»', () => {
    const e: S['TripExpense'] = {
      id: 'x1',
      tripId: 'trip-208',
      kind: 'fuel',
      occurredAt: '2026-10-01T09:00:00Z',
      amount: { amountMinor: 250000, currency: 'RUB' },
      receiptFileIds: ['rc1'],
      reviewState: 'pending',
      revision: 1,
    };
    expect(expenseRow(e)).toEqual({
      id: 'x1',
      icon: 'local_gas_station',
      title: `Топливо · 2${NB}500 ₽`,
      meta: '01.10.2026 · чек приложен',
      chip: { label: 'Принято сервером', tone: 'ok', icon: 'cloud_done' },
    });
    expect(expenseRow({ ...e, kind: 'parking', comment: 'Химки' }).title).toBe(
      `Парковка · 2${NB}500 ₽`,
    );
    expect(expenseRow({ ...e, comment: 'Химки' }).meta).toBe('01.10.2026 · Химки · чек приложен');
  });

  it('категории D-12 0.5.1-stage2: шесть кодов, «Шиномонтаж и мелкий ремонт» перед «Прочее»', () => {
    expect(EXPENSE_KINDS.map((k) => [k.kind, k.label])).toEqual([
      ['fuel', 'Топливо'],
      ['wash', 'Мойка'],
      ['parking', 'Парковка'],
      ['toll', 'Платная дорога'],
      ['tire_service', 'Шиномонтаж и мелкий ремонт'],
      ['other', 'Прочее'],
    ]);
    const e: S['TripExpense'] = {
      id: 'x2',
      tripId: 'trip-208',
      kind: 'tire_service',
      occurredAt: '2026-10-01T09:00:00Z',
      amount: { amountMinor: 120000, currency: 'RUB' },
      receiptFileIds: [],
      reviewState: 'pending',
      revision: 1,
    };
    expect(expenseRow(e)).toMatchObject({
      icon: 'tire_repair',
      title: `Шиномонтаж и мелкий ремонт · 1${NB}200 ₽`,
    });
  });

  // W2.41 · справочник категорий тенанта (D-12 комплекта): варианты, обязательный комментарий, подписи.
  const catalog = [
    { code: 'fuel', label: 'Топливо', commentRequired: false },
    { code: 'custom_1', label: 'Стоянка на ночь', commentRequired: true },
    { code: 'other', label: 'Прочее', commentRequired: true },
  ];

  it('варианты из справочника: иконка кода посева, у своей категории — общая', () => {
    expect(expenseKindOptions(catalog)).toEqual([
      { kind: 'fuel', label: 'Топливо', icon: 'local_gas_station', commentRequired: false },
      { kind: 'custom_1', label: 'Стоянка на ночь', icon: 'receipt_long', commentRequired: true },
      { kind: 'other', label: 'Прочее', icon: 'receipt_long', commentRequired: true },
    ]);
  });

  it('категория с commentRequired: без комментария — ошибка под полем «Комментарий»', () => {
    const ok = {
      ...newExpense('2026-10-01'),
      amount: '700',
      receipt: { state: 'ready' as const, progress: 100, fileId: 'r' },
    };
    const kinds = expenseKindOptions(catalog);
    expect(expenseErrors({ ...ok, kind: 'custom_1' }, kinds)).toEqual({
      comment: 'Для категории «Стоянка на ночь» добавьте комментарий',
    });
    expect(expenseErrors({ ...ok, kind: 'other', comment: '  ' }, kinds).comment).toBe(
      'Для категории «Прочее» добавьте комментарий',
    );
    expect(expenseErrors({ ...ok, kind: 'custom_1', comment: 'Химки' }, kinds)).toEqual({});
    expect(expenseErrors({ ...ok, kind: 'fuel' }, kinds)).toEqual({});
    // Без справочника — шесть кодов посева: «Прочее» требует комментарий.
    expect(expenseErrors({ ...ok, kind: 'other' }).comment).toBe(
      'Для категории «Прочее» добавьте комментарий',
    );
  });

  it('строка расхода: подпись из справочника (с архивными), код вне справочника — сам код', () => {
    const e: S['TripExpense'] = {
      id: 'x3',
      tripId: 'trip-208',
      kind: 'custom_1',
      occurredAt: '2026-10-01T09:00:00Z',
      amount: { amountMinor: 70000, currency: 'RUB' },
      receiptFileIds: [],
      reviewState: 'pending',
      revision: 1,
      comment: 'Химки',
    };
    const labels = new Map([['custom_1', 'Стоянка на ночь']]);
    expect(expenseRow(e, 'Europe/Moscow', labels)).toMatchObject({
      icon: 'receipt_long',
      title: 'Стоянка на ночь · 700 ₽',
    });
    expect(expenseRow({ ...e, kind: 'custom_9' }).title).toBe('custom_9 · 700 ₽');
    expect(expenseRow({ ...e, kind: 'wash' }, 'Europe/Moscow', labels).title).toBe('Мойка · 700 ₽');
  });
});

describe('рейс и сдача', () => {
  it('остановки: время и операция, отметка «Прибыл» → «✓» и «Отменить»', () => {
    expect(stopRows(plan(), {})).toEqual([
      {
        name: 'Склад № 1, Лобня',
        meta: '09:00 · погрузка 12 м³',
        done: false,
        mark: '1',
        button: 'Прибыл',
      },
      {
        name: 'Химки, ул. Заводская, 8',
        meta: '10:15 · выгрузка 8 м³',
        done: false,
        mark: '2',
        button: 'Прибыл',
      },
      {
        name: 'Долгопрудный, Лихачёвский пр., 4',
        meta: '11:30 · выгрузка 4 м³',
        done: false,
        mark: '3',
        button: 'Прибыл',
      },
    ]);
    expect(stopRows(plan(), { 0: true })[0]).toMatchObject({
      done: true,
      mark: '✓',
      button: 'Отменить',
    });
  });

  it('диалог «Завершить рейс Р-208?»: «Внимание» при неотмеченных точках', () => {
    const m = finishDialog(plan(), 1, 3);
    expect(m).toMatchObject({
      title: 'Завершить рейс Р-208?',
      text: 'Дальше — осмотр при сдаче: 5 фото, пробег, топливо и чек-лист.',
      icon: 'flag',
      tone: 'info',
      confirmLabel: 'Завершить рейс',
    });
    expect(m.consequences).toEqual([
      {
        title: 'Внимание',
        items: [
          {
            text: 'Отмечено точек: 1 из 3. Убедитесь, что доставка выполнена.',
            icon: 'warning',
            tone: 'warn',
          },
        ],
      },
    ]);
    expect(finishDialog(plan(), 3, 3).consequences).toEqual([]);
  });

  it('итоги сдачи: «Пройдено 60 км», «Расходы 1 на 2 500 ₽»; без осмотров — «—»', () => {
    const insp = (km: string) => ({ odometerKm: km }) as S['Inspection'];
    const exp = [{ amount: { amountMinor: 250000, currency: 'RUB' } }] as S['TripExpense'][];
    expect(summary(insp('84500'), insp('84560'), exp)).toEqual([
      { label: 'Пройдено', value: '60 км' },
      { label: 'Расходы', value: `1 на 2${NB}500 ₽` },
    ]);
    expect(summary(undefined, undefined, [])[0]?.value).toBe('—');
  });

  it('разделы доработки по ключам контракта (`odometer`, Q-W2.00-13)', () => {
    expect(reworkSteps(['photos', 'odometer'])).toBe('Фото при сдаче, Пробег');
    expect(reworkSteps(undefined)).toBe('');
  });
});
