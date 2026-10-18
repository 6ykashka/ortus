// Шаблоны форм 14.10 (models.js:80–107): страницы → вопросы. `module` — отраслевой модуль, без
// которого шаблон недоступен; `cat` — раздел в списке «Все шаблоны». Подписи — дословно из эталона.
import { clone } from './clone.ts';
import type {
  FieldOption,
  FieldType,
  FormDef,
  FormField,
  FormPage,
  FormSettings,
  FormTemplate,
  ShowIf,
} from './types.ts';

type FieldExtra = Partial<Omit<FormField, 'id' | 'type' | 'label'>>;

const q = (id: string, type: FieldType, label: string, x: FieldExtra = {}): FormField => ({
  id,
  type,
  label,
  required: false,
  ...x,
});
const R = { required: true } as const;
const opts = (labels: readonly (string | readonly [string, number])[]): FieldOption[] =>
  labels.map((l, i) =>
    typeof l === 'string'
      ? { id: 'o' + String(i + 1), label: l }
      : { id: 'o' + String(i + 1), label: l[0], score: l[1] },
  );
const iff = (field: string, value: string, op: 'eq' | 'ne' = 'eq'): ShowIf => ({
  mode: 'all',
  conds: [{ field, op, value }],
});
const SCALE5 = { scaleMin: 1, scaleMax: 5, left: 'Совсем нет', right: 'Полностью' } as const;

export const FORM_SETTINGS: Readonly<FormSettings> = {
  access: 'internal',
  until: '',
  limit: null,
  onePerPerson: false,
  allowEdit: true,
  thanks: 'Спасибо! Ответ отправлен.',
  quiz: false,
  passScore: null,
  showScore: true,
  progress: true,
  backButton: true,
  logo: true,
  retainDays: 365,
};

export const FORM_TEMPLATES: readonly FormTemplate[] = [
  {
    id: 'blank',
    cat: 'basic',
    name: 'Пустая форма',
    icon: 'note_add',
    module: null,
    pages: [{ title: 'Страница 1', fields: [q('q-1', 'text', 'Вопрос 1')] }],
  },
  {
    id: 'tpl-profile',
    cat: 'basic',
    name: 'Анкета',
    icon: 'badge',
    module: null,
    pages: [
      {
        title: 'Контакты',
        fields: [
          q('q-name', 'text', 'Имя и фамилия', R),
          q('q-phone', 'phone', 'Телефон', R),
          q('q-email', 'email', 'Почта'),
          q('q-company', 'text', 'Компания'),
          q('q-inn', 'inn', 'ИНН компании'),
          q('q-contact', 'choice', 'Как удобнее связаться', {
            options: opts(['Звонок', 'Мессенджер', 'Почта']),
          }),
        ],
      },
    ],
  },
  {
    id: 'tpl-feedback',
    cat: 'basic',
    name: 'Форма обратной связи',
    icon: 'forum',
    module: null,
    settings: { access: 'public' },
    pages: [
      {
        title: 'Отзыв',
        fields: [
          q('q-rate', 'rating', 'Оцените работу', R),
          q('q-recommend', 'choice', 'Порекомендуете нас знакомым?', {
            ...R,
            options: opts(['Да', 'Нет', 'Не знаю']),
          }),
          q('q-better', 'longtext', 'Что нам улучшить?', {
            ...R,
            showIf: iff('q-recommend', 'Нет'),
          }),
          q('q-comment', 'longtext', 'Комментарий'),
          q('q-phone', 'phone', 'Телефон, если нужен ответ'),
        ],
      },
    ],
  },
  {
    id: 'tpl-request',
    cat: 'basic',
    name: 'Заявка на услугу или работу',
    icon: 'assignment_add',
    module: null,
    pages: [
      {
        title: 'Что нужно',
        fields: [
          q('q-what', 'longtext', 'Что нужно сделать', R),
          q('q-where', 'text', 'Адрес или объект', R),
          q('q-date', 'date', 'Удобная дата', R),
          q('q-photo', 'photo', 'Фото, если есть', { accept: 'photo', maxFiles: 5, maxMb: 20 }),
        ],
      },
      {
        title: 'Контакты',
        fields: [
          q('q-name', 'text', 'Как к вам обращаться', R),
          q('q-phone', 'phone', 'Телефон', R),
          q('q-urgent', 'bool', 'Срочно?'),
          q('q-why', 'text', 'Почему срочно', { showIf: iff('q-urgent', 'да') }),
        ],
      },
    ],
  },
  {
    id: 'tpl-event',
    cat: 'basic',
    name: 'Регистрация на обучение',
    icon: 'event_available',
    module: null,
    pages: [
      {
        title: 'Участник',
        fields: [
          q('q-name', 'text', 'Имя и фамилия', R),
          q('q-email', 'email', 'Почта', R),
          q('q-phone', 'phone', 'Телефон'),
        ],
      },
      {
        title: 'Участие',
        fields: [
          q('q-format', 'choice', 'Формат', { ...R, options: opts(['Очно', 'Онлайн']) }),
          q('q-car', 'bool', 'Нужен пропуск на машину?', { showIf: iff('q-format', 'Очно') }),
          q('q-plate', 'text', 'Номер машины', { ...R, showIf: iff('q-car', 'да') }),
          q('q-ask', 'longtext', 'Вопросы к организаторам'),
        ],
      },
    ],
  },
  {
    id: 'tpl-csat',
    cat: 'survey',
    name: 'CSAT · удовлетворённость',
    icon: 'sentiment_satisfied',
    module: null,
    pages: [
      {
        title: 'Оценка',
        fields: [
          q('q-csat', 'rating', 'Насколько вы довольны результатом?', R),
          q('q-why', 'longtext', 'Что повлияло на оценку?'),
        ],
      },
    ],
  },
  {
    id: 'tpl-nps',
    cat: 'survey',
    name: 'NPS · готовность рекомендовать',
    icon: 'recommend',
    module: null,
    pages: [
      {
        title: 'Оценка',
        fields: [
          q('q-nps', 'scale', 'Насколько вероятно, что вы порекомендуете нас знакомым?', {
            ...R,
            scaleMin: 0,
            scaleMax: 10,
            left: 'Точно нет',
            right: 'Точно да',
          }),
          q('q-why', 'longtext', 'Почему такая оценка?'),
        ],
      },
    ],
  },
  {
    id: 'tpl-ces',
    cat: 'survey',
    name: 'CES · лёгкость обращения',
    icon: 'speed',
    module: null,
    pages: [
      {
        title: 'Оценка',
        fields: [
          q('q-ces', 'scale', 'Насколько легко было решить ваш вопрос?', {
            ...R,
            scaleMin: 1,
            scaleMax: 7,
            left: 'Очень сложно',
            right: 'Очень легко',
          }),
          q('q-hard', 'longtext', 'Что было сложнее всего?'),
        ],
      },
    ],
  },
  {
    id: 'tpl-support',
    cat: 'survey',
    name: 'Оценка поддержки',
    icon: 'support_agent',
    module: null,
    pages: [
      {
        title: 'Обращение',
        fields: [
          q('q-solved', 'choice', 'Ваш вопрос решён?', {
            ...R,
            options: opts(['Да', 'Частично', 'Нет']),
          }),
          q('q-speed', 'rating', 'Скорость ответа', R),
          q('q-polite', 'rating', 'Вежливость', R),
          q('q-left', 'longtext', 'Что осталось нерешённым', {
            ...R,
            showIf: {
              mode: 'any',
              conds: [
                { field: 'q-solved', op: 'eq', value: 'Частично' },
                { field: 'q-solved', op: 'eq', value: 'Нет' },
              ],
            },
          }),
        ],
      },
    ],
  },
  {
    id: 'tpl-pulse',
    cat: 'people',
    name: 'Пульс команды',
    icon: 'monitor_heart',
    module: null,
    pages: [
      {
        title: 'Работа',
        fields: [
          q('q-goals', 'scale', 'Я понимаю приоритеты на эту неделю', { ...R, ...SCALE5 }),
          q('q-tools', 'scale', 'Мне хватает инструментов и материалов', { ...R, ...SCALE5 }),
        ],
      },
      {
        title: 'Команда',
        fields: [
          q('q-help', 'scale', 'Коллеги помогают, когда нужно', { ...R, ...SCALE5 }),
          q('q-idea', 'longtext', 'Что улучшить в работе команды'),
        ],
      },
    ],
  },
  {
    id: 'tpl-onboard',
    cat: 'people',
    name: 'Онбординг сотрудника',
    icon: 'person_add',
    module: null,
    pages: [
      {
        title: 'Документы',
        fields: [
          q('q-docs', 'multi', 'Какие документы сданы', {
            ...R,
            options: opts(['Паспорт', 'СНИЛС', 'ИНН', 'Трудовая книжка']),
          }),
          q('q-scan', 'photo', 'Скан или фото документов', {
            accept: 'docs',
            maxFiles: 6,
            maxMb: 20,
          }),
        ],
      },
      {
        title: 'Доступы',
        fields: [
          q('q-access', 'multi', 'Что уже работает', {
            options: opts(['Вход в Ортус', 'Рабочая почта', 'Пропуск']),
          }),
          q('q-mentor', 'person', 'Наставник', R),
        ],
      },
      {
        title: 'Инструктаж',
        fields: [
          q('q-brief', 'bool', 'Инструктаж по технике безопасности пройден', R),
          q('q-brief-date', 'date', 'Дата инструктажа', { ...R, showIf: iff('q-brief', 'да') }),
          q('q-ask', 'longtext', 'Вопросы и пожелания'),
        ],
      },
    ],
  },
  {
    id: 'tpl-quiz',
    cat: 'quiz',
    name: 'Тест знаний с баллами',
    icon: 'quiz',
    module: null,
    settings: { quiz: true, passScore: 4, showScore: true },
    pages: [
      {
        title: 'Осмотр машины',
        fields: [
          q('q-q1', 'choice', 'Что делать, если перед рейсом найден дефект?', {
            ...R,
            options: opts([
              ['Выехать и сообщить после рейса', 0],
              ['Отметить дефект в осмотре и сообщить менеджеру', 1],
              ['Ничего, если дефект мелкий', 0],
            ]),
          }),
          q('q-q2', 'choice', 'Кто решает, выпускать ли машину с дефектом?', {
            ...R,
            options: opts([
              ['Водитель', 0],
              ['Менеджер логистики', 1],
              ['Механик подрядчика', 0],
            ]),
          }),
          q('q-q3', 'multi', 'Что обязательно фотографировать при осмотре?', {
            ...R,
            options: opts([
              ['Четыре стороны машины', 1],
              ['Одометр', 1],
              ['Салон изнутри', 0],
            ]),
          }),
        ],
      },
      {
        title: 'Документы',
        fields: [
          q('q-q4', 'choice', 'Как исправить ошибку в уже принятом ответе?', {
            ...R,
            options: opts([
              ['Удалить ответ', 0],
              ['Попросить исправление — появится ревизия', 1],
            ]),
          }),
        ],
      },
    ],
  },
  {
    id: 'tpl-insp',
    cat: 'industry',
    name: 'Круговой осмотр машины',
    icon: 'local_shipping',
    module: 'logistics',
    pages: [
      {
        title: 'Фото',
        fields: [
          q('q-photos', 'photo', 'Фото: спереди, сзади, слева, справа, одометр', {
            ...R,
            accept: 'photo',
            maxFiles: 5,
            maxMb: 20,
          }),
        ],
      },
      {
        title: 'Показания',
        fields: [
          q('q-odo', 'int', 'Пробег по одометру, км', R),
          q('q-fuel', 'choice', 'Уровень топлива', {
            ...R,
            options: opts(['¼', '½', '¾', 'Полный']),
          }),
        ],
      },
      {
        title: 'Проверка',
        fields: [
          q('q-checks', 'multi', 'Чек-лист', {
            ...R,
            options: opts(['Кузов', 'Шины', 'Свет', 'Документы']),
          }),
          q('q-defect', 'bool', 'Есть дефекты?', R),
          q('q-defect-text', 'longtext', 'Описание дефекта', {
            ...R,
            showIf: iff('q-defect', 'да'),
          }),
          q('q-defect-photo', 'photo', 'Фото дефекта', {
            ...R,
            accept: 'photo',
            maxFiles: 3,
            maxMb: 20,
            showIf: iff('q-defect', 'да'),
          }),
        ],
      },
    ],
  },
  {
    id: 'tpl-foreman',
    cat: 'industry',
    name: 'Ежедневный отчёт прораба',
    icon: 'construction',
    module: 'repair',
    pages: [
      {
        title: 'Работы',
        fields: [
          q('q-object', 'ref', 'Объект', { ...R, refKind: 'object' }),
          q('q-done', 'longtext', 'Что сделано за день', R),
          q('q-volume', 'number', 'Выполненный объём', R),
          q('q-crew', 'person', 'Кто был на объекте', R),
        ],
      },
      {
        title: 'Фото и простой',
        fields: [
          q('q-photo', 'photo', 'Фото до и после', {
            ...R,
            accept: 'photo',
            maxFiles: 10,
            maxMb: 20,
          }),
          q('q-stop', 'bool', 'Был простой или замечания?', R),
          q('q-stop-why', 'longtext', 'Причина и что нужно от офиса', {
            ...R,
            showIf: iff('q-stop', 'да'),
          }),
        ],
      },
    ],
  },
  {
    id: 'tpl-spa',
    cat: 'industry',
    name: 'Анкета клиента перед процедурой',
    icon: 'spa',
    module: 'spa',
    pages: [
      {
        title: 'Клиент',
        fields: [q('q-name', 'text', 'Имя и фамилия', R), q('q-phone', 'phone', 'Телефон', R)],
      },
      {
        title: 'Здоровье',
        fields: [
          q(
            'q-contra',
            'bool',
            'Есть противопоказания: давление, беременность, кожные заболевания?',
            R,
          ),
          q('q-contra-text', 'longtext', 'Уточните противопоказания', {
            ...R,
            showIf: iff('q-contra', 'да'),
          }),
          q('q-allergy', 'text', 'Аллергия на масла или косметику'),
          q('q-consent', 'bool', 'Согласие на обработку персональных данных', R),
        ],
      },
    ],
  },
];

/** Черновик формы из шаблона: `{pages: [{id: 'pN', title}], fields: [{…, page, section}]}`. */
export function templateDef(T?: FormTemplate | null): FormDef {
  const pages: FormPage[] = [];
  const fields: FormField[] = [];
  const src = T ? T.pages : [{ title: 'Страница 1', fields: [] }];
  src.forEach((p, i) => {
    const id = 'p' + String(i + 1);
    pages.push({ id, title: p.title });
    for (const x of p.fields) fields.push({ ...clone(x), page: id, section: p.title });
  });
  return { pages, fields };
}

/** Служебные значения ответа для записи в Базу знаний (`formVal`). */
export const FORM_VARS: readonly (readonly [string, string])[] = [
  ['$at', 'Дата и время ответа'],
  ['$author', 'Автор ответа'],
  ['$object', 'Объект CRM'],
  ['$id', 'Номер ответа'],
  ['$form', 'Название формы'],
  ['$ver', 'Версия формы'],
];
