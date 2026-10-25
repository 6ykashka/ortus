// Сид и установка «Документов» (documents.js 14.10/19.10:404–524): папки, документы «Альты» и
// «Лотоса», роли папок, глаголы `docs` у ролей и проект маршрутов `pj-docs` (Q-W4.00-documents-18).
// Данные переносятся как в эталоне, включая версии и маршрут договора аренды. Время демо — 01.10.2026.
import type { Assignment, Role, TenantDb } from '../../../core/types/index.ts';
import { buildWf } from '../../tasks/workflow.ts';
import type { Project } from '../../tasks/types.ts';
import { DOC_ROLES } from './dictionaries.ts';
import type {
  DocBlock,
  DocFolder,
  DocItem,
  DocsSlice,
  DocsTenantDb,
  DocVersion,
  RouteTpl,
  Sheet,
  SheetCell,
} from './types.ts';

const clone = <T>(o: T): T => structuredClone(o);

const B = (id: string, t: string, text = '', o: Partial<DocBlock> = {}): DocBlock => ({
  id,
  t,
  text,
  ...o,
});

const CONTRACT: DocBlock[] = [
  B('b-t', 'title', 'ДОГОВОР ПОДРЯДА № 42/26'),
  B('b-m', 'meta', 'г. Москва | «1» октября 2026 г.'),
  B(
    'b-0',
    'p',
    '{Подрядчик} (Подрядчик), директор — {Подписант}, и {Заказчик} (Заказчик) заключили настоящий договор о нижеследующем.',
  ),
  B('b-h1', 'h', '1. Предмет договора'),
  B(
    'b-11',
    'p',
    '1.1. Подрядчик выполняет капитальный ремонт квартиры ({Площадь}) по адресу {Адрес объекта} в объёме сметы {Смета} (Приложение 1).',
  ),
  B('b-h2', 'h', '2. Сроки выполнения работ'),
  B(
    'b-21',
    'p',
    '2.1. Начало работ — 14 сентября 2026 г. Окончание — 27 ноября 2026 г. с учётом технологических пауз по графику работ.',
  ),
  B('b-h3', 'h', '3. Цена и порядок расчётов'),
  B('b-31', 'p', '3.1. Цена работ — {Цена}, включая материалы по Приложению 1.'),
  B('b-32', 'p', '3.2. Аванс и оплата этапов производятся по таблице:'),
  B('b-tb', 'table', '', {
    rows: [
      ['Этап', 'Доля', 'Сумма'],
      ['Аванс', '30 %', '374 490 ₽'],
      ['После этапа «Электрика»', '40 %', '499 320 ₽'],
      ['После приёмки объекта', '30 %', '374 490 ₽'],
    ],
  }),
  B('b-h4', 'h', '4. Права и обязанности сторон'),
  B(
    'b-41',
    'p',
    '4.1. Подрядчик выполняет работы своими силами и силами субподрядчиков и отвечает за их качество и сроки.',
  ),
  B(
    'b-42',
    'p',
    '4.2. Заказчик обеспечивает доступ на объект в согласованное время и принимает этапы в течение 3 рабочих дней.',
  ),
  B('b-h5', 'h', '5. Приёмка работ'),
  B(
    'b-51',
    'p',
    '5.1. Этапы принимаются по акту. Скрытые работы принимаются до начала следующего этапа.',
  ),
  B('b-h6', 'h', '6. Гарантия'),
  B(
    'b-61',
    'p',
    '6.1. Гарантия на выполненные работы — 24 месяца с даты подписания итогового акта.',
  ),
];

const ORDER: DocBlock[] = [
  B('o-t', 'title', 'ПРИКАЗ № 14'),
  B('o-m', 'meta', '{Фирма} | «1» октября 2026 г.'),
  B('o-h', 'h', 'О работе 4 ноября 2026 г.'),
  B('o-0', 'p', 'В связи с нерабочим праздничным днём 4 ноября 2026 г. приказываю:'),
  B('o-1', 'li', '1. 4 ноября рейсы не планировать.'),
  B('o-2', 'li', '2. Дежурный диспетчер 4 ноября — Марина Котова, телефон в карточке сотрудника.'),
  B('o-3', 'li', '3. Машины, вернувшиеся 3 ноября, сдать до 20:00 с полной приёмкой.'),
  B('o-4', 'li', '4. Работа в праздник оплачивается по табелю.'),
  B('o-s', 'meta', 'Руководитель логистики | Марина Котова'),
];

const S = (v: string | number, o: Partial<SheetCell> = {}): SheetCell => ({ v, ...o });
const Fm = (f: string, o: Partial<SheetCell> = {}): SheetCell => ({ f, ...o });
const HD: Partial<SheetCell> = { st: 'head' };
const HR: Partial<SheetCell> = { st: 'head', al: 'r' };

function fuelSheets(): Sheet[] {
  const c: Record<string, SheetCell> = {
    A1: S('Расход топлива · октябрь 2026 · «Север Логистик»', { st: 'title' }),
    A2: S('Машина', HD),
    B2: S('Модель', HD),
    C2: S('Водитель', HD),
    D2: S('Пробег, км', HR),
    E2: S('Литры', HR),
    F2: S('л/100 км', HR),
    G2: S('Норма', HR),
    H2: S('Отклонение', HR),
    I2: S('Сумма, ₽', HR),
  };
  const rows: [string, string, string, number, number, number, number][] = [
    ['А 412 МР 77', 'ГАЗель Next', 'Илья Васильев', 2140, 268, 12, 19135],
    ['Т 771 ЕХ 77', 'Mercedes Sprinter', 'Тимур Ахмедов', 1870, 221, 11.5, 15779],
    ['М 608 КТ 77', 'Ford Transit · реф.', 'Водитель #104 · пул', 1320, 198, 13, 14137],
    ['В 233 ОС 77', 'Hyundai Porter', 'Илья Васильев', 980, 103, 10, 7354],
  ];
  rows.forEach(([a, b, cc, d, e, g, i], k) => {
    const r = k + 3;
    Object.assign(c, {
      ['A' + r]: S(a, { mono: true }),
      ['B' + r]: S(b),
      ['C' + r]: S(cc),
      ['D' + r]: S(d, { fmt: 'n0' }),
      ['E' + r]: S(e, { fmt: 'n0' }),
      ['F' + r]: Fm('=ОКРУГЛ(E' + r + '/D' + r + '*100;1)', { fmt: 'n1' }),
      ['G' + r]: S(g, { fmt: 'n1' }),
      ['H' + r]: Fm('=F' + r + '/G' + r + '-1', { fmt: 'dpct' }),
      ['I' + r]: S(i, { fmt: 'n0' }),
    });
  });
  const T: Partial<SheetCell> = { st: 'total' };
  Object.assign(c, {
    A7: S('Итого · 4 машины', T),
    B7: S('', T),
    C7: S('', T),
    D7: Fm('=СУММ(D3:D6)', { st: 'total', fmt: 'n0' }),
    E7: Fm('=СУММ(E3:E6)', { st: 'total', fmt: 'n0' }),
    F7: Fm('=ОКРУГЛ(E7/D7*100;1)', { st: 'total', fmt: 'n1' }),
    G7: S('', T),
    H7: S('', T),
    I7: Fm('=СУММ(I3:I6)', { st: 'total', fmt: 'n0' }),
    A9: S('Средний расход, где норма от 12 л', { st: 'note' }),
    F9: Fm('=СРЗНАЧЕСЛИ(G3:G6;">=12";F3:F6)', { fmt: 'n1' }),
  });
  return [
    {
      id: 'sh-oct',
      name: 'Октябрь',
      cols: 10,
      rows: 14,
      w: [104, 140, 140, 92, 70, 78, 70, 96, 88, 60],
      merges: { A1: 9, A7: 3, A9: 5 },
      freeze: 2,
      cells: c,
    },
    {
      id: 'sh-norm',
      name: 'Нормы',
      cols: 4,
      rows: 10,
      w: [170, 140, 120, 80],
      cells: {
        A1: S('Модель', HD),
        B1: S('Норма, л/100 км', HR),
        A2: S('ГАЗель Next'),
        B2: S(12, { fmt: 'n1' }),
        A3: S('Mercedes Sprinter'),
        B3: S(11.5, { fmt: 'n1' }),
        A4: S('Ford Transit · реф.'),
        B4: S(13, { fmt: 'n1' }),
        A5: S('Hyundai Porter'),
        B5: S(10, { fmt: 'n1' }),
        A6: S('ГАЗон Next'),
        B6: S(16, { fmt: 'n1' }),
      },
    },
    {
      id: 'sh-pay',
      name: 'Начисления',
      fin: true,
      finWho: ['m-kotova'],
      cols: 4,
      rows: 10,
      w: [170, 80, 110, 130],
      cells: {
        A1: S('Водитель', HD),
        B1: S('Смен', HR),
        C1: S('Ставка, ₽', HR),
        D1: S('Начислено, ₽', HR),
        A2: S('Илья Васильев'),
        B2: S(18),
        C2: S(2400, { fmt: 'n0' }),
        D2: Fm('=B2*C2', { fmt: 'n0' }),
        A3: S('Тимур Ахмедов'),
        B3: S(15),
        C3: S(2400, { fmt: 'n0' }),
        D3: Fm('=B3*C3', { fmt: 'n0' }),
        A4: S('Итого', { st: 'total' }),
        D4: Fm('=СУММ(D2:D3)', { st: 'total', fmt: 'n0' }),
      },
    },
  ];
}

const RULES = { lock: true, notAuthor: true, commentOnBack: true, escalate: false };
const ROUTE_ORDER: RouteTpl = {
  name: 'Приказ по фирме',
  project: 'fleet',
  steps: [
    { kind: 'approve', mode: 'all', who: ['m-kotelnikova', 'm-ilyin'], days: 2 },
    { kind: 'sign', who: ['m-owner'], days: 1 },
    {
      kind: 'ack',
      audience: [
        { who: 'role', ref: 'r-driver', unit: 'f-msk-sever' },
        { who: 'group', ref: 'g-disp' },
      ],
      days: 3,
    },
  ],
  rules: { ...RULES },
};
const ROUTE_CONTRACT: RouteTpl = {
  name: 'Договор с заказчиком',
  project: 'pj-docs',
  steps: [
    { kind: 'approve', mode: 'all', who: ['m-sokolov'], days: 1 },
    { kind: 'ext', days: 3 },
  ],
  rules: { ...RULES },
};

const FD = (id: string, name: string, o: Partial<DocFolder> = {}): DocFolder => ({
  id,
  name,
  parent: null,
  unit: null,
  mode: 'inherit',
  share: [],
  owner: 'm-owner',
  icon: 'folder',
  ...o,
});

type DocInit = Partial<DocItem> & Pick<DocItem, 'id' | 'kind' | 'title' | 'folder' | 'owner' | 'v'>;
const base = (o: DocInit): DocItem => ({
  status: 'draft',
  mode: 'inherit',
  share: [],
  links: [],
  dirty: false,
  authors: [],
  presence: [],
  comments: [],
  suggestions: [],
  history: [],
  jobs: [],
  tmp: [],
  annots: [],
  versions: [],
  ...o,
});
const ver = (v: number, at: string, by: string, o: Partial<DocVersion> = {}): DocVersion => ({
  v,
  at,
  by,
  name: '',
  source: 'edit',
  ...o,
});

interface DocsSeed {
  folders: DocFolder[];
  items: DocItem[];
  assign: Assignment[];
}

function altaDocs(): DocsSeed {
  const body = clone(CONTRACT);
  const v10 = clone(CONTRACT).map((b) =>
    b.id === 'b-61' ? { ...b, text: b.text.replace('24 месяца', '12 месяцев') } : b,
  );
  const v9 = v10.map((b) =>
    b.id === 'b-21' ? { ...b, text: b.text.replace('27 ноября', '20 ноября') } : b,
  );
  const folders: DocFolder[] = [
    FD('fd-log', 'Север Логистик', {
      unit: 'f-msk-sever',
      icon: 'local_shipping',
      owner: 'm-kotova',
      share: [{ who: 'group', ref: 'g-disp', level: 'edit' }],
    }),
    FD('fd-log-ord', 'Приказы', {
      parent: 'fd-log',
      unit: 'f-msk-sever',
      icon: 'gavel',
      owner: 'm-kotova',
      routeTpl: ROUTE_ORDER,
    }),
    FD('fd-log-ctr', 'Договоры', {
      parent: 'fd-log',
      unit: 'f-msk-sever',
      icon: 'handshake',
    }),
    FD('fd-log-fin', 'Финансы', {
      parent: 'fd-log',
      unit: 'f-msk-sever',
      icon: 'payments',
      mode: 'listed',
      sensitivity: 'finance',
      share: [{ who: 'member', ref: 'm-kotova', level: 'edit' }],
    }),
    FD('fd-rep', 'Ремонт и стройка', { icon: 'construction' }),
    FD('fd-o42', 'ЖК Речной · квартира 42', {
      parent: 'fd-rep',
      icon: 'home_work',
      link: { kind: 'object', id: 'obj-42' },
      share: [{ who: 'relation', ref: 'foreman', obj: 'obj-42', level: 'edit' }],
      routeTpl: ROUTE_CONTRACT,
    }),
  ];
  const blockB21 = body.find((b) => b.id === 'b-21');
  const items: DocItem[] = [
    base({
      id: 'doc-42',
      kind: 'text',
      title: 'Договор подряда № 42/26',
      folder: 'fd-o42',
      owner: 'm-owner',
      links: [{ kind: 'object', id: 'obj-42' }],
      v: 12,
      body,
      fields: [
        { k: 'Подрядчик', src: 'tenant' },
        { k: 'Подписант', src: 'owner' },
        { k: 'Заказчик', src: 'obj.client' },
        { k: 'Адрес объекта', src: 'obj.address' },
        { k: 'Площадь', src: 'obj.area' },
        { k: 'Смета', v: 'v3 · 1 248 300 ₽', src: 'snap', from: 'Смета v3 · Ремонт и стройка' },
        { k: 'Цена', v: '1 248 300 ₽', src: 'snap', from: 'Итог сметы v3' },
      ],
      versions: [
        ver(9, '24.09 16:05', 'Дарья Зимина', { body: v9 }),
        ver(10, '29.09 12:40', 'Алексей Соколов, Дарья Зимина', { body: v10 }),
        ver(11, '01.10 09:58', 'Дарья Зимина', { name: 'Перед согласованием', body: clone(body) }),
        ver(12, '01.10 10:38', 'Алексей Соколов', { body: clone(body) }),
      ],
      saved: { at: '10:41', by: 'm-sokolov' },
      upd: { at: '01.10 10:41', by: 'm-sokolov' },
      presence: [{ member: 'm-sokolov', block: 'b-21' }],
      suggestions: [
        {
          id: 'sg-1',
          block: 'b-21',
          from: '27 ноября 2026 г.',
          to: '4 декабря 2026 г.',
          pos: (blockB21?.text ?? '').indexOf('27 ноября'),
          by: 'm-sokolov',
          at: '01.10 10:38',
          note: 'Стяжке нужно 7 дней на сушку, в графике этап уже сдвинут.',
          status: 'open',
        },
      ],
      comments: [
        {
          id: 'c-1',
          block: 'b-32',
          quote: 'Аванс и оплата этапов',
          by: 'm-owner',
          at: '01.10 10:40',
          text: '@Сергей Ильин, аванс 30 % проводим через кассу или по счёту?',
          mention: 'm-ilyin',
          replies: [],
          resolved: false,
        },
      ],
    }),
    base({
      id: 'doc-fuel',
      kind: 'sheet',
      title: 'Расход топлива · октябрь',
      folder: 'fd-log',
      owner: 'm-kotova',
      links: [{ kind: 'set', id: 'expenses', label: 'Наборы «Поездки» и «Расходы»' }],
      v: 4,
      sheets: fuelSheets(),
      versions: [
        ver(3, '30.09 18:10', 'Марина Котова'),
        ver(4, '01.10 09:40', 'Марина Котова', { source: 'crm', name: 'Обновление из CRM' }),
      ],
      prot: [
        {
          id: 'pr-1',
          sheet: 'sh-oct',
          range: 'G3:G40',
          name: 'Норма',
          who: [
            { who: 'role', ref: 'r-manager', unit: 'f-msk-sever' },
            { who: 'member', ref: 'm-kotova' },
          ],
        },
      ],
      crm: {
        sheet: 'sh-oct',
        cols: ['D', 'E', 'I'],
        r1: 3,
        r2: 6,
        sets: 'Поездки и Расходы',
        unit: 'f-msk-sever',
        at: '09:40',
        every: 'каждый час',
      },
      cond: [
        {
          sheet: 'sh-oct',
          range: 'H3:H6',
          rules: [
            { gt: 0.1, tone: 'danger' },
            { gt: 0.03, tone: 'warn' },
          ],
          note: 'Красный — перерасход больше 10 %, жёлтый — больше 3 %',
        },
      ],
      chart: {
        sheet: 'sh-oct',
        label: 'A',
        val: 'F',
        norm: 'G',
        r1: 3,
        r2: 6,
        title: 'л/100 км и норма',
      },
      saved: { at: '10:42', by: 'm-kotova' },
      upd: { at: '01.10 10:38', by: 'm-kotova' },
      presence: [{ member: 'm-kotova', sel: 'G3:G6' }],
      comments: [
        {
          id: 'c-2',
          sheet: 'sh-oct',
          cell: 'G5',
          quote: 'G5 · Норма',
          by: 'm-kotova',
          at: '01.10 09:52',
          text: '@Дарья Зимина, норма для Transit с рефрижератором — 13 л? По паспорту 12, но с холодильником выходит больше.',
          mention: 'm-owner',
          replies: [],
          resolved: false,
        },
      ],
    }),
    base({
      id: 'doc-318',
      kind: 'pdf',
      title: 'Накладная № 318 · скан',
      folder: 'fd-o42',
      owner: 'm-sokolov',
      links: [{ kind: 'object', id: 'obj-42' }],
      scan: true,
      textLayer: true,
      size: 4.8,
      v: 1,
      versions: [ver(1, '01.10 09:12', 'Алексей Соколов', { source: 'upload' })],
      saved: { at: '09:12', by: 'm-sokolov' },
      upd: { at: '01.10 09:12', by: 'm-sokolov' },
      pages: [
        { id: 'pg-1', art: 'inv1', rot: 0 },
        { id: 'pg-2', art: 'inv2', rot: 0 },
      ],
      annots: [
        {
          id: 'an-1',
          page: 'pg-1',
          kind: 'stamp',
          text: 'ПОЛУЧЕНО НА ОБЪЕКТЕ',
          by: 'А. Соколов',
          byId: 'm-sokolov',
          at: '30.09 · 14:20',
          pep: true,
        },
      ],
      comments: [
        {
          id: 'c-3',
          page: 'pg-1',
          quote: 'Итого: 118 440,00 руб.',
          by: 'm-sokolov',
          at: '01.10 09:14',
          text: 'Сумма совпадает с заказом ЗК-27.',
          replies: [],
          resolved: false,
        },
      ],
      ocr: {
        status: 'done',
        conf: 97,
        at: '09:21',
        lang: 'русский и английский',
        words: [
          {
            id: 'w1',
            text: 'Скпадская',
            sug: 'Складская',
            conf: 58,
            why: '«п» вместо «л» в названии улицы',
            st: 'open',
          },
          {
            id: 'w2',
            text: 'ФК 1S мм',
            sug: 'ФК 15 мм',
            conf: 64,
            why: 'Латинская «S» вместо цифры 5',
            st: 'open',
            row: 2,
          },
          {
            id: 'w3',
            text: '89О,00',
            sug: '890,00',
            conf: 61,
            why: 'Буква «О» вместо нуля. С исправлением сумма строки сходится: 6 × 890 = 5 340',
            st: 'open',
            row: 3,
          },
        ],
      },
      table: {
        cols: ['Наименование', 'Ед.', 'Кол-во', 'Цена', 'Сумма'],
        rows: [
          ['Доска обрезная 50×150×6000', 'м³', 2.4, 18500, 44400],
          ['Брус 100×100×6000', 'м³', 1.2, 21000, 25200],
          ['Фанера ФК 15 мм', 'лист', 30, 1450, 43500],
          ['Саморезы 4,2×75, уп. 500', 'уп.', 6, 890, 5340],
        ],
        total: 118440,
        words: { 2: 'w2', 3: 'w3' },
      },
      jobs: [
        {
          id: 'job-2',
          op: 'merge',
          name: 'Объединение 4 файлов',
          status: 'failed',
          at: '09:30',
          params: { files: ['Счёт 118.pdf', 'Акт приёмки 318.pdf', 'Фото 2.jpg'] },
          error: '«Счёт 118.pdf» защищён паролем: введите пароль или уберите файл',
        },
        {
          id: 'job-1',
          op: 'ocr',
          name: 'Распознавание · 2 страницы',
          status: 'done',
          at: '09:21',
          res: 'Готово за 9 секунд · 97 %',
        },
      ],
    }),
    base({
      id: 'doc-ord14',
      kind: 'text',
      title: 'Приказ № 14 · О работе 4 ноября',
      folder: 'fd-log-ord',
      owner: 'm-kotova',
      v: 6,
      body: clone(ORDER),
      fields: [{ k: 'Фирма', src: 'unit' }],
      versions: [
        ver(5, '30.09 17:20', 'Марина Котова', {
          body: clone(ORDER).filter((b) => b.id !== 'o-4'),
        }),
        ver(6, '01.10 09:05', 'Марина Котова', { body: clone(ORDER) }),
      ],
      saved: { at: '09:05', by: 'm-kotova' },
      upd: { at: '01.10 09:05', by: 'm-kotova' },
    }),
    base({
      id: 'doc-lease',
      kind: 'pdf',
      title: 'Договор аренды стоянки',
      folder: 'fd-log-ctr',
      owner: 'm-owner',
      status: 'signed',
      textLayer: true,
      size: 1.2,
      v: 3,
      versions: [ver(3, '31.08 15:02', 'Марина Котова', { name: 'На согласование' })],
      saved: { at: '15:02', by: 'm-kotova' },
      upd: { at: '01.09 12:10', by: 'm-owner' },
      pages: [
        { id: 'pg-l1', art: 'lease1', rot: 0 },
        { id: 'pg-l2', art: 'lines', rot: 0 },
        { id: 'pg-l3', art: 'lines', rot: 0 },
        {
          id: 'pg-l4',
          art: 'approval',
          title: 'Договор аренды стоянки',
          v: 3,
          sha: '7c1e…04ad',
          rows: [
            { s: '1 · Согласовать', w: 'Марина Котова', r: 'Согласовал(а)', at: '31.08 16:20' },
            {
              s: '2 · Утвердить',
              w: 'Дарья Зимина',
              r: 'Утвердил(а) · ПЭП, код из SMS',
              at: '01.09 12:10',
            },
          ],
          rot: 0,
        },
      ],
      route: {
        id: 'rt-0',
        v: 3,
        by: 'm-kotova',
        at: '31.08 15:02',
        status: 'done',
        cur: 1,
        project: null,
        task: null,
        rules: { ...RULES },
        steps: [
          {
            kind: 'approve',
            name: 'Согласовать',
            mode: 'all',
            who: ['m-kotova'],
            days: 1,
            status: 'done',
            decisions: [{ member: 'm-kotova', decision: 'ok', at: '31.08 16:20', method: 'click' }],
          },
          {
            kind: 'sign',
            name: 'Утвердить',
            who: ['m-owner'],
            days: 1,
            status: 'done',
            decisions: [
              { member: 'm-owner', decision: 'ok', at: '01.09 12:10', method: 'pep_sms' },
            ],
          },
        ],
      },
    }),
    base({
      id: 'doc-pay',
      kind: 'sheet',
      title: 'Начисления водителям · сентябрь',
      folder: 'fd-log-fin',
      owner: 'm-owner',
      sensitivity: 'finance',
      v: 2,
      versions: [ver(2, '28.09 18:30', 'Дарья Зимина')],
      saved: { at: '18:30', by: 'm-owner' },
      upd: { at: '28.09 18:30', by: 'm-owner' },
      sheets: [
        {
          id: 'sh-p1',
          name: 'Сентябрь',
          cols: 5,
          rows: 10,
          w: [170, 80, 110, 130, 60],
          cells: {
            A1: S('Водитель', HD),
            B1: S('Смен', HR),
            C1: S('Ставка, ₽', HR),
            D1: S('Начислено, ₽', HR),
            A2: S('Илья Васильев'),
            B2: S(20),
            C2: S(2400, { fmt: 'n0' }),
            D2: Fm('=B2*C2', { fmt: 'n0' }),
            A3: S('Тимур Ахмедов'),
            B3: S(17),
            C3: S(2400, { fmt: 'n0' }),
            D3: Fm('=B3*C3', { fmt: 'n0' }),
            A4: S('Кирилл Громов'),
            B4: S(6),
            C4: S(2400, { fmt: 'n0' }),
            D4: Fm('=B4*C4', { fmt: 'n0' }),
            A5: S('Итого', { st: 'total' }),
            D5: Fm('=СУММ(D2:D4)', { st: 'total', fmt: 'n0' }),
          },
        },
      ],
    }),
  ];
  // Последняя версия листа и PDF хранит полную копию содержимого (иначе «У vN нет копии содержимого»).
  for (const d of items) {
    const last = d.versions[d.versions.length - 1];
    if (!last) continue;
    if (d.kind === 'sheet' && !last.sheets) last.sheets = clone(d.sheets ?? []);
    if (d.kind === 'pdf' && !last.pages) last.pages = clone(d.pages ?? []);
  }
  return {
    folders,
    items,
    assign: [
      {
        id: 'adoc-1',
        member: 'm-kotova',
        role: 'r-doc-manage',
        scope: { type: 'folder', id: 'fd-log' },
      },
    ],
  };
}

function otherDocs(db: TenantDb): DocsSeed {
  const own = db.members[0] ?? { id: 'm-owner', name: '' };
  const body = [
    B('l-t', 'title', 'ПРАВИЛА ЗАПИСИ И ОТМЕНЫ ВИЗИТОВ'),
    B(
      'l-1',
      'p',
      'Клиент может перенести или отменить визит не позднее чем за 4 часа. Позднюю отмену отмечает администратор в карточке визита.',
    ),
    B(
      'l-2',
      'p',
      'Опоздание больше 15 минут — визит сокращается или переносится по согласованию с мастером.',
    ),
  ];
  return {
    folders: [
      FD('fd-salon', 'Салон', {
        icon: 'spa',
        owner: own.id,
        share: [{ who: 'all', level: 'view' }],
      }),
    ],
    items: [
      base({
        id: 'doc-l1',
        kind: 'text',
        title: 'Правила записи и отмены визитов',
        folder: 'fd-salon',
        owner: own.id,
        v: 1,
        body,
        versions: [ver(1, '20.09 11:00', own.name, { body: clone(body) })],
        saved: { at: '11:00', by: own.id },
        upd: { at: '20.09 11:00', by: own.id },
      }),
    ],
    assign: [],
  };
}

/** Сид документов организации: «Альта» — договор, приказ, таблицы и сканы; остальные — одна папка. */
export const docsSeed = (db: TenantDb): DocsSeed =>
  db.tenantId === 't-alta' ? altaDocs() : otherDocs(db);

/** Глаголы `docs` существующих ролей эталона: проставляются, только если у роли их ещё нет. */
const ROLE_ACTIONS: readonly [string, readonly string[]][] = [
  ['r-manager', ['view', 'create', 'edit', 'export', 'settings']],
  ['r-driver', ['view']],
  ['r-foreman', ['view', 'create', 'edit', 'settings']],
  ['r-admin', ['view', 'create', 'edit', 'settings']],
];

/**
 * Установка модуля в БД организации (documents.js `installDocs`). Повторный вызов ничего не меняет.
 * Проект маршрутов `pj-docs` создаётся с процессом «С согласованием» (Q-W4.00-documents-18).
 */
export function installDocs(db: TenantDb): void {
  const d = db as DocsTenantDb;
  if (d.docs?.v1) return;
  for (const r of DOC_ROLES) {
    if (!db.roles.some((x) => x.id === r.id)) db.roles.push(clone(r) as Role);
  }
  for (const [id, verbs] of ROLE_ACTIONS) {
    const r = db.roles.find((x) => x.id === id);
    if (r && !r.actions.docs) r.actions = { ...r.actions, docs: [...verbs] } as Role['actions'];
  }
  // Водитель видит только адресованное: «Документы · Просматривать» не открывает папки фирмы целиком.
  const drv = db.roles.find((x) => x.id === 'r-driver');
  if (drv) drv.docsAddressed = true;
  db.projects ??= [];
  if (!db.projects.some((p) => p.id === 'pj-docs')) {
    const project: Project = {
      id: 'pj-docs',
      key: 'ДОК',
      name: 'Документы · маршруты',
      owner: db.members[0]?.name ?? '—',
      access: 'limited',
      wf: buildWf('approval'),
      automations: [],
      runs: [],
    };
    db.projects.push(project);
  }
  const x = docsSeed(db);
  for (const a of x.assign) {
    if (!db.assignments.some((y) => y.id === a.id)) db.assignments.push(a);
  }
  const slice: DocsSlice = { folders: x.folders, items: x.items, v1: true };
  d.docs = slice;
}
