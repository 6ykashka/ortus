// W4.32 · Модель «Базы знаний» (эталон design-2026-10-19 «База знаний.dc.html», логика М:379–727): даты сида,
// справочники, дерево и поиск, вкладки, меню, доступ страницы, мета, таблицы, ознакомление, черновик и публикация,
// карта и проверка, шаблон пространства, области, влияние, записи списка доступа.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  accessImpactLines,
  ackOf,
  avatarOf,
  dayOf,
  diagramOuts,
  draftOf,
  entryWarning,
  excerpt,
  homeOf,
  impactNames,
  indexTree,
  initialsOf,
  isHome,
  kidsOf,
  mapGrid,
  menuOf,
  metaParts,
  momentOf,
  openPath,
  ownAccessOf,
  paragraphs,
  publishBody,
  quickReader,
  sameEntry,
  stampOf,
  subtreeIds,
  tablesOf,
  tabOf,
  tabsOf,
  templateChip,
  titleMatches,
  toggleTemplateNode,
  treeOptions,
  treeRows,
  unitOptions,
  verdictOf,
} from './model.ts';

type S = components['schemas'];

const my = (edit = true, create = true, lead = true) => ({ edit, create, lead });

function sum(
  id: string,
  title: string,
  o: Partial<S['KnowledgeNodeSummary']> = {},
): S['KnowledgeNodeSummary'] {
  return {
    id,
    spaceId: 'sp',
    parentId: null,
    position: 0,
    kind: 'page',
    title,
    status: 'active',
    accessMode: 'inherit',
    sensitivity: 'normal',
    archived: false,
    version: 1,
    my: my(),
    ...o,
  };
}

/** Дерево «Логистики» сида (фрагмент). */
const NODES = [
  sum('home', 'Обзор', { position: 0 }),
  sum('reg', 'Регламенты', { kind: 'folder', position: 1 }),
  sum('kb1', 'Регламент приёмки смены', { parentId: 'reg', position: 1, version: 2 }),
  sum('kb1a', 'Чек-лист приёмки', { parentId: 'kb1', position: 1 }),
  sum('kb6', 'Выезд при критическом дефекте', { parentId: 'reg', position: 3, status: 'review' }),
  sum('drv', 'Водителям', { kind: 'folder', position: 4, accessMode: 'listed' }),
  sum('fin', 'Тарифы и начисления', {
    position: 5,
    accessMode: 'listed',
    sensitivity: 'finance',
  }),
  sum('file', 'Договор аренды стоянки.pdf', { kind: 'file', position: 6 }),
];

const SPACE: S['KnowledgeSpace'] = {
  id: 'sp',
  name: 'Логистика',
  icon: 'local_shipping',
  color: '#1F6B52',
  orgUnitId: 'f',
  areaLabel: 'Фирма «Север Логистик»',
  access: 'limited',
  templateKey: null,
  homeNodeId: 'home',
  my: { owner: true, lead: true, view: true, create: true, edit: true, role: 'Владелец бизнеса' },
  leadNames: ['Марина Котова'],
  pageCount: 16,
  openRequestCount: 2,
  revision: 1,
};

function node(o: Partial<S['KnowledgeNode']> = {}): S['KnowledgeNode'] {
  return {
    ...sum('kb1', 'Регламент приёмки смены', { parentId: 'reg', version: 2 }),
    spaceName: 'Логистика',
    path: [{ id: 'reg', title: 'Регламенты' }],
    owner: { memberId: 'm', displayName: 'Дарья Зимина' },
    reviewBy: '2027-03-24',
    current: {
      version: 2,
      publishedAt: '2026-09-23T21:00:00Z',
      authorDisplayName: 'Дарья Зимина',
      body: 'Первый.\n\nВторой.',
    },
    versions: [],
    tables: [],
    entries: [],
    revision: 2,
    ...o,
  };
}

const ST: Record<string, string> = {
  active: 'Действует',
  draft: 'Черновик',
  review: 'На проверке',
  outdated: 'Пора пересмотреть',
};

describe('даты сида по Москве', () => {
  it('день, отметка журнала, момент запроса, дата контракта', () => {
    expect(dayOf('2026-09-23T21:00:00Z')).toBe('24.09.2026');
    expect(dayOf('2027-03-24')).toBe('24.03.2027');
    expect(dayOf(null)).toBe('');
    expect(stampOf('2026-09-24T15:10:00Z')).toBe('24.09 18:10');
    expect(momentOf('2026-10-20T11:30:00Z')).toBe('20.10.2026 14:30');
  });
});

describe('помощники эталона', () => {
  it('инициалы, цвет аватара, абзацы, выдержка', () => {
    expect(initialsOf('Марина Котова')).toBe('МК');
    expect(initialsOf('')).toBe('?');
    expect(avatarOf('Марина Котова')).toMatch(/^#[0-9A-F]{6}$/);
    expect(avatarOf('Марина Котова')).toBe(avatarOf('Марина Котова'));
    expect(paragraphs('А.\n\n  Б.\n \nВ.')).toEqual(['А.', 'Б.', 'В.']);
    expect(excerpt('раз  два\nтри', 100)).toBe('раз два три');
    expect(excerpt('абвгдеёжз', 5)).toBe('абвг…');
  });
});

describe('дерево', () => {
  const t = indexTree(NODES);

  it('верхний уровень, дети, путь, главная, раскрытие пути', () => {
    expect(t.kids(null).map((n) => n.title)).toEqual([
      'Обзор',
      'Регламенты',
      'Водителям',
      'Тарифы и начисления',
      'Договор аренды стоянки.pdf',
    ]);
    expect(t.kids('reg').map((n) => n.id)).toEqual(['kb1', 'kb6']);
    expect(t.path('kb1a').map((n) => n.id)).toEqual(['reg', 'kb1']);
    expect(homeOf(SPACE, t)?.id).toBe('home');
    expect(homeOf({ ...SPACE, homeNodeId: null }, t)?.id).toBe('home');
    expect([...openPath(t, 'kb1a')]).toEqual(['reg', 'kb1']);
  });

  it('строки: свёрнутые папки, чип статуса строчными, финансовая и свой доступ, выбранная', () => {
    const rows = treeRows(t, { open: new Set(), selected: 'home', statusLabel: (s) => ST[s] ?? s });
    expect(rows.map((r) => r.title)).toEqual([
      'Обзор',
      'Регламенты',
      'Водителям',
      'Тарифы и начисления',
      'Договор аренды стоянки.pdf',
    ]);
    expect(rows[0]).toMatchObject({
      selected: true,
      icon: 'description',
      depth: 0,
      hasKids: false,
    });
    expect(rows[1]).toMatchObject({ icon: 'folder', hasKids: true, open: false });
    expect(rows[2]).toMatchObject({ lock: true, fin: false });
    expect(rows[3]).toMatchObject({ lock: true, fin: true });
    expect(rows[4]?.icon).toBe('picture_as_pdf');
    const open = treeRows(t, {
      open: new Set(['reg']),
      selected: undefined,
      statusLabel: (s) => ST[s] ?? s,
    });
    expect(open.map((r) => [r.title, r.depth])).toEqual([
      ['Обзор', 0],
      ['Регламенты', 0],
      ['Регламент приёмки смены', 1],
      ['Выезд при критическом дефекте', 1],
      ['Водителям', 0],
      ['Тарифы и начисления', 0],
      ['Договор аренды стоянки.pdf', 0],
    ]);
    expect(open[1]?.icon).toBe('folder_open');
    expect(open[3]?.chip).toEqual({ label: 'на проверке', tone: 'warn' });
  });

  it('поиск: плоский список совпадений с путём', () => {
    const rows = treeRows(t, {
      open: new Set(),
      selected: undefined,
      statusLabel: (s) => s,
      matches: titleMatches(t, 'чек'),
    });
    expect(rows.map((r) => [r.title, r.where, r.depth])).toEqual([
      ['Чек-лист приёмки', 'Регламенты › Регламент приёмки смены', 0],
    ]);
    expect(
      treeRows(t, { open: new Set(), selected: undefined, statusLabel: (s) => s, matches: [] }),
    ).toEqual([]);
  });

  it('варианты родителя с отступом и поддерево', () => {
    expect(treeOptions(t, (n) => n.kind === 'folder' || n.id === 'kb1')).toEqual([
      { v: 'reg', t: 'Регламенты' },
      { v: 'kb1', t: '   └ Регламент приёмки смены' },
      { v: 'drv', t: 'Водителям' },
    ]);
    expect([...subtreeIds(t, 'reg')].sort()).toEqual(['kb1', 'kb1a', 'kb6', 'reg']);
  });
});

describe('вкладки пространства', () => {
  it('руководитель: четыре вкладки и бейдж запросов; читатель — две', () => {
    expect(tabsOf(SPACE)).toEqual([
      { key: 'pages', badge: 0 },
      { key: 'people', badge: 2 },
      { key: 'auto', badge: 0 },
      { key: 'arch', badge: 0 },
    ]);
    const reader = { ...SPACE, my: { ...SPACE.my, lead: false, edit: false } };
    expect(tabsOf(reader).map((x) => x.key)).toEqual(['pages', 'people']);
    expect(tabsOf({ ...reader, my: { ...reader.my, edit: true } }).map((x) => x.key)).toEqual([
      'pages',
      'people',
      'arch',
    ]);
    expect(tabOf(reader, 'auto')).toBe('pages');
    expect(tabOf(SPACE, 'auto')).toBe('auto');
    expect(tabOf(SPACE, undefined)).toBe('pages');
  });
});

describe('страница', () => {
  const t = indexTree(NODES);

  it('меню по правам: подстраница, перенос, утвердить, в архив; у главной — без переноса и архива', () => {
    expect(menuOf(SPACE, node())).toEqual(['child', 'move', 'archive']);
    expect(menuOf(SPACE, node({ status: 'review' }))).toEqual([
      'child',
      'move',
      'approve',
      'archive',
    ]);
    const home = node({ id: 'home', parentId: null, title: 'Обзор', path: [] });
    expect(isHome(SPACE, home)).toBe(true);
    expect(menuOf(SPACE, home)).toEqual(['child']);
    const reader = { ...SPACE, my: { ...SPACE.my, edit: false, lead: false } };
    expect(menuOf(reader, node({ my: my(false, false, false) }))).toEqual([]);
    expect(menuOf(SPACE, node({ kind: 'file' }))).toEqual(['move', 'archive']);
  });

  it('свой доступ: сам узел, предок из дерева, как у пространства', () => {
    expect(ownAccessOf(t, node({ accessMode: 'listed', title: 'Тарифы' }))).toEqual({
      self: true,
      title: 'Тарифы',
      mode: 'listed',
    });
    expect(ownAccessOf(t, node({ path: [{ id: 'drv', title: 'Водителям' }] }))).toEqual({
      self: false,
      title: 'Водителям',
      mode: 'listed',
    });
    expect(ownAccessOf(t, node())).toBeNull();
  });

  it('мета: вид, владелец, обновлено, пересмотреть до', () => {
    expect(metaParts(node())).toEqual({
      kind: 'page',
      owner: 'Дарья Зимина',
      updated: { date: '24.09.2026', by: 'Дарья Зимина' },
      review: '24.03.2027',
    });
    expect(
      metaParts(node({ reviewBy: null, owner: { memberId: null, displayName: '' } })),
    ).toMatchObject({ owner: '—', review: null });
  });

  it('схема: два исхода — стрелки вверх и вниз, один — вперёд', () => {
    expect(
      diagramOuts({
        steps: [],
        outcomes: [
          { text: 'Принято', tone: 'ok' },
          { text: 'Возврат', tone: 'warn' },
        ],
      }).map((o) => o.arrow),
    ).toEqual(['north_east', 'south_east']);
    expect(diagramOuts({ steps: [], outcomes: [{ text: 'Готово', tone: 'ok' }] })[0]?.arrow).toBe(
      'arrow_forward',
    );
    expect(diagramOuts(undefined)).toEqual([]);
  });

  it('таблицы: строки по колонкам, «—» вместо пустых, подпись формы или числа строк; пустая таблица узла', () => {
    const table: S['KnowledgeTable'] = {
      id: 't',
      nodeId: 'kb1',
      title: 'Осмотры',
      columns: [
        { id: 'a', name: 'Дата', type: 'text' },
        { id: 'b', name: 'Топливо', type: 'text' },
      ],
      rows: [
        {
          id: 'r',
          addedAt: '2026-09-27T06:12:00Z',
          cells: { a: '27.09 09:05' },
          source: { formId: 'f', responseNumber: 'R-1', formVersion: 1 },
        },
      ],
    };
    expect(tablesOf(node({ tables: [table] }), ['Дата', 'Что', 'Кто'])).toEqual([
      {
        id: 't',
        title: 'Осмотры',
        cols: ['Дата', 'Топливо'],
        rows: [['27.09 09:05', '—']],
        note: { kind: 'form' },
      },
    ]);
    const plain = {
      ...table,
      rows: table.rows.map((r) => ({ id: r.id, addedAt: r.addedAt, cells: r.cells })),
    };
    expect(tablesOf(node({ tables: [plain] }), [])[0]?.note).toEqual({ kind: 'count', n: 1 });
    expect(tablesOf(node({ kind: 'table', title: 'Журнал' }), ['Дата', 'Что', 'Кто'])).toEqual([
      {
        id: 'kb1',
        title: 'Журнал',
        cols: ['Дата', 'Что', 'Кто'],
        rows: [],
        note: { kind: 'empty' },
      },
    ]);
  });

  it('ознакомление: аудитории — «Ознакомлен», руководителю — статистика, подтверждено', () => {
    const ack = (o: Partial<S['KnowledgeAck']>): S['KnowledgeAck'] => ({
      version: 2,
      audienceLabel: 'роль «Водитель»',
      mine: { required: false, done: false },
      ...o,
    });
    expect(ackOf(node(), false)).toBeNull();
    expect(ackOf(node({ ack: ack({}) }), false)).toBeNull();
    expect(
      ackOf(node({ ack: ack({ mine: { required: true, done: false } }) }), false),
    ).toMatchObject({
      ask: true,
      done: false,
      highlight: true,
      stats: null,
    });
    expect(ackOf(node({ ack: ack({ mine: { required: true, done: false } }) }), true)?.ask).toBe(
      false,
    );
    expect(
      ackOf(node({ ack: ack({ mine: { required: true, done: true } }) }), false),
    ).toMatchObject({
      ask: false,
      done: true,
      highlight: false,
    });
    expect(
      ackOf(
        node({
          ack: ack({
            total: 7,
            doneCount: 1,
            pendingNames: ['А', 'Б', 'В', 'Г', 'Д', 'Е'],
          }),
        }),
        false,
      )?.stats,
    ).toEqual({ pct: '14%', done: 1, total: 7, names: 'А, Б, В, Г, Д', more: 1 });
  });

  it('подстраницы: дети узла; у файла — нет', () => {
    expect(kidsOf(t, node({ id: 'reg', kind: 'folder' })).map((x) => x.id)).toEqual(['kb1', 'kb6']);
    expect(kidsOf(t, node({ id: 'reg', kind: 'file' }))).toEqual([]);
  });

  it('черновик и тело публикации: шаги — у схемы, ознакомление — если запрошено', () => {
    const n = node({
      kind: 'diagram',
      diagram: { steps: ['А', 'Б'], outcomes: [] },
      ack: { version: 2, audienceLabel: 'x', mine: { required: false, done: false } },
    });
    const d = draftOf(n);
    expect(d).toEqual({
      id: 'kb1',
      title: 'Регламент приёмки смены',
      body: 'Первый.\n\nВторой.',
      steps: 'А\nБ',
      ack: true,
      base: 2,
    });
    expect(publishBody({ ...d, steps: 'А\nБ\nВ' }, n)).toEqual({
      title: 'Регламент приёмки смены',
      body: 'Первый.\n\nВторой.',
      steps: ['А', 'Б', 'В'],
      requestAck: true,
    });
    expect(publishBody({ ...d, ack: false }, node())).toEqual({
      title: 'Регламент приёмки смены',
      body: 'Первый.\n\nВторой.',
    });
  });
});

describe('участники и карта', () => {
  it('сетка карты и итог проверки', () => {
    expect(mapGrid(3)).toEqual({ cols: 'minmax(180px,1fr) repeat(3,84px)', minW: '464px' });
    expect(verdictOf(null)).toEqual({ tone: 'neutral', icon: 'info' });
    const x = {
      nodeId: 'n',
      memberId: 'm',
      memberDisplayName: 'М',
      functionBlocked: false,
      chain: [],
      summary: '',
    };
    expect(verdictOf({ ...x, view: true, edit: true }).tone).toBe('ok');
    expect(verdictOf({ ...x, view: true, edit: false }).tone).toBe('info');
    expect(verdictOf({ ...x, view: false, edit: false }).tone).toBe('danger');
  });
});

describe('диалоги', () => {
  const NODES_T: S['KnowledgeTemplateNode'][] = [
    {
      index: 0,
      kind: 'page',
      title: 'Обзор',
      parentIndex: null,
      readerRoleLabel: null,
      requestAck: false,
    },
    {
      index: 1,
      kind: 'page',
      title: 'Вводный',
      parentIndex: null,
      readerRoleLabel: null,
      requestAck: true,
    },
    {
      index: 2,
      kind: 'folder',
      title: 'Водителям',
      parentIndex: null,
      readerRoleLabel: 'Водитель',
      requestAck: false,
    },
    {
      index: 3,
      kind: 'page',
      title: 'Перед выездом',
      parentIndex: 2,
      readerRoleLabel: null,
      requestAck: false,
    },
  ];

  it('шаблон: папка снимает и ставит подстраницы, подстраница ставит папку; чипы', () => {
    const all = new Set([0, 1, 2, 3]);
    expect([...toggleTemplateNode(NODES_T, all, 2)].sort()).toEqual([0, 1]);
    expect([...toggleTemplateNode(NODES_T, new Set([0]), 3)].sort()).toEqual([0, 2, 3]);
    expect(NODES_T.map(templateChip)).toEqual([
      { kind: 'space' },
      { kind: 'ack' },
      { kind: 'role', role: 'Водитель' },
      { kind: 'parent' },
    ]);
  });

  it('области: вся организация, регион и его фирмы', () => {
    const u = (
      id: string,
      kind: S['OrgUnit']['kind'],
      name: string,
      parentId: string | null = null,
    ) => ({
      id,
      kind,
      name,
      parentId,
      status: 'active' as const,
      revision: 1,
    });
    expect(
      unitOptions([
        u('r', 'region', 'Москва'),
        u('f', 'company', 'Север Логистик', 'r'),
        u('t', 'team', 'Склад', 'f'),
      ]),
    ).toEqual([
      { v: '', kind: 'tenant', name: '' },
      { v: 'r', kind: 'region', name: 'Москва' },
      { v: 'f', kind: 'firm', name: 'Север Логистик' },
    ]);
  });

  it('влияние доступа: строки по спискам, «ни у кого» и записи без доступа', () => {
    const p = (displayName: string, pages: number) => ({
      memberId: displayName,
      displayName,
      pages,
    });
    expect(impactNames([p('Илья Васильев', 2), p('Анна', 1)])).toBe('Илья Васильев · 2, Анна · 1');
    const imp = (o: Partial<S['KnowledgeAccessImpact']>): S['KnowledgeAccessImpact'] => ({
      applied: false,
      pages: 2,
      own: [],
      gainView: [],
      loseView: [],
      gainEdit: [],
      loseEdit: [],
      ...o,
    });
    expect(accessImpactLines(false, imp({}), [])).toEqual([{ key: 'pick' }]);
    expect(accessImpactLines(true, null, [])).toEqual([{ key: 'pick' }]);
    expect(
      accessImpactLines(true, imp({ gainView: [p('А', 1)], loseEdit: [p('Б', 2)] }), []),
    ).toEqual([
      { key: 'gainView', names: 'А · 1' },
      { key: 'loseEdit', names: 'Б · 2' },
    ]);
    expect(accessImpactLines(true, imp({}), [])).toEqual([{ key: 'noChange' }]);
    expect(accessImpactLines(true, imp({}), ['Группа «Север»'])).toEqual([
      { key: 'dead', names: 'Группа «Север»' },
    ]);
  });

  it('записи списка: та же запись, предупреждение, быстрый читатель', () => {
    expect(
      sameEntry(
        { who: 'role', refId: 'r', orgUnitId: 'f', can: 'view' },
        { who: 'role', refId: 'r', orgUnitId: 'f', can: 'edit' },
      ),
    ).toBe(true);
    expect(
      sameEntry(
        { who: 'role', refId: 'r', can: 'view' },
        { who: 'role', refId: 'r', orgUnitId: 'f', can: 'view' },
      ),
    ).toBe(false);
    expect(entryWarning(undefined)).toBeNull();
    expect(
      entryWarning({
        members: 0,
        total: 1,
        blocked: [{ displayName: 'Вера', reason: 'не участник пространства' }],
      }),
    ).toEqual({
      kind: 'one',
      why: 'не участник пространства',
    });
    expect(
      entryWarning({
        members: 1,
        total: 3,
        blocked: [
          { displayName: 'А', reason: 'нет роли' },
          { displayName: 'Б', reason: 'нет роли' },
        ],
      }),
    ).toEqual({ kind: 'some', names: 'А, Б', why: 'нет роли' });
    expect(
      quickReader(
        { who: 'member', refId: 'm', can: 'view' },
        {
          members: 0,
          total: 1,
          blocked: [{ displayName: 'В', reason: 'не участник закрытого пространства' }],
        },
      ),
    ).toBe(true);
    expect(quickReader({ who: 'role', refId: 'r', can: 'view' }, undefined)).toBe(false);
  });
});
