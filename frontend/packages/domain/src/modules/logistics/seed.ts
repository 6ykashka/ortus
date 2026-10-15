// Сид логистики (mock-data.js 14.10:189–230): автопарк, рейсы и ресурсный пул «Альты».
// У других организаций срезы пустые, как у «Лотоса» эталона.
import type { LogisticsSlices, Trip, Vehicle } from './types.ts';

type Fleet = Required<LogisticsSlices>;

const SEVER = 'f-msk-sever';

function vehicles(): Vehicle[] {
  const v = (
    id: string,
    unit: string,
    model: string,
    plate: string,
    body: string,
    [payloadT, volumeM3, lengthM]: [number, number, number],
    temp: Vehicle['temp'],
    odometer: number,
    depot: string,
    state: Vehicle['state'] = 'free',
    note?: string,
  ): Vehicle => ({
    id,
    unit,
    model,
    plate,
    body,
    payloadT,
    volumeM3,
    lengthM,
    temp,
    odometer,
    state,
    ...(note ? { note } : {}),
    depot,
  });
  return [
    v('v1', SEVER, 'ГАЗель Next', 'А 412 МР 77', 'Тент', [1.5, 16, 4.2], null, 84370, 'Склад № 1'),
    v(
      'v6',
      SEVER,
      'Mercedes Sprinter',
      'Т 771 ЕХ 77',
      'Фургон',
      [1.6, 14, 4.3],
      null,
      120544,
      'Склад № 1',
    ),
    v(
      'v2',
      SEVER,
      'Ford Transit',
      'М 608 КТ 77',
      'Рефрижератор',
      [1.2, 11, 3.4],
      [-18, 8],
      61210,
      'Склад № 1',
    ),
    v(
      'v3',
      SEVER,
      'Hyundai Porter',
      'В 233 ОС 77',
      'Тент',
      [0.9, 9, 3.1],
      null,
      152003,
      'Склад № 2',
    ),
    v(
      'v4',
      SEVER,
      'ГАЗон Next',
      'Е 905 НА 77',
      'Фургон',
      [4.5, 30, 5.1],
      null,
      40112,
      'Склад № 2',
      'unavailable',
      'Плановое ТО до 03.10',
    ),
    v(
      'v5',
      'f-msk-yug',
      'Isuzu Elf',
      'К 120 РУ 77',
      'Фургон',
      [3.0, 20, 4.4],
      null,
      98320,
      'Юг · база',
    ),
    v(
      'v7',
      'f-smr-volga',
      'ГАЗель Бизнес',
      'О 318 ХС 163',
      'Тент',
      [1.5, 14, 3.1],
      null,
      201450,
      'Самара · склад',
      'on_route',
    ),
  ];
}

const tripBase = (): Pick<Trip, 'dep' | 'ret' | 'expenses' | 'review' | 'defect'> => ({
  dep: null,
  ret: null,
  expenses: [],
  review: null,
  defect: null,
});

function trips(): Trip[] {
  return [
    {
      id: 'Р-208',
      unit: SEVER,
      title: 'Северный маршрут',
      date: '01.10.2026',
      window: '09:00–13:00',
      distanceKm: 46,
      driverId: 'm-vasiliev',
      driverName: 'Илья Васильев',
      vehicleId: null,
      status: 'planned',
      earnings: 4500,
      cargo: {
        weightT: 1.1,
        volumeM3: 12,
        lengthM: 3.0,
        temp: null,
        kind: 'Сухой груз · 14 паллет-мест',
      },
      stops: [
        { time: '09:00', name: 'Склад № 1, Лобня', op: 'load', w: 1.1, v: 12 },
        { time: '10:15', name: 'Химки, ул. Заводская, 8', op: 'unload', w: 0.7, v: 8 },
        { time: '11:30', name: 'Долгопрудный, Лихачёвский пр., 4', op: 'unload', w: 0.4, v: 4 },
      ],
      ...tripBase(),
    },
    {
      id: 'Р-211',
      unit: SEVER,
      title: 'Охлаждённая продукция',
      date: '01.10.2026',
      window: '14:00–18:00',
      distanceKm: 31,
      driverId: null,
      driverName: null,
      vehicleId: null,
      status: 'planned',
      earnings: 3800,
      cargo: {
        weightT: 0.6,
        volumeM3: 7,
        lengthM: 2.4,
        temp: [2, 6],
        kind: 'Молочная продукция · +2…+6 °C',
      },
      stops: [
        { time: '14:00', name: 'Склад № 1, Лобня', op: 'load', w: 0.6, v: 7 },
        { time: '15:10', name: 'Мытищи, ул. Колпакова, 2', op: 'unload', w: 0.35, v: 4 },
        { time: '16:20', name: 'Королёв, пр. Космонавтов, 20', op: 'unload', w: 0.25, v: 3 },
      ],
      ...tripBase(),
    },
  ];
}

const empty = (): Fleet => ({
  vehicles: [],
  trips: [],
  earnings: [],
  pool: { drivers: [], requests: [] },
});

/** Срезы логистики организации; каждый вызов — новые объекты. */
export function logisticsSeed(tenantId: string): Fleet {
  if (tenantId !== 't-alta') return empty();
  const terms = 'По соглашению фирм группы';
  return {
    vehicles: vehicles(),
    trips: trips(),
    earnings: [],
    pool: {
      drivers: [
        {
          id: 'd-104',
          code: 'Водитель #104',
          qual: 'Кат. C · рефрижератор',
          home: 'Юг Транс',
          unit: 'f-msk-yug',
          window: '13:00–19:00',
          terms,
        },
        {
          id: 'd-117',
          code: 'Водитель #117',
          qual: 'Кат. B',
          home: 'Восток Карго',
          unit: 'f-msk-vostok',
          window: '15:00–20:00',
          terms,
        },
      ],
      requests: [],
    },
  };
}
