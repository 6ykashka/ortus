// Справочники документов (documents.js 14.10/19.10:21–34, 404–412): уровни доступа, виды, шаги
// маршрута, роли папок и три шаблона. Подписи — дословно из эталона.
import type { Role } from '../../../core/types/index.ts';
import type { DocLevelKey, DocTemplate } from './types.ts';

export const DOC_LEVELS = [
  'Нет доступа',
  'Читает',
  'Комментирует',
  'Предлагает правки',
  'Правит',
  'Управляет доступом',
] as const;

export const LV: Readonly<Record<DocLevelKey, 1 | 2 | 3 | 4 | 5>> = {
  view: 1,
  comment: 2,
  suggest: 3,
  edit: 4,
  manage: 5,
};

export const LV_KEY: readonly (DocLevelKey | null)[] = [
  null,
  'view',
  'comment',
  'suggest',
  'edit',
  'manage',
];

export const DOC_LEVEL_HINT: readonly string[] = [
  '',
  'Открывает документ. Скачать и распечатать — если это разрешает роль',
  'Читает и оставляет комментарии',
  'Каждая его правка становится предложением; принимает тот, кто правит',
  'Правит, принимает предложения, отправляет на согласование',
  'Как «Правит», плюс «Поделиться» и маршрут',
];

/** Вид документа: подпись, значок, фон и цвет значка. */
export const DOC_KINDS: Readonly<Record<'text' | 'sheet' | 'pdf', readonly string[]>> = {
  text: ['Текст', 'description', '#E7EEF6', '#2B5479'],
  sheet: ['Таблица', 'table_chart', '#E3EFE7', '#1F6B52'],
  pdf: ['PDF', 'picture_as_pdf', '#FBEAE7', '#A13A33'],
};

export const STEP_KINDS: Readonly<Record<'approve' | 'sign' | 'ack' | 'ext', readonly string[]>> = {
  approve: ['Согласовать', 'task_alt'],
  sign: ['Утвердить', 'verified'],
  ack: ['Ознакомить', 'visibility'],
  ext: ['Подпись заказчика', 'signature'],
};

export const APPROVE_MODES: Readonly<Record<'all' | 'seq' | 'any', string>> = {
  all: 'Все сразу',
  seq: 'По очереди',
  any: 'Достаточно одного',
};

const FIN0 = { read: false, manage: false };

/** Роли папок: `docLevel` — уровень доступа, который роль даёт в папке или документе. */
export type DocRole = Role & { docLevel: 1 | 4 | 5 };

export const DOC_ROLES: readonly DocRole[] = [
  {
    id: 'r-doc-manage',
    name: 'Документы · управляет доступом',
    kind: 'template',
    folderRole: true,
    docLevel: 5,
    actions: { docs: ['view', 'create', 'edit', 'export', 'settings'] },
    finance: FIN0,
  },
  {
    id: 'r-doc-edit',
    name: 'Документы · правит',
    kind: 'template',
    folderRole: true,
    docLevel: 4,
    actions: { docs: ['view', 'create', 'edit', 'export'] },
    finance: FIN0,
  },
  {
    id: 'r-doc-read',
    name: 'Документы · читает',
    kind: 'template',
    folderRole: true,
    docLevel: 1,
    actions: { docs: ['view'] },
    finance: FIN0,
  },
];

export const DOC_TEMPLATES: readonly DocTemplate[] = [
  {
    id: 'tpl-order',
    name: 'Приказ по фирме',
    kind: 'text',
    icon: 'gavel',
    hint: 'Номер, тема, пункты. Маршрут папки «Приказы»: согласовать → утвердить → ознакомить',
    link: null,
    folder: 'fd-log-ord',
    fields: [{ k: 'Фирма', src: 'unit' }],
    body: [
      ['title', 'ПРИКАЗ № '],
      ['meta', '{Фирма} | «__» ________ 2026 г.'],
      ['h', 'О …'],
      ['p', 'Приказываю:'],
      ['li', '1. …'],
      ['p', 'Контроль исполнения оставляю за собой.'],
    ],
  },
  {
    id: 'tpl-poa',
    name: 'Доверенность на получение груза',
    kind: 'text',
    icon: 'badge',
    hint: 'Поля из рейса: водитель, машина, рейс',
    link: 'trip',
    folder: 'fd-log',
    fields: [
      { k: 'Организация', src: 'tenant' },
      { k: 'Водитель', src: 'trip.driverName' },
      { k: 'Машина', src: 'trip.vehicle' },
      { k: 'Рейс', src: 'trip.ref' },
      { k: 'Дата рейса', src: 'trip.date' },
      { k: 'Руководитель', src: 'owner' },
    ],
    body: [
      ['title', 'ДОВЕРЕННОСТЬ'],
      ['meta', 'г. Москва | {Дата рейса}'],
      [
        'p',
        '{Организация} доверяет водителю {Водитель} получить груз по рейсу {Рейс} и перевезти его на машине {Машина}.',
      ],
      ['p', 'Доверенность действительна в день рейса.'],
      ['meta', 'Руководитель | {Руководитель}'],
    ],
  },
  {
    id: 'tpl-act',
    name: 'Акт скрытых работ',
    kind: 'text',
    icon: 'construction',
    hint: 'Поля из объекта: адрес, заказчик, прораб',
    link: 'object',
    folder: 'fd-o42',
    fields: [
      { k: 'Объект', src: 'obj.name' },
      { k: 'Адрес объекта', src: 'obj.address' },
      { k: 'Заказчик', src: 'obj.client' },
      { k: 'Прораб', src: 'obj.foreman' },
    ],
    body: [
      ['title', 'АКТ ОСВИДЕТЕЛЬСТВОВАНИЯ СКРЫТЫХ РАБОТ'],
      ['meta', '{Адрес объекта} | «__» ________ 2026 г.'],
      ['p', 'Объект: {Объект}. Заказчик: {Заказчик}. Работы выполнил прораб {Прораб}.'],
      ['h', 'Предъявлены к освидетельствованию'],
      ['li', '1. …'],
      ['p', 'Работы выполнены по проекту и технологии. Разрешается выполнение последующих работ.'],
    ],
  },
];
