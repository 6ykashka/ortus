// Действие формы «Сохранить в Базу знаний» (api.js 14.10:79–118, B §2.2 `kbFits`/`kbRun`).
import { describe, expect, it } from 'vitest';
import { grants } from '../../core/access/index.ts';
import { kbFits, kbRun, ownersOf } from './kb-actions.ts';
import {
  formsFixture,
  inspResponse,
  kbEnv,
  withKbEditor,
  type FormsDb,
} from './testing/fixture.ts';
import type { Form, FormResponse, FormRule } from './types.ts';

const ROW_TEXT = 'Строка в таблице «Осмотры» · страница «Журнал осмотров машин»';

function setup(rule: Partial<FormRule> = {}, resp: Partial<FormResponse> = {}) {
  const db = formsFixture();
  const f = db.forms[0] as Form;
  const base = f.automations[1] as FormRule;
  const x: FormRule = { ...base, ...rule };
  const r = inspResponse('R-1050', resp);
  db.responses.unshift(r);
  return { db, f, x, r, env: kbEnv(db) };
}

const rows = (db: FormsDb) => db.knowledge.tables?.[0]?.rows ?? [];

describe('kbFits: когда срабатывает действие', () => {
  const r = inspResponse('R-1');
  const x: FormRule = { id: 'au-9', kind: 'kb', on: true };

  it('выключенное действие не срабатывает', () => {
    expect(kbFits({ ...x, on: false }, r)).toBe(false);
  });

  it.each<[string, FormRule['when'], string, boolean]>([
    ['по умолчанию — принятый ответ', undefined, 'Принят', true],
    ['по умолчанию — непринятый не подходит', undefined, 'На проверке', false],
    ['accepted — принятый', 'accepted', 'Принят', true],
    ['accepted — исправление не подходит', 'accepted', 'Исправление', false],
    ['submitted — любой ответ', 'submitted', 'На проверке', true],
  ])('%s', (_n, when, status, want) => {
    expect(kbFits({ ...x, when }, { ...r, status })).toBe(want);
  });

  it.each<[string, FormRule['cond'], FormResponse['values'], boolean]>([
    ['значение совпало', { field: 'q-defect', value: 'да' }, { 'q-defect': 'да' }, true],
    ['без учёта регистра', { field: 'q-defect', value: 'ДА' }, { 'q-defect': 'Да' }, true],
    ['не совпало', { field: 'q-defect', value: 'да' }, { 'q-defect': 'нет' }, false],
    ['нет ответа', { field: 'q-defect', value: 'да' }, {}, false],
    ['пусто ↔ null', { field: 'q-defect', value: null }, {}, true],
    [
      'вариант в списке',
      { field: 'q-checks', value: 'шины' },
      { 'q-checks': ['Кузов', 'Шины'] },
      true,
    ],
    [
      'варианта нет в списке',
      { field: 'q-checks', value: 'свет' },
      { 'q-checks': ['Кузов'] },
      false,
    ],
    ['условие без вопроса не проверяется', { field: '', value: 'да' }, {}, true],
    ['условия нет', null, {}, true],
  ])('условие: %s', (_n, cond, values, want) => {
    expect(kbFits({ ...x, cond }, { ...r, values })).toBe(want);
  });

  it('у ответа нет values — условие не выполнено', () => {
    const bare = { ...r, values: undefined as unknown as FormResponse['values'] };
    expect(kbFits({ ...x, cond: { field: 'q-defect', value: 'да' } }, bare)).toBe(false);
  });
});

describe('kbRun: строка в таблицу', () => {
  it('новая строка сверху, ячейки из ответа, результат в журнале ответа', () => {
    const { db, f, x, r, env } = setup();
    const seq = db.seq;
    const res = kbRun(env, f, r, x);
    expect(res).toEqual({
      rule: 'au-2',
      rv: 1,
      kind: 'kb',
      at: '10:30',
      page: 'kb-5',
      ok: true,
      table: 'kt-insp',
      text: ROW_TEXT,
    });
    expect(rows(db)[0]).toEqual({
      id: 'kr-' + String(seq),
      at: '10:30',
      src: { form: 'fm-insp', resp: 'R-1050', fv: 3, rule: 'au-2', rv: 1 },
      cells: {
        'c-at': '01.10 10:05',
        'c-obj': 'Рейс Р-208 · выезд',
        'c-who': 'Илья Васильев',
        'c-odo': '84 590',
        'c-fuel': '½',
        'c-def': 'нет',
        'c-resp': 'R-1050',
      },
    });
    expect(rows(db)).toHaveLength(3);
    expect(r.actions).toEqual([res]);
    expect(db.seq).toBe(seq + 1);
  });

  it('pos: bottom — строка в конец таблицы', () => {
    const { db, f, x, r, env } = setup({ pos: 'bottom' });
    kbRun(env, f, r, x);
    expect(rows(db).map((y) => y.src?.resp)).toEqual(['R-1012', 'R-0988', 'R-1050']);
  });

  it('только столбцы таблицы и поля с источником', () => {
    const { db, f, x, r, env } = setup({
      fields: [
        { col: 'c-odo', name: 'Пробег', src: 'q-odo' },
        { col: 'c-gone', name: 'Удалён', src: 'q-fuel' },
        { col: 'c-obj', name: 'Без источника', src: '' },
      ],
    });
    kbRun(env, f, r, x);
    expect(rows(db)[0]?.cells).toEqual({ 'c-odo': '84 590' });
  });

  it('правило без полей — пустая строка с источником', () => {
    const { db, f, x, r, env } = setup({ fields: undefined, version: undefined });
    const res = kbRun(env, f, r, x);
    expect(rows(db)[0]?.cells).toEqual({});
    expect(res.rv).toBe(1);
    expect(rows(db)[0]?.src?.rv).toBe(1);
  });

  it('фото — ссылка на ответ по вопросам версии ответа', () => {
    const { db, f, x, r, env } = setup({
      fields: [{ col: 'c-obj', name: 'Фото', src: 'q-photos' }],
    });
    kbRun(env, f, r, x);
    expect(rows(db)[0]?.cells['c-obj']).toBe('5 фото · файлы в ответе R-1050');
  });

  it('версии ответа нет в форме — вопросы неизвестны, значение как есть', () => {
    const { db, f, x, r, env } = setup(
      { fields: [{ col: 'c-obj', name: 'Фото', src: 'q-photos' }] },
      { version: 9 },
    );
    kbRun(env, f, r, x);
    expect(rows(db)[0]?.cells['c-obj']).toBe('5 фото');
  });

  it('повтор после успеха возвращает прошлый результат, без новой строки', () => {
    const { db, f, x, r, env } = setup();
    const first = kbRun(env, f, r, x);
    const seq = db.seq;
    expect(kbRun(env, f, r, x)).toBe(first);
    expect(rows(db)).toHaveLength(3);
    expect(db.seq).toBe(seq);
  });

  it('строка уже есть (журнал потерян) — без дубля, результат успешный', () => {
    const { db, f, x, env } = setup();
    const old = db.responses.find((y) => y.id === 'R-1012') as FormResponse;
    old.actions = [];
    const res = kbRun(env, f, old, x);
    expect(res.ok).toBe(true);
    expect(rows(db)).toHaveLength(2);
    expect(old.actions).toEqual([res]);
  });

  it('результат правила заменяется, результаты других правил остаются', () => {
    const { f, x, r, env } = setup();
    r.actions = [
      { rule: 'au-2', rv: 1, kind: 'kb', at: '09:00', ok: false, err: 'старая ошибка' },
      { rule: 'au-7', rv: 1, kind: 'kb', at: '09:00', ok: true },
    ];
    const res = kbRun(env, f, r, x);
    expect(r.actions.map((y) => [y.rule, y.ok])).toEqual([
      ['au-7', true],
      ['au-2', true],
    ]);
    expect(r.actions[1]).toBe(res);
  });

  it('автор правила ищется по имени, если byId нет', () => {
    const { f, x, r, env } = setup({ byId: undefined, by: 'Дарья Зимина' });
    expect(kbRun(env, f, r, x).ok).toBe(true);
  });
});

describe('kbRun: запись на странице', () => {
  const entry = {
    mode: 'entry' as const,
    table: undefined,
    head: '$object',
    fields: [
      { name: 'Пробег', src: 'q-odo' },
      { name: 'Топливо', src: 'q-fuel' },
      { name: 'Пусто', src: 'q-defect-text' },
      { name: 'Без источника', src: '' },
    ],
  };

  it('запись сверху: заголовок, непустые строки, источник', () => {
    const { db, f, x, r, env } = setup(entry);
    db.knowledge.entries = undefined;
    const seq = db.seq;
    const res = kbRun(env, f, r, x);
    expect(res).toEqual({
      rule: 'au-2',
      rv: 1,
      kind: 'kb',
      at: '10:30',
      page: 'kb-5',
      ok: true,
      text: 'Запись на странице «Журнал осмотров машин»',
    });
    expect(db.knowledge.entries).toEqual([
      {
        id: 'ke-' + String(seq),
        page: 'kb-5',
        at: '10:30',
        head: 'Рейс Р-208 · выезд',
        lines: [
          { name: 'Пробег', value: '84 590' },
          { name: 'Топливо', value: '½' },
        ],
        src: { form: 'fm-insp', resp: 'R-1050', fv: 3, rule: 'au-2', rv: 1 },
      },
    ]);
  });

  it('pos: bottom — в конец; повтор без дубля; заголовок по умолчанию — объект', () => {
    const { db, f, x, r, env } = setup({ ...entry, pos: 'bottom', head: undefined });
    db.knowledge.entries = [
      {
        id: 'ke-1',
        page: 'kb-5',
        at: '09:00',
        head: 'Старая',
        lines: [],
        src: { form: 'fm-insp', resp: 'R-1', fv: 3, rule: 'au-2', rv: 1 },
      },
    ];
    kbRun(env, f, r, x);
    r.actions = [];
    kbRun(env, f, r, x);
    expect(db.knowledge.entries.map((e) => e.head)).toEqual(['Старая', 'Рейс Р-208 · выезд']);
  });

  it('пустой заголовок — номер ответа', () => {
    const { db, f, x, r, env } = setup({ ...entry, head: 'q-defect-text' });
    kbRun(env, f, r, x);
    expect(db.knowledge.entries?.[0]?.head).toBe('R-1050');
  });

  it('у правила нет полей — запись без строк', () => {
    const { db, f, x, r, env } = setup({ ...entry, fields: undefined });
    kbRun(env, f, r, x);
    expect(db.knowledge.entries?.[0]?.lines).toEqual([]);
  });
});

describe('kbRun: ошибки пишутся в результат и событие владельцам', () => {
  const ownersAlta = (db: FormsDb) =>
    db.members.filter((m) => grants(db, m.id).some((g) => g.roleObj.all)).map((m) => m.id);

  it.each<[string, Partial<FormRule>, string]>([
    ['страницы нет', { page: 'kb-404' }, 'страница удалена из Базы знаний'],
    [
      'автора нет',
      { byId: 'm-nobody', by: 'Никто' },
      'у автора правила нет права «Создавать» в Базе знаний',
    ],
    [
      'автор заблокирован',
      { byId: 'm-gromov' },
      'у автора правила Кирилл Громов нет права «Создавать» в Базе знаний',
    ],
    [
      'у автора нет права «Создавать»',
      { byId: 'm-vasiliev' },
      'у автора правила Илья Васильев нет права «Создавать» в Базе знаний',
    ],
    ['таблицы нет', { table: 'kt-404' }, 'таблица удалена со страницы «Журнал осмотров машин»'],
    [
      'таблица на другой странице',
      { page: 'kb-1' },
      'таблица удалена со страницы «Регламент приёмки смены»',
    ],
  ])('%s', (_n, rule, err) => {
    const { db, f, x, r, env } = setup(rule);
    const res = kbRun(env, f, r, x);
    expect(res).toEqual({
      rule: 'au-2',
      rv: 1,
      kind: 'kb',
      at: '10:30',
      page: x.page,
      ok: false,
      err,
    });
    expect(r.actions).toEqual([res]);
    expect(rows(db)).toHaveLength(2);
    expect(db.events[0]).toMatchObject({
      text: 'Форма «Осмотр машины»: ответ R-1050 не сохранён в Базу знаний — ' + err,
      to: ownersAlta(db),
      at: '10:30',
    });
  });

  it('нет среза Базы знаний — «страница удалена»', () => {
    const { f, x, r, env } = setup();
    const res = kbRun({ ...env, kb: undefined }, f, r, x);
    expect(res.err).toBe('страница удалена из Базы знаний');
  });

  it('страница «Только владелец» — автор не владелец бизнеса', () => {
    const { db, f, x, r, env } = setup({ page: 'kb-4', byId: 'm-kotelnikova' });
    withKbEditor(db, 'sp-own');
    expect(kbRun(env, f, r, x).err).toBe(
      'страница «Политика начислений водителям» доступна только владельцу',
    );
  });

  it('страница «Только владелец» — владелец бизнеса пишет, если там есть таблица', () => {
    const { f, x, r, env } = setup({ page: 'kb-4' });
    expect(kbRun(env, f, r, x).err).toBe(
      'таблица удалена со страницы «Политика начислений водителям»',
    );
  });

  it('успех — без события', () => {
    const { db, f, x, r, env } = setup();
    const n = db.events.length;
    kbRun(env, f, r, x);
    expect(db.events).toHaveLength(n);
  });

  it('ownersOf — участники с ролью владельца бизнеса', () => {
    const db = formsFixture();
    expect(ownersOf(db)).toEqual(ownersAlta(db));
    expect(ownersOf(db)).toContain('m-owner');
  });
});

describe('kbRun: PD-53 — роль пространства действует только в своём пространстве', () => {
  it('редактор «Логистики» пишет в журнал осмотров (kb-5, sp-log)', () => {
    const { db, f, x, r, env } = setup({ byId: 'm-kotelnikova' });
    withKbEditor(db, 'sp-log');
    expect(kbRun(env, f, r, x).ok).toBe(true);
  });

  it('редактор «Логистики» не пишет в «Салон и SPA» (kb-3, sp-spa)', () => {
    const { db, f, x, r, env } = setup({ byId: 'm-kotelnikova', mode: 'entry', page: 'kb-3' });
    withKbEditor(db, 'sp-log');
    expect(kbRun(env, f, r, x).err).toBe(
      'у автора правила Вера Котельникова нет права «Создавать» в Базе знаний',
    );
  });

  it('страница без пространства — объектные роли не засчитываются', () => {
    const { db, f, x, r, env } = setup({ byId: 'm-kotelnikova', mode: 'entry', page: 'kb-x' });
    withKbEditor(db, 'sp-log');
    db.knowledge.pages.push({ id: 'kb-x', title: 'Без раздела' });
    expect(kbRun(env, f, r, x).ok).toBe(false);
  });
});
