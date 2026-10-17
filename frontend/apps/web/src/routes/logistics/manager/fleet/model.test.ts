// W2.20 · Модель «Рабочего места логиста» на ответах сценарного сервера (сид «Альты» 14.10): проекция DTO → домен,
// счётчики, подбор (compat), участки (legs), карточка рейса, вкладки, область и право на подразделение. Ожидания —
// чек-лист 03-logistics.md §14 п. 5–13 и расчёты §5.4.
import type { components } from '@ortus/api-client';
import { beforeAll, describe, expect, it } from 'vitest';

import { A, fleetData, type FleetData } from './fixtures.test-util.ts';
import {
  canEdit,
  card,
  crumb,
  legFor,
  legRows,
  may,
  pickOf,
  rows,
  stats,
  subtree,
  tabsOf,
  tripOf,
  vehicleOf,
  visibleTrips,
} from './model.ts';

type S = components['schemas'];

let owner: FleetData;
let manager: FleetData;
beforeAll(async () => {
  owner = await fleetData('owner');
  manager = await fleetData('manager');
});

const trip = (d: FleetData, n: string): S['TripPlan'] => {
  const t = d.trips.find((x) => x.number === n);
  if (!t) throw new Error(`нет рейса ${n}`);
  return t;
};
const label = (d: FleetData) => (id: string) => {
  const u = d.units.find((x) => x.id === id);
  const p = u?.parentId ? d.units.find((x) => x.id === u.parentId) : undefined;
  return p ? `${p.name} / ${u?.name}` : (u?.name ?? '');
};
const domain = (d: FleetData) => d.vehicles.map(vehicleOf);
const view = (d: FleetData, n: string, filter: 'all' | 'fit' | 'free' = 'all', edit = true) => {
  const vs = domain(d);
  const t = trip(d, n);
  return rows(vs, t, { filter, pick: pickOf(vs, t, null), canEdit: edit, unitLabel: label(d) });
};
const row = (r: ReturnType<typeof view>, model: string) => {
  const x = r.find((y) => y.model === model);
  if (!x) throw new Error(`нет строки ${model}`);
  return x;
};

describe('проекция машины Vehicle → домен', () => {
  it('единицы и состояние: кг → т, status → состояние эталона, depot, statusNote, heldByTripId', () => {
    const gazon = owner.vehicles.find((v) => v.displayName === 'ГАЗон Next');
    const d = vehicleOf(gazon as S['Vehicle']);
    expect(d).toMatchObject({
      model: 'ГАЗон Next',
      plate: 'Е 905 НА 77',
      payloadT: 4.5,
      volumeM3: 30,
      lengthM: 5.1,
      temp: null,
      state: 'unavailable',
      note: 'Плановое ТО до 03.10',
      depot: 'Склад № 2',
      body: 'Фургон',
      heldBy: null,
    });
    const ford = vehicleOf(
      owner.vehicles.find((v) => v.displayName === 'Ford Transit') as S['Vehicle'],
    );
    expect(ford.temp).toEqual([-18, 8]);
    expect(ford.body).toBe('Рефрижератор');
    const v7 = vehicleOf(
      owner.vehicles.find((v) => v.displayName === 'ГАЗель Бизнес') as S['Vehicle'],
    );
    expect(v7.state).toBe('on_route');
  });

  it('рейс TripPlan → домен: дата и окно по Москве, точки в т и м³', () => {
    const t = tripOf(trip(owner, 'Р-208'));
    expect(t).toMatchObject({
      title: 'Северный маршрут',
      date: '01.10.2026',
      window: '09:00–13:00',
      distanceKm: 46,
      driverName: 'Илья Васильев',
      status: 'planned',
      cargo: {
        weightT: 1.1,
        volumeM3: 12,
        lengthM: 3,
        temp: null,
        kind: 'Сухой груз · 14 паллет-мест',
      },
    });
    expect(t.stops[1]).toEqual({
      time: '10:15',
      name: 'Химки, ул. Заводская, 8',
      op: 'unload',
      w: 0.7,
      v: 8,
    });
    expect(tripOf(trip(owner, 'Р-211')).cargo.temp).toEqual([2, 6]);
  });

  it('отменённые рейсы не показываются (в TRIP_STATE эталона их нет)', () => {
    const t = trip(owner, 'Р-208');
    expect(visibleTrips([t, { ...t, id: 'x', state: 'cancelled' }]).map((x) => x.id)).toEqual([
      t.id,
    ]);
  });
});

describe('счётчики (п. 5)', () => {
  it('логист «Север Логистик»: 4 свободно, 0 в брони или рейсе, 0 ждут приёмки, 1 недоступно', () => {
    expect(stats(domain(manager))).toEqual({ free: 4, busy: 0, review: 0, unavailable: 1 });
  });
  it('владелец, вся организация: 5 / 1 / 0 / 1', () => {
    expect(stats(domain(owner))).toEqual({ free: 5, busy: 1, review: 0, unavailable: 1 });
  });
});

describe('подбор транспорта (п. 7–8)', () => {
  it('порядок: подходящие и свободные, затем подходящие недоступные, затем остальные', () => {
    expect(view(manager, 'Р-208').map((r) => r.model)).toEqual([
      'ГАЗель Next',
      'Mercedes Sprinter',
      'ГАЗон Next',
      'Ford Transit',
      'Hyundai Porter',
    ]);
  });

  it('строки: причины с «нужно …», кнопки «Назначить на рейс» / «Не подходит» / «Недоступна»', () => {
    const r = view(manager, 'Р-208');
    const porter = row(r, 'Hyundai Porter');
    expect(porter.checks.filter((c) => !c.ok).map((c) => c.text)).toEqual([
      'Грузоподъёмность: 0,9 т (нужно от 1,1 т)',
      'Объём: 9 м³ (нужно от 12 м³)',
    ]);
    expect(porter.action).toBe('unfit');
    const gazon = row(r, 'ГАЗон Next');
    expect(gazon.checks[0]).toEqual({
      text: 'Доступность: Недоступна · Плановое ТО до 03.10',
      ok: false,
    });
    expect(gazon.chip).toEqual({
      label: 'Недоступна · Плановое ТО до 03.10',
      tone: 'danger',
      icon: 'block',
    });
    expect(gazon.action).toBe('unavailable');
    const gazel = row(r, 'ГАЗель Next');
    expect(gazel.action).toBe('assign');
    // Регион «Москва» вне org_units.read логиста (listOrgUnits его не отдаёт): подпись — название фирмы (Q-W2.20-3).
    expect(gazel.sub).toBe('Тент · Север Логистик · Склад № 1');
    expect(
      rows(domain(owner), trip(owner, 'Р-208'), {
        filter: 'all',
        pick: null,
        canEdit: true,
        unitLabel: label(owner),
      })[0]?.sub,
    ).toBe('Тент · Москва / Север Логистик · Склад № 1');
    expect(gazel.icon).toBe('local_shipping');
    expect(gazel.chip).toEqual({ label: 'Свободна', tone: 'ok', icon: 'check_circle' });
    expect(gazel.checks.map((c) => c.text)).toEqual([
      'Доступность: Свободна',
      'Грузоподъёмность: 1,5 т',
      'Объём: 16 м³',
      'Длина кузова: 4,2 м',
      'Температура: не требуется',
    ]);
    expect(gazel.picked).toBe(true);
    expect(row(r, 'Ford Transit').icon).toBe('ac_unit');
  });

  it('без права изменения подходящая машина — без кнопки, неподходящая — «Не подходит»', () => {
    const r = view(manager, 'Р-208', 'all', false);
    expect(row(r, 'ГАЗель Next').action).toBeNull();
    expect(row(r, 'Hyundai Porter').action).toBe('unfit');
  });

  it('фильтр «Подходят» — ГАЗель Next, Mercedes Sprinter, ГАЗон Next; «Свободны» — без ГАЗон Next', () => {
    expect(view(manager, 'Р-208', 'fit').map((r) => r.model)).toEqual([
      'ГАЗель Next',
      'Mercedes Sprinter',
      'ГАЗон Next',
    ]);
    expect(view(manager, 'Р-208', 'free').map((r) => r.model)).toEqual([
      'ГАЗель Next',
      'Mercedes Sprinter',
      'Ford Transit',
      'Hyundai Porter',
    ]);
  });

  it('назначенная на рейс машина — первой, чип «Назначена на Р-208», без кнопки', () => {
    const t = trip(manager, 'Р-208');
    const vs = manager.vehicles.map((v) =>
      v.displayName === 'Mercedes Sprinter'
        ? vehicleOf({ ...v, status: 'reserved', heldByTripId: t.id })
        : vehicleOf(v),
    );
    const assigned = { ...t, state: 'assigned' as const, vehicleId: A('v6') };
    const r = rows(vs, assigned, {
      filter: 'all',
      pick: pickOf(vs, assigned, null),
      canEdit: true,
      unitLabel: label(manager),
    });
    expect(r[0]?.model).toBe('Mercedes Sprinter');
    expect(r[0]?.chip).toEqual({
      label: 'Назначена на Р-208',
      tone: 'info',
      icon: 'event_available',
    });
    expect(r[0]?.action).toBeNull();
    expect(r[0]?.checks[0]?.text).toBe('Доступность: Назначена на этот рейс');
    expect(r[0]?.picked).toBe(true);
  });

  it('Р-211 (температура +2…+6): Ford Transit подходит, у ГАЗели — «без охлаждения (нужно +2…+6 °C)»', () => {
    const r = view(manager, 'Р-211');
    expect(row(r, 'Ford Transit').checks.at(-1)).toEqual({
      text: 'Температура: -18…+8 °C',
      ok: true,
    });
    expect(row(r, 'Ford Transit').action).toBe('assign');
    expect(row(r, 'ГАЗель Next').checks.at(-1)).toEqual({
      text: 'Температура: без охлаждения (нужно +2…+6 °C)',
      ok: false,
    });
    expect(row(r, 'ГАЗель Next').action).toBe('unfit');
  });
});

describe('загрузка по участкам (п. 9, §5.4)', () => {
  it('по умолчанию — первая подходящая (ГАЗель Next): 75 % / 73 %, затем 25 % / 27 %, 0 % / 0 %', () => {
    const vs = domain(manager);
    const t = trip(manager, 'Р-208');
    const pick = pickOf(vs, t, null);
    expect(pick?.model).toBe('ГАЗель Next');
    expect(legFor(pick)).toBe(
      'Для ГАЗель Next · 16 м³ · 1,5 т. Объём и масса считаются раздельно.',
    );
    const l = legRows(t, pick);
    expect(l.map((x) => [x.vPct, x.wPct])).toEqual([
      ['75%', '73%'],
      ['25%', '27%'],
      ['0%', '0%'],
    ]);
    expect(l[0]).toMatchObject({
      n: 1,
      time: '09:00',
      name: 'Склад № 1, Лобня',
      op: 'Погрузка +12 м³ · 1,1 т',
      after: 'В кузове после точки: 12 м³ · 1,1 т',
      vBar: 'ok',
    });
    expect(l[1]?.op).toBe('Выгрузка −8 м³ · 0,7 т');
  });

  it('Mercedes Sprinter: участок 1 — 86 % объёма и 69 % массы', () => {
    const vs = domain(manager);
    const t = trip(manager, 'Р-208');
    const pick = pickOf(vs, t, A('v6'));
    expect(legFor(pick)).toBe(
      'Для Mercedes Sprinter · 14 м³ · 1,6 т. Объём и масса считаются раздельно.',
    );
    expect(legRows(t, pick)[0]).toMatchObject({ vPct: '86%', wPct: '69%', vW: '86%', wW: '69%' });
  });

  it('перегруз: полоса > 100 % — over (ширина 100 %), > 90 % — high', () => {
    const vs = domain(manager);
    const t = trip(manager, 'Р-208');
    const porter = pickOf(vs, t, A('v3'));
    const first = legRows(t, porter)[0];
    expect(first).toMatchObject({ vPct: '133%', vW: '100%', vBar: 'over', wBar: 'over' });
    const ford = pickOf(vs, t, A('v2'));
    expect(legRows(t, ford)[0]?.wBar).toBe('high');
  });

  it('без машины: «Выберите машину, чтобы увидеть загрузку»', () => {
    expect(legFor(null)).toBe('Выберите машину, чтобы увидеть загрузку');
  });
});

describe('карточка рейса (п. 6, 12)', () => {
  it('Р-208: дата и окно, груз, требования, водитель, машина, маршрут', () => {
    expect(card(trip(manager, 'Р-208'), undefined)).toEqual({
      title: 'Р-208 · Северный маршрут',
      when: '01.10.2026 · 09:00–13:00',
      chip: { label: 'Запланирован', tone: 'neutral', icon: 'event' },
      cargo: 'Сухой груз · 14 паллет-мест · 1,1 т · 12 м³',
      req: 'Кузов от 3 м · без температурного режима',
      driver: 'Илья Васильев',
      noDriver: false,
      vehicle: 'Выберет водитель при брони или назначит логист',
      route: '3 точки · 46 км',
    });
  });

  it('Р-211 без водителя: «Не назначен», «Не выбрана», «Кузов от 2,4 м · +2…+6 °C»', () => {
    const c = card(trip(manager, 'Р-211'), undefined);
    expect(c).toMatchObject({
      driver: 'Не назначен',
      noDriver: true,
      vehicle: 'Не выбрана',
      req: 'Кузов от 2,4 м · +2…+6 °C',
      route: '3 точки · 31 км',
    });
  });

  it('с назначенной машиной: «ГАЗель Next · А 412 МР 77»', () => {
    const gazel = domain(manager).find((v) => v.model === 'ГАЗель Next');
    expect(card(trip(manager, 'Р-208'), gazel).vehicle).toBe('ГАЗель Next · А 412 МР 77');
  });

  it('вкладки: «Р-208 · Северный маршрут» выбрана, подпись «09:00–13:00 · Запланирован»', () => {
    const t = tabsOf(manager.trips, trip(manager, 'Р-208').id);
    expect(t).toEqual([
      {
        id: trip(manager, 'Р-208').id,
        title: 'Р-208 · Северный маршрут',
        sub: '09:00–13:00 · Запланирован',
        selected: true,
      },
      {
        id: trip(manager, 'Р-211').id,
        title: 'Р-211 · Охлаждённая продукция',
        sub: '14:00–18:00 · Запланирован',
        selected: false,
      },
    ]);
  });

  it('изменять можно запланированный рейс и рейс с назначенной машиной; не в режиме чтения и с правом', () => {
    const t = trip(manager, 'Р-208');
    expect(canEdit(t, { readOnly: false, may: true })).toBe(true);
    expect(canEdit({ ...t, state: 'assigned' }, { readOnly: false, may: true })).toBe(true);
    expect(canEdit({ ...t, state: 'on_route' }, { readOnly: false, may: true })).toBe(false);
    expect(canEdit(t, { readOnly: true, may: true })).toBe(false);
    expect(canEdit(t, { readOnly: false, may: false })).toBe(false);
  });
});

describe('область и право', () => {
  it('поддерево региона «Москва» — регион и четыре фирмы', () => {
    const msk = owner.units.find((u) => u.name === 'Москва');
    const s = subtree(owner.units, msk?.id ?? '');
    expect([...s].map((id) => owner.units.find((u) => u.id === id)?.name).sort()).toEqual([
      'Восток Карго',
      'Москва',
      'Север Логистик',
      'Центр Экспресс',
      'Юг Транс',
    ]);
  });

  it('право на подразделение: владелец — везде; область org_unit — подразделение и потомки', () => {
    const caps = [
      {
        permission: 'fleet.routes.manage',
        scope: { kind: 'org_unit', resourceIds: [A('r-msk')], includeDescendants: true },
      },
    ];
    expect(
      may({ owner: true, caps: [], units: owner.units }, 'fleet.routes.manage', A('f-smr-volga')),
    ).toBe(true);
    const a = { owner: false, caps, units: owner.units };
    expect(may(a, 'fleet.routes.manage', A('f-msk-sever'))).toBe(true);
    expect(may(a, 'fleet.routes.manage', A('f-smr-volga'))).toBe(false);
    expect(may(a, 'fleet.vehicles.manage', A('f-msk-sever'))).toBe(false);
    const tenant = [
      {
        permission: 'fleet.routes.manage',
        scope: { kind: 'tenant', resourceIds: [], includeDescendants: true },
      },
    ];
    expect(
      may({ owner: false, caps: tenant, units: [] }, 'fleet.routes.manage', A('f-smr-volga')),
    ).toBe(true);
  });

  it('крошка: владелец — «Альта Групп · все подразделения», регион — «Регион Самара», фирма — «Москва / Север Логистик»', () => {
    const base = { owner: true, tenant: 'Альта Групп', units: owner.units, caps: [] };
    expect(crumb({ ...base, scope: 'all' })).toBe('Альта Групп · все подразделения');
    expect(crumb({ ...base, scope: A('r-smr') })).toBe('Регион Самара');
    expect(crumb({ ...base, scope: A('f-msk-sever') })).toBe('Москва / Север Логистик');
  });

  it('крошка логиста — подразделение права логистики; регион вне области — без него (Q-W2.20-3)', () => {
    const caps = [
      {
        permission: 'fleet.trips.read',
        scope: { kind: 'org_unit', resourceIds: [A('f-msk-sever')], includeDescendants: true },
      },
    ];
    expect(
      crumb({ owner: false, scope: 'all', tenant: 'Альта Групп', units: manager.units, caps }),
    ).toBe('Север Логистик');
    expect(
      crumb({ owner: false, scope: 'all', tenant: 'Альта Групп', units: owner.units, caps }),
    ).toBe('Москва / Север Логистик');
  });
});
