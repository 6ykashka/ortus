// W4.22 · «Формы и опросы» (`forms-list`, `forms-builder`, `forms-preview`, `modal-form-publish`): подписи страницы
// дословно по эталону design-2026-10-19 «Формы и опросы.dc.html» (dc — номер строки). Заголовок списка — пункт меню
// `shell.nav.items.forms`; общие слова — ссылки на файлы-владельцы. Только добавление; пишет владелец страницы.
import { calendar } from './calendar.ts';
import { company } from './company.ts';
import { knowledge } from './knowledge.ts';
import { logisticsDriver } from './logistics-driver.ts';
import { platform } from './platform.ts';
import { shell } from './shell.ts';
import { tasks } from './tasks.ts';
import type { TextTree } from './types.ts';

const QUESTIONS = '{n, plural, one {# вопрос} few {# вопроса} many {# вопросов} other {# вопроса}}';

export const forms = {
  /** Загрузка модуля dc:27. */
  loading: 'Загрузка форм…',
  /** Подложка закрытия меню dc:26. */
  closeMenus: 'Закрыть меню',

  /** Список форм dc:28–84, listVM dc:748–780. */
  list: {
    subtitle:
      'Анкеты, заявки, опросы, тесты и рабочие отчёты. Опубликованная версия неизменяема: каждый ответ привязан к своей версии.', // dc:30
    create: 'Создание формы', // dc:33
    blank: 'Создать пустую форму', // dc:752
    allTemplates: 'Все шаблоны · {n}', // dc:39
    tplSearch: 'Поиск по названию', // dc:42
    tplSearchAria: 'Поиск шаблона',
    tplNone: 'Шаблон не найден', // dc:47
    tplCats: {
      basic: 'Основные',
      survey: 'Опросы и оценка',
      people: calendar.kinds.member,
      quiz: 'Тесты',
      industry: 'Отраслевые',
    }, // TCAT dc:488
    moduleOff: 'Модуль «{name}» не подключён', // dc:752
    moduleOffMeta: 'модуль не подключён', // dc:751
    questions: QUESTIONS,
    pages: knowledge.card.pages,
    groups: 'Формы и группы', // dc:55
    groupNew: 'Создать группу',
    groupPlaceholder: 'Название группы, например «Опросы клиентов»', // dc:56
    groupAria: 'Название группы',
    groupCreate: tasks.newTask.create,
    cancel: shell.modal.cancel,
    groupShort: 'Название группы — от 2 символов', // dc:773
    groupTaken: 'Такая группа уже есть',
    groupCreated: 'Группа «{name}» создана. Переместите в неё формы через меню «…»',
    search: 'Поиск', // dc:58
    searchAria: 'Поиск формы',
    ownerAria: platform.tenants.fields.owner, // dc:59
    owners: { all: 'Все формы', mine: 'Мои формы' },
    statusAria: tasks.newTask.status, // dc:60
    statuses: {
      all: 'Все статусы',
      draft: 'Черновики',
      open: 'Принимают ответы',
      closed: 'Приём закрыт',
    },
    byGroup: 'По группам', // dc:61
    empty: {
      noneTitle: 'Форм пока нет', // dc:777
      noneText: 'Создайте первую форму с нуля или из шаблона выше.',
      title: 'Ничего не найдено',
      text: 'Измените поиск или фильтры.',
      reset: 'Сбросить фильтры',
    },
    deleteGroup: 'Удалить пустую группу', // dc:66
    noGroup: 'Без группы', // dc:760
    groupEmpty: 'В группе пока нет форм — переместите сюда форму через меню «…».', // dc:78
    rowMenu: 'Действия с формой «{name}»', // dc:73
    moveTitle: 'Переместить в группу', // dc:74
    menu: {
      open: shell.actions.open, // dc:761
      responses: 'Ответы · {n}',
      duplicate: 'Дублировать',
      move: 'Переместить в группу',
      close: 'Закрыть приём ответов',
      reopen: 'Возобновить приём ответов',
    },
    general: 'Общая', // modName dc:550
    group: 'группа «{name}»', // dc:762
    updated: 'изменена {date}',
    responses: '{n, plural, one {# ответ} few {# ответа} many {# ответов} other {# ответа}}',
    newName: 'Новая форма', // dc:626
    copyName: '{name} · копия', // dc:631
    clash: '{name} · {k}', // dc:561
    /** Отраслевые модули форм (INDUSTRY models.js:24–60): ключ контракта → имя. */
    modules: {
      fleet: shell.nav.groups.logistics,
      spa: shell.nav.items.spa,
      repairs: shell.nav.groups.repair,
    },
  },

  /** Чипы статуса строки dc:759 и шапки dc:785. */
  chips: {
    draft: knowledge.status.draft,
    closed: 'Приём закрыт · v{v}',
    changed: 'v{v} · есть изменения',
    open: 'Принимает ответы · v{v}',
    draftEditor: 'Черновик · не опубликована',
    changedEditor: 'Действует v{v} · есть неопубликованные изменения',
  },

  /** Тосты dc:628–641, 792, 798. */
  toasts: {
    created: 'Создан черновик «{name}»',
    copied: 'Создана копия «{name}»',
    closed: 'Приём ответов закрыт: «{name}»',
    reopened: 'Приём ответов возобновлён: «{name}»',
    renamed: 'Форма переименована',
    discarded: 'Изменения отменены: действует v{v}',
    published: 'Опубликована версия v{v} формы «{name}»',
    noResponses: 'Ответов пока нет',
  },

  /** Шапка редактора dc:85–106, editVM dc:782–811. */
  editor: {
    back: 'Все формы', // dc:89
    nameAria: 'Название формы', // dc:90
    area: 'область: {name}', // dc:794
    org: 'вся организация',
    owner: knowledge.page.metaOwner,
    saving: 'Сохраняем черновик…', // dc:795
    saved: 'Черновик сохранён',
    saveError: 'Черновик не сохранён: {error}',
    preview: 'Предпросмотр', // dc:95
    share: 'Поделиться', // dc:96
    more: 'Ещё действия с формой', // dc:97
    moreMenu: {
      duplicate: 'Дублировать форму', // dc:798
      discard: 'Отменить неопубликованные изменения',
      csv: 'Выгрузить ответы в CSV',
    },
    publish: 'Опубликовать', // dc:799
    publishV: knowledge.editor.publish,
    published: 'Опубликовано',
    readOnly: 'Только просмотр · нет права «Настраивать» формы', // dc:103
    tabsAria: 'Разделы формы', // dc:104
    tabs: {
      build: 'Конструктор', // dc:786
      settings: 'Настройки',
      actions: 'Действия после ответа',
      responses: 'Ответы',
      versions: knowledge.page.versions,
    },
  },

  /** «Конструктор» dc:143–286, builderVM dc:813–879. */
  builder: {
    outlineAria: 'Содержание формы', // dc:145
    outline: 'Содержание', // dc:146
    count: `{p} стр. · ${QUESTIONS}`, // dc:837
    addPage: 'Добавить страницу',
    toggle: 'Свернуть или развернуть страницу', // dc:148
    hidden: 'Скрытый', // dc:149
    issues: 'До публикации исправьте', // dc:153
    undoQuestion: 'Вопрос «{label}» удалён', // dc:599
    undoPage:
      '«{title}» удалена{n, plural, =0 {} one { вместе с # вопросом} few { вместе с # вопросами} many { вместе с # вопросами} other { вместе с # вопросами}}', // dc:605
    restore: knowledge.archive.restore, // dc:154
    hide: knowledge.error.hide,
    page: {
      titleAria: 'Название страницы', // dc:158
      of: 'Страница {i} из {n}', // dc:827
      title: 'Страница {n}', // dc:594
      shuffled: 'Вопросы перемешиваются', // dc:160
      up: 'Страницу выше',
      down: 'Страницу ниже',
      menu: knowledge.page.menuAria,
      shuffle: 'Перемешивать вопросы для каждого', // dc:828
      noShuffle: 'Не перемешивать вопросы',
      remove: 'Удалить страницу',
      empty: 'На странице пока нет вопросов.', // dc:278
    },
    noText: 'Вопрос без текста', // dc:824
    required: 'обязательный', // dc:818
    options: '{n, plural, one {# вариант} few {# варианта} many {# вариантов} other {# варианта}}',
    cond: 'если {text}',
    condPart: '«{label}» {op} {value}', // condText dc:812
    condAnd: 'и',
    condOr: 'или',
    /** Значения «Да / нет» в тексте условия (vals dc:844 — значения «да» / «нет»). */
    boolValues: { true: 'да', false: 'нет' },
    flags: { added: 'Новое', newType: 'Новый тип', changed: 'Изменено' }, // dc:819
    addQuestion: 'Добавить вопрос', // dc:279
    statementDefault: 'Текст для респондента', // dc:575
    pick: {
      title: 'Выберите вопрос', // dc:271
      close: 'Закрыть выбор вопроса',
      showAll: 'Показать все вопросы', // dc:835
      hideAll: 'Скрыть все вопросы',
    },
    /** Карточка вопроса dc:182–266, qeVM dc:839–879. */
    card: {
      typeAria: 'Тип вопроса', // dc:186
      unavailable: '{label} — недоступно', // dc:850
      up: 'Вопрос выше',
      down: 'Вопрос ниже',
      menu: 'Действия с вопросом',
      menuItems: {
        duplicate: 'Дублировать', // dc:853
        hide: 'Сделать скрытым',
        show: 'Показывать вопрос',
        remove: 'Удалить',
      },
      collapse: 'Свернуть вопрос', // dc:195
      noteType:
        'Смена типа создаёт новое поле: ответы прошлых версий сохранят значение «{type}» под старым идентификатором.', // dc:855
      noteText: 'Смена текста не меняет идентификатор: старые ответы и отчёты остаются связаны.',
      hiddenNote:
        'Скрытый вопрос не показывается. Значение — по умолчанию или из параметра ссылки ?{id}=…', // dc:856
      question: 'Вопрос', // dc:857
      text: 'Текст',
      placeholder: 'Введите текст вопроса',
      placeholderStatement: 'Текст, который увидит респондент',
      requiredLabel: 'Обязательный', // dc:203
      hintPlaceholder: 'Пояснение под вопросом', // dc:204
      hintAria: 'Пояснение',
      hintAdd: 'Добавить пояснение', // dc:859
      hintRemove: 'Убрать пояснение',
      defaultLabel: 'Значение по умолчанию', // dc:860
      defaultRemove: 'Убрать значение по умолчанию',
      answers: 'Ответы', // dc:209
      viewsAria: 'Вид вариантов', // dc:211
      views: { list: 'Списком', tiles: 'Плиткой', row: 'В один ряд' }, // dc:862
      option: 'Вариант {n}', // dc:215
      points: 'баллов', // dc:216
      pointsAria: 'Баллы за вариант {n}',
      optionId: 'Идентификатор варианта', // dc:217
      optionDelete: 'Удалить вариант {n}', // dc:218
      addOption: 'Добавить вариант', // dc:221
      other: 'Вариант «Другое» с вводом',
      scale: 'Шкала', // dc:225
      from: 'от',
      to: 'до',
      left: 'Подпись слева',
      right: 'Подпись справа',
      settings: 'Настройки', // dc:233
      length: 'Длина ответа, символов', // dc:867
      range: 'Допустимое значение',
      min: 'От',
      max: 'До',
      selectCount: 'Сколько вариантов выбрать', // dc:236
      minSel: 'Не меньше',
      maxSel: 'Не больше',
      order: 'Порядок вариантов', // dc:237
      orders: {
        asIs: 'Как в списке',
        alpha: 'По алфавиту',
        random: 'В случайном порядке для каждого',
      },
      withTime: 'Спрашивать время', // dc:238
      filesAria: 'Тип файлов', // dc:239
      accept: {
        photo: 'Только фото',
        docs: 'Документы: PDF, Word, Excel',
        any: 'Любые файлы',
      },
      maxFiles: 'не больше',
      files: 'файлов',
      maxFilesAria: 'Файлов не больше',
      mb: 'МБ',
      maxMbAria: 'Размер файла до, МБ',
      unitLevel: 'Что можно выбрать', // dc:240
      unitLevels: { any: 'Регион или фирму', region: 'Только регион', firm: 'Только фирму' },
      refKind: 'Объект CRM', // dc:241
      refKinds: {
        vehicle: logisticsDriver.today.steps.vehicle,
        trip: logisticsDriver.today.steps.trip,
        object: 'Объект ремонта',
        task: tasks.board.quickButton,
      },
      crmNote:
        'Список берётся из CRM и доступен только сотрудникам после входа. В публичной форме такой вопрос запрещён.', // dc:873
      id: 'Идентификатор вопроса', // dc:243
      idLocked: 'Идентификатор нельзя изменить: вопрос есть в опубликованной версии.', // dc:874
      idNote: 'Используется в выгрузке, действиях после ответа и параметре ссылки.',
      idBad: 'Латиница, цифры, «_» и «-», с буквы, от 2 символов', // dc:611
      idTaken: 'Такой идентификатор уже есть',
      cond: 'Условие показа', // dc:247
      condAdd: 'Показывать при условии', // dc:249
      condHint: 'Условие может зависеть только от вопросов выше.', // dc:875
      condNone: 'Выше нет вопросов, от которых может зависеть показ.',
      condModeAria: 'Как сочетать условия', // dc:251
      condModes: { all: 'Все условия выполнены (И)', any: 'Любое из условий (ИЛИ)' },
      condField: 'Вопрос условия', // dc:254
      condOp: 'Сравнение', // dc:255
      ops: { equals: 'равно', notEquals: 'не равно' },
      condValue: 'Значение', // dc:256
      valuePlaceholder: 'значение', // dc:257
      condDelete: 'Удалить условие', // dc:258
      condMore: 'Добавить условие', // dc:261
      bool: { yes: 'Да', no: knowledge.people.cells.none }, // dc:844
      copy: '{label} (копия)', // dc:595
    },
  },

  /** Типы вопросов TYPES dc:474–482. */
  types: {
    text: 'Короткий текст',
    longtext: 'Длинный текст',
    number: 'Число',
    money: logisticsDriver.expenses.amount,
    email: 'Почта',
    phone: 'Телефон',
    inn: 'ИНН',
    url: 'Ссылка',
    choice: 'Один вариант',
    multi: 'Несколько вариантов',
    select: 'Выпадающий список',
    bool: 'Да / нет',
    person: company.users.check.member,
    unit: 'Регион или фирма',
    ref: 'Объект CRM',
    date: logisticsDriver.expenses.date,
    int: 'Целое число',
    scale: 'Оценка по шкале',
    rating: 'Оценка звёздами',
    photo: 'Файл или фото',
    statement: 'Текст без вопроса',
    series: 'Серия вопросов',
    payment: platform.tenants.fields.payment,
  },
  typeWhy: {
    series: 'Повторяемая группа вопросов — раннее расширение (FORM-06)',
    payment: 'Форма не принимает деньги: оплату проводит касса (FORM-05)',
  },
  /** TGROUPS dc:483. */
  typeGroups: { text: 'Текст и числа', choice: 'Выбор', crm: 'Данные CRM', other: 'Другие' },

  /** «До публикации исправьте» — issues() dc:721–738. */
  issues: {
    noQuestions: 'В форме нет ни одного вопроса',
    questionN: 'Вопрос {n}',
    noText: '{name}: нет текста',
    noOptions: '{name}: нет вариантов ответа',
    emptyOption: '{name}: есть пустой вариант',
    duplicateId: 'Идентификатор {id} повторяется',
    condDeleted: '{name}: условие ссылается на удалённый вопрос',
    condBelow:
      '{name}: условие ссылается на вопрос ниже — условие может зависеть только от вопросов выше',
    hiddenRequired: '{name}: скрытый обязательный вопрос без значения по умолчанию',
    range: '{name}: «от» больше «до»',
    publicCrm: '«{label}»: публичная форма не может спрашивать данные CRM',
    noScores: 'Включён подсчёт баллов, но ни у одного варианта нет баллов',
  },

  /** «Предпросмотр» dc:107–142, previewVM dc:1021–1059, pvCheck dc:688–705. */
  preview: {
    devicesAria: 'Устройство', // dc:110
    devices: { phone: 'Телефон', desktop: 'Компьютер' }, // dc:1051
    note: 'Предпросмотр черновика. Ответ не сохраняется.', // dc:111
    restart: 'Заново', // dc:112
    close: 'Закрыть предпросмотр',
    org: 'Организация', // dc:1024
    progress: 'Страница {i} из {n}', // dc:1054
    placeholders: {
      email: 'name@example.ru',
      phone: '+7 900 000-00-00',
      inn: '10 или 12 цифр',
      url: 'https://',
      money: '0 ₽',
    }, // PH dc:1029
    other: 'Другое — свой вариант', // dc:129
    otherAria: 'Свой вариант',
    choose: 'Выберите', // dc:130
    star: '{k} из 5', // dc:1043
    attach: 'Демо: прикрепить файл', // dc:132
    filesNone: 'Файлы не выбраны · до {max} шт., до {mb} МБ', // dc:1045
    files: '{n, plural, one {# файл} few {# файла} many {# файлов} other {# файла}} из {max}',
    empty: 'В форме нет вопросов для показа.', // dc:137
    back: 'Назад', // dc:138
    next: 'Далее',
    submit: 'Отправить',
    thanks: 'Спасибо! Ответ отправлен.', // dc:1055
    kbLink: 'Ответ появится на странице «{title}» в Базе знаний', // dc:906
    score:
      'Результат: {got} из {max} {max, plural, one {балла} few {баллов} many {баллов} other {баллов}}', // dc:1055
    scorePassed:
      'Результат: {got} из {max} {max, plural, one {балла} few {баллов} many {баллов} other {баллов}} · тест пройден',
    scoreFailed:
      'Результат: {got} из {max} {max, plural, one {балла} few {баллов} many {баллов} other {баллов}} · нужно {p} для зачёта',
    again: 'Пройти ещё раз', // dc:118
    errors: {
      required: 'Обязательный вопрос', // dc:690
      email: 'Проверьте адрес почты',
      phone: 'Нужно не меньше 10 цифр',
      inn: 'ИНН — 10 или 12 цифр',
      url: 'Ссылка начинается с http:// или https://',
      number: 'Нужно число',
      int: 'Нужно целое число',
      min: 'Не меньше {n}',
      max: 'Не больше {n}',
      minLength: 'Не короче {n} символов',
      maxLength: 'Не длиннее {n} символов',
      minSelected: 'Выберите не меньше {n}',
      maxSelected: 'Выберите не больше {n}',
    },
  },

  /** Диалог «Опубликовать» dc:457–466, modalVM dc:1063–1080. */
  publish: {
    bad: 'Сначала исправьте форму',
    badText: 'Найдено ошибок: {n}. Исправьте их в конструкторе.',
    title: 'Опубликовать «{name}» v{v}?',
    text: 'Будет создана новая неизменяемая версия. Новые ответы пойдут по v{v}.',
    first: 'Форма начнёт принимать ответы. Кто может ответить: {who}.', // dc:1069
    who: { members: 'сотрудники организации', public: 'все, у кого есть ссылка' }, // AC dc:1068
    kept: '{n, plural, one {# ответ остаётся привязан} few {# ответа остаются привязаны} many {# ответов остаются привязаны} other {# ответа остаются привязаны}} к своим версиям и показываются по их структуре',
    newRequired: 'Новые обязательные вопросы {names} не требуются от уже отправленных ответов',
    typeChanged: 'Смена типа создаст новые поля: {names}. Старые значения не переписываются',
    removed: 'Убраны вопросы {names}: их ответы остаются в прошлых версиях',
    kb: 'База знаний: {names} — вопрос удалён или сменил тип, поле останется пустым. Обновите действие после публикации',
    rules: 'Действия после ответа продолжают работать по своей версии правила', // dc:1076
    confirm: knowledge.editor.publish,
    toBuilder: 'Перейти к конструктору',
    cancel: shell.modal.cancel,
  },
} as const satisfies TextTree;
