// Справочники ядра — дословно `models.js` 14.10 (`:11–78`, `:117–123`). Справочники модулей
// (`VEHICLE_STATE`, `TRIP_STATE`, `FORM_TEMPLATES`, `TASK_FLOW`, …) переносят владельцы модулей.
import type { CoreKey, IndustryKey, ModulePerms, Reason, ToneKey, Verb } from './types/index.ts';

export const TONES: Readonly<Record<ToneKey, { bg: string; fg: string }>> = {
  ok: { bg: '#E3EFE7', fg: '#1F6B52' },
  info: { bg: '#E7EEF6', fg: '#2B5479' },
  warn: { bg: '#FAF1DC', fg: '#7A5214' },
  danger: { bg: '#FBEAE7', fg: '#A13A33' },
  neutral: { bg: '#ECEFEA', fg: '#4C5955' },
};

export const VERBS: readonly (readonly [Verb, string])[] = [
  ['view', 'Просматривать'],
  ['create', 'Создавать'],
  ['edit', 'Изменять'],
  ['review', 'Проверять'],
  ['export', 'Выгружать'],
  ['settings', 'Настраивать'],
];

export interface IndustryDef {
  name: string;
  icon: string;
  desc: string;
  deps: readonly string[];
  adds: readonly string[];
  templates: readonly string[];
  perms: ModulePerms;
}

export interface CoreDef {
  name: string;
  icon: string;
  perms: ModulePerms | null;
}

export const INDUSTRY: Readonly<Record<IndustryKey, IndustryDef>> = {
  logistics: {
    name: 'Логистика',
    icon: 'local_shipping',
    desc: 'Машины, рейсы, осмотры, расходы в пути и приёмка смен.',
    deps: ['calendar', 'files', 'forms'],
    adds: [
      'Рабочее место логиста',
      'Мобильная смена водителя',
      'Осмотры с обязательными фото',
      'Приёмка смен',
    ],
    templates: ['Менеджер логистики', 'Водитель'],
    perms: {
      view: ['fleet.vehicles.read', 'fleet.trips.read'],
      create: ['fleet.reservations.create', 'fleet.inspections.create', 'fleet.expenses.create'],
      edit: ['fleet.trips.manage', 'fleet.pool.request'],
      review: ['fleet.trips.review'],
      export: ['fleet.export'],
      settings: ['fleet.settings'],
    },
  },
  spa: {
    name: 'Салон и SPA',
    icon: 'spa',
    desc: 'Запись, специалисты, кабинеты, техкарты и списание материалов.',
    deps: ['calendar', 'inventory', 'cash', 'forms'],
    adds: ['Расписание специалиста', 'Визиты и техкарты', 'Списание материалов'],
    templates: ['Массажист'],
    perms: {
      view: ['spa.appointments.read'],
      create: ['spa.appointments.create'],
      edit: ['spa.services.manage'],
      review: ['spa.completion.review'],
      export: ['spa.export'],
      settings: ['spa.settings'],
    },
  },
  repair: {
    name: 'Ремонт и стройка',
    icon: 'construction',
    desc: 'Объекты, виды работ, бригады, материалы и фотоотчёты.',
    deps: ['tasks', 'inventory', 'files'],
    adds: ['Объекты и этапы', 'Отметки прораба', 'Фотоотчёты'],
    templates: ['Прораб'],
    perms: {
      view: ['repairs.projects.read'],
      create: ['repairs.worklogs.create'],
      edit: ['repairs.projects.manage'],
      review: ['repairs.worklogs.review'],
      export: ['repairs.export'],
      settings: ['repairs.settings'],
    },
  },
};

export const CORE: Readonly<Record<CoreKey, CoreDef>> = {
  calendar: {
    name: 'Календарь',
    icon: 'calendar_month',
    perms: {
      view: ['calendar.read'],
      create: ['calendar.bookings.create'],
      edit: ['calendar.bookings.manage'],
    },
  },
  tasks: {
    name: 'Задачи',
    icon: 'task_alt',
    perms: { view: ['tasks.read'], create: ['tasks.create'], edit: ['tasks.manage'] },
  },
  knowledge: {
    name: 'База знаний',
    icon: 'menu_book',
    perms: { view: ['knowledge.read'], create: ['knowledge.write'] },
  },
  docs: {
    name: 'Документы',
    icon: 'description',
    perms: {
      view: ['docs.read', 'docs.comment'],
      create: ['docs.create', 'docs.convert'],
      edit: ['docs.update', 'docs.suggest'],
      review: ['docs.sign'],
      export: ['docs.export'],
      settings: ['docs.share', 'docs.templates.manage', 'docs.folders.manage'],
    },
  },
  forms: {
    name: 'Формы',
    icon: 'dynamic_form',
    perms: {
      view: ['forms.read'],
      create: ['forms.responses.create'],
      review: ['forms.responses.review'],
      settings: ['forms.publish'],
    },
  },
  data: {
    name: 'Данные',
    icon: 'table_view',
    perms: { view: ['data.read'], export: ['data.export'] },
  },
  files: {
    name: 'Файлы',
    icon: 'folder_open',
    perms: { view: ['files.read'], create: ['files.upload'] },
  },
  inventory: {
    name: 'Склад и материалы',
    icon: 'inventory_2',
    perms: { view: ['inventory.read'], create: ['inventory.movements.post'] },
  },
  cash: {
    name: 'Касса',
    icon: 'account_balance_wallet',
    perms: {
      view: ['cash.read'],
      create: ['cash.post', 'cash.proposals.post', 'cash.shift.operate'],
      edit: ['cash.refund', 'cash.transfer', 'cash.advance.issue'],
      review: ['cash.approve', 'cash.reconcile', 'cash.reverse'],
      export: ['cash.export'],
      settings: ['cash.accounts.manage', 'cash.period.close'],
    },
  },
  service: {
    name: 'Обращения',
    icon: 'support_agent',
    perms: {
      view: ['service.requests.read'],
      create: ['service.requests.create'],
      edit: ['service.requests.reply'],
      review: ['service.requests.resolve'],
      settings: ['service.directions.manage'],
    },
  },
  chat: {
    name: 'Чаты',
    icon: 'forum',
    perms: {
      view: ['chat.read'],
      create: ['chat.write', 'chat.files.send', 'chat.polls.create', 'chat.direct'],
      edit: ['chat.create'],
      review: ['chat.moderate', 'chat.announce'],
      export: ['chat.export'],
      settings: ['chat.settings.manage', 'chat.members.manage', 'chat.retention.manage'],
    },
  },
  notifications: { name: 'Уведомления', icon: 'notifications', perms: null },
};

export const ALL_MODULES: Readonly<Record<IndustryKey | CoreKey, IndustryDef | CoreDef>> = {
  ...INDUSTRY,
  ...CORE,
};

export const isIndustry = (k: string): k is IndustryKey =>
  Object.prototype.hasOwnProperty.call(INDUSTRY, k);

export interface ReasonDef {
  label: string;
  icon: string;
  tone: ToneKey;
  text: string;
}

export const REASON: Readonly<Record<Reason, ReasonDef>> = {
  module_off: {
    label: 'Модуль не подключён',
    icon: 'extension_off',
    tone: 'neutral',
    text: 'Модуль не подключён организацией. Подключить его может владелец бизнеса.',
  },
  module_readonly: {
    label: 'Модуль отключён · только чтение',
    icon: 'history',
    tone: 'neutral',
    text: 'Модуль отключён. История доступна для чтения, новые операции закрыты.',
  },
  no_permission: {
    label: 'Нет права',
    icon: 'lock',
    tone: 'warn',
    text: 'Ни одна роль сотрудника не разрешает это действие.',
  },
  no_scope: {
    label: 'Нет доступа к объекту',
    icon: 'visibility_off',
    tone: 'warn',
    text: 'Право есть, но объект находится вне области назначения.',
  },
  driver_block: {
    label: 'Запрещено функцией «Водитель»',
    icon: 'block',
    tone: 'danger',
    text: 'Действующая функция «Водитель» запрещает начисления через любую роль и группу.',
  },
};
