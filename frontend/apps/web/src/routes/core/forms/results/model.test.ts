// W4.23 · Модель вкладок формы: шапка, настройки, правила и «в БЗ», ответы, журнал, версии, ссылки (эталон
// design-2026-10-19 «Формы и опросы.dc.html»: editVM, settingsVM, actionsVM, kbVM, respVM, actsVM, versVM, modalVM).
import { describe, expect, it } from 'vitest';

import {
  accessOptions,
  answerText,
  areaOptions,
  cardNote,
  cardRows,
  condFields,
  condText,
  condValues,
  crmQuestions,
  day,
  dayTime,
  type Def,
  draftOf,
  emptyText,
  feedTitle,
  type Form,
  journal,
  kbDefault,
  kbMap,
  kbMissing,
  kbOwnerAccess,
  kbPageLabel,
  kbSeenByAll,
  kbSources,
  kbValue,
  labelsByKey,
  maxScore,
  moduleName,
  newDraft,
  num,
  numOrNull,
  respColumns,
  type Response,
  retainText,
  type Rule,
  ruleBody,
  ruleError,
  ruleMeta,
  ruleText,
  sampleOf,
  shareLinks,
  statCards,
  tableRow,
  type Version,
  versionMeta,
  versionView,
} from './model.ts';

const V1: Def = {
  pages: [
    { id: 'p1', title: 'Фото' },
    { id: 'p2', title: 'Показания' },
  ],
  fields: [
    { key: 'q-photos', pageId: 'p1', type: 'photo', label: 'Фото: спереди, сзади', required: true },
    { key: 'q-odo', pageId: 'p2', type: 'number', label: 'Пробег', required: true },
    { key: 'q-fuel-t', pageId: 'p2', type: 'text', label: 'Уровень топлива', required: false },
  ],
};

const V2: Def = {
  pages: V1.pages,
  fields: [
    V1.fields[0] as Def['fields'][number],
    { key: 'q-odo', pageId: 'p2', type: 'number', label: 'Пробег по одометру, км', required: true },
    {
      key: 'q-fuel',
      pageId: 'p2',
      type: 'choice',
      label: 'Уровень топлива',
      required: true,
      options: [
        { key: 'o1', label: '¼' },
        { key: 'o2', label: '¾' },
      ],
    },
    { key: 'q-defect', pageId: 'p2', type: 'bool', label: 'Есть дефекты?', required: true },
    {
      key: 'q-defect-text',
      pageId: 'p2',
      type: 'text',
      label: 'Описание дефекта',
      required: true,
      showIf: {
        mode: 'all',
        conditions: [{ fieldKey: 'q-defect', operator: 'equals', value: 'true' }],
      },
    },
  ],
};

const ver = (n: number, d: Def, current = false): Version => ({
  id: `v${n}`,
  formId: 'f1',
  number: n,
  definition: d,
  createdAt: n === 1 ? '2026-09-02T09:00:00Z' : '2026-09-24T09:00:00Z',
  createdBy: { memberId: 'm1', displayName: 'Дарья Зимина' },
  questionCount: d.fields.length,
  current,
});

const form = (p: Partial<Form> = {}): Form => ({
  id: 'f1',
  orgUnitId: null,
  name: 'Осмотр машины',
  status: 'published',
  revision: 1,
  moduleKey: 'fleet',
  templateId: null,
  groupId: null,
  owner: { memberId: 'm1', displayName: 'Дарья Зимина' },
  updatedAt: '2026-09-24T09:00:00Z',
  publishedVersionNumber: 2,
  versionCount: 2,
  hasUnpublishedChanges: false,
  questionCount: 5,
  responseCount: 2,
  enabledRuleCount: 1,
  settings: {
    access: 'members',
    acceptUntil: null,
    responseLimit: null,
    onePerMember: false,
    allowEditBeforeReview: true,
    confirmationText: 'Спасибо! Ответ отправлен.',
    scoring: false,
    passScore: null,
    showScore: true,
    progressBar: true,
    backButton: true,
    showLogo: true,
    retainResponsesDays: 365,
  },
  share: { publicToken: null },
  my: {
    create: true,
    manage: true,
    publish: true,
    publishPublic: true,
    readResponses: true,
    reviewResponses: true,
    respond: true,
  },
  ...p,
});

const resp = (p: Partial<Response> = {}): Response => ({
  id: 'r1',
  formId: 'f1',
  versionId: 'v2',
  submittedAt: '2026-09-27T06:05:00Z',
  answers: [
    { fieldKey: 'q-photos', value: { type: 'files', value: ['a', 'b', 'c', 'd', 'e'] } },
    { fieldKey: 'q-odo', value: { type: 'decimal', value: '84210' } },
    { fieldKey: 'q-fuel', value: { type: 'choices', value: ['o2'] } },
    { fieldKey: 'q-defect', value: { type: 'boolean', value: false } },
  ],
  reviewStatus: 'accepted',
  revision: 1,
  number: 'R-1012',
  versionNumber: 2,
  author: { memberId: 'm2', displayName: 'Илья Васильев' },
  subject: {
    ref: { moduleKey: 'fleet', entityType: 'trip', entityId: 't1' },
    label: 'Рейс Р-196',
  },
  channel: 'inspection',
  actions: [],
  my: { review: true, assign: true },
  ...p,
});

const rule = (p: Partial<Rule>): Rule => ({
  id: 'au-1',
  formId: 'f1',
  kind: 'task',
  enabled: true,
  version: 1,
  trigger: 'accepted',
  condition: { fieldKey: null, value: null },
  author: { memberId: 'm1', displayName: 'Дарья Зимина' },
  doneCount: 0,
  failedCount: 0,
  pendingBackfillCount: 0,
  createdAt: '2026-09-24T09:00:00Z',
  updatedAt: '2026-09-24T09:00:00Z',
  revision: 1,
  ...p,
});

describe('даты и числа эталона (по Москве)', () => {
  it('ответ — «ДД.ММ ЧЧ:ММ», версия — «ДД.ММ.ГГГГ», числа с разрядами', () => {
    expect(dayTime('2026-09-27T06:05:00Z')).toBe('27.09 09:05');
    expect(day('2026-09-23T22:30:00Z')).toBe('24.09.2026');
    expect(num(84056).replace(/\s/g, ' ')).toBe('84 056');
    expect(num(2.25)).toBe('2,3');
  });
});

describe('модуль формы (modName dc:550)', () => {
  it('отраслевой модуль или «Общая» — пространство «в БЗ» по умолчанию', () => {
    expect(moduleName('fleet')).toBe('Логистика');
    expect(moduleName(null)).toBe('Общая');
    expect(moduleName('unknown')).toBe('Общая');
  });
});

describe('«Настройки» dc:880–898', () => {
  const LATER = 'Появится позже';
  it('режимы доступа: выбранный, CRM, право, приглашения — позже', () => {
    const a = accessOptions(form(), [], false, LATER);
    expect(a.map((x) => [x.value, x.sel, x.off])).toEqual([
      ['members', true, false],
      ['public', false, false],
      ['invite', false, true],
    ]);
    expect(a[2]).toMatchObject({
      desc: 'У каждого приглашённого своя ссылка со сроком действия.',
      why: LATER,
    });
    const crm = accessOptions(form(), ['«Сотрудник»'], false, LATER);
    expect(crm[1]).toMatchObject({
      off: true,
      desc: 'Недоступно: в форме есть вопросы с данными CRM — «Сотрудник».',
    });
    const noRight = form({ my: { ...form().my, publishPublic: false } });
    expect(accessOptions(noRight, [], false, LATER)[1]?.off).toBe(true);
    expect(accessOptions(form(), [], true, LATER).map((x) => x.off)).toEqual([false, true, true]);
  });
  it('вопросы CRM черновика и версии без повторов', () => {
    const d: Def = {
      pages: [{ id: 'p1', title: 'Стр' }],
      fields: [{ key: 'q-p', pageId: 'p1', type: 'person', label: 'Сотрудник', required: false }],
    };
    expect(crmQuestions([d, d, V2])).toEqual(['«Сотрудник»']);
  });
  it('области, числа, максимум баллов, срок', () => {
    expect(
      areaOptions([
        { id: 'r', name: 'Москва', kind: 'region' },
        { id: 'f', name: 'Север Логистик', kind: 'firm' },
      ]),
    ).toEqual([
      { value: '', label: 'Вся организация' },
      { value: 'r', label: 'Москва · регион' },
      { value: 'f', label: 'Север Логистик · фирма' },
    ]);
    expect([numOrNull(''), numOrNull(' 1 000 '), numOrNull('0')]).toEqual([null, 1000, 0]);
    const quiz: Def = {
      pages: V1.pages,
      fields: [
        {
          key: 'a',
          pageId: 'p1',
          type: 'choice',
          label: 'A',
          required: false,
          options: [
            { key: 'o1', label: '1', score: 2 },
            { key: 'o2', label: '2', score: 5 },
          ],
        },
        {
          key: 'b',
          pageId: 'p1',
          type: 'multi',
          label: 'B',
          required: false,
          options: [
            { key: 'o1', label: '1', score: 1 },
            { key: 'o2', label: '2', score: 3 },
            { key: 'o3', label: '3', score: -2 },
          ],
        },
      ],
    };
    expect(maxScore(quiz)).toBe(9);
    expect(maxScore(V2)).toBe(0);
    expect([retainText(90), retainText(365), retainText(1095)]).toEqual([
      '90 дней',
      '1 год',
      '3 года',
    ]);
  });
});

describe('«Действия после ответа» dc:915–984', () => {
  const who = (id: string) => ({ m3: 'Марина Котова' })[id];
  const qs = labelsByKey([V2, V1]);
  it('текст карточки пяти видов', () => {
    expect(
      ruleText(
        rule({ task: { projectId: 'p', title: 'Проверить осмотр', assigneeMemberId: 'm3' } }),
        who,
      ),
    ).toBe('Задача «Проверить осмотр» → Марина Котова');
    expect(
      ruleText(rule({ task: { projectId: 'p', title: 'X', assigneeMemberId: '' } }), who),
    ).toBe('Задача «X» → без исполнителя');
    expect(ruleText(rule({ kind: 'notify', notify: { memberId: 'm3' } }), who)).toBe(
      'Уведомление в CRM → Марина Котова',
    );
    expect(ruleText(rule({ kind: 'email', email: { to: 'a@b.ru' } }), who)).toBe('Письмо → a@b.ru');
    expect(ruleText(rule({ kind: 'http', http: { url: 'https://x.ru' } }), who)).toBe(
      'POST https://x.ru',
    );
    const kb = {
      nodeId: 'n1',
      mode: 'table' as const,
      position: 'top' as const,
      fields: [],
      showLink: false,
      allEmployeesConfirmed: true,
    };
    expect(
      ruleText(
        rule({
          kind: 'kb',
          kb: { ...kb, node: { id: 'n1', title: 'Журнал осмотров машин' }, tableTitle: 'Осмотры' },
        }),
        who,
      ),
    ).toBe('Строка в таблицу «Осмотры» · страница «Журнал осмотров машин»');
    expect(ruleText(rule({ kind: 'kb', kb: { ...kb, mode: 'entry' } }), who)).toBe(
      'Запись на страницу «недоступна вам»',
    );
  });
  it('исполнитель задан, но имя неизвестно — не «без исполнителя»; адрес скрыт без «Настраивать»', () => {
    // Логисту listMembers отдаёт только его область: id исполнителя есть, имени нет (возврат 1 W4.23).
    expect(
      ruleText(rule({ task: { projectId: 'p', title: 'X', assigneeMemberId: 'm0' } }), who),
    ).toBe('Задача «X» → сотрудник вне вашей области');
    expect(ruleText(rule({ kind: 'notify', notify: { memberId: 'm0' } }), who)).toBe(
      'Уведомление в CRM → сотрудник вне вашей области',
    );
    // Без forms.manage контракт не отдаёт email и http (Q-W4.05-18): объекта вида нет.
    expect(ruleText(rule({ kind: 'email' }), who)).toBe(
      'Письмо → адрес видят только настраивающие форму',
    );
    expect(ruleText(rule({ kind: 'http' }), who)).toBe(
      'POST · адрес видят только настраивающие форму',
    );
  });
  it('страница списка «Страница Базы знаний»: свой доступ — « · только владелец» (dc:941)', () => {
    expect(kbPageLabel({ spaceName: 'Руководство', title: 'Политика', listed: true })).toBe(
      'Руководство · Политика · только владелец',
    );
    expect(kbPageLabel({ spaceName: 'Логистика', title: 'Журнал', listed: false })).toBe(
      'Логистика · Журнал',
    );
  });
  it('«Только владелец» новой страницы: шаг доступа после создания, без «Понимаю…», только владельцу', () => {
    const k = newDraft('kb', form(), { assignee: '', to: '' });
    const fields = [{ name: 'Дата', source: '$at' }];
    const own = {
      ...k,
      page: '__new',
      mode: 'entry' as const,
      fields,
      np: { space: 'sp', title: 'Ответы осмотров', access: 'owner' as const },
    };
    const all = { ...own, np: { ...own.np, access: 'all' as const } };
    // Доступ страницы — «Только выбранные» без записей: читают руководитель пространства и владелец бизнеса.
    expect(kbOwnerAccess(own)).toEqual({ mode: 'listed', entries: [] });
    expect(kbOwnerAccess(all)).toBeNull();
    expect(kbOwnerAccess({ ...own, page: 'n1' })).toBeNull();
    const listed = (id: string) => (id === 'n-own' ? true : id === 'n-all' ? false : undefined);
    expect(kbSeenByAll(own, listed)).toBe(false);
    expect(kbSeenByAll(all, listed)).toBe(true);
    expect(kbSeenByAll({ ...own, page: 'n-own' }, listed)).toBe(false);
    expect(kbSeenByAll({ ...own, page: 'n-all' }, listed)).toBe(true);
    // Неизвестная страница — как «все сотрудники»: подтверждение обязательно.
    expect(kbSeenByAll({ ...own, page: 'n-x' }, listed)).toBe(true);
    const pageExists = () => false;
    expect(ruleError({ ...own, allSee: false }, { pageExists, canOwnerOnly: () => true })).toBe(
      null,
    );
    expect(ruleError({ ...own, allSee: false }, { pageExists, canOwnerOnly: () => false })).toBe(
      'Страницу «Только владелец» может создать только владелец',
    );
    expect(ruleError({ ...own, allSee: false }, { pageExists })).toBe(
      'Страницу «Только владелец» может создать только владелец',
    );
    expect(ruleError({ ...all, allSee: true }, { pageExists })).toBe(
      'Подтвердите, что записи увидят все сотрудники с доступом к странице',
    );
  });
  it('мета: когда, условие словами, версия, записано', () => {
    expect(ruleMeta(rule({ version: 2 }), qs)).toBe('после принятия ответа · правило v2');
    expect(
      ruleMeta(
        rule({
          kind: 'kb',
          trigger: 'submitted',
          doneCount: 2,
          condition: { fieldKey: 'q-defect', value: 'true' },
        }),
        qs,
      ),
    ).toBe('после отправки ответа · если «Есть дефекты?» = да · правило v1 · записано ответов: 2');
    expect(ruleMeta(rule({ condition: { fieldKey: 'q-fuel', value: 'o2' } }), qs)).toBe(
      'после принятия ответа · если «Уровень топлива» = ¾ · правило v1',
    );
  });
  it('«Только если» и «равно»', () => {
    expect(condFields(V2)).toEqual([
      { value: 'q-fuel', label: 'Уровень топлива' },
      { value: 'q-defect', label: 'Есть дефекты?' },
    ]);
    expect(condValues(V2, 'q-defect')).toEqual([
      { value: 'true', label: 'да' },
      { value: 'false', label: 'нет' },
    ]);
    expect(condValues(V2, 'q-fuel').map((x) => x.label)).toEqual(['¼', '¾']);
  });
  it('источники, поля по умолчанию, сопоставление, нет в форме', () => {
    expect(
      kbSources(V2)
        .slice(0, 7)
        .map((x) => x.label),
    ).toEqual([
      'Дата и время ответа',
      'Автор ответа',
      'Объект CRM',
      'Номер ответа',
      'Название формы',
      'Версия формы',
      'Фото: спереди, сзади',
    ]);
    expect(kbDefault(form(), V2).map((x) => `${x.name}←${x.source}`)).toEqual([
      'Дата←$at',
      'Автор←$author',
      'Объект←$object',
      'Фото: спереди, сзади←q-photos',
      'Пробег по одометру, км←q-odo',
      'Уровень топлива←q-fuel',
      'Есть дефекты←q-defect',
      'Описание дефекта←q-defect-text',
      'Ответ←$id',
    ]);
    expect(kbDefault(form({ moduleKey: null }), V1).map((x) => x.source)).not.toContain('$object');
    const m = kbMap(
      [
        { id: 'c1', name: 'Дата' },
        { id: 'c2', name: 'Пробег, км' },
        { id: 'c3', name: 'Топливо' },
      ],
      V2,
      [{ columnId: 'c3', name: 'Топливо', source: 'q-fuel-t' }],
    );
    expect(m.map((x) => x.source)).toEqual(['$at', '', 'q-fuel-t']);
    expect(kbMissing(m, V2).map((x) => x.name)).toEqual(['Топливо']);
  });
  it('значения поля «в БЗ» и пример по последнему ответу', () => {
    const r = resp();
    expect(
      [
        '$at',
        '$author',
        '$object',
        '$id',
        '$form',
        '$ver',
        'q-odo',
        'q-fuel',
        'q-defect',
        'q-photos',
      ].map((s) => kbValue(form(), r, s, V2).replace(/\s/g, ' ')),
    ).toEqual([
      '27.09 09:05',
      'Илья Васильев',
      'Рейс Р-196',
      'R-1012',
      'Осмотр машины',
      'v2',
      '84 210',
      '¾',
      'нет',
      // formVal эталона (models.js:113): файлы не копируются — ссылка на ответ.
      '5 фото · файлы в ответе R-1012',
    ]);
    // В карточке ответа — без ссылки на ответ.
    expect(answerText(V2.fields[0], r.answers[0]?.value)).toBe('5 фото');
    expect(sampleOf([resp({ number: 'R-0988' }), resp(), resp({ number: 'R-0999' })])?.number).toBe(
      'R-1012',
    );
    expect(sampleOf([])).toBeUndefined();
  });
  it('проверка редактора до сохранения: тексты эталона', () => {
    const f = form();
    const pageExists = (s: string, t: string) => s === 'sp' && t === 'Журнал';
    const t = newDraft('task', f, { assignee: 'm3', to: '' });
    expect(t.title).toBe('Проверить ответ: Осмотр машины');
    expect(t.trigger).toBe('submitted');
    expect(ruleError({ ...t, title: ' ' }, { pageExists })).toBe('Укажите название задачи');
    expect(ruleError(t, { pageExists })).toBeNull();
    const e = newDraft('email', f, { assignee: '', to: '' });
    expect(ruleError({ ...e, to: 'почта' }, { pageExists })).toBe('Укажите адрес почты');
    const h = newDraft('http', f, { assignee: '', to: '' });
    expect(ruleError({ ...h, url: 'http://x' }, { pageExists })).toBe(
      'Адрес запроса должен начинаться с https://',
    );
    const n = newDraft('notify', f, { assignee: '', to: '' });
    expect(ruleError(n, { pageExists })).toBe('Выберите, кого уведомить');
    const k = newDraft('kb', f, { assignee: '', to: '' });
    expect(k.trigger).toBe('accepted');
    expect(ruleError(k, { pageExists })).toBe('Выберите страницу Базы знаний');
    const np = { ...k, page: '__new', np: { space: '', title: 'Ответы', access: 'all' as const } };
    expect(ruleError(np, { pageExists })).toBe('Выберите раздел для новой страницы');
    expect(ruleError({ ...np, np: { ...np.np, space: 'sp', title: 'Ж' } }, { pageExists })).toBe(
      'Название страницы — не короче 3 символов',
    );
    expect(
      ruleError({ ...np, np: { ...np.np, space: 'sp', title: 'Журнал' } }, { pageExists }),
    ).toBe(
      'В этом разделе уже есть страница «Журнал» — выберите её в списке или измените название',
    );
    const pg = { ...k, page: 'n1' };
    expect(ruleError(pg, { pageExists })).toBe('Выберите таблицу');
    expect(ruleError({ ...pg, table: '__new', newTitle: 'О' }, { pageExists })).toBe(
      'Укажите название новой таблицы',
    );
    const withT = { ...pg, table: 't1', fields: [{ name: 'Дата', source: '' }] };
    expect(ruleError(withT, { pageExists })).toBe('Укажите данные хотя бы для одного столбца');
    expect(ruleError({ ...withT, mode: 'entry' as const }, { pageExists })).toBe(
      'Выберите, что записать',
    );
    const f2 = [
      { name: 'Дата', source: '$at' },
      { name: ' ', source: '$id' },
    ];
    expect(ruleError({ ...withT, fields: f2 }, { pageExists })).toBe('У поля нет названия');
    const f3 = [
      { name: 'Дата', source: '$at' },
      { name: 'дата', source: '$id' },
    ];
    expect(ruleError({ ...withT, fields: f3 }, { pageExists })).toBe('Названия полей повторяются');
    const ok = { ...withT, fields: [{ name: 'Дата', source: '$at' }], allSee: true };
    expect(ruleError(ok, { pageExists })).toBe(
      'Подтвердите, что записи увидят все сотрудники с доступом к странице',
    );
    expect(ruleError({ ...ok, ack: true }, { pageExists })).toBeNull();
  });
  it('черновик из правила и тело запроса — объект только своего вида', () => {
    const r = rule({
      id: 'au-9',
      condition: { fieldKey: 'q-defect', value: 'true' },
      task: { projectId: 'p1', title: 'Проверить', assigneeMemberId: 'm3' },
    });
    const d = draftOf(r, form());
    expect(d).toMatchObject({
      id: 'au-9',
      condField: 'q-defect',
      condValue: 'true',
      title: 'Проверить',
    });
    expect(ruleBody(d)).toEqual({
      kind: 'task',
      enabled: true,
      trigger: 'accepted',
      condition: { fieldKey: 'q-defect', value: 'true' },
      task: { projectId: 'p1', title: 'Проверить', assigneeMemberId: 'm3' },
    });
    const k = {
      ...newDraft('kb', form(), { assignee: '', to: '' }),
      page: 'n1',
      table: 't1',
      ack: true,
      fields: [
        { columnId: 'c1', name: 'Дата', source: '$at' },
        { columnId: 'c2', name: 'Пусто', source: '' },
      ],
    };
    expect(ruleBody(k).kb).toEqual({
      nodeId: 'n1',
      mode: 'table',
      tableId: 't1',
      position: 'top',
      fields: [{ columnId: 'c1', name: 'Дата', source: '$at' }],
      showLink: false,
      allEmployeesConfirmed: true,
    });
    expect(ruleBody({ ...k, mode: 'entry' }).kb).toMatchObject({ head: '$object' });
    expect(ruleBody({ ...k, mode: 'entry' }).kb?.tableId).toBeUndefined();
  });
});

describe('«Ответы» dc:986–1011', () => {
  const versions = [ver(1, V1), ver(2, V2, true)];
  it('колонки всех версий, свежая первой; пустые состояния', () => {
    expect(respColumns(versions, undefined).map((q) => q.key)).toEqual([
      'q-photos',
      'q-odo',
      'q-fuel',
      'q-defect',
      'q-defect-text',
      'q-fuel-t',
    ]);
    expect(respColumns([], V1).map((q) => q.key)).toEqual(['q-photos', 'q-odo', 'q-fuel-t']);
    expect(emptyText(form({ publishedVersionNumber: null, status: 'draft' }))).toBe(
      'Ответов нет: форма ещё не опубликована.',
    );
    expect(emptyText(form({ status: 'closed' }))).toBe('Ответов нет, приём закрыт.');
    expect(emptyText(form())).toBe('Ответов пока нет. Отправьте ссылку из «Поделиться».');
  });
  it('карточки сводки: полосы (да / нет строчными), числа, тексты', () => {
    const cards = statCards({
      formId: 'f1',
      total: 2,
      questions: [
        {
          fieldKey: 'q-defect',
          label: 'Есть дефекты?',
          type: 'bool',
          answered: 1,
          options: [
            { key: 'true', label: 'Да', count: 0, percent: 0 },
            { key: 'false', label: 'Нет', count: 1, percent: 100 },
          ],
        },
        {
          fieldKey: 'q-odo',
          label: 'Пробег',
          type: 'number',
          answered: 2,
          numbers: { average: '84056', min: '83902', max: '84210' },
        },
        { fieldKey: 'q-n', label: 'Пусто', type: 'int', answered: 0 },
        {
          fieldKey: 'q-t',
          label: 'Текст',
          type: 'text',
          answered: 1,
          recentTexts: ['почти полный'],
        },
      ],
    });
    expect(cards[0]).toMatchObject({
      meta: 'Да / нет · ответили 1 из 2',
      bars: [
        { label: 'да', n: '0', pct: '0%' },
        { label: 'нет', n: '1', pct: '100%' },
      ],
    });
    expect(cards[1]?.numText?.replace(/\s/g, ' ')).toBe(
      'Среднее 84 056 · мин 83 902 · макс 84 210',
    );
    expect(cards[2]?.numText).toBe('Нет числовых ответов');
    expect(cards[3]?.texts).toEqual(['почти полный']);
  });
  it('карточка ленты: строки по версии, условие, «Не ответил», пояснение', () => {
    const r = resp();
    expect(cardRows(r, V2)).toEqual([
      { label: 'Фото: спереди, сзади', value: '5 фото', muted: false },
      { label: 'Пробег по одометру, км', value: num(84210), muted: false },
      { label: 'Уровень топлива', value: '¾', muted: false },
      { label: 'Есть дефекты?', value: 'нет', muted: false },
      { label: 'Описание дефекта', value: 'Не показывался по условию', muted: true },
    ]);
    expect(cardRows(resp({ answers: [] }), V1)[0]).toEqual({
      label: 'Фото: спереди, сзади',
      value: 'Не ответил',
      muted: true,
    });
    expect(cardNote(r, form())).toBe(
      'Илья Васильев · 27.09 09:05 · показан по структуре версии v2',
    );
    expect(cardNote(resp({ versionNumber: 1 }), form())).toBe(
      'Илья Васильев · 27.09 09:05 · показан по структуре версии v1 (действует v2)',
    );
    expect(feedTitle(r)).toBe('R-1012 · Рейс Р-196');
    const noSubject: Response = { ...r };
    delete noSubject.subject;
    expect(feedTitle(noSubject)).toBe('R-1012');
  });
  it('журнал действий: «в БЗ», задача, ошибка с «Повторить» только при праве', () => {
    const r = resp({
      actions: [
        {
          ruleId: 'au-1',
          ruleVersion: 1,
          kind: 'task',
          ok: true,
          at: '2026-09-27T06:10:00Z',
          text: 'Задача LOG-101 «Проверить осмотр» · Марина Котова · Новая',
          retryable: false,
        },
        {
          ruleId: 'au-2',
          ruleVersion: 1,
          kind: 'kb',
          ok: true,
          at: '2026-09-27T06:12:00Z',
          text: 'Строка в таблице «Осмотры» · страница «Журнал осмотров машин»',
          node: { id: 'n1', title: 'Журнал осмотров машин' },
          retryable: false,
        },
        {
          ruleId: 'au-3',
          ruleVersion: 2,
          kind: 'kb',
          ok: false,
          at: '2026-09-27T06:12:00Z',
          error: 'страница удалена из Базы знаний',
          retryable: true,
        },
      ],
    });
    const lines = journal(r, true, 'Не выполнено: {err} · {at}');
    expect(lines.map((l) => l.text)).toEqual([
      'Задача LOG-101 «Проверить осмотр» · Марина Котова · Новая',
      'Строка в таблице «Осмотры» · страница «Журнал осмотров машин» · 27.09 09:12 · правило v1',
      'Не сохранено в Базу знаний: страница удалена из Базы знаний · 27.09 09:12',
    ]);
    expect(lines.map((l) => [l.nodeId ?? null, l.retry])).toEqual([
      [null, false],
      ['n1', false],
      [null, true],
    ]);
    expect(journal(r, false, '').map((l) => l.retry)).toEqual([false, false, false]);
  });
  it('строка таблицы: «—» у пустых, подписи вариантов по версии ответа', () => {
    const cols = respColumns(versions, undefined);
    expect(tableRow(resp(), cols, versions).map((x) => x.replace(/\s/g, ' '))).toEqual([
      'R-1012',
      '27.09 09:05',
      'Илья Васильев',
      'Рейс Р-196',
      'v2',
      '5 фото',
      '84 210',
      '¾',
      'нет',
      '—',
      '—',
    ]);
  });
  it('подписи значений: даты, деньги, ссылки, «Другое»', () => {
    expect(answerText(undefined, { type: 'date', value: '2026-10-01' })).toBe('01.10.2026');
    expect(
      answerText(undefined, {
        type: 'money',
        value: { amountMinor: 150000, currency: 'RUB' },
      }).replace(/\s/g, ' '),
    ).toBe('1 500');
    expect(
      answerText(undefined, {
        type: 'reference',
        value: { moduleKey: 'core', entityType: 'member', entityId: 'm' },
        label: 'Марина Котова',
      }),
    ).toBe('Марина Котова');
    expect(
      answerText(
        { key: 'q', pageId: 'p', type: 'choice', label: 'Q', required: false, options: [] },
        { type: 'choices', value: ['other'], otherText: 'свой' },
      ),
    ).toBe('свой');
    expect(answerText(undefined, { type: 'null', value: null })).toBe('');
  });
});

describe('«Версии» dc:1012–1020', () => {
  it('отличия от предыдущей версии и убранные вопросы', () => {
    const v = versionView(ver(2, V2), ver(1, V1));
    expect(v.questions.map((q) => [q.key, q.diff?.label ?? null])).toEqual([
      ['q-photos', null],
      ['q-odo', 'Текст изменён'],
      ['q-fuel', 'Добавлено'],
      ['q-defect', 'Добавлено'],
      ['q-defect-text', 'Добавлено'],
    ]);
    expect(v.questions[4]?.meta).toBe(
      'ID q-defect-text · Короткий текст · обязательный · если «Есть дефекты?» = да',
    );
    expect(v.questions.map((q) => [q.page, q.pageStart])).toEqual([
      ['Фото', true],
      ['Показания', true],
      ['Показания', false],
      ['Показания', false],
      ['Показания', false],
    ]);
    expect(v.removed).toEqual(['«Уровень топлива»']);
    expect(versionView(ver(1, V1), undefined).questions.every((q) => q.diff === null)).toBe(true);
    const typed: Def = {
      ...V1,
      fields: [{ ...(V1.fields[1] as Def['fields'][number]), type: 'int' }],
    };
    expect(versionView(ver(2, typed), ver(1, V1)).questions[0]?.diff).toEqual({
      label: 'Новый тип',
      tone: 'warn',
    });
    const hinted: Def = {
      ...V1,
      fields: [{ ...(V1.fields[1] as Def['fields'][number]), hint: 'км' }],
    };
    expect(versionView(ver(2, hinted), ver(1, V1)).questions[0]?.diff?.label).toBe('Изменено');
  });
  it('версия N>1 без версии N−1 — сравнение с пустым списком: всё «Добавлено» (versVM dc:1016–1017)', () => {
    const v = versionView(ver(3, V2), undefined);
    expect(v.questions.map((q) => q.diff?.label ?? null)).toEqual(V2.fields.map(() => 'Добавлено'));
    expect(v.removed).toEqual([]);
  });
  it('условия «И / ИЛИ», «≠»; мета версии', () => {
    expect(
      condText(
        {
          mode: 'any',
          conditions: [
            { fieldKey: 'q-defect', operator: 'equals', value: 'true' },
            { fieldKey: 'q-fuel', operator: 'not_equals', value: 'o1' },
          ],
        },
        V2,
      ),
    ).toBe('«Есть дефекты?» = да или «Уровень топлива» ≠ ¼');
    expect(versionMeta(ver(2, V2))).toBe('24.09.2026 · Дарья Зимина · вопросов: 5');
  });
});

describe('«Поделиться формой» dc:1081–1087', () => {
  it('черновик — без ссылок; сотрудники; публичная с кодом для сайта', () => {
    expect(shareLinks(form({ publishedVersionNumber: null, status: 'draft' }), 'http://x')).toEqual(
      [],
    );
    expect(shareLinks(form(), 'http://x')).toEqual([
      {
        key: 'int',
        label: 'Ссылка для сотрудников',
        value: 'http://x/forms/f1',
        note: 'Откроется после входа. Ответить могут сотрудники с правом «Формы» в области формы.',
      },
    ]);
    const pub = form({
      settings: { ...form().settings, access: 'public' },
      share: { publicToken: 'tok' },
    });
    expect(shareLinks(pub, 'http://x').map((l) => [l.label, l.value])).toEqual([
      ['Публичная ссылка', 'http://x/f/tok'],
      [
        'Код для сайта',
        '<iframe src="http://x/f/tok?embed=1" width="100%" height="640" frameborder="0"></iframe>',
      ],
    ]);
    const noTok = form({ settings: { ...form().settings, access: 'public' } });
    expect(shareLinks(noTok, 'http://x')[0]?.label).toBe('Ссылка для сотрудников');
  });
});
