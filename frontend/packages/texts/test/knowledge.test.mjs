// W4.32 · Домен «База знаний» (`knowledge`, KB-01…KB-08): подписи и шаблоны страницы дословно по эталону
// design-2026-10-19 «База знаний.dc.html» (М) и `ortus/knowledge.js` (справочники). Статические строки сверяет
// domains.test.mjs (источники эталона — с «Базой знаний»), здесь — ключи страницы и шаблоны конкатенаций М.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { format, knowledge, shell } from '../src/index.ts';

const K = knowledge;

describe('knowledge: список пространств М:29–59', () => {
  it('заголовок — пункт меню, подзаголовок, поиск, подсказка', () => {
    assert.equal(shell.nav.items.knowledge, 'База знаний');
    assert.equal(K.list.subtitle, 'Пространства и страницы, доступные вам по ролям');
    assert.equal(K.list.newSpace, 'Новое пространство');
    assert.equal(K.list.searchAria, 'Поиск по базе знаний');
    assert.equal(K.list.searchPlaceholder, 'Поиск по доступным страницам');
    assert.equal(K.list.noResults, 'Среди доступных вам страниц ничего не нашлось');
    assert.equal(
      K.list.hint,
      'Пространство — область в «Пользователях и ролях». Доступ дают роли с областью организации, региона, фирмы или самого пространства. Подстраница получает доступ родителя и может только сузить круг читателей.',
    );
  });

  const cases = [
    [':451', K.card.pages, { n: 16 }, '16 страниц'],
    [':451', K.card.pages, { n: 1 }, '1 страница'],
    [':451', K.card.pages, { n: 3 }, '3 страницы'],
    [':451', K.card.lead, { names: 'Марина Котова' }, 'Руководитель: Марина Котова'],
    [':452', K.card.role, { role: 'владелец бизнеса' }, 'Вы: владелец бизнеса'],
    [':452', K.card.requests, { n: 2 }, 'Запросы доступа: 2'],
    [
      ':452',
      K.card.updated,
      { title: 'Регламент приёмки смены', date: '24.09.2026' },
      'Обновлено: «Регламент приёмки смены», 24.09.2026',
    ],
  ];
  for (const [src, msg, values, expected] of cases) {
    it(`${src} → ${expected}`, () => assert.equal(format(msg, values), expected));
  }
  it('руководитель по умолчанию и роль по ссылке', () => {
    assert.equal(K.card.leadOwner, 'владелец бизнеса');
    assert.equal(K.card.roleLink, 'по ссылке на страницу');
  });
});

describe('knowledge: пространство и «Страницы» М:61–197', () => {
  it('шапка и вкладки', () => {
    assert.equal(K.space.back, 'К списку пространств');
    assert.equal(
      format(K.space.role, { role: 'Владелец бизнеса' }),
      'База знаний · Владелец бизнеса',
    );
    assert.equal(K.space.roleBranch, 'доступ к ветке');
    assert.equal(K.space.tabsAria, 'Разделы пространства');
    assert.deepEqual(
      [K.space.tabs.pages, K.space.tabs.people, K.space.tabs.auto, K.space.tabs.arch],
      ['Страницы', 'Участники и доступ', 'Автоматизация', 'Архив'],
    );
    assert.equal(
      format(K.space.level, { label: 'Ограниченное', area: 'фирма «Север Логистик»' }),
      'Ограниченное · фирма «Север Логистик»',
    );
  });

  it('дерево', () => {
    assert.equal(K.tree.aria, 'Дерево пространства');
    assert.equal(K.tree.search, 'Найти в пространстве');
    assert.equal(K.tree.create, 'Создать страницу');
    assert.equal(K.tree.createTitle, 'Создать');
    assert.equal(K.tree.expand, 'Развернуть');
    assert.equal(K.tree.collapse, 'Свернуть');
    assert.equal(K.tree.finance, 'Финансовая страница');
    assert.equal(K.tree.own, 'Свой доступ');
    assert.equal(K.tree.empty, 'Ничего не нашлось среди доступных страниц');
    assert.equal(
      K.tree.hint,
      'Значок замка — у страницы свой доступ. Подстраницы получают доступ родителя. Перенос — «⋯ → Переместить»: Ортус покажет, кто потеряет доступ.',
    );
  });

  it('панель страницы и меню', () => {
    assert.equal(K.page.tree, 'Дерево');
    assert.equal(K.page.pathAria, 'Путь');
    assert.equal(K.page.access, 'Доступ');
    assert.equal(K.page.edit, 'Править');
    assert.equal(K.page.request, 'Запросить право правки');
    assert.equal(K.page.requested, 'Запрос отправлен');
    assert.equal(K.page.menuAria, 'Действия со страницей');
    assert.deepEqual(K.page.menu, {
      child: 'Новая подстраница',
      move: 'Переместить…',
      approve: 'Утвердить',
      archive: 'В архив',
    });
  });

  const view = [
    [
      ':544',
      K.page.oldVersion,
      { v: 1, date: '05.09.2026', cur: 2 },
      'Вы смотрите версию 1 от 05.09.2026. Текущая — v2.',
    ],
    [':542', K.page.status, { label: 'Действует', v: 1 }, 'Действует · v1'],
    [':543', K.page.metaOwner, { name: 'Дарья Зимина' }, 'владелец Дарья Зимина'],
    [
      ':543',
      K.page.metaUpdated,
      { date: '20.09.2026', by: 'Дарья Зимина' },
      'обновлено 20.09.2026, Дарья Зимина',
    ],
    [':543', K.page.metaReview, { date: '24.03.2027' }, 'пересмотреть до 24.03.2027'],
    [':547', K.page.fileMeta, { size: '1,2 МБ', pages: 4 }, 'PDF · 1,2 МБ · 4 страницы'],
    [':532', K.page.tableRows, { n: 0 }, 'Строк: 0'],
    [
      ':527',
      K.page.ackTitle,
      { v: 2, audience: 'роль «Водитель»' },
      'Ознакомление с версией 2 · роль «Водитель»',
    ],
    [
      ':528',
      K.page.ackLine,
      { done: 1, total: 1, wait: false, names: '', more: false, n: 0 },
      '1 из 1 ознакомились',
    ],
    [
      ':528',
      K.page.ackLine,
      { done: 0, total: 1, wait: true, names: 'Илья Васильев', more: false, n: 0 },
      '0 из 1 ознакомились. Ждём: Илья Васильев',
    ],
    [
      ':528',
      K.page.ackLine,
      { done: 0, total: 7, wait: true, names: 'А, Б, В, Г, Д', more: true, n: 2 },
      '0 из 7 ознакомились. Ждём: А, Б, В, Г, Д и ещё 2',
    ],
    [':512', K.page.accessOwn, { mode: 'только выбранные' }, 'Свой доступ: только выбранные.'],
    [
      ':512',
      K.page.accessAs,
      { title: 'Водителям', mode: 'только выбранные' },
      'Как у «Водителям»: только выбранные.',
    ],
    [
      ':512',
      K.page.accessSpace,
      { d: 'все в области читают, пишут участники' },
      'Как у пространства: все в области читают, пишут участники.',
    ],
    [':549', K.page.versionTag, { v: 3 }, 'v3'],
    [
      ':549',
      K.page.versionLine,
      { date: '20.09.2026', by: 'Дарья Зимина' },
      '20.09.2026 · Дарья Зимина',
    ],
  ];
  for (const [src, msg, values, expected] of view) {
    it(`${src} → ${expected}`, () => assert.equal(format(msg, values), expected));
  }

  it('блоки страницы', () => {
    assert.equal(K.page.toCurrent, 'К текущей версии');
    assert.equal(K.page.restore, 'Восстановить как новую');
    assert.equal(K.page.fileNote, 'В прототипе файл не хранится: здесь будет предпросмотр PDF.');
    assert.equal(K.page.linkNote, 'Запись CRM: открывается, если у вас есть доступ к ней');
    assert.equal(
      K.page.tableForm,
      'Строки добавляет форма после принятия ответа; исправления — через ответ формы.',
    );
    assert.equal(K.page.tableEmpty, 'Таблица пока пустая');
    assert.deepEqual(K.page.emptyCols, { at: 'Дата', what: 'Что', who: 'Кто' });
    assert.equal(K.page.ackAsk, 'Подтвердите, что прочитали эту версию.');
    assert.equal(K.page.ack, 'Ознакомлен');
    assert.equal(K.page.ackDone, 'Вы подтвердили, что ознакомились с этой версией');
    assert.equal(K.page.kids, 'Подстраницы');
    assert.equal(K.page.kidsNote, '· видны только доступные вам');
    assert.equal(K.page.aside, 'О странице');
    assert.equal(K.page.canEdit, 'Вы можете читать и править.');
    assert.equal(K.page.canRead, 'Вы можете читать.');
    assert.equal(K.page.setup, 'Настроить доступ');
    assert.equal(K.page.why, 'Кто видит и почему');
    assert.equal(K.page.versions, 'Версии');
  });

  it('редактор', () => {
    assert.equal(K.editor.steps, 'Шаги схемы — по одному в строке');
    assert.equal(K.editor.body, 'Текст · абзацы через пустую строку');
    assert.equal(
      format(K.editor.ack, { audience: 'все, кто видит страницу' }),
      'Попросить ознакомиться с новой версией: все, кто видит страницу',
    );
    assert.equal(format(K.editor.publish, { v: 3 }), 'Опубликовать v3');
    assert.equal(
      format(K.editor.base, { v: 2 }),
      'Основа — v2. Если страницу изменят раньше, Ортус покажет конфликт.',
    );
  });

  it('справочники knowledge.js: виды, статусы, уровни, режимы', () => {
    assert.deepEqual(K.kinds, {
      page: 'Страница',
      folder: 'Папка',
      table: 'Таблица',
      diagram: 'Схема',
      file: 'Файл',
      link: 'Запись CRM',
    });
    assert.deepEqual(K.status, {
      active: 'Действует',
      draft: 'Черновик',
      review: 'На проверке',
      outdated: 'Пора пересмотреть',
    });
    assert.deepEqual(K.levels.open, { label: 'Открытое', d: 'Роли области действуют полностью' });
    assert.deepEqual(K.levels.limited, {
      label: 'Ограниченное',
      d: 'Все в области читают, пишут участники',
    });
    assert.deepEqual(K.levels.closed, {
      label: 'Закрытое',
      d: 'Только участники и владелец бизнеса',
    });
    assert.deepEqual(K.modes.inherit, {
      label: 'Как у родителя',
      d: 'Читают и правят те же, кто у родителя',
    });
    assert.deepEqual(K.modes.editListed, {
      label: 'Читают все, правят выбранные',
      d: 'Чтение как у родителя, правка — по списку',
    });
    assert.deepEqual(K.modes.listed, {
      label: 'Только выбранные',
      d: 'Читают и правят только те, кто в списке',
    });
  });
});

describe('knowledge: «Участники и доступ», «Автоматизация», «Архив» М:199–290', () => {
  it('участники и карта', () => {
    assert.equal(
      format(K.people.intro, {
        space: 'Логистика',
        level: 'все в области читают, пишут участники',
      }),
      'Роли пространства — назначения из «Пользователей и ролей» с областью «Логистика». Остальные получают доступ по уровню пространства: все в области читают, пишут участники.',
    );
    assert.equal(K.people.assigned, 'назначение в пространстве');
    assert.equal(
      format(K.people.invited, { src: K.people.assigned }),
      'приглашение не принято · назначение в пространстве',
    );
    assert.equal(K.people.roleAria, 'Роль в пространстве');
    assert.equal(K.people.remove, 'Убрать');
    assert.equal(K.people.nobody, 'Никого');
    assert.equal(format(K.people.page, { title: 'Маршруты' }), 'Страница «Маршруты»');
    assert.equal(
      format(K.people.pageUntil, { title: 'Маршруты', date: '31.10.2026' }),
      'Страница «Маршруты» до 31.10.2026',
    );
    assert.equal(K.people.add, 'Добавить в пространство');
    assert.equal(K.people.map, 'Карта доступа');
    assert.equal(
      K.people.mapNote,
      'Страницы × сотрудники. Нажмите на ячейку, чтобы увидеть причину. Владелец бизнеса видит всё.',
    );
    assert.deepEqual(K.people.cells, {
      edit: 'Правит',
      view: 'Читает',
      none: 'Нет',
      function: 'Функция',
    });
    assert.equal(K.people.whyAria, 'Почему так');
    assert.equal(K.people.check, 'Проверить сотрудника');
    assert.equal(K.people.pickCell, 'Выберите ячейку карты');
  });

  it('автоматизация', () => {
    assert.equal(K.auto.rules, 'Правила пространства');
    assert.equal(K.auto.switchAria, 'Правило включено');
    assert.equal(K.auto.checkNow, 'Проверить сроки сейчас');
    assert.equal(K.auto.createSection, 'Создать раздел');
    assert.equal(K.auto.openSection, 'Открыть раздел');
    assert.equal(K.auto.runs, 'Журнал запусков');
    assert.equal(K.auto.noRuns, 'Запусков пока нет');
    assert.equal(
      format(K.auto.objectForeman, { stage: 'Черновая отделка', name: 'Алексей Соколов' }),
      'Черновая отделка · прораб Алексей Соколов',
    );
    assert.equal(
      format(K.auto.objectNoForeman, { stage: 'Подготовка' }),
      'Подготовка · прораб не назначен',
    );
    assert.equal(
      K.auto.notes.ack,
      'Срабатывает при публикации с отметкой «Попросить ознакомиться»: уведомление получают все из аудитории страницы.',
    );
  });

  it('архив', () => {
    assert.equal(
      K.archive.intro,
      'Страницы в архиве не видны в дереве и поиске. Восстановление возвращает ветку на прежнее место.',
    );
    assert.equal(format(K.archive.branch, { n: 1 }), '1 страница в ветке');
    assert.equal(format(K.archive.branch, { n: 5 }), '5 страниц в ветке');
    assert.equal(K.archive.restore, 'Восстановить');
    assert.equal(K.archive.empty, 'В архиве ничего нет');
  });
});

describe('knowledge: диалоги М:294–374', () => {
  it('«Новое пространство», «Создать в …», «Переместить …»', () => {
    assert.equal(K.dialogs.space.sub, 'Область и уровень доступа можно поменять позже');
    assert.equal(K.dialogs.space.placeholder, 'Например, «Охрана труда»');
    assert.equal(K.dialogs.space.unit, 'Область — чьи роли действуют');
    assert.equal(format(K.dialogs.space.region, { name: 'Москва' }), 'Регион «Москва»');
    assert.equal(
      format(K.dialogs.space.firm, { name: 'Север Логистик' }),
      '— фирма «Север Логистик»',
    );
    assert.equal(format(K.dialogs.space.chipRole, { role: 'Водитель' }), 'Читают: роль «Водитель»');
    assert.equal(K.dialogs.space.chipAck, 'Ознакомиться: все');
    assert.equal(K.dialogs.space.chipSpace, 'Как у пространства');
    assert.equal(K.dialogs.space.ok, 'Создать пространство');
    assert.equal(format(K.dialogs.node.title, { space: 'Логистика' }), 'Создать в «Логистика»');
    assert.equal(K.dialogs.node.sub, 'Подстраница получит доступ родителя');
    assert.equal(K.dialogs.node.where, 'Где создать');
    assert.equal(K.dialogs.node.top, 'Верхний уровень пространства');
    assert.equal(
      format(K.dialogs.node.inside, { title: 'Регламенты', own: false }),
      'Внутри «Регламенты». Доступ — как у родителя.',
    );
    assert.equal(
      format(K.dialogs.node.inside, { title: 'Водителям', own: true }),
      'Внутри «Водителям». У родителя свой доступ — новая страница получит его же.',
    );
    assert.equal(
      format(K.dialogs.node.atTop, { d: 'все в области читают, пишут участники' }),
      'На верхнем уровне доступ — как у пространства: все в области читают, пишут участники.',
    );
    assert.equal(format(K.dialogs.move.title, { title: 'Маршруты' }), 'Переместить «Маршруты»');
    assert.equal(K.dialogs.move.sub, 'Доступ пересчитается по новому родителю');
    assert.equal(K.dialogs.move.parent, 'Новый родитель');
    assert.equal(
      format(K.dialogs.move.pages, { n: 3 }),
      'Переносится 3 страницы вместе с подстраницами.',
    );
    assert.equal(
      format(K.dialogs.impact.loseView, { names: 'Илья Васильев · 1' }),
      'Потеряют чтение (страниц): Илья Васильев · 1',
    );
    assert.equal(K.dialogs.move.nobody, 'Потеряют доступ: никто');
  });

  it('«Доступ · …»', () => {
    assert.equal(format(K.dialogs.access.title, { title: 'Маршруты' }), 'Доступ · Маршруты');
    assert.equal(
      format(K.dialogs.access.sub, { path: 'Логистика › Водителям', n: 0 }),
      'Логистика › Водителям · 0 подстраниц',
    );
    assert.equal(
      format(K.dialogs.access.readonly, { leads: 'Марина Котова' }),
      'Доступ меняет руководитель пространства (Марина Котова). Здесь видно, кто читает и правит.',
    );
    assert.equal(K.dialogs.access.whoAria, 'Кого добавить');
    assert.equal(K.dialogs.access.whoPlaceholder, 'Выберите роль, группу или сотрудника');
    assert.equal(K.dialogs.access.canAria, 'Что может');
    assert.equal(K.dialogs.access.duplicate, 'Уже есть в списке');
    assert.equal(K.dialogs.access.fixed, 'Руководитель пространства и владелец бизнеса');
    assert.equal(
      format(K.dialogs.access.fixedSub, { leads: 'Марина Котова' }),
      'Марина Котова · видят и правят всё в пространстве',
    );
    assert.equal(
      format(K.dialogs.access.warnOne, { why: 'не участник закрытого пространства' }),
      'Не получит доступ: не участник закрытого пространства. Добавьте во вкладке «Участники и доступ».',
    );
    assert.equal(K.dialogs.access.quick, 'Добавить в пространство читателем');
    assert.equal(K.dialogs.access.removeAria, 'Убрать из списка');
    assert.equal(
      format(K.dialogs.access.branch, {
        title: 'Тарифы и начисления',
        n: 2,
        own: false,
        names: '',
      }),
      'Ветка «Тарифы и начисления»: 2 страницы.',
    );
    assert.equal(
      format(K.dialogs.access.applyOwn, { n: 1 }),
      'Применить и к подстраницам со своим доступом (1): их доступ станет «Как у родителя»',
    );
    assert.equal(
      format(K.dialogs.access.request, { can: 'edit', at: '20.10.2026 14:30' }),
      'просит право правки · 20.10.2026 14:30',
    );
    assert.equal(format(K.dialogs.access.save, { n: 2 }), 'Сохранить · 2 страницы');
  });

  it('тосты эталона', () => {
    assert.equal(K.toast.spaceCreated, 'Пространство создано');
    assert.equal(K.toast.created, 'Создано');
    assert.equal(format(K.toast.published, { v: 3 }), 'Опубликована версия 3');
    assert.equal(format(K.toast.restored, { v: 1 }), 'Версия 1 восстановлена как новая');
    assert.equal(K.toast.approved, 'Страница утверждена');
    assert.equal(K.toast.archived, 'Перенесено в архив');
    assert.equal(K.toast.unarchived, 'Восстановлено');
    assert.equal(K.toast.moved, 'Страница перенесена');
    assert.equal(K.toast.accessSaved, 'Доступ сохранён');
    assert.equal(K.toast.requestSent, 'Запрос отправлен руководителю пространства');
    assert.equal(K.toast.requestApproved, 'Запрос одобрен');
    assert.equal(K.toast.requestDenied, 'Запрос отклонён');
    assert.equal(K.toast.acked, 'Спасибо, отметили');
    assert.equal(K.toast.memberAdded, 'Добавлен(а) в пространство');
    assert.equal(K.toast.readerAdded, 'Добавлен(а) в пространство читателем');
    assert.equal(K.toast.roleChanged, 'Роль изменена');
    assert.equal(K.toast.memberRemoved, 'Убран(а) из пространства');
    assert.equal(K.toast.ruleOn, 'Правило включено');
    assert.equal(K.toast.ruleOff, 'Правило выключено');
    assert.equal(K.toast.checked, 'Проверка выполнена');
    assert.equal(K.toast.sectionCreated, 'Раздел создан');
  });
});
