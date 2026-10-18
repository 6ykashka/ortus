// Переход «Базы знаний» на пространства с деревом (`installKnowledge`, knowledge.js 14.10:244–315) —
// стадия сида `knowledge`. Повторный вызов ничего не меняет.
//
// Отличия от эталона (бриф W4.30 §10):
// - KB-02: роли «Автор» нет — назначение Котовой в «Общем» (`akb-3`) — «Редактор»;
// - KB-07: старая страница `owner` → «Только выбранные» (как предложено), остальные — «Как у родителя»;
// - раздел объекта obj-42 строится из `db.repair`, а без среза ремонта — из объекта сида `KB_OBJ_42`.
import { objOf } from '../../core/entries.ts';
import { KB_ROLES } from './dictionaries.ts';
import { KB_OBJ_42, kbEditors, kbNode, makeSection, type KbSectionObject } from './sections.ts';
import type { KbNode, KbSpaceAccess, KbTenantDb, KnowledgeSlice } from './types.ts';

type SpaceMeta = [icon: string, color: string, altaUnit: string | null, access: KbSpaceAccess];

const META: Readonly<Record<string, SpaceMeta>> = {
  'sp-log': ['local_shipping', '#1F6B52', 'f-msk-sever', 'limited'],
  'sp-spa': ['spa', '#6B4A7A', null, 'open'],
  'sp-own': ['shield_person', '#3A4844', null, 'closed'],
};
const META_DEFAULT: SpaceMeta = ['menu_book', '#2B5479', null, 'open'];

function altaExtras(db: KbTenantDb, K: KnowledgeSlice): void {
  /** Дополняет страницу сырого сида; удалённую страницу пропускает (эталон падал). */
  const patch = (id: string, fields: Partial<KbNode>): void => {
    const n = K.pages.find((p) => p.id === id);
    if (n) Object.assign(n, fields);
  };
  const add = (...a: Parameters<typeof kbNode>): void => {
    K.pages.push(kbNode(...a));
  };
  K.spaces.push(
    {
      id: 'sp-rep',
      name: 'Ремонт и стройка',
      icon: 'construction',
      color: '#7A5214',
      unit: null,
      access: 'limited',
    },
    {
      id: 'sp-gen',
      name: 'Общее',
      icon: 'apartment',
      color: '#2B5479',
      unit: null,
      access: 'open',
    },
  );
  add('kb-log-home', 'sp-log', null, 0, 'page', 'Обзор', {
    body: 'Регламенты и памятки фирмы «Север Логистик»: приёмка смены, осмотр машины, выезд при дефекте. Вопросы по пространству — Марине Котовой.',
  });
  add('kb-f-reg', 'sp-log', null, 1, 'folder', 'Регламенты', { body: '' });
  patch('kb-1', {
    parent: 'kb-f-reg',
    pos: 1,
    reviewBy: '24.03.2027',
    ack: { v: 2, audience: { who: 'role', ref: 'r-driver', unit: 'f-msk-sever' }, done: [] },
  });
  add('kb-1a', 'sp-log', 'kb-1', 1, 'page', 'Чек-лист приёмки', {
    body: 'Фото с пяти ракурсов, включая одометр.\n\nПробег совпадает с одометром на фото.\n\nУ каждого расхода есть чек.\n\nТоплива не меньше, чем при выезде.',
  });
  add('kb-1b', 'sp-log', 'kb-1', 2, 'page', 'Типовые замечания', {
    body: 'Нет фото одометра — вернуть раздел «Фото».\n\nРасход без чека — вернуть раздел «Расходы».\n\nПробег не совпадает с фото — вернуть раздел «Пробег».',
  });
  patch('kb-2', {
    parent: 'kb-f-reg',
    pos: 2,
    reviewBy: '30.09.2026',
    owner: 'm-kotova',
  });
  add('kb-6', 'sp-log', 'kb-f-reg', 3, 'page', 'Выезд при критическом дефекте', {
    status: 'review',
    owner: 'm-kotova',
    by: 'Марина Котова',
    body: 'Если при осмотре отмечен критический дефект, выезд блокируется. Менеджер разрешает выезд или подтверждает неисправность и отправляет машину в ремонт.',
  });
  patch('kb-5', { parent: null, pos: 2, kind: 'table' });
  add('kb-d1', 'sp-log', null, 3, 'diagram', 'Схема сдачи смены', {
    body: 'Как водитель сдаёт смену и что проверяет менеджер.',
    diagram: {
      steps: ['Сдача смены', 'Фото и пробег', 'Чеки расходов'],
      out: [
        ['Принято · машина в пул', 'ok'],
        ['Возврат по разделам', 'warn'],
      ],
    },
  });
  add('kb-f-drv', 'sp-log', null, 4, 'folder', 'Водителям', {
    body: 'Памятки для водителей «Север Логистик».',
    mode: 'listed',
    list: [{ who: 'role', ref: 'r-driver', unit: 'f-msk-sever', can: 'view' }, kbEditors()],
  });
  add('kb-drv-1', 'sp-log', 'kb-f-drv', 1, 'page', 'Памятка водителя', {
    body: 'Перед сменой — осмотр машины в приложении: пять фото и пробег. Без осмотра выезд не начнётся.\n\nВ пути расходы заносите сразу и фотографируйте чек.\n\nПосле рейса — сдача смены с фото, пробегом и чеками.',
  });
  add('kb-drv-2', 'sp-log', 'kb-f-drv', 2, 'page', 'ДТП и поломка в пути', {
    body: 'Остановитесь в безопасном месте, включите аварийную сигнализацию и выставьте знак.\n\nПозвоните диспетчеру, затем сфотографируйте место и повреждения.\n\nНе подписывайте документы без согласования с диспетчером.',
  });
  add('kb-drv-3', 'sp-log', 'kb-f-drv', 3, 'page', 'Контакты диспетчеров', {
    body: 'Диспетчерская «Север Логистик» работает ежедневно с 8:00 до 20:00. Ночью — дежурный менеджер по номеру из карточки рейса.',
  });
  add('kb-drv-4', 'sp-log', 'kb-f-drv', 4, 'diagram', 'Маршруты', {
    mode: 'edit',
    list: [],
    body: 'Схему правит только руководитель пространства.',
    diagram: {
      steps: ['Склад «Север»', 'Погрузка', 'Маршрут по заявке', 'Разгрузка'],
      out: [['Возврат на стоянку', 'ok']],
    },
  });
  add('kb-fin', 'sp-log', null, 5, 'page', 'Тарифы и начисления', {
    sensitivity: 'finance',
    mode: 'listed',
    list: [
      { who: 'member', ref: 'm-kotova', can: 'view' },
      { who: 'member', ref: 'm-kotelnikova', can: 'view' },
    ],
    body: 'Ставки начислений водителям и порядок расчёта. Начисление создаётся после приёмки смены.',
  });
  add('kb-fin-1', 'sp-log', 'kb-fin', 1, 'page', 'Ставки по маршрутам', {
    body: 'Город — 2 400 ₽ за смену.\n\nМежгород до 300 км — 3 800 ₽.\n\nМежгород свыше 300 км — 5 200 ₽.\n\nНочная смена — плюс 15%.',
  });
  add('kb-file1', 'sp-log', null, 6, 'file', 'Договор аренды стоянки.pdf', {
    body: '',
    file: { size: '1,2 МБ', pages: 4 },
  });
  add('kb-lnk1', 'sp-log', null, 7, 'link', 'Форма «Осмотр машины»', {
    body: '',
    link: {
      label: 'Форма «Осмотр машины» · действует версия 3',
      go: 'forms',
      icon: 'dynamic_form',
    },
  });

  add('kb-spa-home', 'sp-spa', null, 0, 'page', 'Обзор', {
    body: 'Технологические карты, подготовка кабинета и правила работы салона.',
  });
  patch('kb-3', {
    parent: null,
    pos: 1,
    ack: { v: 1, audience: { who: 'role', ref: 'r-therapist' }, done: ['m-morozova'] },
  });
  add('kb-spa-2', 'sp-spa', null, 2, 'page', 'Подготовка кабинета', {
    body: 'За 15 минут до визита проветрите кабинет, смените бельё, включите подогрев стола.\n\nПосле визита — уборка 15 минут и отметка в «Мой день».',
  });

  add('kb-own-home', 'sp-own', null, 0, 'page', 'Обзор', {
    body: 'Документы для владельца: политики начислений, договоры, планы.',
  });
  patch('kb-4', { parent: null, pos: 1, sensitivity: 'finance' });

  add('kb-rep-home', 'sp-rep', null, 0, 'page', 'Обзор', {
    body: 'Технология работ, объекты и их документы. Раздел объекта создаётся сам, когда объект переходит на этап «Договор».',
  });
  add('kb-rep-tech', 'sp-rep', null, 1, 'page', 'Технология работ', {
    body: 'Грунтование — не раньше чем через 24 часа после шпаклёвки.\n\nПлитка — после приёмки скрытых работ по электрике и сантехнике.\n\nФото каждого этапа — в «Фотоотчёт» объекта.',
    ack: { v: 1, audience: { who: 'role', ref: 'r-foreman' }, done: [] },
  });
  add('kb-rep-obj', 'sp-rep', null, 2, 'folder', 'Объекты', {
    body: 'Разделы объектов: паспорт, как попасть, акты, фотоотчёт, гарантия.',
  });
  const o42 = (objOf(db, 'obj-42') as KbSectionObject | undefined) ?? KB_OBJ_42;
  makeSection(db, o42, 'kb-rep-obj');

  add('kb-gen-home', 'sp-gen', null, 0, 'page', 'Обзор', {
    body: 'Общие сведения для всех сотрудников «Альта Групп».',
  });
  add('kb-gen-1', 'sp-gen', null, 1, 'page', 'Контакты офиса', {
    owner: 'm-kotova',
    by: 'Марина Котова',
    body: 'Офис: Москва, Дмитровское шоссе, 41, этаж 2. Будни 9:00–18:00.\n\nБухгалтерия принимает документы по пятницам до 16:00.',
  });
  add('kb-gen-2', 'sp-gen', null, 2, 'page', 'Как пользоваться Ортусом', {
    body: 'Задачи — в разделе «Задачи», обращения клиентов — в «Обращениях».\n\nРегламенты своего подразделения ищите в его пространстве базы знаний.',
  });

  db.assignments.push(
    { id: 'akb-1', member: 'm-kotova', role: 'r-kb-lead', scope: { type: 'space', id: 'sp-log' } },
    {
      id: 'akb-2',
      member: 'm-kotelnikova',
      role: 'r-kb-editor',
      scope: { type: 'space', id: 'sp-log' },
    },
    // KB-02: в эталоне — «Автор» (r-kb-author).
    {
      id: 'akb-3',
      member: 'm-kotova',
      role: 'r-kb-editor',
      scope: { type: 'space', id: 'sp-gen' },
    },
  );
  K.rules = [
    {
      id: 'kr-1',
      space: 'sp-log',
      kind: 'ack',
      name: 'Новая версия регламента → попросить ознакомиться заново',
      trigger: 'База знаний · страница опубликована',
      on: true,
    },
    {
      id: 'kr-2',
      space: 'sp-log',
      kind: 'review',
      name: 'Пора пересмотреть страницу → уведомить владельца',
      trigger: 'По расписанию · каждый день в 09:00',
      on: true,
    },
    {
      id: 'kr-3',
      space: 'sp-rep',
      kind: 'section',
      name: 'Объект на этапе «Договор» → раздел из шаблона «Объект ремонта»',
      trigger: 'Ремонт и стройка · этап объекта изменён',
      on: true,
    },
    {
      id: 'kr-4',
      space: 'sp-rep',
      kind: 'ack',
      name: 'Новая версия «Технологии работ» → ознакомить прорабов',
      trigger: 'База знаний · страница опубликована',
      on: true,
    },
    {
      id: 'kr-5',
      space: 'sp-rep',
      kind: 'review',
      name: 'Пора пересмотреть страницу → уведомить владельца',
      trigger: 'По расписанию · каждый день в 09:00',
      on: false,
    },
  ];
  K.runs = [
    {
      id: 'krr-1',
      space: 'sp-rep',
      rule: 'kr-3',
      at: '24.09 10:42',
      res: 'ok',
      text: 'ЖК Речной · квартира 42: создан раздел и 5 подстраниц, доступ получил прораб Алексей Соколов',
    },
    {
      id: 'krr-2',
      space: 'sp-rep',
      rule: 'kr-3',
      at: '01.10 14:05',
      res: 'stopped',
      text: 'Дом 120 м², Истра: остановлено условием — новый этап «Замер», а не «Договор»',
    },
    {
      id: 'krr-3',
      space: 'sp-log',
      rule: 'kr-1',
      at: '24.09 18:10',
      res: 'ok',
      text: '«Регламент приёмки смены» v2: попросили ознакомиться роль «Водитель» в «Север Логистик» — 1 человек',
    },
  ];
}

/** Переход БЗ организации на пространства с деревом. Без среза или уже v2 — ничего не делает. */
export function migrateKnowledgeV2(db: KbTenantDb): void {
  const K = db.knowledge;
  if (!K || K.v2) return;
  for (const r of KB_ROLES) {
    if (!db.roles.some((x) => x.id === r.id)) db.roles.push(structuredClone(r));
  }
  const alta = db.tenantId === 't-alta';
  for (const s of K.spaces) {
    const [icon, color, unit, access] = META[s.id] ?? META_DEFAULT;
    Object.assign(s, {
      icon: s.icon || icon,
      color: s.color || color,
      unit: s.unit !== undefined ? s.unit : alta ? unit : null,
      access: s.access || access,
    });
  }
  K.pages.forEach((p, i) => {
    Object.assign(p, {
      parent: p.parent || null,
      pos: p.pos ?? i + 1,
      kind: p.kind || 'page',
      mode: p.mode || (p.access === 'owner' ? 'listed' : 'inherit'),
      list: p.list || [],
      status: p.status || 'active',
      owner: p.owner || 'm-owner',
    });
  });
  if (alta) altaExtras(db, K);
  for (const s of K.spaces) {
    if (!K.pages.some((p) => p.space === s.id && !p.parent && p.title === 'Обзор')) {
      K.pages.push(
        kbNode('kb-home-' + s.id, s.id, null, 0, 'page', 'Обзор', {
          body: 'Главная страница пространства «' + s.name + '».',
        }),
      );
    }
  }
  K.requests ??= [];
  K.rules ??= [];
  K.runs ??= [];
  K.v2 = true;
}
