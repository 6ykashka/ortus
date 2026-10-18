// Справочники «Базы знаний» (knowledge.js 14.10:11–62). Отличия от эталона — ответы владельца 17.10:
// - KB-02 «Нет «Автора»: редактор + черновики» — ролей пространства три (в эталоне четыре с `r-kb-author`);
// - KB-06 «6 уровней» — предел глубины дерева `KB_MAX_DEPTH`.
import type { Role } from '../../core/types/index.ts';
import type { KbKind, KbMode, KbSpaceAccess, KbStatus } from './types.ts';

const FIN0 = { read: false, manage: false } as const;

export const KB_ROLES: readonly Role[] = [
  {
    id: 'r-kb-lead',
    name: 'Руководитель пространства',
    kind: 'template',
    space: true,
    actions: { knowledge: ['view', 'create', 'edit', 'review', 'settings'] },
    finance: FIN0,
  },
  {
    id: 'r-kb-editor',
    name: 'Редактор',
    kind: 'template',
    space: true,
    actions: { knowledge: ['view', 'create', 'edit', 'review'] },
    finance: FIN0,
  },
  {
    id: 'r-kb-reader',
    name: 'Читатель',
    kind: 'template',
    space: true,
    actions: { knowledge: ['view'] },
    finance: FIN0,
  },
];

export const KB_ROLE_ORDER: readonly string[] = ['r-kb-lead', 'r-kb-editor', 'r-kb-reader'];

export const KB_ROLE_CAPS: Readonly<Record<string, string>> = {
  'r-kb-lead': 'Всё в пространстве, участники, доступ, автоматизация',
  'r-kb-editor': 'Создаёт и правит любые страницы, публикует, перемещает',
  'r-kb-reader': 'Читает и отмечает «Ознакомлен»',
};

export interface KbAccessInfo {
  label: string;
  icon: string;
  tone: string;
  d: string;
}

export const KB_ACCESS: Readonly<Record<KbSpaceAccess, KbAccessInfo>> = {
  open: { label: 'Открытое', icon: 'public', tone: 'ok', d: 'Роли области действуют полностью' },
  limited: {
    label: 'Ограниченное',
    icon: 'visibility',
    tone: 'info',
    d: 'Все в области читают, пишут участники',
  },
  closed: {
    label: 'Закрытое',
    icon: 'lock',
    tone: 'neutral',
    d: 'Только участники и владелец бизнеса',
  },
};

export const KB_MODES: Readonly<Record<KbMode, { label: string; d: string }>> = {
  inherit: { label: 'Как у родителя', d: 'Читают и правят те же, кто у родителя' },
  edit: { label: 'Читают все, правят выбранные', d: 'Чтение как у родителя, правка — по списку' },
  listed: { label: 'Только выбранные', d: 'Читают и правят только те, кто в списке' },
};

export const KB_KINDS: Readonly<Record<KbKind, readonly [string, string]>> = {
  page: ['Страница', 'description'],
  folder: ['Папка', 'folder'],
  table: ['Таблица', 'table_view'],
  diagram: ['Схема', 'schema'],
  file: ['Файл', 'picture_as_pdf'],
  link: ['Запись CRM', 'dynamic_form'],
};

export const KB_STATUS: Readonly<Record<KbStatus, readonly [string, string, string]>> = {
  active: ['Действует', 'ok', 'check_circle'],
  draft: ['Черновик', 'warn', 'edit_note'],
  review: ['На проверке', 'warn', 'rate_review'],
  outdated: ['Пора пересмотреть', 'danger', 'event_busy'],
};

export const KB_ICONS: readonly string[] = [
  'menu_book',
  'local_shipping',
  'construction',
  'spa',
  'health_and_safety',
  'apartment',
  'school',
  'rule',
];

export const KB_COLORS: readonly string[] = [
  '#1F6B52',
  '#2B5479',
  '#7A5214',
  '#6B4A7A',
  '#A13A33',
  '#3A4844',
];

/** Узел шаблона: `in` — подстраница предыдущего узла верхнего уровня, `role` — папка функции. */
export interface KbTemplateNode {
  t: string;
  k: KbKind;
  body?: string;
  in?: number;
  role?: string;
  ack?: boolean;
}

export interface KbTemplate {
  id: string;
  name: string;
  icon: string;
  hint: string;
  nodes: readonly KbTemplateNode[];
}

export const KB_TEMPLATES: readonly KbTemplate[] = [
  {
    id: 'regs',
    name: 'Регламенты подразделения',
    icon: 'rule',
    hint: 'Обзор, регламенты, чек-листы, журнал изменений',
    nodes: [
      { t: 'Обзор', k: 'page', body: 'Что лежит в пространстве и к кому обращаться с вопросами.' },
      { t: 'Регламенты', k: 'folder' },
      {
        t: 'Порядок работы',
        k: 'page',
        in: 1,
        body: 'Кто, что и в какие сроки делает в подразделении.',
      },
      { t: 'Чек-листы', k: 'folder' },
      {
        t: 'Журнал изменений',
        k: 'page',
        body: 'Что поменялось в регламентах и с какой даты действует.',
      },
    ],
  },
  {
    id: 'staff',
    name: 'Инструкции для сотрудников',
    icon: 'health_and_safety',
    hint: 'Вводный инструктаж и папки по функциям: водители, прорабы, массажисты',
    nodes: [
      {
        t: 'Обзор',
        k: 'page',
        body: 'Инструкции и инструктажи для сотрудников. Каждый видит папку своей функции.',
      },
      {
        t: 'Вводный инструктаж',
        k: 'page',
        body: 'Правила безопасности на рабочем месте, порядок действий при травме и пожаре, контакты ответственных.',
        ack: true,
      },
      { t: 'Водителям', k: 'folder', role: 'r-driver' },
      {
        t: 'Перед выездом',
        k: 'page',
        in: 1,
        body: 'Осмотр машины, фото с пяти ракурсов, проверка документов.',
      },
      { t: 'Прорабам и бригадам', k: 'folder', role: 'r-foreman' },
      {
        t: 'Работа на высоте',
        k: 'page',
        in: 1,
        body: 'Леса и стремянки, страховка, допуск к работам на высоте.',
      },
      { t: 'Массажистам', k: 'folder', role: 'r-therapist' },
      {
        t: 'Подготовка кабинета',
        k: 'page',
        in: 1,
        body: 'Проветривание, смена белья, подогрев стола, уборка после визита.',
      },
    ],
  },
  {
    id: 'objects',
    name: 'Объекты и проекты',
    icon: 'home_work',
    hint: 'Папка «Объекты» и технология работ',
    nodes: [
      { t: 'Обзор', k: 'page', body: 'Объекты, их документы и технология работ.' },
      { t: 'Объекты', k: 'folder' },
      {
        t: 'Технология работ',
        k: 'page',
        body: 'Порядок и сроки этапов, требования к фотоотчёту.',
      },
    ],
  },
  {
    id: 'blank',
    name: 'Пустое пространство',
    icon: 'draft',
    hint: 'Только главная страница',
    nodes: [{ t: 'Обзор', k: 'page', body: '' }],
  },
];

export const KB_SECTION = {
  name: 'Объект ремонта',
  v: 3,
  pages: [
    'Паспорт объекта',
    'Как попасть на объект',
    'Акты скрытых работ',
    'Фотоотчёт',
    'Гарантия',
  ],
} as const;

/** Предел глубины дерева: «Обзор» — уровень 1 (KB-06). */
export const KB_MAX_DEPTH = 6;
/** Предел текста версии страницы, символов. */
export const KB_BODY_MAX = 20000;
/** Сколько запусков автоматизации хранит журнал пространства. */
export const KB_RUNS_KEPT = 40;
/** Назначение по одобренному запросу доступа действует 30 дней. */
export const KB_REQUEST_DAYS = 30;
