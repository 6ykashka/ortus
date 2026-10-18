// Команды «Базы знаний» (knowledge.js 14.10:317–515): успех, каждая ошибка дословно, события и журнал.
// БД — «Альта» после миграции v2 с объектами ремонта; часы — демо-«сейчас» (01.10.2026 10:30, Москва).
import { describe, expect, it } from 'vitest';
import { demoClock } from '../../core/clock.ts';
import { createModuleCtx } from '../../core/module.ts';
import { createFakeTaskPort } from '../../core/testing/index.ts';
import type { TenantDb } from '../../core/types/index.ts';
import { createAlta } from '../../seed/alta.ts';
import { createPlatform } from '../../seed/platform.ts';
import { kbAccess } from './access.ts';
import { knowledgeCommands, KB_DELAYS, KB_METHODS, type KnowledgeApi } from './commands.ts';
import { apiErr, T } from './fixture.test-util.ts';
import { migrateKnowledgeV2 } from './migrate-v2.ts';
import { KB_OBJ_42 } from './sections.ts';
import { knowledgeSeed } from './seed.ts';
import type { KbNode, KbTenantDb, KnowledgeSlice } from './types.ts';

type Db = KbTenantDb & { knowledge: KnowledgeSlice };
const ED = { who: 'role', ref: 'r-kb-editor', can: 'edit' } as const;

function env(o: { migrate?: boolean } = {}) {
  const db = createAlta(createPlatform()) as TenantDb as Db;
  Object.assign(db, {
    repair: {
      objects: [
        KB_OBJ_42,
        {
          id: 'obj-45',
          name: 'Дом 120 м², Истра',
          address: 'Истра',
          area: '120 м²',
          kind: 'дом',
          client: 'Пётр Белов',
          foreman: null,
        },
        {
          id: 'obj-38',
          name: 'ЖК Северный парк · квартира 117',
          address: 'Москва',
          area: '74 м²',
          kind: 'капитальный ремонт',
          client: 'Игорь Лебедев',
          foremanId: 'm-sokolov',
        },
      ],
    },
  });
  db.knowledge = knowledgeSeed('t-alta');
  if (o.migrate !== false) migrateKnowledgeV2(db);
  let actor = 'm-owner';
  const ctx = createModuleCtx({
    getDb: () => db,
    getActor: () => actor,
    clock: demoClock,
    tasks: createFakeTaskPort(),
  });
  const api = knowledgeCommands(ctx);
  const as = (mid: string): KnowledgeApi => {
    actor = mid;
    return api;
  };
  const pg = (id: string): KbNode => {
    const n = db.knowledge.pages.find((p) => p.id === id);
    if (!n) throw new Error('нет ' + id);
    return n;
  };
  return { db, api, as, pg, K: db.knowledge };
}

const err = (code: string, message: string) => ({ code, message });

describe('реестр команд', () => {
  it('17 методов с задержками эталона', () => {
    expect([...KB_METHODS].sort()).toEqual(
      [
        'kbCreateSpace',
        'kbCreateNode',
        'kbPublish',
        'kbSetStatus',
        'kbSetAccess',
        'kbMove',
        'kbArchive',
        'kbAck',
        'kbRequest',
        'kbDecide',
        'kbSetMember',
        'kbToggleRule',
        'kbCheckReview',
        'kbRunSection',
        'saveKbPage',
        'createKbPage',
        'createKbTable',
      ].sort(),
    );
    expect(KB_DELAYS).toMatchObject({
      kbCreateSpace: 380,
      kbCreateNode: 300,
      kbPublish: 380,
      kbSetStatus: 250,
      kbSetAccess: 380,
      kbMove: 300,
      kbArchive: 300,
      kbAck: 250,
      kbRequest: 300,
      kbDecide: 300,
      kbSetMember: 300,
      kbToggleRule: 250,
      kbCheckReview: 350,
      kbRunSection: 380,
    });
  });

  it('БЗ не подключена (нет среза или не v2) — not_found', () => {
    const e = env({ migrate: false });
    expect(apiErr(() => e.api.kbSetStatus('kb-1', 'draft'))).toEqual(
      err('not_found', 'База знаний не подключена'),
    );
    delete (e.db as KbTenantDb).knowledge;
    expect(apiErr(() => e.api.kbToggleRule('kr-1'))).toEqual(
      err('not_found', 'База знаний не подключена'),
    );
  });
});

describe('kbCreateSpace', () => {
  it('владелец: шаблон «Регламенты», узлы по шаблону, без назначения руководителя', () => {
    const { api, K, db } = env();
    const before = db.assignments.length;
    expect(api.kbCreateSpace({ name: ' Склад ', access: 'open', template: 'regs' })).toEqual({
      id: 'sp-100',
    });
    expect(K.spaces.at(-1)).toEqual({
      id: 'sp-100',
      name: 'Склад',
      icon: 'rule',
      color: '#2B5479',
      unit: null,
      access: 'open',
      template: 'regs',
    });
    const nodes = K.pages.filter((p) => p.space === 'sp-100');
    expect(nodes.map((p) => [p.id, p.parent, p.pos, p.kind, p.title])).toEqual([
      ['kb-101', null, 1, 'page', 'Обзор'],
      ['kb-102', null, 2, 'folder', 'Регламенты'],
      ['kb-103', 'kb-102', 1, 'page', 'Порядок работы'],
      ['kb-104', null, 3, 'folder', 'Чек-листы'],
      ['kb-105', null, 4, 'page', 'Журнал изменений'],
    ]);
    expect(nodes[0]).toMatchObject({
      owner: 'm-owner',
      at: '01.10.2026',
      by: 'Дарья Зимина',
      versions: [
        {
          v: 1,
          at: '01.10.2026',
          by: 'Дарья Зимина',
          body: 'Что лежит в пространстве и к кому обращаться с вопросами.',
        },
      ],
    });
    expect(db.assignments).toHaveLength(before);
  });

  it('роль области с «Настраивать»: пространство своей фирмы, руководитель — создатель', () => {
    const { db, as, K } = env();
    db.roles.push({
      id: 'r-kbadm',
      name: 'Администратор БЗ',
      kind: 'custom',
      actions: { knowledge: ['view', 'settings'] },
      finance: { read: false, manage: false },
    });
    db.assignments.push({
      id: 'x1',
      member: 'm-ilyin',
      role: 'r-kbadm',
      scope: { type: 'firm', id: 'f-msk-sever' },
    });
    const api = as('m-ilyin');
    expect(
      api.kbCreateSpace({
        name: 'Инструкции',
        access: 'limited',
        template: 'staff',
        unit: 'f-msk-sever',
        icon: 'school',
        color: '#A13A33',
      }),
    ).toEqual({ id: 'sp-100' });
    const drv = K.pages.find((p) => p.space === 'sp-100' && p.title === 'Водителям');
    expect(drv).toMatchObject({
      mode: 'listed',
      list: [{ who: 'role', ref: 'r-driver', unit: 'f-msk-sever', can: 'view' }, ED],
    });
    const intro = K.pages.find((p) => p.space === 'sp-100' && p.title === 'Вводный инструктаж');
    expect(intro?.ack).toEqual({ v: 1, audience: { who: 'all' }, done: [] });
    expect(db.assignments.at(-1)).toEqual({
      id: 'akb-109',
      member: 'm-ilyin',
      role: 'r-kb-lead',
      scope: { type: 'space', id: 'sp-100' },
    });
    // PD-53: право области не покрывает чужую фирму
    expect(
      apiErr(() => api.kbCreateSpace({ name: 'Юг', access: 'open', unit: 'f-msk-yug' })),
    ).toEqual(
      err(
        'forbidden',
        'Создавать пространства может владелец бизнеса или роль с правом «База знаний · Настраивать»',
      ),
    );
  });

  it('роль пространства «Настраивать» вне пространства не даёт (PD-53)', () => {
    const { as } = env();
    expect(apiErr(() => as('m-kotova').kbCreateSpace({ name: 'Новое', access: 'open' }))).toEqual(
      err(
        'forbidden',
        'Создавать пространства может владелец бизнеса или роль с правом «База знаний · Настраивать»',
      ),
    );
  });

  it('выбор узлов шаблона: подстраница без родителя уходит в корень', () => {
    const { api, K } = env();
    api.kbCreateSpace({ name: 'Выбор', access: 'open', template: 'regs', nodes: [0, 2] });
    expect(
      K.pages.filter((p) => p.space === 'sp-100').map((p) => [p.title, p.parent, p.pos]),
    ).toEqual([
      ['Обзор', null, 1],
      ['Порядок работы', null, 1],
    ]);
  });

  it('неизвестный шаблон — «Пустое пространство»', () => {
    const { api, K } = env();
    api.kbCreateSpace({ name: 'Пусто', access: 'closed', template: 'нет' });
    expect(K.spaces.at(-1)).toMatchObject({ icon: 'draft', template: 'blank', access: 'closed' });
    expect(K.pages.filter((p) => p.space === 'sp-100').map((p) => p.title)).toEqual(['Обзор']);
  });

  it.each([
    [{ name: 'А', access: 'open' }, 'Название — не короче 2 символов'],
    [{ name: 'Я'.repeat(121), access: 'open' }, 'Название — не длиннее 120 символов'],
    [{ name: 'логистика', access: 'open' }, 'Пространство «логистика» уже есть'],
    [{ name: 'Новое', access: 'x' }, 'Выберите уровень доступа'],
  ] as const)('%j → %s', (spec, message) => {
    const { api } = env();
    expect(apiErr(() => api.kbCreateSpace(spec as never))).toEqual(err('validation', message));
  });
});

describe('kbCreateNode', () => {
  it('руководитель: черновик страницы в папке, позиция — следующая', () => {
    const { as, pg } = env();
    expect(as('m-kotova').kbCreateNode('sp-log', 'kb-f-reg', 'page', 'Новый регламент')).toEqual({
      id: 'kb-100',
    });
    expect(pg('kb-100')).toMatchObject({
      space: 'sp-log',
      parent: 'kb-f-reg',
      pos: 4,
      kind: 'page',
      status: 'draft',
      owner: 'm-kotova',
      by: 'Марина Котова',
      versions: [{ v: 1, at: '01.10.2026', by: 'Марина Котова', body: '' }],
    });
  });

  it('папка — сразу «Действует»; схема — с шагами по умолчанию; в корень', () => {
    const { as, pg } = env();
    const api = as('m-kotelnikova');
    api.kbCreateNode('sp-log', null, 'folder', 'Папка');
    api.kbCreateNode('sp-log', null, 'diagram', 'Схема');
    expect(pg('kb-100')).toMatchObject({ parent: null, pos: 8, status: 'active' });
    expect(pg('kb-101')).toMatchObject({
      pos: 9,
      status: 'draft',
      diagram: { steps: ['Начало', 'Шаг', 'Готово'], out: [] },
    });
  });

  it.each([
    ['m-kotova', 'sp-x', null, 'page', 'Тема', 'not_found', 'Пространство не найдено'],
    ['m-kotova', 'sp-log', null, 'page', 'Т', 'validation', 'Название — не короче 2 символов'],
    [
      'm-kotova',
      'sp-log',
      null,
      'file',
      'Файл',
      'validation',
      'Выберите тип: страница, папка или схема',
    ],
    [
      'm-kotova',
      'sp-log',
      null,
      'link',
      'Ссылка',
      'validation',
      'Выберите тип: страница, папка или схема',
    ],
    [
      'm-kotova',
      'sp-log',
      null,
      'x',
      'Тема',
      'validation',
      'Выберите тип: страница, папка или схема',
    ],
    [
      'm-kotova',
      'sp-log',
      'kb-x',
      'page',
      'Тема',
      'not_found',
      'Страница не найдена или недоступна',
    ],
    [
      'm-vasiliev',
      'sp-log',
      'kb-fin',
      'page',
      'Тема',
      'not_found',
      'Страница не найдена или недоступна',
    ],
    [
      'm-kotova',
      'sp-log',
      'kb-gen-1',
      'page',
      'Тема',
      'validation',
      'Родитель — из другого пространства',
    ],
    [
      'm-vasiliev',
      'sp-log',
      'kb-f-drv',
      'page',
      'Тема',
      'forbidden',
      'Нет права создавать страницы внутри «Водителям»',
    ],
    [
      'm-vasiliev',
      'sp-log',
      null,
      'page',
      'Тема',
      'forbidden',
      'Нет права создавать страницы в пространстве',
    ],
  ] as const)('%s: %s/%s/%s → %s', (mid, sp, parent, kind, t, code, message) => {
    const { as } = env();
    expect(apiErr(() => as(mid).kbCreateNode(sp, parent, kind as never, t))).toEqual(
      err(code, message),
    );
  });

  it('глубже шести уровней — нельзя (KB-06)', () => {
    const { api } = env();
    let parent = 'kb-1a';
    for (let i = 4; i <= 6; i++)
      parent = api.kbCreateNode('sp-log', parent, 'page', 'Уровень ' + i).id;
    expect(apiErr(() => api.kbCreateNode('sp-log', parent, 'page', 'Уровень 7'))).toEqual(
      err('validation', 'Не больше шести уровней вложенности'),
    );
  });
});

describe('kbPublish', () => {
  it('новая версия: автор, дата; базовая версия совпала', () => {
    const { as, pg } = env();
    expect(as('m-kotova').kbPublish('kb-1', { base: 2, body: 'Новый текст' })).toEqual({
      v: 3,
      asked: 0,
    });
    expect(pg('kb-1').versions.at(-1)).toEqual({
      v: 3,
      at: '01.10.2026',
      by: 'Марина Котова',
      body: 'Новый текст',
    });
    expect(pg('kb-1').ack?.v).toBe(2);
  });

  it('конфликт базовой версии, длина текста, название', () => {
    const { as, pg } = env();
    const api = as('m-kotova');
    expect(apiErr(() => api.kbPublish('kb-1', { base: 1, body: 'x' }))).toEqual(
      err('conflict', 'Страницу уже изменили (v2). Обновите и повторите правку.'),
    );
    expect(apiErr(() => api.kbPublish('kb-1', { body: 'я'.repeat(20001) }))).toEqual(
      err('validation', 'Текст — не длиннее 20 000 символов'),
    );
    expect(apiErr(() => api.kbPublish('kb-1', { title: ' я ' }))).toEqual(
      err('validation', 'Название — не короче 2 символов'),
    );
    expect(pg('kb-1').versions).toHaveLength(2);
    api.kbPublish('kb-1', { title: ' Приёмка смены ', body: 'Текст' });
    expect(pg('kb-1').title).toBe('Приёмка смены');
  });

  it('черновик и «Пора пересмотреть» становятся «Действует»; «На проверке» — нет', () => {
    const { as, pg } = env();
    const api = as('m-kotova');
    const { id } = api.kbCreateNode('sp-log', null, 'page', 'Черновик');
    api.kbPublish(id, { body: 'Готово' });
    expect(pg(id).status).toBe('active');
    pg('kb-2').status = 'outdated';
    api.kbPublish('kb-2', { body: 'Обновлено' });
    expect(pg('kb-2').status).toBe('active');
    api.kbPublish('kb-6', { body: 'Обновлено' });
    expect(pg('kb-6').status).toBe('review');
  });

  it('шаги схемы: обрезка, без пустых, не больше 8', () => {
    const { api, pg } = env();
    api.kbPublish('kb-d1', { steps: [' А ', '', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И'] });
    expect(pg('kb-d1').diagram).toEqual({
      steps: ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З'],
      out: [
        ['Принято · машина в пул', 'ok'],
        ['Возврат по разделам', 'warn'],
      ],
    });
    api.kbPublish('kb-1', { steps: ['Не схема'] });
    expect(pg('kb-1').diagram).toBeUndefined();
  });

  it('с ознакомлением: событие аудитории и запуск правила kr-1', () => {
    const { api, pg, db, K } = env();
    expect(api.kbPublish('kb-1', { body: 'v3', ack: true })).toEqual({ v: 3, asked: 1 });
    expect(pg('kb-1').ack).toEqual({
      v: 3,
      audience: { who: 'role', ref: 'r-driver', unit: 'f-msk-sever' },
      done: [],
    });
    expect(db.events?.[0]).toEqual({
      id: 'e100',
      at: '10:30',
      text: 'Новая версия «Регламент приёмки смены» v3 — подтвердите, что ознакомились',
      to: ['m-vasiliev'],
      sensitive: null,
    });
    expect(K.runs?.[0]).toEqual({
      id: 'krr-101',
      space: 'sp-log',
      rule: 'kr-1',
      at: '01.10 10:30',
      res: 'ok',
      text: '«Регламент приёмки смены» v3: попросили ознакомиться — 1 чел.',
    });
  });

  it('ознакомление без аудитории и без правила — без события и журнала', () => {
    const { api, db, K, pg } = env();
    pg('kb-gen-1').ack = { v: 1, audience: { who: 'role', ref: 'r-manager' }, done: [] };
    expect(api.kbPublish('kb-gen-1', { body: 'v2', ack: true })).toEqual({ v: 2, asked: 0 });
    expect(db.events).toEqual([]);
    expect(K.runs).toHaveLength(3);
    expect(api.kbPublish('kb-2', { body: 'v2', ack: true })).toEqual({ v: 2, asked: 0 });
  });

  it('нет права править; не видит — not_found', () => {
    const { as } = env();
    expect(apiErr(() => as('m-vasiliev').kbPublish('kb-1', { body: 'x' }))).toEqual(
      err('forbidden', 'Нет права править «Регламент приёмки смены»'),
    );
    expect(apiErr(() => as('m-vasiliev').kbPublish('kb-fin', { body: 'x' }))).toEqual(
      err('not_found', 'Страница не найдена или недоступна'),
    );
    expect(apiErr(() => as('m-vasiliev').kbPublish('kb-x', { body: 'x' }))).toEqual(
      err('not_found', 'Страница не найдена или недоступна'),
    );
  });
});

describe('kbSetStatus', () => {
  it('редактор меняет статус; неизвестный — ошибка; читатель — нет', () => {
    const { as, pg } = env();
    expect(as('m-kotelnikova').kbSetStatus('kb-1', 'review')).toEqual({ status: 'review' });
    expect(pg('kb-1').status).toBe('review');
    expect(apiErr(() => as('m-kotelnikova').kbSetStatus('kb-1', 'x' as never))).toEqual(
      err('validation', 'Неизвестный статус'),
    );
    expect(apiErr(() => as('m-vasiliev').kbSetStatus('kb-1', 'draft'))).toEqual(
      err('forbidden', 'Нет права править «Регламент приёмки смены»'),
    );
  });
});

describe('kbSetAccess', () => {
  it('руководитель сужает доступ папки: последствия и запись в истории', () => {
    const { as, pg, db } = env();
    expect(as('m-kotova').kbSetAccess('kb-f-drv', { mode: 'listed', list: [ED] })).toEqual({
      pages: 5,
      lose: 1,
    });
    expect(pg('kb-f-drv')).toMatchObject({ mode: 'listed', list: [ED] });
    expect(pg('kb-f-drv').history).toEqual([
      {
        at: '01.10.2026 10:30',
        by: 'Марина Котова',
        text: 'Доступ: Только выбранные · Роль «Редактор» в пространстве — правит',
      },
    ]);
    expect(kbAccess(db, 'm-vasiliev', pg('kb-drv-1'), T).view).toBe(false);
  });

  it('«Как у родителя» очищает список; applyOwn сбрасывает подстраницы', () => {
    const { api, pg } = env();
    api.kbSetAccess('kb-f-drv', { mode: 'inherit', list: [ED], applyOwn: true });
    expect(pg('kb-f-drv')).toMatchObject({ mode: 'inherit', list: [] });
    expect(pg('kb-drv-4')).toMatchObject({ mode: 'inherit', list: [] });
    expect(pg('kb-f-drv').history?.[0]?.text).toBe('Доступ: Как у родителя');
  });

  it('записи списка нормализуются: только who, ref, can, unit, obj', () => {
    const { api, pg } = env();
    api.kbSetAccess('kb-2', {
      mode: 'edit',
      list: [
        { who: 'member', ref: 'm-vasiliev', can: 'edit', extra: 1 } as never,
        { who: 'role', ref: 'r-driver', unit: 'f-msk-sever', can: 'view' },
        { who: 'group', ref: 'g-drv', can: 'view' },
      ],
    });
    expect(pg('kb-2').list).toEqual([
      { who: 'member', ref: 'm-vasiliev', can: 'edit' },
      { who: 'role', ref: 'r-driver', can: 'view', unit: 'f-msk-sever' },
      { who: 'group', ref: 'g-drv', can: 'view' },
    ]);
  });

  it('связь с записью CRM — только из шаблона раздела (KB-01)', () => {
    const { api, pg } = env();
    const rel = { who: 'relation', ref: 'foreman', obj: 'obj-42' } as const;
    expect(
      apiErr(() => api.kbSetAccess('kb-2', { mode: 'listed', list: [{ ...rel, can: 'view' }] })),
    ).toEqual(err('validation', 'Связь с записью CRM задаётся шаблоном раздела'));
    api.kbSetAccess('kb-o-obj-42', {
      mode: 'listed',
      list: [{ ...rel, can: 'edit' }, ED, { who: 'member', ref: 'm-kotova', can: 'view' }],
    });
    expect(pg('kb-o-obj-42').list?.[0]).toEqual({ ...rel, can: 'edit' });
  });

  it('KB-01: связь шаблона раздела можно вернуть после «Как у родителя» и applyOwn папки', () => {
    const { api, pg } = env();
    const rel = { who: 'relation', ref: 'foreman', obj: 'obj-42' } as const;
    // «Как у родителя» снимает список раздела вместе со связью; kbRunSection раздел не пересоздаёт
    api.kbSetAccess('kb-o-obj-42', { mode: 'inherit' });
    expect(pg('kb-o-obj-42').list).toEqual([]);
    expect(api.kbRunSection('obj-42')).toEqual({ created: false });
    api.kbSetAccess('kb-o-obj-42', { mode: 'listed', list: [{ ...rel, can: 'view' }, ED] });
    expect(pg('kb-o-obj-42').list).toEqual([{ ...rel, can: 'view' }, ED]);
    // applyOwn родительской папки «Объекты» сбрасывает и подстраницы раздела
    const folder = pg('kb-o-obj-42').parent as string;
    api.kbSetAccess(folder, { mode: 'edit', list: [ED], applyOwn: true });
    expect(pg('kb-o-obj-42-2')).toMatchObject({ mode: 'inherit', list: [] });
    api.kbSetAccess('kb-o-obj-42-2', { mode: 'edit', list: [{ ...rel, can: 'edit' }, ED] });
    expect(pg('kb-o-obj-42-2').list?.[0]).toEqual({ ...rel, can: 'edit' });
    // связь другого объекта или другая связь — по-прежнему нельзя
    for (const e of [
      { who: 'relation', ref: 'foreman', obj: 'obj-45', can: 'view' },
      { who: 'relation', ref: 'client', obj: 'obj-42', can: 'view' },
    ] as const) {
      expect(apiErr(() => api.kbSetAccess('kb-o-obj-42-1', { mode: 'listed', list: [e] }))).toEqual(
        err('validation', 'Связь с записью CRM задаётся шаблоном раздела'),
      );
    }
  });

  it.each([
    [{ mode: 'x' }, 'Выберите, кто видит страницу'],
    [{ mode: 'listed', list: [{ who: 'all', can: 'view' }] }, 'Неверная запись в списке доступа'],
    [
      { mode: 'listed', list: [{ who: 'member', ref: 'm-owner', can: 'x' }] },
      'Неверная запись в списке доступа',
    ],
    [{ mode: 'listed', list: [{ who: 'member', ref: 'm-x', can: 'view' }] }, 'Сотрудник не найден'],
    [{ mode: 'listed', list: [{ who: 'group', ref: 'g-x', can: 'view' }] }, 'Группа не найдена'],
    [{ mode: 'listed', list: [{ who: 'role', ref: 'r-x', can: 'view' }] }, 'Роль не найдена'],
  ] as const)('%j → %s', (spec, message) => {
    const { api, pg } = env();
    expect(apiErr(() => api.kbSetAccess('kb-2', spec as never))).toEqual(
      err('validation', message),
    );
    expect(pg('kb-2').mode).toBe('inherit');
  });

  it('редактор — не руководитель', () => {
    const { as } = env();
    expect(apiErr(() => as('m-kotelnikova').kbSetAccess('kb-2', { mode: 'inherit' }))).toEqual(
      err('forbidden', 'Это может руководитель пространства или владелец бизнеса'),
    );
  });
});

describe('kbMove', () => {
  it('в корень и в другую папку; позиция — следующая', () => {
    const { as, pg } = env();
    const api = as('m-kotova');
    expect(api.kbMove('kb-6', null)).toEqual({ ok: true });
    expect(pg('kb-6')).toMatchObject({ parent: null, pos: 8 });
    as('m-kotelnikova').kbMove('kb-1', 'kb-f-drv');
    expect(pg('kb-1')).toMatchObject({ parent: 'kb-f-drv', pos: 5 });
  });

  it.each([
    [
      'm-kotova',
      'kb-f-reg',
      'kb-1a',
      'validation',
      'Нельзя перенести страницу внутрь её же подстраницы',
    ],
    ['m-kotova', 'kb-1', 'kb-gen-1', 'validation', 'Переносить можно только внутри пространства'],
    ['m-kotova', 'kb-1', 'kb-x', 'not_found', 'Страница не найдена или недоступна'],
    ['m-vasiliev', 'kb-1', null, 'forbidden', 'Нет права править «Регламент приёмки смены»'],
    ['m-kotelnikova', 'kb-1', 'kb-drv-4', 'forbidden', 'Нет права добавлять страницы в «Маршруты»'],
  ] as const)('%s: %s → %s', (mid, id, parent, code, message) => {
    const { as } = env();
    expect(apiErr(() => as(mid).kbMove(id, parent))).toEqual(err(code, message));
  });

  it('ветка не уходит глубже шести уровней (KB-06)', () => {
    const { api } = env();
    let parent = 'kb-drv-1';
    for (let i = 3; i <= 4; i++)
      parent = api.kbCreateNode('sp-log', parent, 'page', 'Уровень ' + i).id;
    expect(apiErr(() => api.kbMove('kb-f-reg', parent))).toEqual(
      err('validation', 'Не больше шести уровней вложенности'),
    );
    expect(api.kbMove('kb-1', parent)).toEqual({ ok: true });
  });
});

describe('kbArchive', () => {
  it('редактор архивирует ветку и возвращает её', () => {
    const { as, pg } = env();
    const api = as('m-kotelnikova');
    expect(api.kbArchive('kb-1', true)).toEqual({ ok: true });
    expect(['kb-1', 'kb-1a', 'kb-1b'].map((id) => pg(id).archived)).toEqual([true, true, true]);
    api.kbArchive('kb-1', false);
    expect(['kb-1', 'kb-1a', 'kb-1b'].map((id) => pg(id).archived)).toEqual([false, false, false]);
  });

  it('главную нельзя; читатель не может', () => {
    const { as } = env();
    expect(apiErr(() => as('m-kotova').kbArchive('kb-log-home', true))).toEqual(
      err('validation', 'Главную страницу пространства архивировать нельзя'),
    );
    expect(apiErr(() => as('m-vasiliev').kbArchive('kb-1', true))).toEqual(
      err('forbidden', 'Архивировать может редактор или руководитель пространства'),
    );
    expect(apiErr(() => as('m-kotova').kbArchive('kb-o-obj-42', true))).toEqual(
      err('forbidden', 'Архивировать может редактор или руководитель пространства'),
    );
    expect(as('m-kotova').kbArchive('kb-log-home', false)).toEqual({ ok: true });
  });
});

describe('kbAck (KB-03: кнопка и журнал)', () => {
  it('водитель подтверждает; повтор не дублирует; журнал хранит версию и время', () => {
    const { as, pg } = env();
    expect(as('m-vasiliev').kbAck('kb-1')).toEqual({ done: 1 });
    expect(as('m-vasiliev').kbAck('kb-1')).toEqual({ done: 1 });
    expect(pg('kb-1').ack).toEqual({
      v: 2,
      audience: { who: 'role', ref: 'r-driver', unit: 'f-msk-sever' },
      done: ['m-vasiliev'],
      log: [{ member: 'm-vasiliev', v: 2, at: '01.10 10:30' }],
    });
  });

  it('новая версия очищает подтверждения, журнал остаётся', () => {
    const { as, pg } = env();
    as('m-vasiliev').kbAck('kb-1');
    as('m-owner').kbPublish('kb-1', { body: 'v3', ack: true });
    expect(pg('kb-1').ack?.done).toEqual([]);
    expect(pg('kb-1').ack?.log).toHaveLength(1);
    as('m-vasiliev').kbAck('kb-1');
    expect(pg('kb-1').ack?.log?.map((x) => x.v)).toEqual([2, 3]);
  });

  it('не запрошено; другая роль; не видит', () => {
    const { as } = env();
    expect(apiErr(() => as('m-vasiliev').kbAck('kb-2'))).toEqual(
      err('validation', 'Ознакомление со страницей не запрошено'),
    );
    expect(apiErr(() => as('m-kotelnikova').kbAck('kb-1'))).toEqual(
      err('validation', 'Ознакомление запрошено у другой роли'),
    );
    expect(apiErr(() => as('m-vasiliev').kbAck('kb-fin'))).toEqual(
      err('not_found', 'Страница не найдена или недоступна'),
    );
  });

  it('аудитория «все» — любой читатель', () => {
    const { as, pg } = env();
    pg('kb-gen-1').ack = { v: 1, audience: { who: 'all' }, done: [] };
    expect(as('m-vasiliev').kbAck('kb-gen-1')).toEqual({ done: 1 });
  });
});

describe('kbRequest и kbDecide', () => {
  it('запрос правки: руководителям и владельцу; одобрение — правка по списку', () => {
    const { as, K, db, pg } = env();
    expect(as('m-vasiliev').kbRequest('kb-1', 'edit')).toEqual({ id: 'kq-100' });
    expect(K.requests?.[0]).toEqual({
      id: 'kq-100',
      node: 'kb-1',
      space: 'sp-log',
      member: 'm-vasiliev',
      can: 'edit',
      at: '01.10 10:30',
      status: 'open',
    });
    expect(db.events?.[0]).toMatchObject({
      id: 'e101',
      text: 'Илья Васильев просит право правки к «Регламент приёмки смены»',
      to: ['m-kotova', 'm-owner'],
    });
    expect(apiErr(() => as('m-vasiliev').kbRequest('kb-1', 'edit'))).toEqual(
      err('validation', 'Запрос уже отправлен'),
    );
    expect(apiErr(() => as('m-kotelnikova').kbDecide('kq-100', true))).toEqual(
      err('forbidden', 'Это может руководитель пространства или владелец бизнеса'),
    );
    expect(as('m-kotova').kbDecide('kq-100', true)).toEqual({ status: 'approved' });
    expect(pg('kb-1')).toMatchObject({
      mode: 'edit',
      list: [ED, { who: 'member', ref: 'm-vasiliev', can: 'edit' }],
    });
    expect(K.requests?.[0]).toMatchObject({ status: 'approved', by: 'Марина Котова' });
    expect(db.events?.[0]).toMatchObject({
      text: 'Одобрен запрос к «Регламент приёмки смены»',
      to: ['m-vasiliev'],
    });
    expect(kbAccess(db, 'm-vasiliev', pg('kb-1'), T).edit).toBe(true);
    expect(apiErr(() => as('m-kotova').kbDecide('kq-100', true))).toEqual(
      err('not_found', 'Запрос не найден или уже решён'),
    );
  });

  it('одобрение правки: запись участника уже есть — повышается до «правит»', () => {
    const { as, pg } = env();
    pg('kb-2').mode = 'edit';
    pg('kb-2').list = [{ who: 'member', ref: 'm-vasiliev', can: 'view' }];
    const { id } = as('m-vasiliev').kbRequest('kb-2', 'edit');
    as('m-kotova').kbDecide(id, true);
    expect(pg('kb-2').list).toEqual([{ who: 'member', ref: 'm-vasiliev', can: 'edit' }]);
  });

  it('запрос чтения: одобрение — «Читатель» на ветку на 30 дней; отказ', () => {
    const { as, db, K } = env();
    const { id } = as('m-vasiliev').kbRequest('kb-1a', 'view');
    expect(db.events?.[0]?.text).toBe('Илья Васильев просит доступ к «Чек-лист приёмки»');
    as('m-owner').kbDecide(id, true);
    expect(db.assignments.at(-1)).toEqual({
      id: 'akb-102',
      member: 'm-vasiliev',
      role: 'r-kb-reader',
      scope: { type: 'page', id: 'kb-1a' },
      until: '31.10.2026',
      via: 'запрос доступа',
    });
    const r2 = as('m-vasiliev').kbRequest('kb-2', 'view');
    expect(as('m-kotova').kbDecide(r2.id, false)).toEqual({ status: 'denied' });
    expect(K.requests?.[0]?.status).toBe('denied');
    expect(db.events?.[0]?.text).toBe('Отклонён запрос к «Как фотографировать машину при осмотре»');
  });

  it('уже может править; не видит страницу', () => {
    const { as } = env();
    expect(apiErr(() => as('m-kotelnikova').kbRequest('kb-1', 'edit'))).toEqual(
      err('validation', 'Вы уже можете править страницу'),
    );
    expect(apiErr(() => as('m-vasiliev').kbRequest('kb-fin', 'view'))).toEqual(
      err('not_found', 'Страница не найдена или недоступна'),
    );
  });
});

describe('kbSetMember', () => {
  it('руководитель назначает и снимает роль пространства', () => {
    const { as, db } = env();
    const api = as('m-kotova');
    expect(api.kbSetMember('sp-log', 'm-vasiliev', 'r-kb-editor')).toEqual({ ok: true });
    expect(db.assignments.at(-1)).toEqual({
      id: 'akb-100',
      member: 'm-vasiliev',
      role: 'r-kb-editor',
      scope: { type: 'space', id: 'sp-log' },
    });
    api.kbSetMember('sp-log', 'm-vasiliev', 'r-kb-reader');
    expect(
      db.assignments
        .filter((a) => a.member === 'm-vasiliev' && a.scope.type === 'space')
        .map((a) => a.role),
    ).toEqual(['r-kb-reader']);
    api.kbSetMember('sp-log', 'm-vasiliev', null);
    expect(db.assignments.some((a) => a.member === 'm-vasiliev' && a.scope.type === 'space')).toBe(
      false,
    );
    expect(api.kbSetMember('sp-log', 'm-kotova', 'r-kb-lead')).toEqual({ ok: true });
  });

  it('владелец снимает руководителя', () => {
    const { db, api } = env();
    api.kbSetMember('sp-log', 'm-kotova', 'r-kb-editor');
    expect(
      db.assignments.find(
        (a) => a.member === 'm-kotova' && a.scope.type === 'space' && a.scope.id === 'sp-log',
      )?.role,
    ).toBe('r-kb-editor');
  });

  it.each([
    ['m-kotova', 'sp-log', 'm-x', 'r-kb-reader', 'validation', 'Выберите сотрудника'],
    ['m-kotova', 'sp-log', 'm-vasiliev', 'r-kb-author', 'validation', 'Выберите роль пространства'],
    [
      'm-kotova',
      'sp-log',
      'm-owner',
      'r-kb-reader',
      'validation',
      'Владелец бизнеса видит всё без назначения',
    ],
    [
      'm-kotova',
      'sp-log',
      'm-kotova',
      'r-kb-editor',
      'validation',
      'Свою роль руководителя снимает владелец бизнеса',
    ],
    [
      'm-kotova',
      'sp-log',
      'm-kotova',
      null,
      'validation',
      'Свою роль руководителя снимает владелец бизнеса',
    ],
    [
      'm-kotelnikova',
      'sp-log',
      'm-vasiliev',
      'r-kb-reader',
      'forbidden',
      'Это может руководитель пространства или владелец бизнеса',
    ],
    ['m-kotova', 'sp-x', 'm-vasiliev', 'r-kb-reader', 'not_found', 'Пространство не найдено'],
  ] as const)('%s: %s %s %s → %s', (mid, sp, member, role, code, message) => {
    const { as } = env();
    expect(apiErr(() => as(mid).kbSetMember(sp, member, role))).toEqual(err(code, message));
  });
});

describe('kbToggleRule', () => {
  it('руководитель своего пространства переключает правило', () => {
    const { as, K } = env();
    expect(as('m-kotova').kbToggleRule('kr-1')).toEqual({ on: false });
    expect(as('m-kotova').kbToggleRule('kr-1')).toEqual({ on: true });
    expect(K.rules?.[0]?.on).toBe(true);
    expect(apiErr(() => as('m-kotova').kbToggleRule('kr-3'))).toEqual(
      err('forbidden', 'Это может руководитель пространства или владелец бизнеса'),
    );
    expect(apiErr(() => as('m-kotova').kbToggleRule('kr-x'))).toEqual(
      err('not_found', 'Правило не найдено'),
    );
  });
});

describe('kbCheckReview', () => {
  it('срок наступил — «Пора пересмотреть», событие владельцу; повтор — остановлено', () => {
    const { as, pg, db, K } = env();
    const api = as('m-kotova');
    expect(api.kbCheckReview('sp-log')).toEqual({ due: 1 });
    expect(pg('kb-2').status).toBe('outdated');
    expect(pg('kb-1').status).toBe('active');
    expect(db.events?.[0]).toMatchObject({
      text: 'Пора пересмотреть «Как фотографировать машину при осмотре»: срок был 30.09.2026',
      to: ['m-kotova'],
    });
    expect(K.runs?.[0]).toMatchObject({
      rule: 'kr-2',
      res: 'ok',
      text: '«Как фотографировать машину при осмотре»: срок пересмотра 30.09.2026, уведомлён владелец Марина Котова',
    });
    expect(api.kbCheckReview('sp-log')).toEqual({ due: 0 });
    expect(K.runs?.[0]).toMatchObject({
      res: 'stopped',
      text: 'Остановлено условием: сроки пересмотра не наступили',
    });
  });

  it('правило выключено; не руководитель', () => {
    const { as } = env();
    expect(apiErr(() => as('m-owner').kbCheckReview('sp-rep'))).toEqual(
      err('validation', 'Правило «Пора пересмотреть» выключено'),
    );
    expect(apiErr(() => as('m-kotelnikova').kbCheckReview('sp-log'))).toEqual(
      err('forbidden', 'Это может руководитель пространства или владелец бизнеса'),
    );
  });

  it('журнал запусков — не больше 40 записей', () => {
    const { api, K } = env();
    for (let i = 0; i < 45; i++) api.kbCheckReview('sp-log');
    expect(K.runs).toHaveLength(40);
  });
});

describe('kbRunSection', () => {
  it('раздел уже есть — остановлено условием', () => {
    const { api, K } = env();
    expect(api.kbRunSection('obj-42')).toEqual({ created: false });
    expect(K.runs?.[0]).toMatchObject({
      space: 'sp-rep',
      rule: 'kr-3',
      res: 'stopped',
      text: 'ЖК Речной · квартира 42: остановлено условием — раздел уже есть',
    });
  });

  it('прораб не назначен — раздел у редакторов, предупреждение', () => {
    const { api, K, db, pg } = env();
    expect(api.kbRunSection('obj-45')).toEqual({ created: true, id: 'kb-o-obj-45' });
    expect(pg('kb-o-obj-45')).toMatchObject({ parent: 'kb-rep-obj', pos: 2 });
    expect(K.runs?.[0]).toMatchObject({
      res: 'warn',
      text: 'Дом 120 м², Истра: прораб не назначен — раздел создан, доступ пока у редакторов. Назначат прораба — он получит доступ сам',
    });
    expect(db.events).toEqual([]);
  });

  it('прораб по id — доступ и событие ему', () => {
    const { api, K, db, pg } = env();
    api.kbRunSection('obj-38');
    expect(K.runs?.[0]).toMatchObject({
      res: 'ok',
      text: 'ЖК Северный парк · квартира 117: создан раздел и 5 подстраниц, доступ получил прораб Алексей Соколов',
    });
    expect(db.events?.[0]).toMatchObject({
      text: 'Создан раздел объекта «ЖК Северный парк · квартира 117» в базе знаний',
      to: ['m-sokolov'],
    });
    expect(kbAccess(db, 'm-sokolov', pg('kb-o-obj-38-2'), T).edit).toBe(true);
  });

  it('ошибки: объект, руководитель, правило, папка', () => {
    const e = env();
    expect(apiErr(() => e.api.kbRunSection('obj-x'))).toEqual(err('not_found', 'Объект не найден'));
    expect(apiErr(() => e.as('m-kotova').kbRunSection('obj-45'))).toEqual(
      err('forbidden', 'Это может руководитель пространства или владелец бизнеса'),
    );
    e.as('m-owner').kbToggleRule('kr-3');
    expect(apiErr(() => e.api.kbRunSection('obj-45'))).toEqual(
      err('validation', 'Правило выключено'),
    );
    e.api.kbToggleRule('kr-3');
    e.pg('kb-rep-obj').title = 'Объекты ремонта';
    expect(apiErr(() => e.api.kbRunSection('obj-45'))).toEqual(
      err('validation', 'В пространстве нет папки «Объекты»'),
    );
  });

  it('нет пространства «Ремонт и стройка»', () => {
    const e = env();
    e.K.spaces = e.K.spaces.filter((s) => s.id !== 'sp-rep');
    expect(apiErr(() => e.api.kbRunSection('obj-45'))).toEqual(
      err('not_found', 'Пространство не найдено'),
    );
  });
});
