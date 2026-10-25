// Сид «Обращений» (service.js 19.10:123–213): 4 направления, 21 тип, 4 шаблона, 8 обращений,
// 2 низкие оценки. Время эталона — местное (`new Date(2026, mon-1, d, h, m)`), в домене — Москва.
// Подключается только к «Альта Групп» стадией `service` (после `normProjects`, план v2 §3.5).
import { DEMO } from '../../core/clock.ts';
import type { SeedHook, SeedOpts } from '../../core/index.ts';
import type { CoreDb } from '../../core/types/index.ts';
import { addWorkMinutes, CAL, DAY_MS, MSK_OFFSET_MIN, MINUTE_MS } from './calendar.ts';
import type {
  Direction,
  MessageKind,
  RequestKind,
  RequestMessage,
  RequestType,
  ServiceRequest,
  ServiceSlice,
  ServiceTenantDb,
  Sla,
} from './types.ts';

/** «Сейчас» демо: 1 октября 2026, 16:24 по Москве; дальше часы идут по `driftClock`. */
export const SVC_BASE = Date.parse(DEMO.svcBase);

/** Московское время 2026 года: день, месяц (1–12), час, минута. */
const ts = (day: number, mon: number, h: number, m: number): number =>
  Date.UTC(2026, mon - 1, day, h, m) - MSK_OFFSET_MIN * MINUTE_MS;

type Stopped = Partial<Record<'first' | 'resolve' | 'legal', number>>;

export function serviceSeed(): ServiceSlice {
  const directions: Direction[] = [
    {
      id: 'd-mas',
      key: 'МАС',
      name: 'Массаж',
      color: '#7B3F6E',
      module: 'Салон и SPA',
      area: 'Альта SPA',
      project: 'svc-mas',
      cal: CAL.spa,
      lead: 'm-owner',
      next: 42,
    },
    {
      id: 'd-kos',
      key: 'КОС',
      name: 'Косметология',
      color: '#5B4E8C',
      module: 'Салон и SPA',
      area: 'Альта SPA',
      project: 'svc-kos',
      cal: CAL.spa,
      lead: 'm-owner',
      next: 7,
    },
    {
      id: 'd-otd',
      key: 'ОТД',
      name: 'Отделка',
      color: '#7A5214',
      module: 'Ремонт и стройка',
      area: 'Москва',
      project: 'svc-otd',
      cal: CAL.rep,
      lead: 'm-owner',
      next: 13,
    },
    {
      id: 'd-grz',
      key: 'ГРЗ',
      name: 'Грузоперевозки',
      color: '#2B5479',
      module: 'Логистика',
      area: 'Москва, Самара',
      project: 'svc-grz',
      cal: CAL.log,
      lead: 'm-owner',
      next: 58,
    },
  ];
  const T = (
    dir: string,
    kind: RequestKind,
    name: string,
    first?: number,
    resolve?: number | null,
    legal?: number,
  ): RequestType => ({
    id: dir + ':' + kind,
    dir,
    kind,
    name,
    first: first ?? null,
    resolve: resolve ?? null,
    legal: legal ?? null,
  });
  const spaTypes = (d: string): RequestType[] => [
    T(d, 'complaint', 'Жалоба', 120, 1320),
    T(d, 'claim', 'Вернуть деньги за услугу', 660, null, 10),
    T(d, 'question', 'Вопрос', 240, 1980),
    T(d, 'idea', 'Предложение', 1320),
    T(d, 'thanks', 'Спасибо мастеру'),
  ];
  const types: RequestType[] = [
    ...spaTypes('d-mas'),
    ...spaTypes('d-kos'),
    T('d-otd', 'warranty', 'Гарантийный случай', 240, 6000),
    T('d-otd', 'claim', 'Претензия по качеству или срокам', 600, null, 10),
    T('d-otd', 'complaint', 'Жалоба', 120, 1200),
    T('d-otd', 'question', 'Вопрос по ремонту', 480, 1800),
    T('d-otd', 'idea', 'Предложение', 1800),
    T('d-otd', 'thanks', 'Спасибо бригаде'),
    T('d-grz', 'cargo', 'Повреждение или недостача груза', 240, null, 30),
    T('d-grz', 'complaint', 'Опоздание или жалоба', 120, 1440),
    T('d-grz', 'question', 'Вопрос по доставке', 120, 2160),
    T('d-grz', 'idea', 'Предложение', 1440),
    T('d-grz', 'thanks', 'Спасибо водителю'),
  ];
  const templates: ServiceSlice['templates'] = [
    ['Приняли в работу', '{имя}, приняли ваше обращение {номер}. Ответим {срок}.'],
    ['Нужны подробности', '{имя}, чтобы разобраться, уточните, пожалуйста: '],
    [
      'Извинение и компенсация',
      '{имя}, извините за неудобство. Мы разобрались, что произошло: . В качестве извинения ',
    ],
    ['Решено', '{имя}, вопрос решён: . Если что-то осталось, просто ответьте на это сообщение.'],
  ];
  const sl = (dirId: string, kind: RequestKind, at: number, x: Stopped = {}): Sla => {
    const d = directions.find((y) => y.id === dirId) as Direction;
    const ty = types.find((y) => y.dir === dirId && y.kind === kind) as RequestType;
    return {
      first: ty.first
        ? { goal: ty.first, due: addWorkMinutes(at, ty.first, d.cal), stopped: x.first ?? null }
        : null,
      resolve: ty.resolve
        ? {
            goal: ty.resolve,
            due: addWorkMinutes(at, ty.resolve, d.cal),
            stopped: x.resolve ?? null,
          }
        : null,
      legal: ty.legal
        ? { days: ty.legal, due: at + ty.legal * DAY_MS, stopped: x.legal ?? null }
        : null,
    };
  };
  let n = 1;
  const m = (
    kind: MessageKind,
    at: number,
    text: string,
    x: Partial<RequestMessage> = {},
  ): RequestMessage => ({ id: 'msg' + n++, kind, at, text, ...x });
  const req = (
    r: Omit<ServiceRequest, 'sla'> & { slaOf: [RequestKind, Stopped?] },
  ): ServiceRequest => {
    const { slaOf, ...rest } = r;
    return { ...rest, sla: sl(r.dir, slaOf[0], r.at, slaOf[1]) };
  };
  const requests: ServiceRequest[] = [
    req({
      id: 'r-57',
      key: 'ГРЗ-57',
      dir: 'd-grz',
      kind: 'cargo',
      title: 'Две коробки помяты, внутри бой',
      status: 'new',
      priority: 'high',
      assignee: null,
      at: ts(1, 10, 11, 14),
      channel: 'bot',
      client: {
        name: 'Наталья Гусева',
        org: 'ООО «Фермерская лавка»',
        phone: '+7 916 204-44-12',
        since: 'Клиент с 2024 года · 23 доставки',
      },
      link: {
        label: 'Рейс Р-196 · 27.09',
        lines: ['Доставлено 27 сентября, 14:40', 'Водитель: Илья Васильев', 'Фото выгрузки: 4'],
      },
      slaOf: ['cargo'],
      labels: ['бой'],
      tasks: [],
      messages: [
        m(
          'client',
          ts(1, 10, 11, 14),
          'Добрый день! В рейсе Р-196 две коробки из 14 пришли помятыми, внутри бой — 6 банок. Фото и акт о расхождении прикладываю.',
          { by: 'Наталья Гусева', files: ['Фото 1.jpg', 'Фото 2.jpg', 'Акт о расхождении.pdf'] },
        ),
        m(
          'public',
          ts(1, 10, 11, 14),
          'Наталья, приняли обращение ГРЗ-57. Ответим в течение 4 часов.',
          { by: 'Автоответ', auto: true },
        ),
      ],
    }),
    req({
      id: 'r-41',
      key: 'МАС-41',
      dir: 'd-mas',
      kind: 'complaint',
      title: 'Начали на 15 минут позже, в кабинете холодно',
      status: 'new',
      priority: 'high',
      assignee: null,
      at: ts(1, 10, 15, 12),
      channel: 'sms',
      fromRating: 2,
      client: {
        name: 'Ольга Романова',
        phone: '+7 925 117-03-18',
        since: 'Клиент с марта 2025 · 7 визитов · прошлые оценки 5, 5, 4',
      },
      link: {
        label: 'Визит 1.10, 11:30 · SPA-ритуал',
        lines: [
          'SPA-ритуал · 1 октября, 11:30–13:00',
          'Кабинет № 2 · стол с подогревом',
          'Мастер: Анна Морозова',
        ],
      },
      about: 'm-morozova',
      aboutName: 'Анна Морозова',
      slaOf: ['complaint'],
      labels: ['опоздание', 'оборудование'],
      tasks: [{ id: 'T-71', title: 'Починить подогрев стола в кабинете № 2', status: 'Новая' }],
      messages: [
        m(
          'rating',
          ts(1, 10, 15, 12),
          'Начали на 15 минут позже, в кабинете холодно. Сам массаж хороший.',
          {
            by: 'Ольга Романова',
            score: 2,
            reasons: ['Опоздание начала', 'Температура в кабинете'],
            contact: true,
          },
        ),
        m(
          'public',
          ts(1, 10, 15, 12),
          'Ольга, спасибо за честную оценку. Администратор ответит в течение 2 часов.',
          { by: 'Автоответ', auto: true },
        ),
        m(
          'note',
          ts(1, 10, 15, 40),
          'Проверила журнал кабинета № 2: в 11:30 не включился подогрев стола, Анна начала в 11:45. Завела задачу T-71 на ремонт стола. Предлагаю скидку 20% на следующий визит.',
          { by: 'Дарья Зимина' },
        ),
      ],
    }),
    req({
      id: 'r-o11',
      key: 'ОТД-11',
      dir: 'd-otd',
      kind: 'claim',
      title: 'Прошу уменьшить цену: перепад ламината в коридоре',
      status: 'work',
      priority: 'normal',
      assignee: 'Дарья Зимина',
      at: ts(27, 9, 20, 5),
      channel: 'cabinet',
      client: { name: 'Игорь Чернов', phone: '+7 903 555-21-07', since: 'Заказчик · договор № 31' },
      link: {
        label: 'Профсоюзная, 64 · кв. 210',
        lines: ['Чистовая отделка · сдача 9 октября', 'Прораб: Алексей Соколов', 'Договор № 31'],
      },
      slaOf: ['claim', { first: ts(28, 9, 10, 30) }],
      labels: ['ламинат'],
      tasks: [{ id: 'T-73', title: 'Замер перепада ламината в коридоре', status: 'В работе' }],
      messages: [
        m(
          'client',
          ts(27, 9, 20, 5),
          'Прошу уменьшить цену за ламинат в коридоре: перепад между плашками до 3 мм, видно при боковом свете. Фото прилагаю.',
          { by: 'Игорь Чернов', files: ['Коридор 1.jpg', 'Коридор 2.jpg', 'Коридор 3.jpg'] },
        ),
        m(
          'public',
          ts(28, 9, 10, 30),
          'Игорь, приняли претензию. 2 октября приедет прораб и замерит перепад, после этого пришлём письменный ответ.',
          { by: 'Дарья Зимина' },
        ),
        m(
          'note',
          ts(28, 9, 10, 40),
          'Соколов, посмотри фото: если перепад больше 2 мм — переукладка за наш счёт, иначе предложим скидку.',
          { by: 'Дарья Зимина' },
        ),
      ],
    }),
    req({
      id: 'r-40',
      key: 'МАС-40',
      dir: 'd-mas',
      kind: 'question',
      title: 'Можно ли SPA-ритуал во время беременности?',
      status: 'new',
      priority: 'normal',
      assignee: null,
      at: ts(1, 10, 16, 4),
      channel: 'widget',
      client: { name: 'Екатерина Лаврова', phone: '+7 977 300-92-55', since: 'Новый клиент' },
      link: null,
      slaOf: ['question'],
      labels: [],
      tasks: [],
      messages: [
        m(
          'client',
          ts(1, 10, 16, 4),
          'Можно ли SPA-ритуал во время беременности? Срок 20 недель.',
          { by: 'Екатерина Лаврова' },
        ),
      ],
    }),
    req({
      id: 'r-o12',
      key: 'ОТД-12',
      dir: 'd-otd',
      kind: 'warranty',
      title: 'Отошла плитка у душевого трапа',
      status: 'work',
      priority: 'normal',
      assignee: 'Дарья Зимина',
      at: ts(30, 9, 19, 40),
      channel: 'cabinet',
      client: {
        name: 'Андрей Кузнецов',
        phone: '+7 916 880-61-40',
        since: 'Заказчик · договор № 27',
      },
      link: {
        label: 'Дом на Лесной · Мытищи',
        lines: [
          'Сдан 12 сентября · гарантия до 12.09.2027',
          'Прораб: Алексей Соколов',
          'Акт № 4 · плитка, санузел 2 этажа',
        ],
      },
      slaOf: ['warranty', { first: ts(1, 10, 9, 35) }],
      labels: ['гарантия'],
      tasks: [
        {
          id: 'T-72',
          title: 'Выезд по гарантии: плитка у трапа, 2.10 10:00–12:00',
          status: 'Новая',
        },
      ],
      messages: [
        m(
          'client',
          ts(30, 9, 19, 40),
          'В ванной на втором этаже отошла плитка у душевого трапа, две плитки качаются.',
          { by: 'Андрей Кузнецов', files: ['Трап 1.jpg', 'Трап 2.jpg'] },
        ),
        m(
          'public',
          ts(1, 10, 9, 35),
          'Андрей, это гарантийный случай. Прораб приедет в пятницу, 2 октября, с 10 до 12. Подойдёт?',
          { by: 'Дарья Зимина' },
        ),
        m('client', ts(1, 10, 10, 2), 'Да, буду дома.', { by: 'Андрей Кузнецов' }),
        m('note', ts(1, 10, 10, 10), 'Назначила выезд в календаре: Соколов, 2.10 10:00–12:00.', {
          by: 'Дарья Зимина',
        }),
      ],
    }),
    req({
      id: 'r-55',
      key: 'ГРЗ-55',
      dir: 'd-grz',
      kind: 'cargo',
      title: 'Привезли 5 паллет из 6',
      status: 'wait',
      pausedAt: ts(28, 9, 11, 0),
      priority: 'normal',
      assignee: 'Вера Котельникова',
      at: ts(26, 9, 14, 20),
      channel: 'phone',
      client: {
        name: 'Олег Сафонов',
        org: 'ИП Сафонов',
        phone: '+7 846 212-77-09',
        since: 'Клиент с 2025 года · 8 доставок',
      },
      link: {
        label: 'Рейс Р-192 · 26.09',
        lines: [
          'Доставлено 26 сентября, 13:10',
          'Водитель: Тимур Ахмедов',
          'Накладная № 4410: 6 паллет',
        ],
      },
      slaOf: ['cargo', { first: ts(26, 9, 14, 25) }],
      labels: ['недостача'],
      tasks: [],
      messages: [
        m('system', ts(26, 9, 14, 20), 'Заведено по звонку · Вера Котельникова'),
        m(
          'client',
          ts(26, 9, 14, 20),
          'Привезли 5 паллет из 6, водитель сказал, что шестую не погрузили на складе.',
          { by: 'Олег Сафонов' },
        ),
        m(
          'public',
          ts(26, 9, 14, 25),
          'Олег, приняли обращение о недостаче одной паллеты. Пришлите, пожалуйста, акт о расхождении с подписью водителя.',
          { by: 'Вера Котельникова' },
        ),
        m('client', ts(27, 9, 12, 10), 'Акт подписан, но он у кладовщика — пришлю в понедельник.', {
          by: 'Олег Сафонов',
        }),
        m('public', ts(28, 9, 11, 0), 'Ждём акт: без него не можем начать проверку.', {
          by: 'Вера Котельникова',
        }),
        m('system', ts(28, 9, 11, 0), 'Ждёт клиента — срок на паузе, срок по закону идёт'),
      ],
    }),
    req({
      id: 'r-k6',
      key: 'КОС-6',
      dir: 'd-kos',
      kind: 'idea',
      title: 'Сделайте онлайн-запись на выходные',
      status: 'new',
      priority: 'low',
      assignee: null,
      at: ts(1, 10, 12, 0),
      channel: 'qr',
      client: {
        name: 'Мария Киселёва',
        phone: '+7 926 410-15-73',
        since: 'Клиент с 2024 года · 15 визитов',
      },
      link: null,
      slaOf: ['idea'],
      labels: [],
      tasks: [],
      messages: [
        m(
          'client',
          ts(1, 10, 12, 0),
          'Сделайте онлайн-запись на выходные — по телефону в субботу не дозвониться.',
          { by: 'Мария Киселёва' },
        ),
      ],
    }),
    {
      id: 'r-39',
      key: 'МАС-39',
      dir: 'd-mas',
      kind: 'thanks',
      title: 'Спасибо Анне, спина больше не болит',
      status: 'resolved',
      outcome: 'Передано мастеру',
      resolvedAt: ts(30, 9, 15, 40),
      priority: 'low',
      assignee: null,
      at: ts(30, 9, 15, 40),
      channel: 'sms',
      client: {
        name: 'Мария Киселёва',
        phone: '+7 926 410-15-73',
        since: 'Клиент с 2024 года · 15 визитов',
      },
      link: {
        label: 'Визит 30.09 · классический массаж',
        lines: [
          'Классический массаж · 30 сентября, 10:00–11:00',
          'Кабинет № 2',
          'Мастер: Анна Морозова',
        ],
      },
      sla: { first: null, resolve: null, legal: null },
      labels: [],
      tasks: [],
      messages: [
        m('rating', ts(30, 9, 15, 40), 'Спасибо Анне, спина больше не болит!', {
          by: 'Мария Киселёва',
          score: 5,
          reasons: [],
          contact: false,
        }),
        m('system', ts(30, 9, 15, 40), 'Благодарность передана мастеру: Анна Морозова'),
      ],
    },
  ];
  const ratings: ServiceSlice['ratings'] = [
    {
      id: 'S-311',
      dir: 'd-mas',
      client: 'Светлана Михеева',
      score: 3,
      reasons: ['Чистота'],
      comment: 'Полотенце было влажным',
      at: ts(30, 9, 18, 10),
      work: 'Визит 30.09 · массаж спины',
      status: 'open',
    },
    {
      id: 'S-305',
      dir: 'd-grz',
      client: 'ООО «Вектор»',
      score: 2,
      reasons: ['Опоздание к окну выгрузки'],
      comment: 'Опоздали на 40 минут, разгрузку перенесли на вечер',
      at: ts(29, 9, 12, 40),
      work: 'Рейс Р-190 · 29.09',
      status: 'open',
    },
  ];
  return { directions, types, templates, requests, ratings, seq: 200 };
}

type InstallDb = CoreDb & { service?: ServiceTenantDb['service'] };

/** Подключение к «Альта Групп»: данные, шаблон роли и назначения с областью направления (S:207–213). */
export function installService(db: InstallDb, opts: SeedOpts): void {
  if (opts.tenantId !== 't-alta' || db.service) return;
  db.service = serviceSeed();
  if (!db.roles.some((r) => r.id === 'r-agent')) {
    db.roles.push({
      id: 'r-agent',
      name: 'Специалист по обращениям',
      kind: 'template',
      project: true,
      actions: { service: ['view', 'create', 'edit', 'review'] },
      finance: { read: false, manage: false },
    });
  }
  db.assignments.push({
    id: 'as-svc1',
    member: 'm-kotova',
    role: 'r-agent',
    scope: { type: 'project', id: 'svc-grz' },
  });
  db.assignments.push({
    id: 'as-svc2',
    member: 'm-kotelnikova',
    role: 'r-agent',
    scope: { type: 'project', id: 'svc-grz' },
  });
}

/** Хук стадии `service` для `createSeed({ hooks })`. */
export const serviceHook: SeedHook = (db, opts) => {
  installService(db as InstallDb, opts);
};
