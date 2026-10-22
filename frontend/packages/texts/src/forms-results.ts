// W4.23 · «Формы и опросы»: ответы, настройки доступа, действия после ответа (`formsResults`): подписи вкладок
// «Настройки», «Действия после ответа», «Ответы», «Версии» и диалога «Поделиться формой» дословно по эталону
// design-2026-10-19 «Формы и опросы.dc.html» (dc — номер строки). Шапка редактора, типы вопросов и слова конструктора —
// домен `forms` (W4.22): здесь ссылки на него. Справочник FORM_VARS — `ortus/models.js:107`. Только добавление; пишет
// владелец страницы.
import { company } from './company.ts';
import { forms } from './forms.ts';
import { knowledge } from './knowledge.ts';
import { logisticsDriver } from './logistics-driver.ts';
import { logisticsManager } from './logistics-manager.ts';
import { platform } from './platform.ts';
import { shell } from './shell.ts';
import { tasks } from './tasks.ts';
import type { TextTree } from './types.ts';

const ANSWERS = forms.list.responses;

export const formsResults = {
  /** «Настройки» dc:287–323, settingsVM dc:880–898. */
  settings: {
    access: {
      title: 'Кто может ответить',
      aria: 'Доступ к форме',
      members: {
        label: 'Сотрудники организации',
        desc: 'Вход обязателен. Ответить могут сотрудники с правом «Формы» в области формы.',
      },
      public: {
        label: 'Все, у кого есть ссылка',
        desc: 'Без входа: гость только отправляет ответ, сводка и чужие ответы ему недоступны. Нужно право «Публичные ссылки».',
      },
      invite: {
        label: 'По персональному приглашению',
        desc: 'У каждого приглашённого своя ссылка со сроком действия.',
      },
      crm: 'Недоступно: в форме есть вопросы с данными CRM — {list}.',
    },
    area: {
      label: 'Область формы',
      whole: company.dialogs.assign.types.tenant,
      region: tasks.wizard.region,
      firm: tasks.wizard.firm,
      note: 'Форму и ответы видят роли с правами «Формы» в этой области.',
      toast: 'Область формы изменена',
    },
    intake: {
      title: 'Приём ответов',
      until: 'Принимать до',
      limit: 'Не больше ответов всего',
      limitPh: 'без ограничения',
      one: 'Один ответ от сотрудника',
      allowEdit: 'Разрешить исправить ответ до проверки — появится ревизия',
      thanks: 'Текст после отправки',
      retain: 'Хранить ответы',
      d90: '90 дней',
      d365: '1 год',
      d1095: '3 года',
    },
    quiz: {
      title: 'Тест с баллами',
      on: 'Считать баллы за варианты ответа',
      max: 'Максимум по форме: {n, plural, one {# балл} few {# балла} many {# баллов} other {# балла}}',
      pass: 'Проходной балл',
      passPh: 'не задан',
      show: 'Показывать результат после отправки',
      note: 'Баллы задаются у вариантов в конструкторе.',
    },
    look: {
      title: 'Вид формы',
      logo: 'Логотип и название организации',
      progress: 'Прогресс по страницам',
      back: 'Кнопка «Назад» между страницами',
      note: 'Цвет кнопок и логотип берутся из «Оформления» организации.',
    },
  },
  /** «Действия после ответа» dc:324–410, actionsVM dc:915–984. */
  actions: {
    intro:
      'Действие выполняется один раз для каждого ответа. Ответ формы — заявление человека: деньги, склад и объёмы меняют только команды своих модулей.',
    kinds: {
      task: 'Создать задачу',
      notify: 'Уведомить сотрудника',
      email: 'Письмо на почту',
      http: 'HTTP-запрос',
      kb: 'Сохранить в Базу знаний',
    },
    /** Текст карточки dc:922–923. */
    text: {
      task: 'Задача «{title}» → {who}',
      noAssignee: 'без исполнителя',
      notify: 'Уведомление в CRM → {who}',
      email: 'Письмо → {to}',
      http: 'POST {url}',
      kbTable: 'Строка в таблицу «{table}» · страница «{page}»',
      kbEntry: 'Запись на страницу «{page}»',
      unavailable: 'недоступна вам',
    },
    when: {
      submitted: 'после отправки ответа',
      accepted: 'после принятия ответа',
    },
    /** Мета карточки dc:969 (части через « · »). */
    meta: {
      cond: 'если «{label}» = {value}',
      version: 'правило v{n}',
      written: 'записано ответов: {n}',
    },
    card: {
      on: 'Включено',
      open: 'Открыть страницу',
      backfill: 'Перенести прошлые ответы · {n}',
      edit: company.dialogs.quota.confirm,
      del: 'Удалить действие',
      fail: 'Не выполнено для {n, plural, one {# ответа} few {# ответов} many {# ответов} other {# ответа}} — повторите из ленты ответов',
    },
    empty: 'Действий пока нет.',
    yes: forms.builder.boolValues.true,
    no: forms.builder.boolValues.false,
    /** Редактор dc:340–351, dc:977–983. */
    editor: {
      titleNew: 'Новое действие: {kind}',
      titleEdit: 'Изменить: {kind}',
      when: logisticsManager.pool.incoming.when,
      whenSubmitted: 'После отправки ответа',
      whenAccepted: 'После принятия ответа',
      only: 'Только если',
      all: 'Для всех ответов',
      eq: forms.builder.card.ops.equals,
      taskTitle: 'Название задачи',
      taskDefault: 'Проверить ответ: {form}',
      assignee: tasks.newTask.assignee,
      taskNote: 'В описание задачи попадут ответы и ссылка на ответ.',
      to: 'Кому',
      address: 'Адрес',
      emailPh: 'office@example.ru',
      url: 'Адрес запроса (POST, JSON с ответами)',
      urlPh: 'https://',
      publicKb:
        'Публичная форма: в Базу знаний попадают только принятые ответы, чтобы туда не попал спам.',
      save: 'Сохранить',
      saving: shell.modal.saving,
      cancel: shell.modal.cancel,
    },
    /** «Сохранить в Базу знаний» dc:352–400, kbVM dc:931–963. */
    kb: {
      page: 'Страница Базы знаний',
      pick: 'Выберите страницу',
      pageOpt: '{space} · {page}',
      /** Страница со своим доступом (dc:941: `p.access === 'owner'`). */
      pageOptOwner: '{space} · {page} · только владелец',
      /** Значение вопроса-фото в строке и записи (formVal `models.js:113`): файлы не копируются. */
      filesIn: '{value} · файлы в ответе {id}',
      newPage: '＋ Новая страница',
      newPageNoRight: '＋ Новая страница · нужно право «Создавать» в Базе знаний',
      modesAria: 'Как сохранять ответ',
      modeTable: 'Строкой в таблицу',
      modeEntry: 'Записью на страницу',
      noPage:
        'Выберите страницу или создайте новую — пункт «Новая страница» в конце списка. Ответы сохраняются в отдельный блок под её текстом и не создают новых версий страницы.',
      section: 'Раздел',
      pageTitle: forms.builder.page.titleAria,
      pageTitleDefault: 'Ответы: {form}',
      who: 'Кто видит страницу',
      all: 'Все сотрудники',
      owner: 'Только владелец',
      ownerWhy: 'Страницу «Только владелец» может создать только владелец',
      npNote:
        'Страница появится при сохранении действия с текстом-пояснением о форме. Дописать текст можно потом в «Базе знаний»: ответы формы идут отдельным блоком под ним.',
      accessOwnerNew: 'Страницу и записи увидит только владелец.',
      accessOwner: 'Записи увидит только владелец; автор правила тоже должен быть владельцем.',
      accessAll: 'Записи увидят все сотрудники с доступом к Базе знаний.',
      table: 'Таблица на странице',
      tableOpt: '{title} · строк: {n}',
      newTable: 'Новая таблица по вопросам формы',
      newTableTitle: 'Название новой таблицы',
      newTableDefault: 'Ответы формы',
      head: 'Заголовок записи',
      mapEntry: 'Что записать',
      mapNew: 'Столбцы новой таблицы',
      mapFixed: 'Столбцы таблицы и данные для них',
      fieldAria: 'Название поля',
      srcAria: 'Данные для поля «{name}»',
      none: 'Не заполнять',
      missing: 'Нет в форме: {src}',
      delField: 'Убрать поле «{name}»',
      addCol: 'Добавить столбец',
      addField: 'Добавить поле',
      colN: 'Столбец {n}',
      fieldN: 'Поле {n}',
      warn: '{list}: вопроса нет в текущей версии формы, поле останется пустым. Выберите другой источник.',
      pos: 'Новые {noun}',
      posAria: 'Куда добавлять',
      rows: 'строки',
      entries: 'записи',
      top: 'В начало',
      bottom: 'В конец',
      pvFrom: 'Так будет выглядеть {kind} для ответа {id} от {at}',
      pvRow: 'строка',
      pvEntry: 'запись',
      pvNone: 'Ответов пока нет — вместо значений показаны названия полей',
      showLink: 'Показать ссылку на страницу после отправки',
      linkNote: 'Ссылка на экране «Спасибо» видна только тем, у кого есть доступ к странице.',
      linkPublic: 'Публичная форма: гость не сотрудник, ссылку на Базу знаний не показываем.',
      ack: 'Понимаю: записи увидят все сотрудники с доступом к Базе знаний, в том числе те, кому ответы формы недоступны.',
      note: 'Файлы не копируются: в ячейке — ссылка на ответ, файл откроется с проверкой доступа. Строки удаляются вместе с ответом по сроку хранения формы ({period}). Править их на странице нельзя: исправление — через ответ.',
      /** Столбцы по умолчанию kbDefault dc:901. */
      col: {
        at: logisticsDriver.expenses.date,
        author: 'Автор',
        object: company.users.check.objectField,
        id: 'Ответ',
      },
    },
    /** Ошибки saveRule dc:645–678. */
    errors: {
      pickPage: 'Выберите страницу Базы знаний',
      pickSection: 'Выберите раздел для новой страницы',
      pageShort: 'Название страницы — не короче 3 символов',
      pageTaken:
        'В этом разделе уже есть страница «{title}» — выберите её в списке или измените название',
      pickTable: 'Выберите таблицу',
      tableTitle: 'Укажите название новой таблицы',
      noColumn: 'Укажите данные хотя бы для одного столбца',
      noEntry: 'Выберите, что записать',
      noName: 'У поля нет названия',
      dupNames: 'Названия полей повторяются',
      confirm: 'Подтвердите, что записи увидят все сотрудники с доступом к странице',
      taskTitle: 'Укажите название задачи',
      email: 'Укажите адрес почты',
      http: 'Адрес запроса должен начинаться с https://',
      notify: 'Выберите, кого уведомить',
      pageOnly: 'Страница создана, но действие не сохранено: {err}',
    },
    /** Тосты dc:651–671, dc:905, dc:970–974. */
    toast: {
      added: 'Действие добавлено',
      updated: 'Действие обновлено · правило v{n}',
      on: 'Действие включено',
      off: 'Действие выключено',
      deleted: 'Действие удалено',
      deletedKb: 'Действие удалено. Уже записанные строки остаются в Базе знаний',
      page: 'Страница «{page}» создана. Действие добавлено',
      pageTable: 'Страница «{page}» создана с таблицей «{table}». Действие добавлено',
      table: 'Таблица «{table}» создана на странице «{page}». Действие добавлено',
      backfilled: 'Перенесено в Базу знаний: ' + ANSWERS,
      backfillPart: '. Не удалось: {n} — {err}',
      backfillFail: 'Не удалось: {err}',
      nothing: 'Новых ответов для переноса нет',
      openKb: 'Страница «{title}» открывается в разделе «База знаний» CRM',
    },
  },
  /** Служебные данные ответа FORM_VARS (`models.js:107`). */
  vars: {
    at: 'Дата и время ответа',
    author: 'Автор ответа',
    object: forms.types.ref,
    id: 'Номер ответа',
    form: forms.editor.nameAria,
    ver: 'Версия формы',
  },
  /** «Ответы» dc:411–439, respVM dc:986–1011, actsVM dc:907–914. */
  responses: {
    viewsAria: 'Вид ответов',
    views: {
      stats: 'Сводка',
      feed: 'Лента',
      table: knowledge.kinds.table,
    },
    count: ANSWERS,
    csv: 'Выгрузить CSV',
    empty: {
      closed: 'Ответов нет, приём закрыт.',
      open: 'Ответов пока нет. Отправьте ссылку из «Поделиться».',
      draft: 'Ответов нет: форма ещё не опубликована.',
      cell: '—',
    },
    stats: {
      answered: '{type} · ответили {n} из {total}',
      bar: '{n} · {pct}',
      num: 'Среднее {avg} · мин {min} · макс {max}',
      noNum: 'Нет числовых ответов',
      noTexts: 'Пока без ответов',
    },
    feed: {
      row: '{id} · {object}',
      by: '{author} · {at}',
      version: 'v{v}',
      note: '{author} · {at} · показан по структуре версии v{v}',
      acting: '(действует v{v})',
      notShown: 'Не показывался по условию',
      noAnswer: 'Не ответил',
    },
    status: {
      accepted: 'Принят',
    },
    journal: {
      title: platform.tenants.audit,
      ok: '{text} · {at} · правило v{n}',
      kbFail: 'Не сохранено в Базу знаний: {err} · {at}',
      open: 'Открыть страницу',
      retry: logisticsDriver.inspection.retry,
      none: 'Для этого ответа действия не выполнялись',
      idem: 'Повторная обработка не создаёт вторую задачу или строку.',
      retried: 'Ответ {id} сохранён в Базу знаний',
    },
    cols: {
      id: 'Ответ',
      at: logisticsDriver.expenses.date,
      author: 'Автор',
      object: company.users.check.objectField,
      version: 'Версия',
    },
  },
  /** «Версии» dc:440–454, versVM dc:1012–1020, condText dc:812. */
  versions: {
    none: 'Форма ещё не публиковалась',
    item: 'Версия {n}',
    current: company.modules.trial.chipActive,
    meta: '{at} · {by} · вопросов: {n}',
    title: 'Структура версии {n} · неизменяема',
    id: 'ID {id} · {type}',
    required: forms.builder.required,
    cond: forms.builder.cond,
    eq: '«{label}» = {value}',
    ne: '«{label}» ≠ {value}',
    and: forms.builder.condAnd,
    or: forms.builder.condOr,
    added: 'Добавлено',
    newType: forms.builder.flags.newType,
    textChanged: 'Текст изменён',
    changed: forms.builder.flags.changed,
    removed: 'Убрано относительно предыдущей версии: {list}',
  },
  /** «Поделиться формой» modalVM dc:1081–1087. */
  share: {
    title: 'Поделиться формой',
    draft: 'Ссылка появится после публикации: сейчас форма — черновик.',
    published: 'Доступ настраивается во вкладке «Настройки».',
    public: 'Публичная ссылка',
    publicNote: 'Без входа; гость может только отправить ответ.',
    embed: 'Код для сайта',
    embedNote: 'Вставьте в HTML страницы — форма откроется внутри сайта.',
    internal: 'Ссылка для сотрудников',
    internalNote:
      'Откроется после входа. Ответить могут сотрудники с правом «Формы» в области формы.',
    copy: 'Копировать',
    copied: 'Скопировано',
    closed: 'Приём ответов закрыт: по ссылке откроется сообщение о закрытии.',
    close: shell.modal.close,
  },
} as const satisfies TextTree;
