// W4.32 · «База знаний» (`knowledge`, KB-01…KB-08): подписи страницы дословно по эталону design-2026-10-19
// «База знаний.dc.html» (М — номер строки) и справочники `ortus/knowledge.js` (KJ). Заголовок списка — пункт меню
// `shell.nav.items.knowledge`; общие слова — ссылки на файлы-владельцы. Только добавление; пишет владелец страницы.
import { company } from './company.ts';
import { home } from './home.ts';
import { logisticsDriver } from './logistics-driver.ts';
import { logisticsManager } from './logistics-manager.ts';
import { platform } from './platform.ts';
import { shell } from './shell.ts';
import { tasks } from './tasks.ts';
import type { TextTree } from './types.ts';

const PAGES = '{n, plural, one {# страница} few {# страницы} many {# страниц} other {# страницы}}';

export const knowledge = {
  /** Список пространств М:29–59. */
  list: {
    subtitle: 'Пространства и страницы, доступные вам по ролям', // М:32
    newSpace: 'Новое пространство', // М:34
    searchAria: 'Поиск по базе знаний', // М:36
    searchPlaceholder: 'Поиск по доступным страницам', // М:36
    noResults: 'Среди доступных вам страниц ничего не нашлось', // М:40
    hint: 'Пространство — область в «Пользователях и ролях». Доступ дают роли с областью организации, региона, фирмы или самого пространства. Подстраница получает доступ родителя и может только сузить круг читателей.', // М:57
  },
  /** Карточка пространства (listVM М:450–452). */
  card: {
    pages: PAGES,
    lead: 'Руководитель: {names}',
    leadOwner: 'владелец бизнеса',
    role: tasks.project.me,
    roleLink: 'по ссылке на страницу',
    requests: 'Запросы доступа: {n}',
    updated: 'Обновлено: «{title}», {date}',
  },
  /** Шапка пространства М:63–74, spaceVM М:466–468. */
  space: {
    back: 'К списку пространств',
    role: 'База знаний · {role}',
    roleBranch: 'доступ к ветке',
    tabsAria: 'Разделы пространства',
    tabs: {
      pages: 'Страницы',
      people: 'Участники и доступ',
      auto: tasks.project.tabs.automation,
      arch: platform.plans.archive,
    },
    level: '{label} · {area}',
  },
  /** Дерево М:79–101, pagesVM М:486–501. */
  tree: {
    aria: 'Дерево пространства',
    search: 'Найти в пространстве',
    create: 'Создать страницу',
    createTitle: tasks.newTask.create,
    expand: 'Развернуть',
    collapse: 'Свернуть',
    finance: 'Финансовая страница',
    own: 'Свой доступ',
    empty: 'Ничего не нашлось среди доступных страниц',
    hint: 'Значок замка — у страницы свой доступ. Подстраницы получают доступ родителя. Перенос — «⋯ → Переместить»: Ортус покажет, кто потеряет доступ.',
  },
  /** Панель и просмотр страницы М:106–190, pageVM М:505–550. */
  page: {
    tree: 'Дерево',
    pathAria: 'Путь',
    access: home.queue.chips.access,
    edit: 'Править',
    request: 'Запросить право правки',
    requested: logisticsManager.pool.chips.sent,
    menuAria: 'Действия со страницей',
    menu: {
      child: 'Новая подстраница',
      move: 'Переместить…',
      approve: 'Утвердить',
      archive: logisticsManager.expenseCategories.archive,
    },
    oldVersion: 'Вы смотрите версию {v} от {date}. Текущая — v{cur}.',
    toCurrent: 'К текущей версии',
    restore: 'Восстановить как новую',
    status: '{label} · v{v}',
    metaOwner: 'владелец {name}',
    metaUpdated: 'обновлено {date}, {by}',
    metaReview: 'пересмотреть до {date}',
    fileMeta:
      'PDF · {size} · {pages, plural, one {# страница} few {# страницы} many {# страниц} other {# страницы}}',
    fileNote: 'В прототипе файл не хранится: здесь будет предпросмотр PDF.',
    linkNote: 'Запись CRM: открывается, если у вас есть доступ к ней',
    open: shell.actions.open,
    tableForm: 'Строки добавляет форма после принятия ответа; исправления — через ответ формы.',
    tableRows: 'Строк: {n}',
    tableEmpty: 'Таблица пока пустая',
    emptyCols: { at: logisticsDriver.expenses.date, what: 'Что', who: 'Кто' },
    ackTitle: 'Ознакомление с версией {v} · {audience}',
    ackLine:
      '{done} из {total} ознакомились{wait, select, true {. Ждём: {names}{more, select, true { и ещё {n}} other {}}} other {}}',
    ackAsk: 'Подтвердите, что прочитали эту версию.',
    ack: 'Ознакомлен',
    ackDone: 'Вы подтвердили, что ознакомились с этой версией',
    kids: 'Подстраницы',
    kidsNote: '· видны только доступные вам',
    aside: 'О странице',
    accessOwn: 'Свой доступ: {mode}.',
    accessAs: 'Как у «{title}»: {mode}.',
    accessSpace: 'Как у пространства: {d}.',
    canEdit: 'Вы можете читать и править.',
    canRead: 'Вы можете читать.',
    setup: 'Настроить доступ',
    why: 'Кто видит и почему',
    versions: 'Версии',
    versionTag: 'v{v}',
    versionLine: '{date} · {by}',
  },
  /** Редактор М:127–135, editVM М:552–561. */
  editor: {
    title: company.dialogs.createRole.name,
    steps: 'Шаги схемы — по одному в строке',
    body: 'Текст · абзацы через пустую строку',
    ack: 'Попросить ознакомиться с новой версией: {audience}',
    publish: 'Опубликовать v{v}',
    cancel: shell.modal.cancel,
    base: 'Основа — v{v}. Если страницу изменят раньше, Ортус покажет конфликт.',
  },
  /** Ошибка команды М:25–27, call М:412. */
  error: {
    hide: 'Скрыть',
    fallback: 'Не получилось',
  },
  /** Виды узлов (KJ KB_KINDS). */
  kinds: {
    page: 'Страница',
    folder: 'Папка',
    table: 'Таблица',
    diagram: 'Схема',
    file: 'Файл',
    link: 'Запись CRM',
  },
  /** Статусы (KJ KB_STATUS). */
  status: {
    active: company.modules.trial.chipActive,
    draft: 'Черновик',
    review: 'На проверке',
    outdated: 'Пора пересмотреть',
  },
  /** Уровни пространства (KJ KB_ACCESS). */
  levels: {
    open: { label: 'Открытое', d: 'Роли области действуют полностью' },
    limited: { label: 'Ограниченное', d: 'Все в области читают, пишут участники' },
    closed: { label: 'Закрытое', d: 'Только участники и владелец бизнеса' },
  },
  /** Режимы доступа узла (KJ KB_MODES; `edit` эталона — `edit_listed` контракта). */
  modes: {
    inherit: { label: 'Как у родителя', d: 'Читают и правят те же, кто у родителя' },
    editListed: {
      label: 'Читают все, правят выбранные',
      d: 'Чтение как у родителя, правка — по списку',
    },
    listed: { label: 'Только выбранные', d: 'Читают и правят только те, кто в списке' },
  },
  /** «Участники и доступ» М:199–256, peopleVM М:676–710. */
  people: {
    intro:
      'Роли пространства — назначения из «Пользователей и ролей» с областью «{space}». Остальные получают доступ по уровню пространства: {level}.',
    assigned: 'назначение в пространстве',
    invited: 'приглашение не принято · {src}',
    roleAria: 'Роль в пространстве',
    remove: 'Убрать',
    nobody: 'Никого',
    levelCaps: '{d} · {area}',
    page: 'Страница «{title}»',
    pageUntil: 'Страница «{title}» до {date}',
    member: company.users.check.member,
    role: company.dialogs.assign.role,
    add: 'Добавить в пространство',
    map: 'Карта доступа',
    mapNote:
      'Страницы × сотрудники. Нажмите на ячейку, чтобы увидеть причину. Владелец бизнеса видит всё.',
    cells: { edit: 'Правит', view: 'Читает', none: 'Нет', function: 'Функция' },
    whyAria: 'Почему так',
    check: 'Проверить сотрудника',
    whyPage: '«{title}»',
    pickCell: 'Выберите ячейку карты',
  },
  /** «Автоматизация» М:258–280, autoVM М:712–721. */
  auto: {
    rules: 'Правила пространства',
    switchAria: 'Правило включено',
    notes: {
      ack: 'Срабатывает при публикации с отметкой «Попросить ознакомиться»: уведомление получают все из аудитории страницы.',
      review:
        'Ищет страницы с наступившим сроком пересмотра, ставит статус «Пора пересмотреть» и уведомляет владельца.',
      section:
        'Создаёт раздел объекта: паспорт, как попасть, акты, фотоотчёт, гарантия. Прораб объекта получает доступ по связи с объектом.',
    },
    checkNow: 'Проверить сроки сейчас',
    objectForeman: '{stage} · прораб {name}',
    objectNoForeman: '{stage} · прораб не назначен',
    createSection: 'Создать раздел',
    openSection: 'Открыть раздел',
    footer:
      'Правило выполняется от имени того, кто его включил; права проверяются при каждом запуске. Изменения, которые сделало правило, другие правила не запускают.',
    runs: 'Журнал запусков',
    noRuns: 'Запусков пока нет',
  },
  /** «Архив» М:282–290, archVM М:723–726. */
  archive: {
    intro:
      'Страницы в архиве не видны в дереве и поиске. Восстановление возвращает ветку на прежнее место.',
    branch:
      '{n, plural, one {# страница} few {# страницы} many {# страниц} other {# страницы}} в ветке',
    restore: 'Восстановить',
    empty: 'В архиве ничего нет',
  },
  /** Диалоги М:294–374, dlgVM М:579–674. */
  dialogs: {
    close: shell.modal.close,
    cancel: shell.modal.cancel,
    space: {
      title: 'Новое пространство',
      sub: 'Область и уровень доступа можно поменять позже',
      name: company.dialogs.createRole.name,
      placeholder: 'Например, «Охрана труда»',
      icon: 'Значок',
      colorAria: 'Цвет',
      unit: 'Область — чьи роли действуют',
      tenant: company.dialogs.assign.types.tenant,
      region: 'Регион «{name}»',
      firm: '— фирма «{name}»',
      template: company.users.roleKinds.template,
      chipRole: 'Читают: роль «{role}»',
      chipAck: 'Ознакомиться: все',
      chipSpace: 'Как у пространства',
      ok: 'Создать пространство',
    },
    node: {
      title: 'Создать в «{space}»',
      sub: 'Подстраница получит доступ родителя',
      name: company.dialogs.createRole.name,
      where: 'Где создать',
      top: 'Верхний уровень пространства',
      inside:
        'Внутри «{title}». {own, select, true {У родителя свой доступ — новая страница получит его же.} other {Доступ — как у родителя.}}',
      atTop: 'На верхнем уровне доступ — как у пространства: {d}.',
      ok: tasks.newTask.create,
    },
    move: {
      title: 'Переместить «{title}»',
      sub: 'Доступ пересчитается по новому родителю',
      parent: 'Новый родитель',
      pick: 'Выберите нового родителя — здесь появится, кто получит или потеряет доступ.',
      pages: `Переносится ${PAGES} вместе с подстраницами.`,
      nobody: 'Потеряют доступ: никто',
      ok: 'Переместить',
    },
    /** Строки влияния (перенос и доступ, М:620–657). */
    impact: {
      gainView: 'Получат чтение (страниц): {names}',
      gainEdit: 'Получат правку (страниц): {names}',
      loseView: 'Потеряют чтение (страниц): {names}',
      loseEdit: 'Потеряют правку (страниц): {names}',
    },
    access: {
      title: 'Доступ · {title}',
      sub: '{path} · {n, plural, one {# подстраница} few {# подстраницы} many {# подстраниц} other {# подстраницы}}',
      readonly:
        'Доступ меняет руководитель пространства ({leads}). Здесь видно, кто читает и правит.',
      setting: 'Настраиваете сейчас',
      asSpace: 'Как у пространства',
      whoAria: 'Кого добавить',
      whoPlaceholder: 'Выберите роль, группу или сотрудника',
      canAria: 'Что может',
      add: logisticsDriver.inspection.add,
      duplicate: 'Уже есть в списке',
      fixed: 'Руководитель пространства и владелец бизнеса',
      fixedSub: '{leads} · видят и правят всё в пространстве',
      all: 'Всё',
      member: company.users.check.member,
      invited: 'Приглашение не принято',
      people:
        '{n, plural, one {# человек} few {# человека} many {# человек} other {# человека}}: {names}{more, select, true { и ещё {rest}} other {}}',
      nobody: 'Сейчас никого',
      warnOne: 'Не получит доступ: {why}. Добавьте во вкладке «Участники и доступ».',
      warnSome: 'Не получат доступ: {names} — {why}.',
      quick: 'Добавить в пространство читателем',
      removeAria: 'Убрать из списка',
      footnote:
        'Доступ проходит каждый уровень цепочки. Подстраница может только сузить круг читателей; правку можно выдать отдельно тем, кто видит страницу. Функция «Водитель» не открывает финансовые страницы ни через роль, ни через группу.',
      changes: 'Что изменится',
      branch: `Ветка «{title}»: ${PAGES}{own, select, true {, из них со своим доступом: {names}} other {}}.`,
      pick: 'Измените режим или список — здесь появится, кто получит или потеряет доступ.',
      dead: 'Ни у кого доступ не изменится: {names} не проходят уровни выше этой страницы. Сначала дайте им доступ к пространству или родителю.',
      noChange: 'Ни у кого доступ не изменится',
      applyOwn:
        'Применить и к подстраницам со своим доступом ({n}): их доступ станет «Как у родителя»',
      requests: 'Запросы доступа',
      request: 'просит {can, select, edit {право правки} other {доступ}} · {at}',
      approve: logisticsManager.pool.approve,
      deny: logisticsManager.pool.decline,
      save: `Сохранить · ${PAGES}`,
    },
  },
  /** Тосты команд (М:519–720, `call(…, ok)`). */
  toast: {
    spaceCreated: 'Пространство создано',
    created: 'Создано',
    published: 'Опубликована версия {v}',
    restored: 'Версия {v} восстановлена как новая',
    approved: 'Страница утверждена',
    archived: 'Перенесено в архив',
    unarchived: 'Восстановлено',
    moved: 'Страница перенесена',
    accessSaved: 'Доступ сохранён',
    requestSent: 'Запрос отправлен руководителю пространства',
    requestApproved: 'Запрос одобрен',
    requestDenied: 'Запрос отклонён',
    acked: 'Спасибо, отметили',
    memberAdded: 'Добавлен(а) в пространство',
    readerAdded: 'Добавлен(а) в пространство читателем',
    roleChanged: 'Роль изменена',
    memberRemoved: 'Убран(а) из пространства',
    ruleOn: 'Правило включено',
    ruleOff: 'Правило выключено',
    checked: 'Проверка выполнена',
    sectionCreated: 'Раздел создан',
  },
} as const satisfies TextTree;
