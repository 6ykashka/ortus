// Команды БЗ из ядра эталона (api.js 14.10:785–845) на узлах v2: `saveKbPage` — обёртка над
// `kbPublish` (право правки по `kbAccess`, а не глобальное `can(knowledge, create)`), `createKbPage` и
// `createKbTable` — с правами пространства и страницы (PD-53, PD-60; KB-07 для «Только владелец»).
import { describe, expect, it } from 'vitest';
import { demoClock } from '../../core/clock.ts';
import { createModuleCtx } from '../../core/module.ts';
import { createFakeTaskPort } from '../../core/testing/index.ts';
import type { TenantDb } from '../../core/types/index.ts';
import type { Platform } from '../platform/types.ts';
import { createAlta } from '../../seed/alta.ts';
import { createPlatform } from '../../seed/platform.ts';
import { kbAccess, kbSpaceMy } from './access.ts';
import { knowledgeCommands, type KnowledgeApi } from './commands.ts';
import { apiErr, T } from './fixture.test-util.ts';
import { migrateKnowledgeV2 } from './migrate-v2.ts';
import { knowledgeSeed } from './seed.ts';
import type { KbNode, KbSpace, KbTenantDb, KnowledgeSlice } from './types.ts';

type Db = KbTenantDb & { knowledge: KnowledgeSlice; platform: Platform };

function env() {
  const db = createAlta(createPlatform()) as TenantDb as Db;
  db.knowledge = knowledgeSeed('t-alta');
  migrateKnowledgeV2(db);
  let actor = 'm-owner';
  const api = knowledgeCommands(
    createModuleCtx({
      getDb: () => db,
      getActor: () => actor,
      clock: demoClock,
      tasks: createFakeTaskPort(),
    }),
  );
  const as = (mid: string): KnowledgeApi => {
    actor = mid;
    return api;
  };
  const pg = (id: string): KbNode => {
    const n = db.knowledge.pages.find((p) => p.id === id);
    if (!n) throw new Error('нет ' + id);
    return n;
  };
  const restrict = (): void => {
    const t = db.platform.tenants.find((x) => x.id === 't-alta');
    if (t) t.status = 'restricted';
  };
  return { db, api, as, pg, restrict, K: db.knowledge };
}

const err = (code: string, message: string) => ({ code, message });
const RESTRICTED = err(
  'subscription_restricted',
  'Пробный период завершён: новые операции недоступны. История доступна для чтения.',
);

describe('saveKbPage — обёртка над kbPublish', () => {
  it('новая версия с проверкой базовой; текст обрезается; ответ — номер версии', () => {
    const { as, pg } = env();
    expect(as('m-kotova').saveKbPage('kb-1', '  Новый текст  ', 2)).toBe(3);
    expect(pg('kb-1').versions.at(-1)).toEqual({
      v: 3,
      at: '01.10.2026',
      by: 'Марина Котова',
      body: 'Новый текст',
    });
  });

  it('черновик становится «Действует», как у kbPublish', () => {
    const { as, pg } = env();
    const api = as('m-kotova');
    const { id } = api.kbCreateNode('sp-log', null, 'page', 'Черновик');
    expect(api.saveKbPage(id, 'Текст', 1)).toBe(2);
    expect(pg(id).status).toBe('active');
  });

  it.each([
    [
      'm-kotova',
      'kb-1',
      'x',
      1,
      'conflict',
      'Страницу уже изменили (v2). Обновите и повторите правку.',
    ],
    [
      'm-kotova',
      'kb-1',
      'x',
      undefined,
      'conflict',
      'Страницу уже изменили (v2). Обновите и повторите правку.',
    ],
    ['m-kotova', 'kb-1', '   ', 2, 'validation', 'Текст страницы пустой'],
    ['m-kotova', 'kb-1', 'я'.repeat(20001), 2, 'validation', 'Текст — не длиннее 20 000 символов'],
    ['m-vasiliev', 'kb-1', 'x', 2, 'forbidden', 'Нет права править «Регламент приёмки смены»'],
    // эталон пускал по глобальному knowledge.create роли пространства (PD-53)
    ['m-kotova', 'kb-4', 'x', 1, 'not_found', 'Страница не найдена или недоступна'],
    ['m-kotova', 'kb-x', 'x', 1, 'not_found', 'Страница не найдена или недоступна'],
  ] as const)('%s: %s → %s', (mid, id, body, base, code, message) => {
    const { as, pg } = env();
    expect(apiErr(() => as(mid).saveKbPage(id, body, base as never))).toEqual(err(code, message));
    if (id === 'kb-1') expect(pg('kb-1').versions).toHaveLength(2);
  });
});

describe('createKbPage — страница v2 в корне пространства', () => {
  it('страница с таблицей одной командой; событие владельцам', () => {
    const { api, pg, K, db } = env();
    expect(
      api.createKbPage('sp-log', {
        title: ' Журнал рейсов ',
        body: ' Текст ',
        table: {
          title: ' Рейсы ',
          columns: [{ name: ' Дата ' }, { name: 'Пробег', type: 'number' }],
        },
      }),
    ).toEqual({ id: 'kb-100', table: { id: 'kt-101', columns: ['c-102', 'c-103'] } });
    expect(pg('kb-100')).toEqual({
      id: 'kb-100',
      space: 'sp-log',
      parent: null,
      pos: 8,
      kind: 'page',
      title: 'Журнал рейсов',
      mode: 'inherit',
      list: [],
      status: 'active',
      owner: 'm-owner',
      access: 'all',
      versions: [{ v: 1, at: '01.10.2026', by: 'Дарья Зимина', body: 'Текст' }],
    });
    expect(K.tables?.at(-1)).toEqual({
      id: 'kt-101',
      page: 'kb-100',
      title: 'Рейсы',
      columns: [
        { id: 'c-102', name: 'Дата', type: 'text' },
        { id: 'c-103', name: 'Пробег', type: 'number' },
      ],
      rows: [],
    });
    expect(db.events?.[0]).toEqual({
      id: 'e104',
      at: '10:30',
      text: 'В разделе «Логистика» создана страница «Журнал рейсов» с таблицей «Рейсы»',
      to: ['m-owner'],
      sensitive: null,
    });
  });

  it('без таблицы; руководитель пространства может', () => {
    const { as, db, pg } = env();
    expect(as('m-kotova').createKbPage('sp-log', { title: 'Памятка', body: 'Текст' })).toEqual({
      id: 'kb-100',
      table: null,
    });
    expect(pg('kb-100')).toMatchObject({ owner: 'm-kotova', versions: [{ by: 'Марина Котова' }] });
    expect(db.events?.[0]?.text).toBe('В разделе «Логистика» создана страница «Памятка»');
  });

  it('«Только владелец» → «Только выбранные» (KB-07); не владельцу — нельзя', () => {
    const { api, as, pg } = env();
    api.createKbPage('sp-own', { title: 'Бюджет', body: 'Текст', access: 'owner' });
    expect(pg('kb-100')).toMatchObject({ access: 'owner', mode: 'listed', list: [] });
    expect(
      apiErr(() =>
        as('m-kotova').createKbPage('sp-log', { title: 'Тайна', body: 'x', access: 'owner' }),
      ),
    ).toEqual(err('validation', 'Страницу «Только владелец» может создать только владелец'));
  });

  it.each([
    ['m-owner', 'sp-x', { title: 'Тема', body: 'x' }, 'validation', 'Выберите раздел Базы знаний'],
    [
      'm-vasiliev',
      'sp-log',
      { title: 'Тема', body: 'x' },
      'forbidden',
      'Нет права создавать страницы в пространстве',
    ],
    [
      'm-owner',
      'sp-log',
      { title: ' АБ ', body: 'x' },
      'validation',
      'Название страницы — не короче 3 символов',
    ],
    [
      'm-owner',
      'sp-log',
      { title: 'обзор', body: 'x' },
      'validation',
      'В разделе «Логистика» уже есть страница «обзор»',
    ],
    ['m-owner', 'sp-log', { title: 'Тема', body: '  ' }, 'validation', 'Текст страницы пустой'],
    [
      'm-owner',
      'sp-log',
      { title: 'Тема', body: 'x', table: { title: 'Т', columns: [{ name: 'А' }] } },
      'validation',
      'Название таблицы — не короче 2 символов',
    ],
    [
      'm-owner',
      'sp-log',
      { title: 'Тема', body: 'x', table: { title: 'Таб', columns: [] } },
      'validation',
      'Добавьте хотя бы один столбец',
    ],
    [
      'm-owner',
      'sp-log',
      { title: 'Тема', body: 'x', table: { title: 'Таб', columns: [{ name: ' ' }] } },
      'validation',
      'У столбца нет названия',
    ],
    [
      'm-owner',
      'sp-log',
      {
        title: 'Тема',
        body: 'x',
        table: { title: 'Таб', columns: [{ name: 'А' }, { name: 'а' }] },
      },
      'validation',
      'Названия столбцов повторяются',
    ],
  ] as const)('%s в %s: %j → %s', (mid, sp, spec, code, message) => {
    const { as, db } = env();
    const seq = db.seq;
    expect(apiErr(() => as(mid).createKbPage(sp, spec as never))).toEqual(err(code, message));
    expect(db.seq).toBe(seq);
  });

  it('как в эталоне, вопрос в DoR W4.00: дубль названия ищется и среди невидимых страниц', () => {
    const { api, as, db, pg } = env();
    const { id } = api.kbCreateNode('sp-log', null, 'page', 'Тайная страница');
    api.kbSetAccess(id, { mode: 'listed', list: [{ who: 'member', ref: 'm-owner', can: 'view' }] });
    expect(kbAccess(db, 'm-kotelnikova', pg(id), T).view).toBe(false);
    const log = db.knowledge.spaces.find((s) => s.id === 'sp-log') as KbSpace;
    expect(kbSpaceMy(db, 'm-kotelnikova', log, T).create).toBe(true);
    // ответ выдаёт, что невидимая страница с таким названием есть (политика 404 — W4.00)
    expect(
      apiErr(() =>
        as('m-kotelnikova').createKbPage('sp-log', { title: 'тайная страница', body: 'x' }),
      ),
    ).toEqual(err('validation', 'В разделе «Логистика» уже есть страница «тайная страница»'));
  });

  it('ограниченная организация — новые страницы нельзя', () => {
    const { api, restrict } = env();
    restrict();
    expect(apiErr(() => api.createKbPage('sp-log', { title: 'Тема', body: 'x' }))).toEqual(
      RESTRICTED,
    );
  });
});

describe('createKbTable — таблица на странице', () => {
  it('правка страницы даёт таблицу; событие владельцам', () => {
    const { as, K, db } = env();
    expect(
      as('m-kotova').createKbTable('kb-5', { title: ' Сводка ', columns: [{ name: 'Дата' }] }),
    ).toEqual({ id: 'kt-101', columns: ['c-100'] });
    expect(K.tables?.at(-1)).toEqual({
      id: 'kt-101',
      page: 'kb-5',
      title: 'Сводка',
      columns: [{ id: 'c-100', name: 'Дата', type: 'text' }],
      rows: [],
    });
    expect(db.events?.[0]).toMatchObject({
      text: 'На странице «Журнал осмотров машин» создана таблица «Сводка»',
      to: ['m-owner'],
    });
  });

  it.each([
    [
      'm-owner',
      'kb-x',
      { title: 'Таб', columns: [{ name: 'А' }] },
      'not_found',
      'Страница не найдена',
    ],
    [
      'm-vasiliev',
      'kb-fin',
      { title: 'Таб', columns: [{ name: 'А' }] },
      'not_found',
      'Страница не найдена',
    ],
    [
      'm-vasiliev',
      'kb-1',
      { title: 'Таб', columns: [{ name: 'А' }] },
      'forbidden',
      'Нет права править «Регламент приёмки смены»',
    ],
    [
      'm-owner',
      'kb-5',
      { title: 'Т', columns: [{ name: 'А' }] },
      'validation',
      'Название таблицы — не короче 2 символов',
    ],
    [
      'm-owner',
      'kb-5',
      { title: 'осмотры', columns: [{ name: 'А' }] },
      'validation',
      'На странице уже есть таблица «осмотры»',
    ],
    [
      'm-owner',
      'kb-5',
      { title: 'Таб', columns: [] },
      'validation',
      'Добавьте хотя бы один столбец',
    ],
    [
      'm-owner',
      'kb-5',
      { title: 'Таб', columns: [{ name: '' }] },
      'validation',
      'У столбца нет названия',
    ],
    [
      'm-owner',
      'kb-5',
      { title: 'Таб', columns: [{ name: 'А' }, { name: 'а' }] },
      'validation',
      'Названия столбцов повторяются',
    ],
  ] as const)('%s на %s: %j → %s', (mid, id, spec, code, message) => {
    const { as, db } = env();
    const seq = db.seq;
    expect(apiErr(() => as(mid).createKbTable(id, spec as never))).toEqual(err(code, message));
    expect(db.seq).toBe(seq);
  });

  it('ограниченная организация — новые таблицы нельзя', () => {
    const { api, restrict } = env();
    restrict();
    expect(
      apiErr(() => api.createKbTable('kb-5', { title: 'Таб', columns: [{ name: 'А' }] })),
    ).toEqual(RESTRICTED);
  });
});
