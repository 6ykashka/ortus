// W2.25 · Вид «Главной» (homeVM :4097–4136; 05 §5.3–5.7): приветствие по часам, дата, сводка, «Начало работы»,
// «Сегодня в работе» (логистика и неподключённые отраслевые модули), «Рейсы сегодня». Часы — инжектируемые
// (Q-61): 01.10.2026 10:30 МСК, как у e2e.
import { describe, expect, it } from 'vitest';

import {
  dateLine,
  greeting,
  logisticsWork,
  offModules,
  setupSteps,
  summary,
  tripsToday,
  type TripLike,
  type VehicleLike,
} from './view.ts';

const TZ = 'Europe/Moscow';
const NOW = new Date('2026-10-01T07:30:00Z');

const trip = (over: Partial<TripLike> & Pick<TripLike, 'id' | 'number'>): TripLike => ({
  title: 'Северный маршрут',
  state: 'planned',
  plannedWindow: { startsAt: '2026-10-01T06:00:00Z', endsAt: '2026-10-01T10:00:00Z', timeZone: TZ },
  ...over,
});

const TRIPS: TripLike[] = [
  trip({
    id: 't211',
    number: 'Р-211',
    title: 'Охлаждённая продукция',
    plannedWindow: {
      startsAt: '2026-10-01T11:00:00Z',
      endsAt: '2026-10-01T15:00:00Z',
      timeZone: TZ,
    },
  }),
  trip({ id: 't208', number: 'Р-208', driverDisplayName: 'Илья Васильев' }),
  trip({
    id: 't199',
    number: 'Р-199',
    state: 'accepted',
    plannedWindow: {
      startsAt: '2026-09-30T06:00:00Z',
      endsAt: '2026-09-30T10:00:00Z',
      timeZone: TZ,
    },
  }),
];

const VEHICLES: VehicleLike[] = [
  { id: 'v1', displayName: 'ГАЗель Next', status: 'available' },
  { id: 'v2', displayName: 'Isuzu Elf', status: 'reserved' },
  { id: 'v3', displayName: 'Hyundai HD78', status: 'available' },
];

describe('шапка «Главной»', () => {
  it('приветствие по часам: до 12 — утро, до 18 — день, иначе вечер; имя — первое слово', () => {
    expect(greeting(NOW, TZ, 'Дарья Зимина')).toEqual({
      key: 'greeting',
      args: { part: 'morning', name: 'Дарья' },
    });
    expect(greeting(new Date('2026-10-01T09:00:00Z'), TZ, 'Дарья Зимина').args?.part).toBe('day');
    expect(greeting(new Date('2026-10-01T15:00:00Z'), TZ, 'Дарья').args?.part).toBe('evening');
  });

  // Эталон пишет «Среда, 1 октября» строкой (:4126); 01.10.2026 — четверг: дата вычисляется по часам (Q-61).
  it('дата по часам и часовому поясу: «Четверг, 1 октября» (Q-61)', () => {
    expect(dateLine(NOW, TZ)).toBe('Четверг, 1 октября');
    expect(dateLine(new Date('2026-10-01T21:30:00Z'), TZ)).toBe('Пятница, 2 октября');
  });

  it('сводка — число карточек очереди', () => {
    expect(summary(2)).toEqual({ key: 'summary', args: { n: 2 } });
  });
});

describe('«Начало работы» (только владелец, :4115–4130)', () => {
  it('по сиду «Альты»: «1 из 3», текущий — шаг 1, шаг 3 выполнен', () => {
    const s = setupSteps({ industryOn: false, rolesAssigned: false, invited: true });
    expect(s.show).toBe(true);
    expect(s.progress).toEqual({ key: 'setup.progress', args: { done: 1, total: 3 } });
    expect(s.steps.map((x) => [x.id, x.n, x.done, x.current])).toEqual([
      ['module', 1, false, true],
      ['roles', 2, false, false],
      ['invite', 3, true, false],
    ]);
    expect(s.steps[0]).toMatchObject({
      title: { key: 'setup.module.title' },
      text: { key: 'setup.module.text' },
      action: { label: { key: 'setup.module.action' }, target: { page: 'modules' } },
    });
    expect(s.steps[1]?.action).toEqual({
      label: { key: 'setup.roles.action' },
      target: { page: 'users', search: { tab: 'people' } },
    });
    expect(s.steps[2]?.action).toEqual({
      label: { key: 'setup.invite.action' },
      target: { page: 'users', search: { tab: 'people' } },
    });
  });

  it('все шаги выполнены — блока нет', () => {
    expect(setupSteps({ industryOn: true, rolesAssigned: true, invited: true }).show).toBe(false);
  });

  it('текущий — первый невыполненный', () => {
    const s = setupSteps({ industryOn: true, rolesAssigned: false, invited: false });
    expect(s.steps.map((x) => x.current)).toEqual([false, true, false]);
    expect(s.progress.args).toEqual({ done: 1, total: 3 });
  });
});

describe('«Сегодня в работе» (:4097–4113)', () => {
  it('«Логистика»: рейсов сегодня, в пути, свободных машин «N из M», ждут приёмки', () => {
    const w = logisticsWork(
      [...TRIPS, trip({ id: 't5', number: 'Р-5', state: 'on_route' })],
      VEHICLES,
      NOW,
      TZ,
    );
    expect(w).toEqual({
      icon: 'local_shipping',
      title: { key: 'work.logistics' },
      target: { page: 'fleet' },
      lines: [
        { label: { key: 'work.tripsToday' }, value: '3' },
        { label: { key: 'work.onRoute' }, value: '1' },
        {
          label: { key: 'work.freeVehicles' },
          value: { key: 'work.freeOf', args: { free: 2, total: 3 } },
        },
        { label: { key: 'work.awaitingReview' }, value: '0' },
      ],
    });
  });

  it('неподключённые отраслевые модули — пунктир в порядке «Логистика», «Салон и SPA», «Ремонт и стройка»', () => {
    expect(
      offModules([
        { moduleKey: 'spa', state: 'active' },
        { moduleKey: 'repairs', state: 'uninstalled' },
        { moduleKey: 'files', state: 'uninstalled' },
      ]),
    ).toEqual([
      { moduleKey: 'fleet', icon: 'local_shipping', title: { key: 'work.logistics' } },
      { moduleKey: 'repairs', icon: 'construction', title: { key: 'work.repair' } },
    ]);
    expect(
      offModules([{ moduleKey: 'fleet', state: 'read_only' }]).map((m) => m.moduleKey),
    ).toEqual(['spa', 'repairs']);
  });
});

describe('«Рейсы сегодня» (:4134)', () => {
  it('рейсы дня по началу окна: время, «Р-208 · Северный маршрут», водитель и машина, чип состояния', () => {
    const rows = tripsToday(
      [...TRIPS, trip({ id: 't9', number: 'Р-9', state: 'submitted', vehicleId: 'v2' })],
      VEHICLES,
      NOW,
      TZ,
    );
    expect(rows.map((r) => r.key)).toEqual(['t208', 't9', 't211']);
    expect(rows[0]).toEqual({
      key: 't208',
      time: '09:00',
      title: { key: 'trips.row', args: { trip: 'Р-208', title: 'Северный маршрут' } },
      sub: { driver: 'Илья Васильев', vehicle: { key: 'trips.noVehicle' } },
      chip: { label: 'Запланирован', tone: 'neutral', icon: 'event' },
      target: { page: 'fleet', search: { trip: 't208' } },
    });
    expect(rows[1]).toMatchObject({
      sub: { driver: { key: 'trips.noDriver' }, vehicle: 'Isuzu Elf' },
      chip: { label: 'Ожидает приёмки', tone: 'warn', icon: 'pending' },
      target: { page: 'review', search: { trip: 't9' } },
    });
    expect(rows[2]?.time).toBe('14:00');
  });

  it('отменённые рейсы не показываются', () => {
    expect(tripsToday([trip({ id: 'c', number: 'Р-1', state: 'cancelled' })], [], NOW, TZ)).toEqual(
      [],
    );
  });
});
