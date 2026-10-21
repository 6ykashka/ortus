// W4.12 · Домен «Задачи и проекты» (`tasks-projects`, `tasks-project-new`, `tasks-board`, `modal-new-task`,
// `tasks-card`): подписи и шаблоны дословно по эталону design-2026-10-19 «Задачи и проекты.dc.html» (шаблон ЗП:21–193,
// логика 318–527; статические строки сверяет domains.test.mjs — модульный файл в корпусе эталона).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { format, tasks } from '../src/index.ts';

describe('tasks: список проектов и «Новый проект» (ЗП:24–71)', () => {
  it('шапка, таблица, пусто, подсказка', () => {
    assert.equal(tasks.projects.title, 'Проекты');
    assert.equal(tasks.projects.note, 'Видны проекты, где у вас есть право «Задачи · Читать»');
    assert.equal(tasks.projects.create, 'Новый проект');
    assert.deepEqual(tasks.projects.cols, {
      project: 'Проект',
      unit: 'Область',
      access: 'Доступ',
      people: 'Людей',
      open: 'Открыто',
    });
    assert.equal(tasks.projects.empty, 'Проектов, доступных вам, пока нет');
    assert.equal(
      tasks.projects.hint,
      'Права в проекте отдельно не настраиваются: действуют роли из «Пользователей и ролей» с областью фирмы, региона или самого проекта. Одна роль — одинаковые права во всех проектах.',
    );
    assert.equal(tasks.projects.wholeOrg, 'Вся организация');
    assert.equal(tasks.projects.funnel, 'Воронка');
    assert.deepEqual(tasks.access, {
      open: 'Открытый',
      limited: 'Ограниченный',
      closed: 'Закрытый',
    });
    assert.deepEqual(tasks.accessDesc, {
      open: 'Все с правом «Задачи» в области видят и работают с задачами',
      limited: 'Все в области видят; создают и меняют задачи участники проекта',
    });
  });

  it('панель «Новый проект»', () => {
    const w = tasks.wizard;
    assert.equal(w.name, 'Название');
    assert.equal(w.namePlaceholder, 'Например, «Ремонт · ЖК Речной»');
    assert.equal(w.key, 'Ключ');
    assert.equal(w.keyStub, 'КЛЮЧ');
    assert.equal(w.unit, 'Область проекта');
    assert.equal(
      w.unitHint,
      'Роли, выданные в этой области, действуют в проекте по уровню доступа.',
    );
    assert.equal(w.who, 'Кто видит проект');
    assert.equal(w.process, 'Процесс');
    assert.deepEqual(w.processes, {
      simple: 'Простой',
      approval: 'С согласованием',
      copy: 'Копия проекта',
    });
    assert.equal(w.copyFrom, 'Проект-образец');
    assert.deepEqual(w.notes, {
      simple:
        'Новая → В работе → На проверке → Готово. «Принять» и «Вернуть» — у руководителя проекта.',
      approval:
        'Новая → В работе → На проверке → Готово. «Согласовать»: достаточно одного согласующего, автор свою не согласует, при отказе — «В работе».',
      copy: 'Статусы и переходы копируются один раз и дальше меняются независимо. Правила автоматизации копируются выключенными.',
    });
    assert.equal(w.submit, 'Создать проект');
    assert.equal(w.owner, 'Вы станете руководителем проекта.');
  });
});

describe('tasks: проект, доска, диалог, карточка (ЗП:75–193)', () => {
  it('шапка и вкладки', () => {
    assert.equal(tasks.project.noAccess, 'Нет доступа');
    assert.equal(tasks.project.tabsAria, 'Разделы проекта');
    assert.deepEqual(tasks.project.tabs, {
      board: 'Доска',
      people: 'Участники',
      workflow: 'Процесс',
      automation: 'Автоматизация',
    });
    assert.equal(
      tasks.project.noWf,
      'У проекта ещё нет настраиваемого процесса. Создадим его из текущих статусов: Новая, В работе, На проверке, Готово.',
    );
    assert.equal(tasks.project.initWf, 'Настроить процесс');
    assert.equal(tasks.project.wfCreated, 'Процесс создан');
  });

  it('доска', () => {
    assert.deepEqual(tasks.board.filters, { all: 'Все', mine: 'Мои' });
    assert.equal(tasks.board.quickPlaceholder, 'Новая задача — Enter');
    assert.equal(tasks.board.quickAria, 'Название новой задачи');
    assert.equal(tasks.board.quickButton, 'Задача');
    assert.equal(tasks.board.created, 'Задача создана');
    assert.equal(tasks.board.waitsMe, 'Ждёт вас');
    assert.equal(tasks.board.inApproval, 'На согласовании');
    assert.equal(tasks.board.docRoute, 'Маршрут документа');
    assert.deepEqual(tasks.priority, {
      urgent: 'Срочно',
      high: 'Высокий',
      normal: 'Обычный',
      low: 'Низкий',
    });
  });

  it('«Новая задача»', () => {
    const n = tasks.newTask;
    assert.equal(n.title, 'Новая задача');
    assert.equal(n.required, 'Обязательные поля отмечены *');
    assert.equal(n.project, 'Проект *');
    assert.equal(n.status, 'Статус');
    assert.equal(n.parent, 'Входит в задачу');
    assert.equal(n.noParent, 'Не входит — самостоятельная задача');
    assert.equal(n.subject, 'Тема *');
    assert.equal(n.subjectPlaceholder, 'Коротко: что нужно сделать');
    assert.equal(n.description, 'Описание');
    assert.equal(
      n.descriptionPlaceholder,
      'Подробности, критерии готовности, ссылки. Скриншот можно вставить из буфера — он станет вложением.',
    );
    assert.equal(n.attachments, 'Вложения');
    assert.equal(n.dropNote, 'Фото, PDF, документы Office, текст · до 20 МБ каждый');
    assert.equal(n.dropLink, 'выберите на устройстве');
    assert.equal(n.pick, 'Выбрать файлы');
    assert.deepEqual(n.reasons, {
      tooMany: 'не больше 30 файлов на задачу',
      tooBig: 'больше 20 МБ',
      empty: 'пустой файл',
      type: 'такой тип не принимаем',
    });
    assert.equal(n.assignMe, 'Назначить меня');
    assert.equal(n.labels, 'Метки');
    assert.equal(n.labelsPlaceholder, 'Через запятую: шины, закупка');
    assert.equal(n.more, 'Создать ещё одну');
    assert.equal(n.creating, 'Создаём…');
    assert.equal(n.titleShort, 'Тема — не короче 3 символов');
    assert.equal(n.screenshot, 'Снимок экрана.png');
  });

  it('карточка задачи', () => {
    const c = tasks.card;
    assert.equal(c.close, 'Закрыть задачу');
    assert.equal(c.comment, 'Комментарий к переходу или отказу');
    assert.equal(c.approved, 'Согласовано');
    assert.deepEqual(c.modes, { any: 'достаточно одного', all: 'нужны все' });
    assert.equal(c.waiting, 'ждёт решения');
    assert.equal(c.noApprovers, 'Некому согласовать: назначьте роль «Согласующий» в «Участниках».');
    assert.equal(c.reject, 'Вернуть на доработку');
    assert.equal(c.rejected, 'Возвращено на доработку');
    assert.equal(c.links, 'Связи');
    assert.equal(c.parentOf, 'Входит в');
    assert.equal(c.parentHidden, 'Задача из проекта, к которому у вас нет доступа');
    assert.equal(c.unparentAria, 'Убрать из состава родительской задачи');
    assert.equal(c.unparentTitle, 'Убрать связь');
    assert.equal(c.unlinked, 'Связь снята');
    assert.equal(c.setParent, 'Входит в задачу…');
    assert.equal(c.children, 'Состоит из');
    assert.equal(c.noChildren, 'подзадач нет');
    assert.equal(c.unlinkTitle, 'Исключить из состава');
    assert.equal(c.subtask, 'Подзадача');
    assert.equal(c.addExisting, 'Добавить существующую…');
    assert.equal(c.addExistingAria, 'Добавить существующую задачу в состав');
    assert.equal(c.noDescription, 'Описания нет');
    assert.equal(c.attach, 'Прикрепить');
    assert.equal(c.attachAria, 'Прикрепить файлы');
    assert.equal(c.fileRemoved, 'Файл удалён');
    assert.equal(
      c.filesHint,
      'Файлы можно перетащить на карточку. Доступ к файлам — как к задаче.',
    );
    assert.equal(c.checklist, 'Чек-лист');
    assert.equal(c.history, 'История');
    assert.equal(c.routeNote, 'Статус задачи меняет маршрут, решения — в «Документах».');
    assert.equal(c.openDoc, 'Открыть документ');
    assert.equal(c.commentAria, 'Комментарий');
  });

  it('вид «Список» и комментарий — по старой доске «Ортус CRM.dc.html»:1650–1697', () => {
    assert.equal(tasks.list.empty, 'Задач нет');
    assert.equal(tasks.list.send, 'Отправить комментарий');
  });
});

describe('tasks: шаблоны логики (ЗП:318–527)', () => {
  const cases = [
    [':361', tasks.projects.sub, { owner: 'Марина Котова', v: 1 }, 'Марина Котова · процесс v1'],
    [':361', tasks.projects.subFunnel, { owner: 'Дарья Зимина' }, 'Дарья Зимина · воронка заявок'],
    [
      ':361',
      tasks.projects.subNoWf,
      { owner: 'Ирина Белова' },
      'Ирина Белова · процесс не настроен',
    ],
    [
      ':365',
      tasks.wizard.keyHint,
      { key: 'LOG' },
      'Номера задач: LOG-101, LOG-102… Ключ уникален в организации.',
    ],
    [':366', tasks.wizard.region, { name: 'Москва' }, 'Москва · регион'],
    [':366', tasks.wizard.firm, { name: 'Север Логистик' }, 'Север Логистик · фирма'],
    [
      ':369',
      tasks.wizard.copyOption,
      { key: 'LOG', name: 'Логистика · Север', v: 1 },
      'LOG · Логистика · Север · v1',
    ],
    [
      ':372',
      tasks.wizard.created,
      { name: 'Ремонт · ЖК Речной' },
      'Проект «Ремонт · ЖК Речной» создан',
    ],
    [
      ':378',
      tasks.project.sub,
      { unit: 'Север Логистик', access: 'ограниченный', v: 1 },
      'Север Логистик · ограниченный проект · процесс v1',
    ],
    [
      ':378',
      tasks.project.subNoWf,
      { unit: 'Вся организация', access: 'закрытый' },
      'Вся организация · закрытый проект',
    ],
    [':378', tasks.project.me, { role: 'Владелец бизнеса' }, 'Вы: Владелец бизнеса'],
    [':390', tasks.board.approvalCount, { n: 2 }, 'Ждут моего согласия · 2'],
    [
      ':397',
      tasks.newTask.parentOption,
      { key: 'T-66', title: 'Подготовить парк к зиме' },
      'T-66 · Подготовить парк к зиме',
    ],
    [':399', tasks.newTask.descriptionCount, { n: 17 }, '17 / 5000'],
    [':402', tasks.newTask.wontAttach, { reason: 'пустой файл' }, 'Не прикрепится: пустой файл'],
    [':405', tasks.newTask.creating, {}, 'Создаём…'],
    [
      ':406',
      tasks.newTask.removeBad,
      { names: 'a.txt, b.exe' },
      'Уберите файлы, которые не прикрепятся: a.txt, b.exe',
    ],
    [':409', tasks.newTask.created, { key: 'LOG-101' }, 'Задача LOG-101 создана'],
    [':112', tasks.newTask.remove, { name: 'Акт.pdf' }, 'Убрать Акт.pdf'],
    [':146', tasks.card.author, { name: 'Илья Васильев' }, '· автор Илья Васильев'],
    [
      ':152',
      tasks.card.blocked,
      { name: 'Согласовать', why: 'Сначала закройте чек-лист' },
      '«Согласовать»: Сначала закройте чек-лист',
    ],
    [':422', tasks.card.done, { name: 'На проверку' }, '«На проверку» выполнен'],
    [
      ':424',
      tasks.card.approvalTitle,
      { name: 'Согласовать', mode: 'достаточно одного' },
      'Согласование «Согласовать» · достаточно одного',
    ],
    [':425', tasks.card.you, { name: 'Дарья Зимина' }, 'Дарья Зимина · вы'],
    [':425', tasks.card.votedAt, { at: '10:42' }, 'согласовал(а) 10:42'],
    [':507', tasks.card.parentDeleted, { key: 'T-12' }, 'T-12 · удалена'],
    [':508', tasks.card.parentSet, { key: 'T-66' }, 'Задача входит в T-66'],
    [':509', tasks.card.childrenCount, { done: 0, total: 2 }, '0 из 2 готово'],
    [':174', tasks.card.unlinkAria, { key: 'T-58' }, 'Исключить T-58 из состава'],
    [':510', tasks.card.unlinkedChild, { key: 'T-58' }, 'T-58 исключена из состава'],
    [
      ':511',
      tasks.card.hiddenChildren,
      { n: 1 },
      'Ещё 1 — в проектах, к которым у вас нет доступа',
    ],
    [':512', tasks.card.added, { key: 'T-58' }, 'T-58 добавлена в состав'],
    [':183', tasks.card.files, { n: 1 }, 'Вложения · 1'],
    [':523', tasks.card.attached, { n: 2 }, 'Прикреплено файлов: 2'],
    [
      ':523',
      tasks.card.notAttached,
      { list: 'a.exe — такой тип не принимаем' },
      'Не прикреплено: a.exe — такой тип не принимаем',
    ],
    [
      ':523',
      tasks.card.notAttachedItem,
      { name: 'a.exe', reason: 'пустой файл' },
      'a.exe — пустой файл',
    ],
    [
      ':434',
      tasks.card.fileMeta,
      { size: '180 КБ', by: 'Илья Васильев', at: '10:41' },
      '180 КБ · Илья Васильев · 10:41',
    ],
    [':184', tasks.card.removeFile, { name: 'Акт.pdf' }, 'Удалить Акт.pdf'],
    [':515', tasks.size.kb, { n: 180 }, '180 КБ'],
    [':515', tasks.size.mb, { n: '1,5' }, '1,5 МБ'],
    [
      ':420',
      tasks.card.route,
      { title: 'Договор поставки', v: 2, n: 1, of: 3, step: 'Согласовать' },
      'Маршрут документа «Договор поставки» v2 · шаг 1 из 3 «Согласовать»',
    ],
    [':420', tasks.card.routeWaiting, { names: 'Дарья Зимина' }, 'Ждут: Дарья Зимина'],
  ];
  for (const [src, msg, values, expected] of cases) {
    it(`${src} → ${expected}`, () => {
      assert.equal(typeof msg, 'string', `${src}: ключ словаря не найден`);
      assert.equal(format(msg, values), expected);
    });
  }
});
