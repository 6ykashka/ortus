// W2.21 · Модель «Приёмки смен» (reviewVM :3330–3382, accept/rework :2764–2783; 03-logistics.md §7, §14 п. 41–47):
// очередь и её порядок, подписи очереди и карточек, статистика осмотров, фото до и после, дефекты, расходы, итоги
// решения, проверки доработки. Строки — дословно эталона.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  checks,
  crumb,
  decidedText,
  defectCard,
  defectLines,
  expenseLine,
  expensesTotal,
  fuelLabel,
  money,
  photoRows,
  queueItem,
  REWORK_STEPS,
  reviewQueue,
  reworkError,
  shiftHead,
  stats,
} from './model.ts';

type S = components['schemas'];

const MSK = 'Europe/Moscow';
/** Разделитель разрядов — NBSP, как `M.int` / `M.rub` эталона (toLocaleString ru-RU). */
const nb = (s: string): string => s.replace(/(\d) (\d{3})/g, '$1 $2');
const plan = (o: Partial<S['TripPlan']> & Pick<S['TripPlan'], 'id' | 'state'>): S['TripPlan'] => ({
  number: 'Р-208',
  title: 'Северный маршрут',
  orgUnitId: 'u-sever',
  plannedWindow: {
    startsAt: '2026-10-01T06:00:00Z',
    endsAt: '2026-10-01T10:00:00Z',
    timeZone: MSK,
  },
  cargo: { description: 'Сухой груз', weightKg: '1100', volumeM3: '12', lengthM: '3' },
  stops: [],
  revision: 1,
  driverDisplayName: 'Илья Васильев',
  ...o,
});

const gazel: S['Vehicle'] = {
  id: 'v1',
  orgUnitId: 'u-sever',
  registrationNumber: 'А 412 МР 77',
  displayName: 'ГАЗель Next',
  bodyType: 'tent',
  capacity: {
    payloadKg: '1500',
    volumeM3: '16',
    cargoLengthM: '4.2',
    cargoWidthM: '2',
    cargoHeightM: '2',
  },
  equipment: [],
  status: 'blocked',
  odometerKm: '84370',
  revision: 3,
};

const photo = (role: S['InspectionPhoto']['role'], fileId: string): S['InspectionPhoto'] => ({
  role,
  fileId,
  capturedAt: '2026-10-01T07:30:00Z',
});

const inspection = (
  o: Partial<S['Inspection']> & Pick<S['Inspection'], 'kind'>,
): S['Inspection'] => ({
  checklistVersionId: 'c1',
  id: `i-${o.kind}`,
  vehicleId: 'v1',
  memberId: 'm-vasiliev',
  status: 'submitted',
  odometerKm: '84500',
  fuelPercent: 50,
  checks: [],
  photos: [],
  capturedAt: '2026-10-01T07:30:00Z',
  submittedAt: '2026-10-01T07:31:00Z',
  revision: 1,
  defects: [],
  ...o,
});

const defect = (o: Partial<S['InspectionDefect']> = {}): S['InspectionDefect'] => ({
  id: 'd1',
  vehicleId: 'v1',
  inspectionId: 'i-departure',
  tripId: 't1',
  zone: 'Стёкла',
  description: 'Скол',
  severity: 'blocking',
  state: 'in_review',
  reportedAt: '2026-10-01T07:31:00Z',
  reportedByMemberId: 'm-vasiliev',
  revision: 1,
  ...o,
});

describe('очередь (:3332–3342)', () => {
  it('только defect_review, submitted, rework, accepted — в порядке эталона', () => {
    const list = [
      plan({ id: 'a', number: 'Р-1', state: 'accepted' }),
      plan({ id: 'b', number: 'Р-2', state: 'planned' }),
      plan({ id: 'c', number: 'Р-3', state: 'rework' }),
      plan({ id: 'd', number: 'Р-4', state: 'submitted' }),
      plan({ id: 'e', number: 'Р-5', state: 'defect_review' }),
      plan({ id: 'f', number: 'Р-6', state: 'on_route' }),
    ];
    expect(reviewQueue(list).map((t) => t.number)).toEqual(['Р-5', 'Р-4', 'Р-3', 'Р-1']);
  });

  it('строка очереди: «{рейс} · {водитель}», «{модель} · {номер}», чип состояния', () => {
    expect(queueItem(plan({ id: 't1', state: 'submitted' }), gazel)).toEqual({
      id: 't1',
      title: 'Р-208 · Илья Васильев',
      sub: 'ГАЗель Next · А 412 МР 77',
      chip: { label: 'Ожидает приёмки', tone: 'warn', icon: 'pending' },
    });
  });

  it('без водителя — «водитель», без машины — «Машина снята с рейса»', () => {
    const t = plan({ id: 't1', state: 'accepted' });
    delete t.driverDisplayName;
    expect(queueItem(t, undefined)).toMatchObject({
      title: 'Р-208 · водитель',
      sub: 'Машина снята с рейса',
      chip: { label: 'Принят', tone: 'ok', icon: 'verified' },
    });
  });
});

describe('крошка (:3333)', () => {
  it('владелец — «{организация} · все подразделения», логист — подразделение области', () => {
    expect(crumb({ owner: true, tenant: 'Альта Групп', unit: undefined })).toBe(
      'Альта Групп · все подразделения',
    );
    expect(crumb({ owner: false, tenant: 'Альта Групп', unit: 'Москва / Север Логистик' })).toBe(
      'Москва / Север Логистик',
    );
    expect(crumb({ owner: false, tenant: 'Альта Групп', unit: undefined })).toBe(
      'Область не назначена',
    );
  });
});

describe('карточка смены (:3357–3371)', () => {
  it('заголовок «{рейс} · {название}», sub «{водитель} · {модель} {номер}»', () => {
    expect(shiftHead(plan({ id: 't1', state: 'submitted' }), gazel)).toEqual({
      title: 'Р-208 · Северный маршрут',
      sub: 'Илья Васильев · ГАЗель Next А 412 МР 77',
      chip: { label: 'Ожидает приёмки', tone: 'warn', icon: 'pending' },
    });
  });

  it('топливо: проценты контракта → подписи FUEL эталона', () => {
    expect([25, 50, 75, 100, 40, undefined].map(fuelLabel)).toEqual([
      '¼',
      '½',
      '¾',
      'Полный',
      '40 %',
      '—',
    ]);
  });

  it('статистика: пробег при выезде и при сдаче, пройдено, топливо (п. 42)', () => {
    const dep = inspection({ kind: 'departure', odometerKm: '84500', fuelPercent: 50 });
    const ret = inspection({ kind: 'return', odometerKm: '84560', fuelPercent: 50 });
    expect(stats(dep, ret)).toEqual([
      { label: 'Пробег при выезде', value: nb('84 500 км') },
      { label: 'При сдаче', value: nb('84 560 км') },
      { label: 'Пройдено', value: '60 км' },
      { label: 'Топливо', value: '½ → ½' },
    ]);
    expect(stats(dep, undefined).map((s) => s.value)).toEqual([nb('84 500 км'), '—', '—', '½ → —']);
  });

  it('фото до и после: пять ракурсов эталона, файлы по ролям контракта', () => {
    const dep = inspection({
      kind: 'departure',
      photos: [photo('front', 'f1'), photo('odometer', 'f5')],
    });
    const ret = inspection({ kind: 'return', photos: [photo('rear', 'r2')] });
    expect(photoRows(dep, ret)).toEqual([
      { role: 'front', label: 'Спереди', before: 'f1', after: undefined },
      { role: 'rear', label: 'Сзади', before: undefined, after: 'r2' },
      { role: 'left', label: 'Слева', before: undefined, after: undefined },
      { role: 'right', label: 'Справа', before: undefined, after: undefined },
      { role: 'odometer', label: 'Одометр', before: 'f5', after: undefined },
    ]);
  });

  it('чек-листы: выезд и сдача', () => {
    const dep = inspection({ kind: 'departure' });
    expect(checks(dep, undefined)).toEqual(['Осмотр перед выездом: чек-лист заполнен']);
    expect(checks(dep, inspection({ kind: 'return' }))).toEqual([
      'Осмотр перед выездом: чек-лист заполнен',
      'Осмотр при сдаче: чек-лист заполнен',
    ]);
  });

  it('дефекты: при выезде, при сдаче, «признан некритичным» после разрешения выезда', () => {
    const dep = inspection({
      kind: 'departure',
      defects: [defect({ state: 'resolved', decision: 'allow_departure' })],
    });
    const ret = inspection({
      kind: 'return',
      defects: [
        defect({
          id: 'd2',
          zone: 'Кузов',
          description: 'Царапина',
          severity: 'minor',
          state: 'open',
        }),
      ],
    });
    expect(defectLines(dep, ret)).toEqual([
      { text: 'Стёкла · Скол · при выезде · признан некритичным', critical: false },
      { text: 'Кузов · Царапина · при сдаче', critical: false },
    ]);
    expect(defectLines(inspection({ kind: 'departure', defects: [defect()] }), undefined)).toEqual([
      { text: 'Стёкла · Скол · при выезде', critical: true },
    ]);
  });

  it('расход: категория, литры, дата, комментарий, «чек приложен», сумма (п. 42)', () => {
    const e: S['TripExpense'] = {
      id: 'x1',
      tripId: 't1',
      kind: 'fuel',
      occurredAt: '2026-10-01T07:30:00Z',
      amount: { amountMinor: 250000, currency: 'RUB' },
      quantity: '40',
      receiptFileIds: ['r1'],
      reviewState: 'pending',
      revision: 1,
      comment: 'АЗС на Ленинградском шоссе',
    };
    expect(expenseLine(e)).toEqual({
      icon: 'local_gas_station',
      label: 'Топливо · 40 л',
      meta: '01.10.2026 · АЗС на Ленинградском шоссе · чек приложен',
      amount: nb('2 500 ₽'),
    });
    expect(
      expenseLine({ ...e, kind: 'wash', quantity: undefined, comment: undefined }),
    ).toMatchObject({ icon: 'local_car_wash', label: 'Мойка', meta: '01.10.2026 · чек приложен' });
    expect(expenseLine({ ...e, kind: 'parking' }).label).toBe('Парковка · 40 л');
    expect(expensesTotal([e, { ...e, amount: { amountMinor: 40000, currency: 'RUB' } }])).toBe(
      nb('2 900 ₽'),
    );
    expect(expensesTotal([])).toBe('0 ₽');
    expect(money({ amountMinor: 450000, currency: 'RUB' })).toBe(nb('4 500 ₽'));
  });

  it('шесть категорий 0.5.1-stage2 (D-12, W2.40): подписи logisticsDriver.expenseKinds, иконки', () => {
    const e: S['TripExpense'] = {
      id: 'x2',
      tripId: 't1',
      kind: 'tire_service',
      occurredAt: '2026-10-01T07:30:00Z',
      amount: { amountMinor: 120000, currency: 'RUB' },
      receiptFileIds: [],
      reviewState: 'pending',
      revision: 1,
    };
    const kinds: S['TripExpense']['kind'][] = [
      'fuel',
      'wash',
      'parking',
      'toll',
      'tire_service',
      'other',
    ];
    expect(kinds.map((kind) => expenseLine({ ...e, kind }))).toMatchObject([
      { label: 'Топливо', icon: 'local_gas_station' },
      { label: 'Мойка', icon: 'local_car_wash' },
      { label: 'Парковка', icon: 'local_parking' },
      { label: 'Платная дорога', icon: 'toll' },
      { label: 'Шиномонтаж и мелкий ремонт', icon: 'tire_repair' },
      { label: 'Прочее', icon: 'receipt_long' },
    ]);
    expect(expenseLine({ ...e, kind: 'other', comment: 'Ключи от склада' })).toEqual({
      icon: 'receipt_long',
      label: 'Прочее',
      meta: '01.10.2026 · Ключи от склада',
      amount: nb('1 200 ₽'),
    });
  });

  it('неизвестный код категории (новее контракта страницы): код и общая иконка, без падения', () => {
    const e = {
      id: 'x3',
      tripId: 't1',
      kind: 'fine',
      occurredAt: '2026-10-01T07:30:00Z',
      amount: { amountMinor: 50000, currency: 'RUB' },
      receiptFileIds: [],
      reviewState: 'pending',
      revision: 1,
    } as unknown as S['TripExpense'];
    expect(expenseLine(e)).toMatchObject({ label: 'fine', icon: 'receipt_long' });
    expect(expenseLine({ ...e, kind: 'toString' as never })).toMatchObject({
      label: 'toString',
      icon: 'receipt_long',
    });
  });
});

describe('решение (:2777–2783, :3377–3379)', () => {
  it('разделы доработки — порядок и подписи эталона', () => {
    expect(REWORK_STEPS).toEqual([
      ['photos', 'Фото при сдаче'],
      ['odometer', 'Пробег'],
      ['expenses', 'Расходы'],
      ['checklist', 'Чек-лист и дефекты'],
    ]);
  });

  it('доработка: сначала замечания, затем хотя бы один раздел', () => {
    expect(reworkError('  ', [])).toBe('Опишите, что нужно исправить');
    expect(reworkError('Переснимите фото', [])).toBe('Отметьте хотя бы один раздел для доработки');
    expect(reworkError('Переснимите фото', ['photos'])).toBeNull();
  });

  it('итог: принята в {время по Москве}; возвращено с разделами', () => {
    const accepted = plan({
      id: 't1',
      state: 'accepted',
      acceptedAt: '2026-10-01T11:42:00Z',
      lastReview: {
        decision: 'approve',
        attempt: 1,
        reviewerMemberId: 'm-kotova',
        reviewedAt: '2026-10-01T11:42:00Z',
      },
    });
    expect(decidedText(accepted)).toBe('Смена принята в 14:42. Машина вернулась в пул свободных.');
    const rework = plan({
      id: 't1',
      state: 'rework',
      lastReview: {
        decision: 'rework',
        comment: 'Переснимите фото слева',
        steps: ['photos', 'odometer'],
        attempt: 1,
        reviewerMemberId: 'm-kotova',
        reviewedAt: '2026-10-01T11:42:00Z',
      },
    });
    expect(decidedText(rework)).toBe(
      'Возвращено водителю: «Переснимите фото слева». Исправить: Фото при сдаче, Пробег.',
    );
    expect(decidedText(plan({ id: 't1', state: 'submitted' }))).toBeNull();
  });
});

describe('карточка дефекта (:3346)', () => {
  it('«{модель} {номер}», «{рейс} · {водитель} · осмотр в {время}», зона и описание', () => {
    const t = plan({ id: 't1', state: 'defect_review' });
    const dep = inspection({ kind: 'departure', submittedAt: '2026-10-01T05:47:00Z' });
    expect(defectCard(t, defect(), gazel, dep)).toEqual({
      vehicle: 'ГАЗель Next А 412 МР 77',
      sub: 'Р-208 · Илья Васильев · осмотр в 08:47',
      zone: 'Стёкла',
      text: 'Скол',
    });
    expect(defectCard(t, defect(), undefined, undefined).sub).toBe(
      'Р-208 · Илья Васильев · осмотр в 10:31',
    );
  });
});
