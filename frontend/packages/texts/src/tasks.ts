// W4.12 · «Задачи и проекты» (`tasks-projects`, `tasks-project-new`, `tasks-board`, `modal-new-task`, `tasks-card`):
// подписи модуля дословно по эталону design-2026-10-19 «Задачи и проекты.dc.html» (шаблон ЗП:21–193, логика 318–527;
// подключён dc-import на pg.tasks «Ортус CRM.dc.html»:1596). Пункт меню — `shell.nav.items.tasks`. Шаблоны — конкатенации
// логики эталона (номер строки — в комментарии). Вкладки «Участники», «Процесс», «Автоматизация» — W4.13.
// Только добавление; пишет владелец страниц (W4.12, W4.13).
import { company } from './company.ts';
import { home } from './home.ts';
import { logisticsDriver } from './logistics-driver.ts';
import { logisticsManager } from './logistics-manager.ts';
import { platform } from './platform.ts';
import type { TextTree } from './types.ts';

export const tasks = {
  projects: {
    title: 'Проекты', // :26
    note: 'Видны проекты, где у вас есть право «Задачи · Читать»', // :27
    create: 'Новый проект', // :29
    cols: {
      project: 'Проект', // :34
      unit: company.dialogs.invite.scope,
      access: home.queue.chips.access,
      people: 'Людей',
      open: 'Открыто',
    },
    empty: 'Проектов, доступных вам, пока нет', // :44
    hint: 'Права в проекте отдельно не настраиваются: действуют роли из «Пользователей и ролей» с областью фирмы, региона или самого проекта. Одна роль — одинаковые права во всех проектах.', // :46
    /** «{владелец} · процесс v{N}» (:361). */
    sub: '{owner} · процесс v{v}',
    subFunnel: '{owner} · воронка заявок',
    subNoWf: '{owner} · процесс не настроен',
    wholeOrg: company.dialogs.assign.types.tenant, // :350
    funnel: 'Воронка', // :360
  },
  /** Уровни доступа проекта (ACC :323) — ключи TaskProjectAccessLevel контракта. */
  access: {
    open: 'Открытый',
    limited: 'Ограниченный',
    closed: 'Закрытый',
  },
  /** Пояснения уровней (ACC :323); «Закрытый» — по TP-03 без «и владелец бизнеса» (Q-W4.00-tasks-2, no-reference). */
  accessDesc: {
    open: 'Все с правом «Задачи» в области видят и работают с задачами',
    limited: 'Все в области видят; создают и меняют задачи участники проекта',
  },
  wizard: {
    name: company.dialogs.createRole.name, // :52
    namePlaceholder: 'Например, «Ремонт · ЖК Речной»',
    key: 'Ключ', // :53
    keyStub: 'КЛЮЧ', // :365
    keyHint: 'Номера задач: {key}-101, {key}-102… Ключ уникален в организации.', // :365
    unit: 'Область проекта', // :56
    unitHint: 'Роли, выданные в этой области, действуют в проекте по уровню доступа.',
    region: '{name} · регион', // :366
    firm: '{name} · фирма',
    who: 'Кто видит проект', // :57
    process: 'Процесс', // :62
    processes: {
      simple: 'Простой', // :368
      approval: 'С согласованием',
      copy: 'Копия проекта',
    },
    copyFrom: 'Проект-образец', // :64
    copyOption: '{key} · {name} · v{v}', // :369
    notes: {
      simple:
        'Новая → В работе → На проверке → Готово. «Принять» и «Вернуть» — у руководителя проекта.', // :370
      approval:
        'Новая → В работе → На проверке → Готово. «Согласовать»: достаточно одного согласующего, автор свою не согласует, при отказе — «В работе».',
      copy: 'Статусы и переходы копируются один раз и дальше меняются независимо. Правила автоматизации копируются выключенными.',
    },
    submit: 'Создать проект', // :68
    owner: 'Вы станете руководителем проекта.', // :69
    created: 'Проект «{name}» создан', // :372
  },
  project: {
    /** «{область} · {уровень} проект · процесс v{N}» (:378), уровень — строчными. */
    sub: '{unit} · {access} проект · процесс v{v}',
    subNoWf: '{unit} · {access} проект',
    me: 'Вы: {role}', // :378
    noAccess: company.users.editor.noAccess,
    tabsAria: 'Разделы проекта', // :84
    tabs: {
      board: 'Доска', // :376
      people: platform.tenants.fields.members,
      workflow: 'Процесс',
      automation: 'Автоматизация',
    },
    noWf: 'У проекта ещё нет настраиваемого процесса. Создадим его из текущих статусов: Новая, В работе, На проверке, Готово.', // :87
    initWf: 'Настроить процесс',
    wfCreated: 'Процесс создан', // :380
  },
  board: {
    filters: {
      all: logisticsManager.fleet.filters.all, // :389
      mine: 'Мои',
    },
    approvalCount: 'Ждут моего согласия · {n}', // :390
    quickPlaceholder: 'Новая задача — Enter', // :95
    quickAria: 'Название новой задачи',
    quickButton: 'Задача',
    created: 'Задача создана', // :525
    waitsMe: 'Ждёт вас', // :413
    inApproval: 'На согласовании',
    docRoute: 'Маршрут документа',
  },
  /** Приоритеты (PRIORITY models.js:235) — ключи TaskPriority контракта. */
  priority: {
    urgent: 'Срочно',
    high: 'Высокий',
    normal: 'Обычный',
    low: 'Низкий',
  },
  newTask: {
    title: 'Новая задача', // :100
    required: 'Обязательные поля отмечены *',
    project: 'Проект *', // :103
    status: 'Статус', // :104
    parent: 'Входит в задачу', // :106
    noParent: 'Не входит — самостоятельная задача',
    parentOption: '{key} · {title}', // :497
    subject: 'Тема *', // :107
    subjectPlaceholder: 'Коротко: что нужно сделать',
    description: logisticsDriver.inspection.description, // :108
    descriptionPlaceholder:
      'Подробности, критерии готовности, ссылки. Скриншот можно вставить из буфера — он станет вложением.',
    descriptionCount: '{n} / 5000', // :399
    attachments: 'Вложения', // :110
    drop: 'Перетащите файлы сюда или', // :111
    dropLink: 'выберите на устройстве',
    dropNote: 'Фото, PDF, документы Office, текст · до 20 МБ каждый',
    pick: 'Выбрать файлы',
    remove: 'Убрать {name}', // :112
    wontAttach: 'Не прикрепится: {reason}', // :402
    /** Причины отказа файла (pickFiles :520). */
    reasons: {
      tooMany: 'не больше 30 файлов на задачу',
      tooBig: 'больше 20 МБ',
      empty: 'пустой файл',
      type: 'такой тип не принимаем',
    },
    assignee: 'Исполнитель', // :115
    assignMe: 'Назначить меня', // :116
    priority: 'Приоритет', // :117
    due: logisticsManager.request.period, // :118
    labels: 'Метки', // :120
    labelsPlaceholder: 'Через запятую: шины, закупка',
    more: 'Создать ещё одну', // :123
    create: 'Создать', // :405
    creating: 'Создаём…',
    titleShort: 'Тема — не короче 3 символов', // :406
    removeBad: 'Уберите файлы, которые не прикрепятся: {names}',
    created: 'Задача {key} создана', // :409
    screenshot: 'Снимок экрана.png', // :519
  },
  card: {
    author: '· автор {name}', // :146
    close: 'Закрыть задачу',
    comment: 'Комментарий к переходу или отказу', // :154
    blocked: '«{name}»: {why}', // :152
    approved: 'Согласовано', // :422
    done: '«{name}» выполнен',
    approvalTitle: 'Согласование «{name}» · {mode}', // :424
    modes: {
      any: 'достаточно одного',
      all: 'нужны все',
    },
    you: '{name} · вы', // :425
    votedAt: 'согласовал(а) {at}',
    waiting: 'ждёт решения',
    noApprovers: 'Некому согласовать: назначьте роль «Согласующий» в «Участниках».', // :160
    reject: logisticsManager.review.rework, // :161
    rejected: 'Возвращено на доработку', // :427
    links: 'Связи', // :170
    parentOf: 'Входит в', // :171
    parentHidden: 'Задача из проекта, к которому у вас нет доступа', // :507
    parentDeleted: '{key} · удалена',
    unparentAria: 'Убрать из состава родительской задачи', // :171
    unparentTitle: 'Убрать связь',
    unlinked: 'Связь снята', // :508
    setParent: 'Входит в задачу…', // :172
    parentSet: 'Задача входит в {key}', // :508
    children: 'Состоит из', // :173
    childrenCount: '{done} из {total} готово', // :509
    noChildren: 'подзадач нет', // :173
    unlinkAria: 'Исключить {key} из состава', // :174
    unlinkTitle: 'Исключить из состава',
    unlinkedChild: '{key} исключена из состава', // :510
    hiddenChildren: 'Ещё {n} — в проектах, к которым у вас нет доступа', // :511
    subtask: 'Подзадача', // :176
    addExisting: 'Добавить существующую…',
    addExistingAria: 'Добавить существующую задачу в состав',
    added: '{key} добавлена в состав', // :512
    noDescription: 'Описания нет', // :181
    files: 'Вложения · {n}', // :183
    attach: 'Прикрепить',
    attachAria: 'Прикрепить файлы',
    attached: 'Прикреплено файлов: {n}', // :523
    notAttached: 'Не прикреплено: {list}',
    notAttachedItem: '{name} — {reason}',
    fileMeta: '{size} · {by} · {at}', // :434
    removeFile: 'Удалить {name}', // :184
    fileRemoved: 'Файл удалён', // :434
    filesHint: 'Файлы можно перетащить на карточку. Доступ к файлам — как к задаче.', // :185
    checklist: logisticsDriver.inspection.checklist, // :187
    history: 'История', // :189
    /** Блок маршрута документа (:420, W7.22). */
    route: 'Маршрут документа «{title}» v{v} · шаг {n} из {of} «{step}»',
    routeWaiting: 'Ждут: {names}',
    routeNote: 'Статус задачи меняет маршрут, решения — в «Документах».',
    openDoc: 'Открыть документ', // :153
    commentAria: logisticsDriver.expenses.comment, // :154
  },
  /** Вид «Список» и комментарий задачи — по старой доске «Ортус CRM.dc.html»:1650–1697 (Р-24, Q-W4.00-tasks-11). */
  list: {
    empty: 'Задач нет', // CRM:1663
    send: 'Отправить комментарий', // CRM:1697
  },
  /** Размер файла (fsize :515). */
  size: {
    kb: '{n} КБ',
    mb: '{n} МБ',
  },
} as const satisfies TextTree;
