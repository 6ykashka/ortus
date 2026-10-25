// Сид «Ремонта и стройки» сценарного сервера (W6.00, контракт 0.12.0-stage6): справочник расценок, шаблоны, замеры,
// версии сметы, график, объекты и работы «Альты» — выписка из «Ремонт и стройка.dc.html» (CAT0, TPL0, ROOMS0, E42, GST,
// GLK, CO0, STOCK0, PUR0, SUP) и ortus/extra-data.js (repair) эталона design-2026-10-19. Чистые данные без состояния:
// их читают seed.ts и тест расчётов. Цены — рубли целыми; даты «дд.мм» эталона — 2026 год (Q-W4.00-repair-15: одни часы,
// сценарий идёт с 20.10.2026).

export type Unit = 'hour' | 'm2' | 'm3' | 'm' | 'piece' | 'set' | 'trip' | 'mesh' | 'liter';
export type Formula =
  'floor' | 'floor_dry' | 'walls' | 'walls_dry' | 'wet' | 'perimeter' | 'perimeter_dry';

/** Единицы эталона → контракт. */
export const UNIT_OF: Readonly<Record<string, Unit>> = {
  'м²': 'm2',
  м: 'm',
  шт: 'piece',
  рейс: 'trip',
  меш: 'mesh',
  л: 'liter',
  компл: 'set',
};

/** Формулы эталона (fval) → контракт. */
const FM: Readonly<Record<string, Formula>> = {
  floor: 'floor',
  floorDry: 'floor_dry',
  walls: 'walls',
  wallsDry: 'walls_dry',
  bath: 'wet',
  perim: 'perimeter',
  perimDry: 'perimeter_dry',
};

export interface CatItem {
  id: string;
  cat: string;
  name: string;
  unit: Unit;
  kind: 'work' | 'material';
  price: number;
}

const cat = (
  id: string,
  c: string,
  name: string,
  unit: string,
  kind: 'work' | 'material',
  price: number,
): CatItem => ({ id, cat: c, name, unit: UNIT_OF[unit] ?? 'piece', kind, price });

/** Справочник расценок: 23 позиции (15 работ и 8 материалов). */
export const CAT0: CatItem[] = [
  cat('p-dem-floor', 'Демонтаж', 'Демонтаж напольного покрытия', 'м²', 'work', 180),
  cat('p-dem-wall', 'Демонтаж', 'Демонтаж перегородок', 'м²', 'work', 650),
  cat('p-trash', 'Демонтаж', 'Вывоз мусора', 'рейс', 'work', 6500),
  cat('p-el-point', 'Электрика', 'Электромонтаж, точка', 'шт', 'work', 1200),
  cat('p-el-move', 'Электрика', 'Перенос розетки или выключателя', 'шт', 'work', 1500),
  cat('p-chase', 'Электрика', 'Штробление бетона', 'м', 'work', 450),
  cat('p-shield', 'Электрика', 'Сборка щитка', 'шт', 'work', 9500),
  cat('p-plaster', 'Стены', 'Штукатурка по маякам', 'м²', 'work', 650),
  cat('p-paint', 'Стены', 'Шпаклёвка и покраска', 'м²', 'work', 520),
  cat('p-wallpaper', 'Стены', 'Поклейка обоев', 'м²', 'work', 380),
  cat('p-screed', 'Полы', 'Стяжка пола', 'м²', 'work', 750),
  cat('p-laminate', 'Полы', 'Укладка ламината', 'м²', 'work', 490),
  cat('p-tile', 'Полы', 'Укладка плитки', 'м²', 'work', 1600),
  cat('p-skirting', 'Полы', 'Монтаж плинтуса', 'м', 'work', 220),
  cat('p-plumb', 'Сантехника', 'Установка сантехприбора', 'шт', 'work', 3500),
  cat('m-laminate', 'Материалы', 'Ламинат 33 класс', 'м²', 'material', 1350),
  cat('m-laminate32', 'Материалы', 'Ламинат 32 класс', 'м²', 'material', 980),
  cat('m-plaster', 'Материалы', 'Штукатурка гипсовая 30 кг', 'меш', 'material', 400),
  cat('m-cable', 'Материалы', 'Кабель и фурнитура', 'компл', 'material', 28500),
  cat('m-skirting', 'Материалы', 'Плинтус МДФ', 'м', 'material', 310),
  cat('m-tile', 'Материалы', 'Керамогранит 60×60', 'м²', 'material', 1800),
  cat('m-primer', 'Материалы', 'Грунтовка глубокого проникновения', 'л', 'material', 95),
  cat('m-paint', 'Материалы', 'Краска интерьерная', 'л', 'material', 540),
];

export interface LineSpec {
  id?: string;
  section: string;
  item: string;
  formula: Formula | null;
  coef: number;
  quantity: number;
}

/** Строка шаблона эталона `TL(sec, item, f, k, q)`. */
const TL = (section: string, item: string, f?: string | null, k = 1, q = 1): LineSpec => ({
  section,
  item,
  formula: f ? (FM[f] ?? null) : null,
  coef: k,
  quantity: q,
});

export interface TechStage {
  name: string;
  /** Выработка в день (м², точек, приборов…); null — «1 день» без выработки. */
  ratePerDay: number | null;
  /** Пауза в календарных днях; < 0 — опережение. */
  pauseDays: number;
  note: string;
}

const T = (name: string, rate: number | null, pause = 0, note = ''): TechStage => ({
  name,
  ratePerDay: rate,
  pauseDays: pause,
  note,
});

const TECH_CAP: TechStage[] = [
  T('Демонтаж', 12),
  T('Электрика · черновая', 5),
  T('Штукатурка стен', 12, -3, 'раньше на 3 дня: начинают с комнат, где проводка готова'),
  T('Стяжка пола', 25),
  T('Шпаклёвка и покраска', 10, 5, 'после штукатурки пауза 5 дней: сушка'),
  T('Плитка в санузле', 5, 3, 'после стяжки пауза 3 дня'),
  T('Укладка ламината', 15, 10, 'после стяжки пауза 10 дней: сушка'),
  T('Электрика · чистовая', 20),
  T('Уборка и сдача объекта', null),
];

const CHECK_CAP = [
  'Стены: отклонение не больше 2 мм на 2 м',
  'Углы и откосы ровные, без трещин',
  'Плитка: швы ровные, пустот при простукивании нет',
  'Ламинат без щелей и скрипа, зазоры закрыты плинтусом',
  'Розетки и выключатели работают, группы подписаны в щитке',
  'Сантехника без протечек, вода уходит свободно',
  'Двери и окна открываются без усилия',
  'Мусор вывезен, объект убран',
];

export type DocKind = 'contract' | 'agreement' | 'act' | 'invoice' | 'handover_act' | 'warranty';
const DOCS_CAP: DocKind[] = ['contract', 'act', 'act', 'act', 'act', 'handover_act', 'warranty'];

const MATS_CAP: LineSpec[] = [
  TL('Материалы', 'm-laminate', 'floorDry', 1.07),
  TL('Материалы', 'm-plaster', 'wallsDry', 0.4),
  TL('Материалы', 'm-cable', null, 1, 1),
  TL('Материалы', 'm-skirting', 'perimDry', 1.05),
  TL('Материалы', 'm-tile', 'bath', 1.1),
  TL('Материалы', 'm-primer', 'walls', 0.2),
];

export const LINES_CAP: LineSpec[] = [
  TL('Демонтаж', 'p-dem-floor', 'floor'),
  TL('Демонтаж', 'p-trash', null, 1, 2),
  TL('Электрика', 'p-el-point', null, 1, 30),
  TL('Электрика', 'p-shield', null, 1, 1),
  TL('Стены', 'p-plaster', 'wallsDry'),
  TL('Стены', 'p-paint', 'wallsDry'),
  TL('Полы', 'p-screed', 'floor'),
  TL('Полы', 'p-laminate', 'floorDry'),
  TL('Полы', 'p-tile', 'bath'),
  TL('Полы', 'p-skirting', 'perimDry'),
  TL('Материалы', 'm-laminate', 'floorDry', 1.07),
  TL('Материалы', 'm-plaster', 'wallsDry', 0.4),
  TL('Материалы', 'm-cable', null, 1, 1),
  TL('Материалы', 'm-skirting', 'perimDry', 1.05),
];

export interface TemplateSeed {
  id: string;
  name: string;
  kind: string;
  source: 'ortus' | 'own';
  /** Объект, из которого сохранён шаблон (эталон: «Дом на Лесной · Мытищи»). */
  from?: string;
  updatedAt: string;
  used: number;
  lines: LineSpec[];
  tech: TechStage[];
  docs: DocKind[];
  check: string[];
  mats: LineSpec[];
  warrantyMonths: number;
}

export const TPL0: TemplateSeed[] = [
  {
    id: 'tpl-cap',
    name: 'Капитальный ремонт квартиры',
    kind: 'капитальный ремонт',
    source: 'ortus',
    updatedAt: '2026-09-12T09:00:00Z',
    used: 2,
    lines: LINES_CAP,
    tech: TECH_CAP,
    docs: DOCS_CAP,
    check: CHECK_CAP,
    mats: MATS_CAP,
    warrantyMonths: 24,
  },
  {
    id: 'tpl-cosm',
    name: 'Косметический ремонт',
    kind: 'косметический ремонт',
    source: 'ortus',
    updatedAt: '2026-09-01T09:00:00Z',
    used: 1,
    lines: [
      TL('Демонтаж', 'p-trash', null, 1, 1),
      TL('Стены', 'p-wallpaper', 'wallsDry'),
      TL('Полы', 'p-laminate', 'floorDry'),
      TL('Полы', 'p-skirting', 'perimDry'),
      TL('Материалы', 'm-laminate32', 'floorDry', 1.07),
      TL('Материалы', 'm-skirting', 'perimDry', 1.05),
    ],
    tech: [
      T('Подготовка и вывоз мусора', null),
      T('Поклейка обоев', 20),
      T('Укладка ламината', 20, 0, 'сразу после обоев'),
      T('Монтаж плинтуса', 30),
      T('Уборка и сдача объекта', null),
    ],
    docs: ['contract', 'handover_act', 'warranty'],
    check: [
      'Обои: стыки не видны, пузырей нет',
      'Ламинат без щелей и скрипа',
      'Плинтус закреплён, углы подогнаны',
      'Мусор вывезен, объект убран',
    ],
    mats: [
      TL('Материалы', 'm-laminate32', 'floorDry', 1.07),
      TL('Материалы', 'm-skirting', 'perimDry', 1.05),
      TL('Материалы', 'm-primer', 'walls', 0.2),
    ],
    warrantyMonths: 12,
  },
  {
    id: 'tpl-house',
    name: 'Ремонт под ключ · дом',
    kind: 'ремонт под ключ',
    source: 'own',
    from: 'Дом на Лесной · Мытищи',
    updatedAt: '2026-09-12T09:00:00Z',
    used: 1,
    lines: [
      TL('Демонтаж', 'p-dem-floor', 'floor'),
      TL('Демонтаж', 'p-trash', null, 1, 4),
      TL('Электрика', 'p-el-point', null, 1, 64),
      TL('Электрика', 'p-shield', null, 1, 1),
      TL('Стены', 'p-plaster', 'wallsDry'),
      TL('Стены', 'p-paint', 'wallsDry'),
      TL('Полы', 'p-screed', 'floor'),
      TL('Полы', 'p-laminate', 'floorDry'),
      TL('Полы', 'p-tile', 'bath'),
      TL('Полы', 'p-skirting', 'perimDry'),
      TL('Сантехника', 'p-plumb', null, 1, 8),
      TL('Материалы', 'm-laminate', 'floorDry', 1.07),
      TL('Материалы', 'm-plaster', 'wallsDry', 0.4),
      TL('Материалы', 'm-cable', null, 1, 2),
      TL('Материалы', 'm-skirting', 'perimDry', 1.05),
      TL('Материалы', 'm-tile', 'bath', 1.1),
    ],
    tech: [
      ...TECH_CAP.slice(0, 7),
      T('Сантехника · чистовая', 3, 0, 'после плитки'),
      ...TECH_CAP.slice(7),
    ],
    docs: ['contract', 'act', 'act', 'act', 'act', 'act', 'handover_act', 'warranty'],
    check: [
      ...CHECK_CAP.slice(0, 7),
      'Котельная: опрессовка отопления пройдена',
      'Лестница: перила закреплены, ступени не скрипят',
      CHECK_CAP[7] ?? '',
    ],
    mats: [
      TL('Материалы', 'm-laminate', 'floorDry', 1.07),
      TL('Материалы', 'm-plaster', 'wallsDry', 0.4),
      TL('Материалы', 'm-cable', null, 1, 2),
      TL('Материалы', 'm-skirting', 'perimDry', 1.05),
      TL('Материалы', 'm-tile', 'bath', 1.1),
      TL('Материалы', 'm-primer', 'walls', 0.2),
    ],
    warrantyMonths: 24,
  },
  {
    id: 'tpl-comm',
    name: 'Коммерческое помещение',
    kind: 'коммерческий ремонт',
    source: 'ortus',
    updatedAt: '2026-09-01T09:00:00Z',
    used: 1,
    lines: [
      TL('Демонтаж', 'p-dem-wall', null, 1, 26),
      TL('Демонтаж', 'p-trash', null, 1, 3),
      TL('Электрика', 'p-el-point', null, 1, 40),
      TL('Электрика', 'p-shield', null, 1, 1),
      TL('Стены', 'p-paint', 'walls'),
      TL('Полы', 'p-screed', 'floor'),
      TL('Полы', 'p-tile', 'floor'),
      TL('Материалы', 'm-paint', 'walls', 0.3),
      TL('Материалы', 'm-tile', 'floor', 1.1),
      TL('Материалы', 'm-cable', null, 1, 2),
    ],
    tech: [
      T('Демонтаж перегородок', 10),
      T('Электрика · черновая', 6),
      T('Стяжка пола', 30),
      T('Шпаклёвка и покраска', 15),
      T('Укладка плитки', 8, 3, 'после стяжки пауза 3 дня'),
      T('Электрика · чистовая', 25),
      T('Уборка и сдача объекта', null),
    ],
    docs: ['contract', 'act', 'act', 'handover_act', 'warranty'],
    check: [
      'Покрытие пола ровное, швы затёрты',
      'Освещение и розетки работают по проекту',
      'Пути эвакуации свободны',
      'Мусор вывезен, помещение убрано',
    ],
    mats: [
      TL('Материалы', 'm-paint', 'walls', 0.3),
      TL('Материалы', 'm-tile', 'floor', 1.1),
      TL('Материалы', 'm-cable', null, 1, 2),
      TL('Материалы', 'm-primer', 'walls', 0.2),
    ],
    warrantyMonths: 12,
  },
];

export interface RoomSeed {
  name: string;
  l: number;
  w: number;
  h: number;
  o: number;
}

const room = (name: string, l: number, w: number, h: number, o: number): RoomSeed => ({
  name,
  l,
  w,
  h,
  o,
});

export const ROOMS0: Record<string, RoomSeed[]> = {
  'obj-42': [
    room('Гостиная', 5.2, 3.8, 2.7, 3.6),
    room('Спальня', 4.1, 3.2, 2.7, 2.4),
    room('Кухня', 3.4, 3.0, 2.7, 2.0),
    room('Санузел', 2.2, 1.7, 2.7, 1.4),
  ],
  'obj-50': [
    room('Гостиная и кухня', 7.2, 5.4, 2.8, 6.2),
    room('Спальня', 4.6, 3.8, 2.8, 2.6),
    room('Детская', 4.0, 3.6, 2.8, 2.4),
    room('Кабинет', 3.6, 3.0, 2.8, 2.2),
    room('Холл и лестница', 6.0, 2.4, 2.8, 4.6),
    room('Санузел', 2.8, 2.0, 2.8, 1.6),
    room('Санузел 2', 2.2, 1.8, 2.8, 1.4),
    room('Котельная', 2.4, 2.0, 2.8, 1.6),
  ],
};

/**
 * Версии сметы кв. 42 (E42): версия 2 — шаблон «Капитальный ремонт квартиры» с 38 точками электрики (основа договора
 * № 42), версия 1 — без сборки щитка, 32 точки и ламинат 32 класса. Идентификаторы строк эталона (l1…l15).
 */
export function e42Versions(): { v1: LineSpec[]; v2: LineSpec[] } {
  const ids = [
    'l1',
    'l2',
    'l3',
    'l4',
    'l5',
    'l6',
    'l7',
    'l8',
    'l9',
    'l14',
    'l10',
    'l11',
    'l12',
    'l15',
  ];
  const v2 = LINES_CAP.map((t, i) => ({
    ...t,
    id: ids[i] ?? `l${i}`,
    quantity: t.item === 'p-el-point' ? 38 : t.quantity,
  }));
  const v1 = v2
    .filter((l) => l.id !== 'l4')
    .map((l) =>
      l.id === 'l3'
        ? { ...l, quantity: 32 }
        : l.id === 'l10'
          ? { ...l, id: 'l13', item: 'm-laminate32' }
          : l,
    );
  return { v1, v2 };
}

/** Допработа ДР-1 (CO0): позиции справочника, которые подставляются в черновик по описанию прораба. */
export const CO1_SUGGEST: [string, number][] = [
  ['p-el-move', 6],
  ['p-chase', 9],
];

/** Этап графика кв. 42 (GST): `as` — фактическое начало (день от 05.10), `ms` — веха сдачи. */
export interface GstSeed {
  id: string;
  ph: number;
  name: string;
  who: string;
  dur: number;
  as?: number;
  acc?: number;
  ms?: boolean;
  section: string;
}

export const GST0: GstSeed[] = [
  {
    id: 's1',
    ph: 0,
    name: 'Демонтаж',
    who: 'Бригада О. Дронова',
    dur: 5,
    as: 0,
    acc: 1,
    section: 'Демонтаж',
  },
  {
    id: 's2',
    ph: 0,
    name: 'Электрика · черновая',
    who: 'ООО «ЭлектроПрофи»',
    dur: 8,
    as: 7,
    section: 'Электрика',
  },
  {
    id: 's3',
    ph: 0,
    name: 'Штукатурка стен',
    who: 'Бригада О. Дронова',
    dur: 10,
    section: 'Стены',
  },
  { id: 's4', ph: 0, name: 'Стяжка пола', who: 'Бригада О. Дронова', dur: 2, section: 'Полы' },
  {
    id: 's5',
    ph: 1,
    name: 'Шпаклёвка и покраска стен',
    who: 'Бригада О. Дронова',
    dur: 12,
    section: 'Стены',
  },
  { id: 's6', ph: 1, name: 'Плитка в санузле', who: '', dur: 5, section: 'Полы' },
  { id: 's7', ph: 1, name: 'Укладка ламината', who: 'Бригада О. Дронова', dur: 3, section: 'Полы' },
  {
    id: 's8',
    ph: 1,
    name: 'Электрика · чистовая',
    who: 'ООО «ЭлектроПрофи»',
    dur: 2,
    section: 'Электрика',
  },
  {
    id: 's9',
    ph: 2,
    name: 'Уборка и подготовка к сдаче',
    who: 'Бригада О. Дронова',
    dur: 1,
    section: '',
  },
  {
    id: 's10',
    ph: 2,
    name: 'Сдача объекта',
    who: 'Алексей Соколов',
    dur: 1,
    ms: true,
    section: '',
  },
];

/** Связи «окончание → начало» (GLK): [от, к, пауза в календарных днях, пояснение]. */
export const GLK0: [string, string, number, string][] = [
  ['s1', 's2', 0, ''],
  ['s2', 's3', -3, 'начинаем с комнат, где проводка готова'],
  ['s3', 's4', 0, ''],
  ['s3', 's5', 5, 'сушка штукатурки'],
  ['s4', 's6', 3, 'стяжка набирает прочность'],
  ['s4', 's7', 10, 'сушка стяжки под ламинат'],
  ['s5', 's7', 0, ''],
  ['s5', 's8', 0, ''],
  ['s6', 's9', 0, ''],
  ['s7', 's9', 0, ''],
  ['s8', 's9', 0, ''],
  ['s9', 's10', 0, ''],
];

export const GREASONS_OF: Readonly<Record<string, string>> = {
  client_request: 'Решение заказчика',
  material_delay: 'Поставка материалов',
  executor_busy: 'Задержка подрядчика',
  rework: 'Уточнили объём работ',
  weather_or_drying: 'Технологическая пауза',
  scope_change: 'Добавили людей на этап',
  other: 'Нет доступа на объект',
};

/** Объекты (extra-data.js repair.objects): общий вид сида. */
export interface ObjectSeed {
  id: string;
  name: string;
  address: string;
  stage: string;
  area: number;
  rooms: number;
  kind: string;
  status: 'draft' | 'active' | 'handed_over';
  contractNo: string | null;
  due: string | null;
  start?: string;
  client: string;
  foreman: string | null;
  crew: string[];
  access: { icon: string; text: string }[];
  template?: string;
  handedOver?: string;
  warranty?: string;
  total?: number;
  paid?: number;
  spent?: number;
}

export const OBJECTS0: ObjectSeed[] = [
  {
    id: 'obj-42',
    name: 'ЖК Речной · квартира 42',
    address: 'Москва, ул. Речная, 5, кв. 42',
    stage: 'Черновая отделка',
    area: 51,
    rooms: 2,
    kind: 'капитальный ремонт',
    status: 'active',
    contractNo: 'договор № 42',
    due: '2026-11-27',
    client: 'Ольга Смирнова',
    foreman: 'm-sokolov',
    crew: ['k1', 'k2', 'k3', 'k4'],
    template: 'tpl-cap',
    total: 438175,
    paid: 131453,
    spent: 31600,
    access: [
      { icon: 'door_front', text: 'Подъезд 2, этаж 9, домофон 42К' },
      { icon: 'elevator', text: 'Грузовой лифт до 20:00, материалы заносить со двора' },
      { icon: 'key', text: 'Ключи у прораба, запасной комплект в офисе' },
      { icon: 'volume_up', text: 'Шумные работы: будни 9:00–19:00, перерыв 13:00–15:00' },
    ],
  },
  {
    id: 'obj-38',
    name: 'ЖК Северный парк · квартира 117',
    address: 'Москва, Дмитровское ш., 107к2, кв. 117',
    stage: 'Чистовая отделка',
    area: 74,
    rooms: 3,
    kind: 'капитальный ремонт',
    status: 'active',
    contractNo: 'договор № 38',
    due: '2026-10-17',
    client: 'Игорь Лебедев',
    foreman: 'm-sokolov',
    crew: ['k1', 'k3', 'k4'],
    template: 'tpl-cap',
    total: 1540000,
    paid: 1078000,
    spent: 736400,
    access: [
      { icon: 'door_front', text: 'Подъезд 1, этаж 14, домофон 117В' },
      { icon: 'elevator', text: 'Грузовой лифт по записи у консьержа' },
      { icon: 'key', text: 'Ключи у консьержа под подпись' },
      { icon: 'volume_up', text: 'Шумные работы: будни 10:00–19:00' },
    ],
  },
  {
    id: 'obj-31',
    name: 'Профсоюзная, 64 · квартира 210',
    address: 'Москва, Профсоюзная ул., 64к1, кв. 210',
    stage: 'Чистовая отделка',
    area: 38,
    rooms: 1,
    kind: 'косметический ремонт',
    status: 'active',
    contractNo: 'договор № 31',
    due: '2026-10-09',
    client: 'Наталья Осипова',
    foreman: 'm-sokolov',
    crew: ['k2', 'k4'],
    template: 'tpl-cosm',
    total: 486000,
    paid: 340200,
    spent: 298600,
    access: [
      { icon: 'door_front', text: 'Подъезд 3, этаж 5, код домофона 210' },
      { icon: 'key', text: 'Ключи у заказчика, встреча по звонку' },
    ],
  },
  {
    id: 'obj-45',
    name: 'Кофейня на Покровке',
    address: 'Москва, ул. Покровка, 17, стр. 1',
    stage: 'Подготовка',
    area: 64,
    rooms: 2,
    kind: 'коммерческий ремонт',
    status: 'active',
    contractNo: 'договор № 45',
    due: '2026-12-20',
    start: '2026-10-06',
    client: 'ООО «Зерно»',
    foreman: null,
    crew: [],
    template: 'tpl-comm',
    total: 2310000,
    paid: 693000,
    spent: 0,
    access: [
      { icon: 'door_front', text: 'Вход со двора, ворота открывает управляющий' },
      {
        icon: 'volume_up',
        text: 'Шумные работы: будни 9:00–19:00, по согласованию с управляющей компанией',
      },
    ],
  },
  {
    id: 'obj-27',
    name: 'Дом на Лесной · Мытищи',
    address: 'Мытищи, ул. Лесная, 14',
    stage: 'Сдан',
    area: 142,
    rooms: 5,
    kind: 'ремонт под ключ',
    status: 'handed_over',
    contractNo: 'договор № 27',
    due: '2026-09-15',
    client: 'Андрей Кузнецов',
    foreman: 'm-sokolov',
    crew: ['k1', 'k2', 'k3'],
    template: 'tpl-house',
    handedOver: '2026-09-12',
    warranty: '2028-09-12',
    total: 1920000,
    paid: 1920000,
    spent: 1344000,
    access: [{ icon: 'key', text: 'Ключи переданы заказчику 12.09' }],
  },
  {
    id: 'obj-50',
    name: 'Дом 120 м², Истра',
    address: 'Истра, ул. Садовая, 8',
    stage: 'Замер',
    area: 120,
    rooms: 8,
    kind: 'ремонт под ключ',
    status: 'draft',
    contractNo: null,
    due: null,
    client: 'Сергей Павлов',
    foreman: null,
    crew: [],
    access: [
      { icon: 'key', text: 'Ключи у заказчика, выезд по звонку' },
      { icon: 'local_parking', text: 'Парковка у ворот, въезд для грузовой машины' },
    ],
  },
];

export const CREW0: { id: string; name: string; role: string }[] = [
  { id: 'k1', name: 'Иван Петров', role: 'отделочник' },
  { id: 'k2', name: 'Олег Смирнов', role: 'отделочник' },
  { id: 'k3', name: 'Роман Сергеев', role: 'маляр' },
  { id: 'k4', name: 'Денис Волков', role: 'разнорабочий' },
];

export const WORKS0: {
  id: string;
  obj: string;
  name: string;
  unit: Unit;
  plan: number;
  fact: number;
}[] = [
  { id: 'w1', obj: 'obj-42', name: 'Подготовка стен', unit: 'm2', plan: 96, fact: 58 },
  { id: 'w2', obj: 'obj-42', name: 'Грунтование', unit: 'm2', plan: 96, fact: 24 },
  { id: 'w3', obj: 'obj-42', name: 'Монтаж перегородок', unit: 'm2', plan: 18, fact: 18 },
  { id: 'w4', obj: 'obj-38', name: 'Шпаклёвка под покраску', unit: 'm2', plan: 186, fact: 186 },
  { id: 'w5', obj: 'obj-38', name: 'Покраска стен', unit: 'm2', plan: 186, fact: 126 },
  { id: 'w6', obj: 'obj-38', name: 'Укладка ламината', unit: 'm2', plan: 58, fact: 40 },
  { id: 'w7', obj: 'obj-31', name: 'Покраска стен', unit: 'm2', plan: 92, fact: 92 },
  { id: 'w8', obj: 'obj-31', name: 'Укладка плитки', unit: 'm2', plan: 24, fact: 24 },
  { id: 'w9', obj: 'obj-31', name: 'Укладка ламината', unit: 'm2', plan: 31, fact: 12 },
  { id: 'w10', obj: 'obj-45', name: 'Демонтаж перегородок', unit: 'm2', plan: 26, fact: 0 },
  { id: 'w11', obj: 'obj-45', name: 'Стяжка пола', unit: 'm2', plan: 64, fact: 0 },
  { id: 'w12', obj: 'obj-27', name: 'Покраска стен', unit: 'm2', plan: 310, fact: 310 },
  { id: 'w13', obj: 'obj-27', name: 'Укладка инженерной доски', unit: 'm2', plan: 118, fact: 118 },
];

export interface LogSeed {
  id: string;
  obj: string;
  at: string;
  work: string;
  volume: number;
  crew: string[];
  materials: [string, number][];
  photos: number;
  status: 'accepted' | 'submitted';
}

/** Отметки (extra-data.js repair.logs); материалы — позиции справочника (Q-W4.00-repair-7: m-*, не mt1…). */
export const LOGS0: LogSeed[] = [
  {
    id: 'WL-11',
    obj: 'obj-42',
    at: '2026-09-30',
    work: 'w1',
    volume: 22,
    crew: ['k1', 'k2'],
    materials: [['m-plaster', 40]],
    photos: 3,
    status: 'accepted',
  },
  {
    id: 'WL-09',
    obj: 'obj-38',
    at: '2026-09-30',
    work: 'w6',
    volume: 18,
    crew: ['k3', 'k4'],
    materials: [['m-laminate32', 18]],
    photos: 3,
    status: 'submitted',
  },
  {
    id: 'WL-08',
    obj: 'obj-38',
    at: '2026-09-29',
    work: 'w5',
    volume: 60,
    crew: ['k1', 'k3'],
    materials: [['m-paint', 12]],
    photos: 4,
    status: 'accepted',
  },
  {
    id: 'WL-06',
    obj: 'obj-31',
    at: '2026-09-29',
    work: 'w9',
    volume: 12,
    crew: ['k2', 'k4'],
    materials: [],
    photos: 2,
    status: 'accepted',
  },
  {
    id: 'WL-02',
    obj: 'obj-27',
    at: '2026-09-10',
    work: 'w13',
    volume: 42,
    crew: ['k1', 'k2'],
    materials: [],
    photos: 6,
    status: 'accepted',
  },
];

export interface SupplySeed {
  id: string;
  obj: string;
  item: string;
  qty: number;
  need: string;
  state: 'request' | 'bought' | 'used';
  sum: number;
  purchase?: string;
}

/** Заявки снабжения (SUP): позиция справочника; З-13 «Кабинет и фурнитура» — комплект кабеля справочника. */
export const SUPPLY0: SupplySeed[] = [
  {
    id: 'З-12',
    obj: 'obj-42',
    item: 'm-plaster',
    qty: 46,
    need: '2026-10-08',
    state: 'used',
    sum: 18400,
  },
  {
    id: 'З-13',
    obj: 'obj-42',
    item: 'm-cable',
    qty: 1,
    need: '2026-10-14',
    state: 'bought',
    sum: 13200,
    purchase: 'ЗК-6',
  },
  {
    id: 'З-14',
    obj: 'obj-42',
    item: 'm-laminate',
    qty: 52,
    need: '2026-10-27',
    state: 'request',
    sum: 70200,
  },
  {
    id: 'З-15',
    obj: 'obj-42',
    item: 'm-tile',
    qty: 18,
    need: '2026-10-23',
    state: 'request',
    sum: 32400,
  },
  {
    id: 'З-21',
    obj: 'obj-38',
    item: 'm-skirting',
    qty: 42,
    need: '2026-10-22',
    state: 'request',
    sum: 13020,
  },
  {
    id: 'З-22',
    obj: 'obj-38',
    item: 'm-paint',
    qty: 18,
    need: '2026-10-24',
    state: 'request',
    sum: 9720,
  },
  {
    id: 'З-23',
    obj: 'obj-31',
    item: 'm-laminate32',
    qty: 22,
    need: '2026-10-21',
    state: 'request',
    sum: 21560,
  },
  {
    id: 'З-24',
    obj: 'obj-45',
    item: 'm-tile',
    qty: 70,
    need: '2026-11-03',
    state: 'request',
    sum: 126000,
  },
  {
    id: 'З-25',
    obj: 'obj-45',
    item: 'm-paint',
    qty: 40,
    need: '2026-11-05',
    state: 'request',
    sum: 21600,
  },
];

export const WAREHOUSES = [
  { id: 'wh-msk', name: 'Москва · Отрадное' },
  { id: 'wh-mo', name: 'Мытищи' },
];

/** Остатки складов (STOCK0): склад, позиция, количество, средняя цена. */
export const STOCK0: { wh: string; item: string; qty: number; cost: number }[] = [
  { wh: 'wh-msk', item: 'm-skirting', qty: 60, cost: 265 },
  { wh: 'wh-msk', item: 'm-primer', qty: 40, cost: 78 },
  { wh: 'wh-msk', item: 'm-plaster', qty: 12, cost: 345 },
  { wh: 'wh-msk', item: 'm-paint', qty: 10, cost: 460 },
  { wh: 'wh-mo', item: 'm-laminate32', qty: 40, cost: 840 },
  { wh: 'wh-mo', item: 'm-tile', qty: 6, cost: 1540 },
];

/** Остатки на объектах (ONOBJ0). */
export const ONOBJ0: { obj: string; item: string; qty: number; cost: number }[] = [
  { obj: 'obj-27', item: 'm-tile', qty: 4, cost: 1540 },
  { obj: 'obj-27', item: 'm-primer', qty: 12, cost: 78 },
  { obj: 'obj-31', item: 'm-skirting', qty: 8, cost: 265 },
];

export const SUPPLIERS = ['СтройБаза Север', 'ПолМаркет', 'КерамТорг'];

/** Бригада в «Оплате бригады» (:1657): работник, роль, работа по акту, сумма. */
export const ACCRUALS0: { name: string; role: string; work: string; sum: number; self: boolean }[] =
  [
    { name: 'Рустам Каримов', role: 'бригадир', work: 'Демонтаж', sum: 19800, self: false },
    { name: 'Виталий Ким', role: 'отделочник', work: 'Демонтаж', sum: 14200, self: true },
    { name: 'Олег Дронов', role: 'разнорабочий', work: 'Демонтаж', sum: 9400, self: true },
  ];
