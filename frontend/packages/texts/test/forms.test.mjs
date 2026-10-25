// W4.22 · Домен «Формы и опросы» (`forms-list`, `forms-builder`, `forms-preview`, `modal-form-publish`): подписи и
// шаблоны дословно по эталону design-2026-10-19 «Формы и опросы.dc.html» (dc — номер строки; статические строки
// сверяет domains.test.mjs — модульный файл в корпусе эталона, шаблоны — здесь, по конкатенациям эталона).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { format, forms } from '../src/index.ts';

const run = (cases) => {
  for (const [src, msg, values, expected] of cases) {
    it(`${src} → ${expected}`, () => {
      assert.equal(typeof msg, 'string', `${src}: ключ словаря не найден`);
      assert.equal(format(msg, values), expected);
    });
  }
};

describe('forms: список форм (dc:28–84, listVM dc:748–780)', () => {
  it('заголовок, плитки, шаблоны, группы, фильтры, пусто', () => {
    const l = forms.list;
    assert.equal(forms.loading, 'Загрузка форм…');
    assert.equal(forms.closeMenus, 'Закрыть меню');
    assert.equal(
      l.subtitle,
      'Анкеты, заявки, опросы, тесты и рабочие отчёты. Опубликованная версия неизменяема: каждый ответ привязан к своей версии.',
    );
    assert.equal(l.create, 'Создание формы');
    assert.equal(l.blank, 'Создать пустую форму');
    assert.equal(l.tplSearch, 'Поиск по названию');
    assert.equal(l.tplSearchAria, 'Поиск шаблона');
    assert.equal(l.tplNone, 'Шаблон не найден');
    assert.deepEqual(l.tplCats, {
      basic: 'Основные',
      survey: 'Опросы и оценка',
      people: 'Сотрудники',
      quiz: 'Тесты',
      industry: 'Отраслевые',
    });
    assert.equal(l.moduleOffMeta, 'модуль не подключён');
    assert.equal(l.groups, 'Формы и группы');
    assert.equal(l.groupNew, 'Создать группу');
    assert.equal(l.groupPlaceholder, 'Название группы, например «Опросы клиентов»');
    assert.equal(l.groupAria, 'Название группы');
    assert.equal(l.groupCreate, 'Создать');
    assert.equal(l.cancel, 'Отмена');
    assert.equal(l.groupShort, 'Название группы — от 2 символов');
    assert.equal(l.groupTaken, 'Такая группа уже есть');
    assert.equal(l.search, 'Поиск');
    assert.equal(l.searchAria, 'Поиск формы');
    assert.equal(l.ownerAria, 'Владелец');
    assert.deepEqual(l.owners, { all: 'Все формы', mine: 'Мои формы' });
    assert.equal(l.statusAria, 'Статус');
    assert.deepEqual(l.statuses, {
      all: 'Все статусы',
      draft: 'Черновики',
      open: 'Принимают ответы',
      closed: 'Приём закрыт',
    });
    assert.equal(l.byGroup, 'По группам');
    assert.deepEqual(l.empty, {
      noneTitle: 'Форм пока нет',
      noneText: 'Создайте первую форму с нуля или из шаблона выше.',
      title: 'Ничего не найдено',
      text: 'Измените поиск или фильтры.',
      reset: 'Сбросить фильтры',
    });
    assert.equal(l.deleteGroup, 'Удалить пустую группу');
    assert.equal(l.noGroup, 'Без группы');
    assert.equal(l.groupEmpty, 'В группе пока нет форм — переместите сюда форму через меню «…».');
    assert.equal(l.moveTitle, 'Переместить в группу');
    assert.equal(l.general, 'Общая');
    assert.equal(l.newName, 'Новая форма');
    assert.deepEqual(l.modules, {
      fleet: 'Логистика',
      spa: 'Салон и SPA',
      repairs: 'Ремонт и стройка',
    });
  });

  run([
    ['dc:39', forms.list.allTemplates, { n: 15 }, 'Все шаблоны · 15'],
    ['dc:752', forms.list.moduleOff, { name: 'Логистика' }, 'Модуль «Логистика» не подключён'],
    ['dc:751', forms.list.questions, { n: 1 }, '1 вопрос'],
    ['dc:751', forms.list.questions, { n: 3 }, '3 вопроса'],
    ['dc:751', forms.list.questions, { n: 7 }, '7 вопросов'],
    ['dc:751', forms.list.questions, { n: 12 }, '12 вопросов'],
    ['dc:751', forms.list.pages, { n: 2 }, '2 страницы'],
    ['dc:751', forms.list.pages, { n: 5 }, '5 страниц'],
    [
      'dc:773',
      forms.list.groupCreated,
      { name: 'Опросы клиентов' },
      'Группа «Опросы клиентов» создана. Переместите в неё формы через меню «…»',
    ],
    ['dc:73', forms.list.rowMenu, { name: 'Осмотр машины' }, 'Действия с формой «Осмотр машины»'],
    ['dc:761', forms.list.menu.responses, { n: 2 }, 'Ответы · 2'],
    ['dc:762', forms.list.group, { name: 'Логистика и машины' }, 'группа «Логистика и машины»'],
    ['dc:762', forms.list.updated, { date: '01.10' }, 'изменена 01.10'],
    ['dc:762', forms.list.responses, { n: 0 }, '0 ответов'],
    ['dc:762', forms.list.responses, { n: 1 }, '1 ответ'],
    ['dc:762', forms.list.responses, { n: 2 }, '2 ответа'],
    ['dc:633', forms.list.copyName, { name: 'Осмотр машины' }, 'Осмотр машины · копия'],
    ['dc:561', forms.list.clash, { name: 'Анкета', k: 2 }, 'Анкета · 2'],
  ]);

  it('меню строки (dc:760–761)', () => {
    assert.deepEqual(forms.list.menu, {
      open: 'Открыть',
      responses: 'Ответы · {n}',
      duplicate: 'Дублировать',
      move: 'Переместить в группу',
      close: 'Закрыть приём ответов',
      reopen: 'Возобновить приём ответов',
    });
  });
});

describe('forms: чипы и тосты (dc:759, 785, 628–641)', () => {
  run([
    ['dc:759', forms.chips.draft, {}, 'Черновик'],
    ['dc:759', forms.chips.closed, { v: 3 }, 'Приём закрыт · v3'],
    ['dc:759', forms.chips.changed, { v: 3 }, 'v3 · есть изменения'],
    ['dc:759', forms.chips.open, { v: 3 }, 'Принимает ответы · v3'],
    ['dc:785', forms.chips.draftEditor, {}, 'Черновик · не опубликована'],
    [
      'dc:785',
      forms.chips.changedEditor,
      { v: 3 },
      'Действует v3 · есть неопубликованные изменения',
    ],
    ['dc:628', forms.toasts.created, { name: 'Анкета' }, 'Создан черновик «Анкета»'],
    ['dc:633', forms.toasts.copied, { name: 'А · копия' }, 'Создана копия «А · копия»'],
    ['dc:635', forms.toasts.closed, { name: 'Осмотр' }, 'Приём ответов закрыт: «Осмотр»'],
    ['dc:635', forms.toasts.reopened, { name: 'Осмотр' }, 'Приём ответов возобновлён: «Осмотр»'],
    ['dc:792', forms.toasts.renamed, {}, 'Форма переименована'],
    ['dc:637', forms.toasts.discarded, { v: 3 }, 'Изменения отменены: действует v3'],
    [
      'dc:641',
      forms.toasts.published,
      { v: 4, name: 'Осмотр машины' },
      'Опубликована версия v4 формы «Осмотр машины»',
    ],
    ['dc:798', forms.toasts.noResponses, {}, 'Ответов пока нет'],
  ]);
});

describe('forms: шапка редактора (dc:85–106, editVM dc:782–811)', () => {
  it('подписи', () => {
    const e = forms.editor;
    assert.equal(e.back, 'Все формы');
    assert.equal(e.nameAria, 'Название формы');
    assert.equal(e.org, 'вся организация');
    assert.equal(e.saving, 'Сохраняем черновик…');
    assert.equal(e.saved, 'Черновик сохранён');
    assert.equal(e.preview, 'Предпросмотр');
    assert.equal(e.share, 'Поделиться');
    assert.equal(e.more, 'Ещё действия с формой');
    assert.deepEqual(e.moreMenu, {
      duplicate: 'Дублировать форму',
      discard: 'Отменить неопубликованные изменения',
      csv: 'Выгрузить ответы в CSV',
    });
    assert.equal(e.publish, 'Опубликовать');
    assert.equal(e.published, 'Опубликовано');
    assert.equal(e.readOnly, 'Только просмотр · нет права «Настраивать» формы');
    assert.equal(e.tabsAria, 'Разделы формы');
    assert.deepEqual(e.tabs, {
      build: 'Конструктор',
      settings: 'Настройки',
      actions: 'Действия после ответа',
      responses: 'Ответы',
      versions: 'Версии',
    });
  });

  run([
    ['dc:794', forms.editor.area, { name: 'Север Логистик' }, 'область: Север Логистик'],
    ['dc:794', forms.editor.owner, { name: 'Дарья Зимина' }, 'владелец Дарья Зимина'],
    ['dc:795', forms.editor.saveError, { error: 'нет связи' }, 'Черновик не сохранён: нет связи'],
    ['dc:799', forms.editor.publishV, { v: 4 }, 'Опубликовать v4'],
  ]);
});

describe('forms: конструктор (dc:143–286, builderVM dc:813–879)', () => {
  it('содержание, страницы, карточка вопроса, выбор типа', () => {
    const b = forms.builder;
    assert.equal(b.outlineAria, 'Содержание формы');
    assert.equal(b.outline, 'Содержание');
    assert.equal(b.addPage, 'Добавить страницу');
    assert.equal(b.toggle, 'Свернуть или развернуть страницу');
    assert.equal(b.hidden, 'Скрытый');
    assert.equal(b.issues, 'До публикации исправьте');
    assert.equal(b.restore, 'Восстановить');
    assert.equal(b.hide, 'Скрыть');
    assert.equal(b.page.titleAria, 'Название страницы');
    assert.equal(b.page.shuffled, 'Вопросы перемешиваются');
    assert.equal(b.page.up, 'Страницу выше');
    assert.equal(b.page.down, 'Страницу ниже');
    assert.equal(b.page.menu, 'Действия со страницей');
    assert.equal(b.page.shuffle, 'Перемешивать вопросы для каждого');
    assert.equal(b.page.noShuffle, 'Не перемешивать вопросы');
    assert.equal(b.page.remove, 'Удалить страницу');
    assert.equal(b.page.empty, 'На странице пока нет вопросов.');
    assert.equal(b.noText, 'Вопрос без текста');
    assert.equal(b.required, 'обязательный');
    assert.deepEqual(b.flags, { added: 'Новое', newType: 'Новый тип', changed: 'Изменено' });
    assert.equal(b.addQuestion, 'Добавить вопрос');
    assert.equal(b.statementDefault, 'Текст для респондента');
    assert.deepEqual(b.pick, {
      title: 'Выберите вопрос',
      close: 'Закрыть выбор вопроса',
      showAll: 'Показать все вопросы',
      hideAll: 'Скрыть все вопросы',
    });
    const c = b.card;
    assert.equal(c.typeAria, 'Тип вопроса');
    assert.equal(c.up, 'Вопрос выше');
    assert.equal(c.down, 'Вопрос ниже');
    assert.equal(c.menu, 'Действия с вопросом');
    assert.deepEqual(c.menuItems, {
      duplicate: 'Дублировать',
      hide: 'Сделать скрытым',
      show: 'Показывать вопрос',
      remove: 'Удалить',
    });
    assert.equal(c.collapse, 'Свернуть вопрос');
    assert.equal(
      c.noteText,
      'Смена текста не меняет идентификатор: старые ответы и отчёты остаются связаны.',
    );
    assert.equal(c.question, 'Вопрос');
    assert.equal(c.text, 'Текст');
    assert.equal(c.placeholder, 'Введите текст вопроса');
    assert.equal(c.placeholderStatement, 'Текст, который увидит респондент');
    assert.equal(c.requiredLabel, 'Обязательный');
    assert.equal(c.hintPlaceholder, 'Пояснение под вопросом');
    assert.equal(c.hintAria, 'Пояснение');
    assert.equal(c.hintAdd, 'Добавить пояснение');
    assert.equal(c.hintRemove, 'Убрать пояснение');
    assert.equal(c.defaultLabel, 'Значение по умолчанию');
    assert.equal(c.defaultRemove, 'Убрать значение по умолчанию');
    assert.equal(c.answers, 'Ответы');
    assert.equal(c.viewsAria, 'Вид вариантов');
    assert.deepEqual(c.views, { list: 'Списком', tiles: 'Плиткой', row: 'В один ряд' });
    assert.equal(c.points, 'баллов');
    assert.equal(c.optionId, 'Идентификатор варианта');
    assert.equal(c.addOption, 'Добавить вариант');
    assert.equal(c.other, 'Вариант «Другое» с вводом');
    assert.equal(c.scale, 'Шкала');
    assert.equal(c.from, 'от');
    assert.equal(c.to, 'до');
    assert.equal(c.left, 'Подпись слева');
    assert.equal(c.right, 'Подпись справа');
    assert.equal(c.settings, 'Настройки');
    assert.equal(c.length, 'Длина ответа, символов');
    assert.equal(c.range, 'Допустимое значение');
    assert.equal(c.min, 'От');
    assert.equal(c.max, 'До');
    assert.equal(c.selectCount, 'Сколько вариантов выбрать');
    assert.equal(c.minSel, 'Не меньше');
    assert.equal(c.maxSel, 'Не больше');
    assert.equal(c.order, 'Порядок вариантов');
    assert.deepEqual(c.orders, {
      asIs: 'Как в списке',
      alpha: 'По алфавиту',
      random: 'В случайном порядке для каждого',
    });
    assert.equal(c.withTime, 'Спрашивать время');
    assert.equal(c.filesAria, 'Тип файлов');
    assert.deepEqual(c.accept, {
      photo: 'Только фото',
      docs: 'Документы: PDF, Word, Excel',
      any: 'Любые файлы',
    });
    assert.equal(c.maxFiles, 'не больше');
    assert.equal(c.files, 'файлов');
    assert.equal(c.maxFilesAria, 'Файлов не больше');
    assert.equal(c.mb, 'МБ');
    assert.equal(c.maxMbAria, 'Размер файла до, МБ');
    assert.equal(c.unitLevel, 'Что можно выбрать');
    assert.deepEqual(c.unitLevels, {
      any: 'Регион или фирму',
      region: 'Только регион',
      firm: 'Только фирму',
    });
    assert.equal(c.refKind, 'Объект CRM');
    assert.deepEqual(c.refKinds, {
      vehicle: 'Машина',
      trip: 'Рейс',
      object: 'Объект ремонта',
      task: 'Задача',
    });
    assert.equal(
      c.crmNote,
      'Список берётся из CRM и доступен только сотрудникам после входа. В публичной форме такой вопрос запрещён.',
    );
    assert.equal(c.id, 'Идентификатор вопроса');
    assert.equal(c.idLocked, 'Идентификатор нельзя изменить: вопрос есть в опубликованной версии.');
    assert.equal(c.idNote, 'Используется в выгрузке, действиях после ответа и параметре ссылки.');
    assert.equal(c.idBad, 'Латиница, цифры, «_» и «-», с буквы, от 2 символов');
    assert.equal(c.idTaken, 'Такой идентификатор уже есть');
    assert.equal(c.cond, 'Условие показа');
    assert.equal(c.condAdd, 'Показывать при условии');
    assert.equal(c.condHint, 'Условие может зависеть только от вопросов выше.');
    assert.equal(c.condNone, 'Выше нет вопросов, от которых может зависеть показ.');
    assert.equal(c.condModeAria, 'Как сочетать условия');
    assert.deepEqual(c.condModes, {
      all: 'Все условия выполнены (И)',
      any: 'Любое из условий (ИЛИ)',
    });
    assert.equal(c.condField, 'Вопрос условия');
    assert.equal(c.condOp, 'Сравнение');
    assert.deepEqual(c.ops, { equals: 'равно', notEquals: 'не равно' });
    assert.equal(c.condValue, 'Значение');
    assert.equal(c.valuePlaceholder, 'значение');
    assert.equal(c.condDelete, 'Удалить условие');
    assert.equal(c.condMore, 'Добавить условие');
    assert.deepEqual(c.bool, { yes: 'Да', no: 'Нет' });
  });

  run([
    ['dc:837', forms.builder.count, { p: 4, n: 7 }, '4 стр. · 7 вопросов'],
    ['dc:837', forms.builder.count, { p: 1, n: 1 }, '1 стр. · 1 вопрос'],
    ['dc:599', forms.builder.undoQuestion, { label: 'Пробег' }, 'Вопрос «Пробег» удалён'],
    ['dc:605', forms.builder.undoPage, { title: 'Фото', n: 0 }, '«Фото» удалена'],
    [
      'dc:605',
      forms.builder.undoPage,
      { title: 'Дефекты', n: 3 },
      '«Дефекты» удалена вместе с 3 вопросами',
    ],
    [
      'dc:605',
      forms.builder.undoPage,
      { title: 'Дефекты', n: 1 },
      '«Дефекты» удалена вместе с 1 вопросом',
    ],
    ['dc:827', forms.builder.page.of, { i: 2, n: 4 }, 'Страница 2 из 4'],
    ['dc:594', forms.builder.page.title, { n: 2 }, 'Страница 2'],
    ['dc:818', forms.builder.options, { n: 4 }, '4 варианта'],
    ['dc:818', forms.builder.options, { n: 5 }, '5 вариантов'],
    ['dc:818', forms.builder.cond, { text: '«Есть дефекты?» = да' }, 'если «Есть дефекты?» = да'],
    ['dc:812', forms.builder.condPart, { label: 'Тип', op: '=', value: 'a' }, '«Тип» = a'],
    ['dc:812', forms.builder.condAnd, {}, 'и'],
    ['dc:812', forms.builder.condOr, {}, 'или'],
    [
      'dc:855',
      forms.builder.card.noteType,
      { type: 'Короткий текст' },
      'Смена типа создаёт новое поле: ответы прошлых версий сохранят значение «Короткий текст» под старым идентификатором.',
    ],
    [
      'dc:856',
      forms.builder.card.hiddenNote,
      { id: 'q-src' },
      'Скрытый вопрос не показывается. Значение — по умолчанию или из параметра ссылки ?q-src=…',
    ],
    ['dc:850', forms.builder.card.unavailable, { label: 'Оплата' }, 'Оплата — недоступно'],
    ['dc:215', forms.builder.card.option, { n: 3 }, 'Вариант 3'],
    ['dc:216', forms.builder.card.pointsAria, { n: 2 }, 'Баллы за вариант 2'],
    ['dc:218', forms.builder.card.optionDelete, { n: 2 }, 'Удалить вариант 2'],
    ['dc:595', forms.builder.card.copy, { label: 'Пробег' }, 'Пробег (копия)'],
  ]);
});

describe('forms: типы вопросов (TYPES dc:474–482, TGROUPS dc:483)', () => {
  it('21 активный тип, два недоступных, четыре группы', () => {
    assert.deepEqual(forms.types, {
      text: 'Короткий текст',
      longtext: 'Длинный текст',
      number: 'Число',
      money: 'Сумма, ₽',
      email: 'Почта',
      phone: 'Телефон',
      inn: 'ИНН',
      url: 'Ссылка',
      choice: 'Один вариант',
      multi: 'Несколько вариантов',
      select: 'Выпадающий список',
      bool: 'Да / нет',
      person: 'Сотрудник',
      unit: 'Регион или фирма',
      ref: 'Объект CRM',
      date: 'Дата',
      int: 'Целое число',
      scale: 'Оценка по шкале',
      rating: 'Оценка звёздами',
      photo: 'Файл или фото',
      statement: 'Текст без вопроса',
      series: 'Серия вопросов',
      payment: 'Оплата',
    });
    assert.deepEqual(forms.typeWhy, {
      series: 'Повторяемая группа вопросов — раннее расширение (FORM-06)',
      payment: 'Форма не принимает деньги: оплату проводит касса (FORM-05)',
    });
    assert.deepEqual(forms.typeGroups, {
      text: 'Текст и числа',
      choice: 'Выбор',
      crm: 'Данные CRM',
      other: 'Другие',
    });
  });
});

describe('forms: проблемы до публикации (issues dc:721–738)', () => {
  run([
    ['dc:723', forms.issues.noQuestions, {}, 'В форме нет ни одного вопроса'],
    ['dc:726', forms.issues.questionN, { n: 3 }, 'Вопрос 3'],
    ['dc:727', forms.issues.noText, { name: 'Вопрос 3' }, 'Вопрос 3: нет текста'],
    ['dc:728', forms.issues.noOptions, { name: '«Явка»' }, '«Явка»: нет вариантов ответа'],
    ['dc:729', forms.issues.emptyOption, { name: '«Явка»' }, '«Явка»: есть пустой вариант'],
    ['dc:730', forms.issues.duplicateId, { id: 'q-odo' }, 'Идентификатор q-odo повторяется'],
    [
      'dc:731',
      forms.issues.condDeleted,
      { name: '«А»' },
      '«А»: условие ссылается на удалённый вопрос',
    ],
    [
      'dc:731',
      forms.issues.condBelow,
      { name: '«А»' },
      '«А»: условие ссылается на вопрос ниже — условие может зависеть только от вопросов выше',
    ],
    [
      'dc:732',
      forms.issues.hiddenRequired,
      { name: '«А»' },
      '«А»: скрытый обязательный вопрос без значения по умолчанию',
    ],
    ['dc:733', forms.issues.range, { name: '«Пробег»' }, '«Пробег»: «от» больше «до»'],
    [
      'dc:735',
      forms.issues.publicCrm,
      { label: 'Машина' },
      '«Машина»: публичная форма не может спрашивать данные CRM',
    ],
    [
      'dc:736',
      forms.issues.noScores,
      {},
      'Включён подсчёт баллов, но ни у одного варианта нет баллов',
    ],
  ]);
});

describe('forms: предпросмотр (dc:107–142, previewVM dc:1021–1059, pvCheck dc:688–705)', () => {
  it('подписи', () => {
    const p = forms.preview;
    assert.equal(p.devicesAria, 'Устройство');
    assert.deepEqual(p.devices, { phone: 'Телефон', desktop: 'Компьютер' });
    assert.equal(p.note, 'Предпросмотр черновика. Ответ не сохраняется.');
    assert.equal(p.restart, 'Заново');
    assert.equal(p.close, 'Закрыть предпросмотр');
    assert.equal(p.org, 'Организация');
    assert.deepEqual(p.placeholders, {
      email: 'name@example.ru',
      phone: '+7 900 000-00-00',
      inn: '10 или 12 цифр',
      url: 'https://',
      money: '0 ₽',
    });
    assert.equal(p.other, 'Другое — свой вариант');
    assert.equal(p.otherAria, 'Свой вариант');
    assert.equal(p.choose, 'Выберите');
    assert.equal(p.attach, 'Демо: прикрепить файл');
    assert.equal(p.empty, 'В форме нет вопросов для показа.');
    assert.equal(p.back, 'Назад');
    assert.equal(p.next, 'Далее');
    assert.equal(p.submit, 'Отправить');
    assert.equal(p.thanks, 'Спасибо! Ответ отправлен.');
    assert.equal(p.again, 'Пройти ещё раз');
    assert.equal(p.errors.required, 'Обязательный вопрос');
    assert.equal(p.errors.email, 'Проверьте адрес почты');
    assert.equal(p.errors.phone, 'Нужно не меньше 10 цифр');
    assert.equal(p.errors.inn, 'ИНН — 10 или 12 цифр');
    assert.equal(p.errors.url, 'Ссылка начинается с http:// или https://');
    assert.equal(p.errors.number, 'Нужно число');
    assert.equal(p.errors.int, 'Нужно целое число');
  });

  run([
    ['dc:1054', forms.preview.progress, { i: 1, n: 3 }, 'Страница 1 из 3'],
    ['dc:1043', forms.preview.star, { k: 4 }, '4 из 5'],
    [
      'dc:1045',
      forms.preview.filesNone,
      { max: 5, mb: 20 },
      'Файлы не выбраны · до 5 шт., до 20 МБ',
    ],
    ['dc:1045', forms.preview.files, { n: 2, max: 5 }, '2 файла из 5'],
    ['dc:1045', forms.preview.files, { n: 5, max: 5 }, '5 файлов из 5'],
    ['dc:1045', forms.preview.files, { n: 1, max: 5 }, '1 файл из 5'],
    [
      'dc:906',
      forms.preview.kbLink,
      { title: 'Журнал осмотров машин' },
      'Ответ появится на странице «Журнал осмотров машин» в Базе знаний',
    ],
    ['dc:1055', forms.preview.score, { got: 3, max: 5 }, 'Результат: 3 из 5 баллов'],
    ['dc:1055', forms.preview.score, { got: 1, max: 1 }, 'Результат: 1 из 1 балла'],
    ['dc:1055', forms.preview.score, { got: 1, max: 2 }, 'Результат: 1 из 2 баллов'],
    [
      'dc:1055',
      forms.preview.scorePassed,
      { got: 4, max: 5 },
      'Результат: 4 из 5 баллов · тест пройден',
    ],
    [
      'dc:1055',
      forms.preview.scoreFailed,
      { got: 2, max: 5, p: 4 },
      'Результат: 2 из 5 баллов · нужно 4 для зачёта',
    ],
    ['dc:698', forms.preview.errors.min, { n: 10 }, 'Не меньше 10'],
    ['dc:699', forms.preview.errors.max, { n: 99 }, 'Не больше 99'],
    ['dc:700', forms.preview.errors.minLength, { n: 3 }, 'Не короче 3 символов'],
    ['dc:701', forms.preview.errors.maxLength, { n: 50 }, 'Не длиннее 50 символов'],
    ['dc:702', forms.preview.errors.minSelected, { n: 2 }, 'Выберите не меньше 2'],
    ['dc:703', forms.preview.errors.maxSelected, { n: 3 }, 'Выберите не больше 3'],
  ]);
});

describe('forms: диалог «Опубликовать» (dc:457–466, modalVM dc:1063–1080)', () => {
  it('подписи', () => {
    const m = forms.publish;
    assert.equal(m.bad, 'Сначала исправьте форму');
    assert.deepEqual(m.who, {
      members: 'сотрудники организации',
      public: 'все, у кого есть ссылка',
    });
    assert.equal(m.rules, 'Действия после ответа продолжают работать по своей версии правила');
    assert.equal(m.toBuilder, 'Перейти к конструктору');
    assert.equal(m.cancel, 'Отмена');
  });

  run([
    ['dc:1079', forms.publish.badText, { n: 2 }, 'Найдено ошибок: 2. Исправьте их в конструкторе.'],
    ['dc:1079', forms.publish.title, { name: 'Анкета', v: 1 }, 'Опубликовать «Анкета» v1?'],
    [
      'dc:1079',
      forms.publish.text,
      { v: 4 },
      'Будет создана новая неизменяемая версия. Новые ответы пойдут по v4.',
    ],
    [
      'dc:1069',
      forms.publish.first,
      { who: 'сотрудники организации' },
      'Форма начнёт принимать ответы. Кто может ответить: сотрудники организации.',
    ],
    [
      'dc:1069',
      forms.publish.kept,
      { n: 1 },
      '1 ответ остаётся привязан к своим версиям и показываются по их структуре',
    ],
    [
      'dc:1069',
      forms.publish.kept,
      { n: 2 },
      '2 ответа остаются привязаны к своим версиям и показываются по их структуре',
    ],
    [
      'dc:1069',
      forms.publish.kept,
      { n: 5 },
      '5 ответов остаются привязаны к своим версиям и показываются по их структуре',
    ],
    [
      'dc:1071',
      forms.publish.newRequired,
      { names: '«А», «Б»' },
      'Новые обязательные вопросы «А», «Б» не требуются от уже отправленных ответов',
    ],
    [
      'dc:1072',
      forms.publish.typeChanged,
      { names: '«Пробег»' },
      'Смена типа создаст новые поля: «Пробег». Старые значения не переписываются',
    ],
    [
      'dc:1073',
      forms.publish.removed,
      { names: '«Топливо»' },
      'Убраны вопросы «Топливо»: их ответы остаются в прошлых версиях',
    ],
    [
      'dc:1075',
      forms.publish.kb,
      { names: '«Пробег, км»' },
      'База знаний: «Пробег, км» — вопрос удалён или сменил тип, поле останется пустым. Обновите действие после публикации',
    ],
    ['dc:1079', forms.publish.confirm, { v: 4 }, 'Опубликовать v4'],
  ]);
});

// W4.70 · Заполнение формы сотрудником (`form-fill`) и публичная форма гостя (`public-form`): экранов в эталоне нет
// (no-reference, Q-W4.00-forms-19, Q-W4.05-9); тексты сервера — дословно backend W4.21 (texts.go, public.go).
describe('forms: заполнение формы и публичная форма (W4.70, no-reference)', () => {
  it('состояния страницы', () => {
    const f = forms.fill;
    assert.equal(f.loading, 'Загружаем форму…');
    assert.equal(f.notFound, 'Форма не найдена');
    assert.equal(f.noAccess, 'Нет доступа к форме');
    assert.equal(f.closed, 'Приём ответов закрыт');
    assert.equal(f.answered, 'Вы уже отвечали на эту форму');
    assert.equal(f.changed, 'Форма обновилась — откройте её заново');
    assert.equal(f.reopen, 'Открыть заново');
    assert.equal(f.linkInvalid, 'Ссылка недействительна');
    assert.equal(f.retry, 'Повторить');
    assert.equal(f.offline, 'Нет связи с сервером. Ответ не отправлен — повторите.');
    assert.equal(f.attach, 'Прикрепить файл');
    assert.equal(f.pending, 'Файл ещё проверяется — подождите');
  });

  run([
    ['W4.70', forms.fill.loadError, { error: 'сеть' }, 'Не удалось загрузить форму: сеть'],
    ['W4.70', forms.fill.failed, { error: 'Ошибка' }, 'Ответ не отправлен: Ошибка'],
    ['W4.70', forms.fill.remove, { name: 'kran.jpg' }, 'Убрать «kran.jpg»'],
    ['W4.70', forms.fill.uploading, { name: 'kran.jpg' }, 'Загружаем «kran.jpg»…'],
    ['W4.70', forms.fill.scanning, { name: 'kran.jpg' }, 'Проверяем «kran.jpg»…'],
    [
      'W4.70',
      forms.fill.uploadFailed,
      { name: 'a.pdf', error: 'нет связи' },
      'Не удалось загрузить «a.pdf»: нет связи',
    ],
    ['W4.70', forms.fill.rejected, { name: 'a.pdf' }, 'Файл «a.pdf» не прошёл проверку'],
    ['W4.70', forms.fill.tooBig, { mb: 20 }, 'Файл больше 20 МБ'],
    ['W4.70', forms.fill.tooMany, { n: 1 }, 'Не больше 1 файла'],
    ['W4.70', forms.fill.tooMany, { n: 3 }, 'Не больше 3 файлов'],
    ['W4.70', forms.fill.tooMany, { n: 5 }, 'Не больше 5 файлов'],
    ['W4.70', forms.fill.searchAria, { label: 'Дежурный' }, 'Поиск: Дежурный'],
  ]);
});
