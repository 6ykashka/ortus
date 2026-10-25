// Сид «Ремонта и стройки»: срез `db.repair` эталона (design/ortus/extra-data.js:77–144, 19.10).
// У «Альты» — шесть объектов, 13 работ, бригада, материалы, допработа ДР-1 и пять отметок.
// У «Лотоса» (салон) в эталоне тот же срез по ошибке сида — здесь срез пустой: изоляция
// организаций по `repair.crew` (Q-31, W6.90). Решение по умолчанию — Q-W6.10-1.
import type {
  ChangeOrder,
  CrewMember,
  RepairMaterial,
  RepairObject,
  RepairSlice,
  RepairWork,
  WorkLog,
} from './types.ts';

const FOREMAN = { foreman: 'Алексей Соколов', foremanId: 'm-sokolov' } as const;

function objects(): RepairObject[] {
  return [
    {
      id: 'obj-42',
      name: 'ЖК Речной · квартира 42',
      address: 'Москва, ул. Речная, 5, кв. 42',
      stage: 'Черновая отделка',
      area: '51 м², 2 комнаты',
      kind: 'капитальный ремонт',
      contract: 'договор № 42',
      due: '27.11',
      client: 'Ольга Смирнова',
      ...FOREMAN,
      crew: ['k1', 'k2', 'k3', 'k4'],
      sections: true,
      access: [
        ['door_front', 'Подъезд 2, этаж 9, домофон 42К'],
        ['elevator', 'Грузовой лифт до 20:00, материалы заносить со двора'],
        ['key', 'Ключи у прораба, запасной комплект в офисе'],
        ['volume_up', 'Шумные работы: будни 9:00–19:00, перерыв 13:00–15:00'],
      ],
      sub: { name: 'ООО «ЭлектроПрофи»', scope: 'электромонтаж', until: '31.10' },
    },
    {
      id: 'obj-38',
      name: 'ЖК Северный парк · квартира 117',
      address: 'Москва, Дмитровское ш., 107к2, кв. 117',
      stage: 'Чистовая отделка',
      area: '74 м², 3 комнаты',
      kind: 'капитальный ремонт',
      contract: 'договор № 38',
      due: '17.10',
      client: 'Игорь Лебедев',
      ...FOREMAN,
      crew: ['k1', 'k3', 'k4'],
      access: [
        ['door_front', 'Подъезд 1, этаж 14, домофон 117В'],
        ['elevator', 'Грузовой лифт по записи у консьержа'],
        ['key', 'Ключи у консьержа под подпись'],
        ['volume_up', 'Шумные работы: будни 10:00–19:00'],
      ],
      st: {
        sched: { due: '17.10', forecast: '17.10', slip: 0 },
        req: ['Плинтус МДФ, 42 м'],
        draft: ['Акт № 3 · чистовая отделка'],
        sms: [],
        est: 'approved',
        fin: {
          total: '1 540 000 ₽',
          paid: '1 078 000 ₽',
          spent: '736 400 ₽',
          margin: '415 800 ₽',
          subs: [
            'по смете версии 1',
            'аванс и два этапа · 70%',
            'материалы и бригада',
            '27% · факт после закрытия',
          ],
        },
      },
    },
    {
      id: 'obj-31',
      name: 'Профсоюзная, 64 · квартира 210',
      address: 'Москва, Профсоюзная ул., 64к1, кв. 210',
      stage: 'Чистовая отделка',
      area: '38 м², 1 комната',
      kind: 'косметический ремонт',
      contract: 'договор № 31',
      due: '09.10',
      client: 'Наталья Осипова',
      ...FOREMAN,
      crew: ['k2', 'k4'],
      access: [
        ['door_front', 'Подъезд 3, этаж 5, код домофона 210'],
        ['key', 'Ключи у заказчика, встреча по звонку'],
      ],
      st: {
        sched: { due: '09.10', forecast: '09.10', slip: 0 },
        req: [],
        draft: [],
        sms: [],
        est: 'approved',
        fin: {
          total: '486 000 ₽',
          paid: '340 200 ₽',
          spent: '298 600 ₽',
          margin: '131 220 ₽',
          subs: [
            'по смете версии 1',
            'аванс и этап · 70%',
            'материалы и бригада',
            '27% · факт после закрытия',
          ],
        },
      },
    },
    {
      id: 'obj-45',
      name: 'Кофейня на Покровке',
      address: 'Москва, ул. Покровка, 17, стр. 1',
      stage: 'Подготовка',
      area: '64 м², зал и кухня',
      kind: 'коммерческий ремонт',
      contract: 'договор № 45',
      due: '20.12',
      start: '06.10',
      client: 'ООО «Зерно»',
      foreman: null,
      crew: [],
      access: [
        ['door_front', 'Вход со двора, ворота открывает управляющий'],
        ['volume_up', 'Шумные работы: будни 9:00–19:00, по согласованию с управляющей компанией'],
      ],
      st: {
        sched: { due: '20.12', forecast: '20.12', slip: 0 },
        req: [],
        draft: [],
        sms: [],
        est: 'approved',
        fin: {
          total: '2 310 000 ₽',
          paid: '693 000 ₽',
          spent: '0 ₽',
          margin: '623 700 ₽',
          subs: ['по смете версии 3', 'аванс 30%', 'закупок пока нет', '27% · факт после закрытия'],
        },
      },
    },
    {
      id: 'obj-27',
      name: 'Дом на Лесной · Мытищи',
      address: 'Мытищи, ул. Лесная, 14',
      stage: 'Сдан',
      handedOver: '12.09',
      warranty: '12.09.2027',
      area: '142 м², 2 этажа',
      kind: 'ремонт под ключ',
      contract: 'договор № 27',
      due: '15.09',
      client: 'Андрей Кузнецов',
      ...FOREMAN,
      crew: ['k1', 'k2', 'k3'],
      access: [['key', 'Ключи переданы заказчику 12.09']],
      st: {
        sched: { due: '15.09', forecast: '12.09', slip: 0 },
        req: [],
        draft: [],
        sms: [],
        est: 'approved',
        fin: {
          total: '1 920 000 ₽',
          paid: '1 920 000 ₽',
          spent: '1 344 000 ₽',
          margin: '576 000 ₽',
          subs: [
            'по смете версии 2',
            'оплачено полностью',
            'материалы и бригада',
            '30% · по закрытым актам',
          ],
        },
      },
    },
    {
      id: 'obj-50',
      name: 'Дом 120 м², Истра',
      address: 'Истра, ул. Садовая, 8',
      stage: 'Замер',
      draft: true,
      measured: '02.10',
      area: '120 м², 2 этажа',
      kind: 'ремонт под ключ',
      contract: null,
      due: null,
      client: 'Сергей Павлов',
      foreman: null,
      crew: [],
      sections: ['measure', 'estimate'],
      access: [
        ['key', 'Ключи у заказчика, выезд по звонку'],
        ['local_parking', 'Парковка у ворот, въезд для грузовой машины'],
      ],
      feed: [
        {
          at: '02.10',
          who: 'Замерщик Игорь Белов',
          text: 'внёс замер: 8 помещений, фото и план приложены',
        },
        {
          at: '01.10',
          who: 'Дарья Зимина',
          text: 'перевела заявку на этап «Замер», создан объект-черновик',
        },
      ],
      st: { est: 'none', req: [], draft: [], sms: [], fin: null },
    },
  ];
}

const w = (
  id: string,
  obj: string,
  name: string,
  unit: string,
  plan: number,
  fact: number,
): RepairWork => ({ id, obj, name, unit, plan, fact });

function works(): RepairWork[] {
  return [
    w('w1', 'obj-42', 'Подготовка стен', 'м²', 96, 58),
    w('w2', 'obj-42', 'Грунтование', 'м²', 96, 24),
    w('w3', 'obj-42', 'Монтаж перегородок', 'м²', 18, 18),
    w('w4', 'obj-38', 'Шпаклёвка под покраску', 'м²', 186, 186),
    w('w5', 'obj-38', 'Покраска стен', 'м²', 186, 126),
    w('w6', 'obj-38', 'Укладка ламината', 'м²', 58, 40),
    w('w7', 'obj-31', 'Покраска стен', 'м²', 92, 92),
    w('w8', 'obj-31', 'Укладка плитки', 'м²', 24, 24),
    w('w9', 'obj-31', 'Укладка ламината', 'м²', 31, 12),
    w('w10', 'obj-45', 'Демонтаж перегородок', 'м²', 26, 0),
    w('w11', 'obj-45', 'Стяжка пола', 'м²', 64, 0),
    w('w12', 'obj-27', 'Покраска стен', 'м²', 310, 310),
    w('w13', 'obj-27', 'Укладка инженерной доски', 'м²', 118, 118),
  ];
}

const crew = (): CrewMember[] => [
  { id: 'k1', name: 'Иван Петров', role: 'отделочник', account: false },
  { id: 'k2', name: 'Олег Смирнов', role: 'отделочник', account: false },
  { id: 'k3', name: 'Роман Сергеев', role: 'маляр', account: false },
  { id: 'k4', name: 'Денис Волков', role: 'разнорабочий', account: false },
];

const mt = (id: string, obj: string, name: string, unit: string, qty: number): RepairMaterial => ({
  id,
  obj,
  name,
  unit,
  qty,
});

const materials = (): RepairMaterial[] => [
  mt('mt1', 'obj-42', 'Грунтовка', 'л', 30),
  mt('mt2', 'obj-42', 'Шпаклёвка', 'кг', 120),
  mt('mt3', 'obj-38', 'Краска интерьерная', 'л', 36),
  mt('mt4', 'obj-38', 'Подложка под ламинат', 'м²', 24),
  mt('mt5', 'obj-31', 'Подложка под ламинат', 'м²', 20),
];

const changes = (): ChangeOrder[] => [
  {
    id: 'ДР-1',
    obj: 'obj-42',
    at: '02.10',
    by: 'Алексей Соколов',
    title: 'Перенос розеток на кухне',
    volume: 6,
    unit: 'шт',
    note: 'Заказчик меняет расстановку кухни: 6 розеток перенести, штроба по бетону около 9 м.',
    photos: 2,
    status: 'proposed',
    suggest: [
      ['p-el-move', 6],
      ['p-chase', 9],
    ],
  },
];

const log = (
  id: string,
  obj: string,
  at: string,
  work: string,
  volume: number,
  crewIds: string[],
  materialsUsed: [string, number][],
  photos: number,
  status: WorkLog['status'],
): WorkLog => ({
  id,
  obj,
  at,
  work,
  volume,
  crew: crewIds,
  materials: materialsUsed,
  photos,
  status,
  by: 'Алексей Соколов',
});

const logs = (): WorkLog[] => [
  log('WL-11', 'obj-42', '30.09', 'w1', 22, ['k1', 'k2'], [['mt2', 40]], 3, 'Принят'),
  log('WL-09', 'obj-38', '30.09', 'w6', 18, ['k3', 'k4'], [['mt4', 18]], 3, 'На проверке'),
  log('WL-08', 'obj-38', '29.09', 'w5', 60, ['k1', 'k3'], [['mt3', 12]], 4, 'Принят'),
  log('WL-06', 'obj-31', '29.09', 'w9', 12, ['k2', 'k4'], [], 2, 'Принят'),
  log('WL-02', 'obj-27', '10.09', 'w13', 42, ['k1', 'k2'], [], 6, 'Принят'),
];

export const emptyRepairSlice = (): RepairSlice => ({
  objects: [],
  works: [],
  crew: [],
  materials: [],
  changes: [],
  logs: [],
});

/** Срез ремонта организации: у «Альты» — данные эталона, у остальных — пустой. */
export function repairSeed(tenantId: string): RepairSlice {
  if (tenantId !== 't-alta') return emptyRepairSlice();
  return {
    objects: objects(),
    works: works(),
    crew: crew(),
    materials: materials(),
    changes: changes(),
    logs: logs(),
  };
}
