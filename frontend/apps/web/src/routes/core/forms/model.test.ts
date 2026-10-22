// W4.22 · Модель «Форм и опросов»: каталог типов (TYPES dc:474–482), черновик (sortDef, правки конструктора
// dc:562–615), проблемы до публикации (issues dc:721–738), условия (condOk dc:499–503), проверки и баллы предпросмотра
// (pvCheck dc:688–705, score dc:712–720), флаги и мета вопроса (dc:818–819), чипы, мета шаблона, имена.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  addCondition,
  addOption,
  addPage,
  changeType,
  chipOf,
  cleanDef,
  condOk,
  condSources,
  condText,
  condValues,
  dayMonth,
  deletePage,
  deleteQuestion,
  duplicateQuestion,
  editorChip,
  flagOf,
  idError,
  issuesOf,
  movePage,
  moveQuestion,
  newQuestion,
  normDef,
  previewDefaults,
  pvCheck,
  pvPages,
  qmeta,
  renameKey,
  restore,
  sameDef,
  scoreOf,
  templateMeta,
  typeInfo,
  TYPE_KEYS,
  uniqName,
} from './model.ts';

type S = components['schemas'];
type Q = S['FormQuestion'];
type Def = S['FormDefinitionV2'];

const q = (key: string, type: Q['type'], label: string, x: Partial<Q> = {}): Q => ({
  key,
  pageId: 'p1',
  type,
  label,
  required: false,
  ...x,
});

/** «Осмотр машины» v3 сида (страницы — разделы). */
const insp = (): Def => ({
  pages: [
    { id: 'p1', title: 'Фото' },
    { id: 'p2', title: 'Показания' },
    { id: 'p3', title: 'Проверка' },
    { id: 'p4', title: 'Дефекты' },
  ],
  fields: [
    q('q-photos', 'photo', 'Фото: спереди, сзади, слева, справа, одометр', { required: true }),
    q('q-odo', 'number', 'Пробег по одометру, км', { pageId: 'p2', required: true }),
    q('q-fuel', 'choice', 'Уровень топлива', {
      pageId: 'p2',
      required: true,
      options: [
        { key: 'o1', label: '¼' },
        { key: 'o2', label: '½' },
        { key: 'o3', label: '¾' },
        { key: 'o4', label: 'Полный' },
      ],
    }),
    q('q-checks', 'multi', 'Чек-лист: кузов, шины, документы', {
      pageId: 'p3',
      required: true,
      options: [
        { key: 'o1', label: 'кузов' },
        { key: 'o2', label: 'шины' },
        { key: 'o3', label: 'документы' },
      ],
    }),
    q('q-defect', 'bool', 'Есть дефекты?', { pageId: 'p4', required: true }),
    q('q-defect-text', 'text', 'Описание дефекта', {
      pageId: 'p4',
      required: true,
      showIf: {
        mode: 'all',
        conditions: [{ fieldKey: 'q-defect', operator: 'equals', value: 'true' }],
      },
    }),
  ],
});

const settings = (x: Partial<S['FormSettings']> = {}): S['FormSettings'] => ({
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
  ...x,
});

describe('каталог типов (TYPES dc:474–482)', () => {
  it('23 типа по порядку эталона, 2 недоступных с причиной, цвета групп', () => {
    expect(TYPE_KEYS).toHaveLength(23);
    expect(TYPE_KEYS.slice(0, 4)).toEqual(['text', 'longtext', 'number', 'money']);
    expect(TYPE_KEYS.slice(-2)).toEqual(['series', 'payment']);
    expect(typeInfo('choice')).toMatchObject({
      label: 'Один вариант',
      icon: 'radio_button_checked',
      group: 'choice',
      bg: '#E3EFE7',
      fg: '#1F6B52',
    });
    expect(typeInfo('person')).toMatchObject({ group: 'crm', bg: '#F6EDDC', fg: '#7A5214' });
    expect(typeInfo('payment')).toMatchObject({
      label: 'Оплата',
      why: 'Форма не принимает деньги: оплату проводит касса (FORM-05)',
    });
    expect(typeInfo('statement').icon).toBe('format_quote');
  });
});

describe('черновик: страницы и вопросы (sortDef, правки dc:562–615)', () => {
  it('normDef: пустой черновик получает «Страница 1», вопросы — по порядку страниц', () => {
    expect(normDef({ pages: [], fields: [] } as unknown as Def).pages).toEqual([
      { id: 'p1', title: 'Страница 1' },
    ]);
    const d = normDef({
      pages: [
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ],
      fields: [q('x', 'text', 'X', { pageId: 'b' }), q('y', 'text', 'Y', { pageId: 'a' })],
    });
    expect(d.fields.map((x) => x.key)).toEqual(['y', 'x']);
  });

  it('newQuestion: варианты, шкала, текст, файл, объект, область', () => {
    expect(newQuestion('choice', 'p1', 'ab12')).toEqual({
      key: 'q-choice-ab12',
      pageId: 'p1',
      type: 'choice',
      label: '',
      required: false,
      options: [
        { key: 'o1', label: 'Вариант 1' },
        { key: 'o2', label: 'Вариант 2' },
      ],
    });
    expect(newQuestion('scale', 'p1', 'x')).toMatchObject({ scaleMin: 1, scaleMax: 5 });
    expect(newQuestion('statement', 'p1', 'x').label).toBe('Текст для респондента');
    expect(newQuestion('photo', 'p1', 'x')).toMatchObject({
      accept: 'photo',
      maxFiles: 5,
      maxFileMb: 20,
    });
    expect(newQuestion('ref', 'p1', 'x').refKind).toBe('vehicle');
    expect(newQuestion('unit', 'p1', 'x').unitLevel).toBe('any');
  });

  it('changeType: варианты и шкала по умолчанию, недоступный тип не ставится', () => {
    const x = q('a', 'text', 'А');
    expect(changeType(x, 'select').options).toHaveLength(2);
    expect(changeType(x, 'scale')).toMatchObject({ scaleMin: 1, scaleMax: 5 });
    expect(changeType(x, 'payment' as Q['type'])).toBe(x);
  });

  it('moveQuestion: внутри страницы — обмен, на границе — переход на соседнюю страницу', () => {
    const d = insp();
    expect(
      moveQuestion(d, 'q-fuel', -1)
        .fields.map((x) => x.key)
        .slice(1, 3),
    ).toEqual(['q-fuel', 'q-odo']);
    const up = moveQuestion(d, 'q-odo', -1);
    expect(up.fields.find((x) => x.key === 'q-odo')?.pageId).toBe('p1');
    expect(moveQuestion(d, 'q-photos', -1)).toEqual(d);
  });

  it('movePage, addPage («Страница N»), deletePage и restore', () => {
    const d = insp();
    expect(movePage(d, 'p2', -1).pages.map((p) => p.id)).toEqual(['p2', 'p1', 'p3', 'p4']);
    expect(movePage(d, 'p1', -1)).toEqual(d);
    const a = addPage(d, 'p-new');
    expect(a.pages.at(-1)).toEqual({ id: 'p-new', title: 'Страница 5' });
    const del = deletePage(d, 'p4');
    expect(del?.undo.text).toBe('«Дефекты» удалена вместе с 2 вопросами');
    expect(del?.def.fields.map((x) => x.key)).not.toContain('q-defect');
    expect(restore(del?.def as Def, del?.undo as never)).toEqual(d);
    expect(deletePage(normDef({ pages: [{ id: 'p1', title: 'Х' }], fields: [] }), 'p1')).toBe(null);
  });

  it('deleteQuestion и restore на прежнее место; текст отмены — по подписи или типу', () => {
    const d = insp();
    const r = deleteQuestion(d, 'q-odo');
    expect(r.undo.text).toBe('Вопрос «Пробег по одометру, км» удалён');
    expect(restore(r.def, r.undo)).toEqual(d);
    expect(
      deleteQuestion(normDef({ pages: [], fields: [q('z', 'int', '')] } as unknown as Def), 'z')
        .undo.text,
    ).toBe('Вопрос «Целое число» удалён');
  });

  it('duplicateQuestion: «-copy-», «(копия)», вставка следом', () => {
    const r = duplicateQuestion(insp(), 'q-odo', 'k1');
    expect(r.key).toBe('q-odo-copy-k1');
    expect(r.def.fields[2]).toMatchObject({
      key: 'q-odo-copy-k1',
      label: 'Пробег по одометру, км (копия)',
    });
    expect(duplicateQuestion(r.def, 'q-odo-copy-k1', 'k2').key).toBe('q-odo-copy-k2');
  });

  it('addOption: «Вариант N» со свободным ключом', () => {
    const d = { ...insp() };
    const x = addOption(d, 'q-fuel');
    expect(x.fields.find((y) => y.key === 'q-fuel')?.options?.at(-1)).toEqual({
      key: 'o5',
      label: 'Вариант 5',
    });
  });
});

describe('идентификатор вопроса (setId dc:609–615)', () => {
  it('правило эталона и повтор', () => {
    const d = insp();
    const x = d.fields[1] as Q;
    expect(idError(d, x, 'q')).toBe('Латиница, цифры, «_» и «-», с буквы, от 2 символов');
    expect(idError(d, x, '1abc')).toBe('Латиница, цифры, «_» и «-», с буквы, от 2 символов');
    expect(idError(d, x, 'пробег')).toBe('Латиница, цифры, «_» и «-», с буквы, от 2 символов');
    expect(idError(d, x, 'q-fuel')).toBe('Такой идентификатор уже есть');
    expect(idError(d, x, 'odometer_km')).toBe(null);
  });

  it('renameKey переименовывает ссылки в условиях', () => {
    const r = renameKey(insp(), 'q-defect', 'q-has-defect');
    expect(r.fields.find((x) => x.key === 'q-defect-text')?.showIf?.conditions[0]?.fieldKey).toBe(
      'q-has-defect',
    );
  });
});

describe('условия показа (dc:843–877, condOk dc:499–503)', () => {
  it('источники — вопросы выше нужных типов; значения — варианты или Да/Нет', () => {
    const d = insp();
    expect(condSources(d, 'q-defect-text').map((x) => x.key)).toEqual([
      'q-odo',
      'q-fuel',
      'q-checks',
      'q-defect',
    ]);
    expect(condValues(d.fields[4] as Q)).toEqual([
      ['true', 'Да'],
      ['false', 'Нет'],
    ]);
    expect(condValues(d.fields[2] as Q)?.[3]).toEqual(['o4', 'Полный']);
    expect(condValues(d.fields[1] as Q)).toBe(null);
  });

  it('addCondition: последний источник выше, первое значение', () => {
    const d = insp();
    const x = addCondition(d, 'q-defect-text');
    expect(x.fields[5]?.showIf?.conditions[1]).toEqual({
      fieldKey: 'q-defect',
      operator: 'equals',
      value: 'true',
    });
  });

  it('condOk: И / ИЛИ, равно / не равно, списки и регистр текста', () => {
    const all = {
      mode: 'all' as const,
      conditions: [
        { fieldKey: 'a', operator: 'equals' as const, value: 'o1' },
        { fieldKey: 'b', operator: 'not_equals' as const, value: 'нет' },
      ],
    };
    expect(condOk(all, { a: 'o1', b: 'да' })).toBe(true);
    expect(condOk(all, { a: 'o1', b: 'НЕТ' })).toBe(false);
    expect(condOk({ ...all, mode: 'any' }, { a: 'o2', b: 'да' })).toBe(true);
    expect(condOk(all, { a: ['o2', 'o1'], b: '' })).toBe(true);
    expect(condOk(undefined, {})).toBe(true);
  });

  it('condText: «вопрос» = подпись значения, «и» / «или»', () => {
    const d = insp();
    expect(condText(d.fields[5]?.showIf as S['FormShowIf'], d)).toBe('«Есть дефекты?» = да');
    const two: S['FormShowIf'] = {
      mode: 'any',
      conditions: [
        { fieldKey: 'q-fuel', operator: 'not_equals', value: 'o4' },
        { fieldKey: 'q-odo', operator: 'equals', value: '100' },
      ],
    };
    expect(condText(two, d)).toBe('«Уровень топлива» ≠ Полный или «Пробег по одометру, км» = 100');
  });
});

describe('мета, флаги и чипы', () => {
  it('qmeta: тип · обязательный · варианты · условие', () => {
    const d = insp();
    expect(qmeta(d.fields[2] as Q, d)).toBe('Один вариант · обязательный · 4 варианта');
    expect(qmeta(d.fields[5] as Q, d)).toBe(
      'Короткий текст · обязательный · если «Есть дефекты?» = да',
    );
  });

  it('flagOf: только у опубликованной формы — «Новое», «Новый тип», «Изменено»', () => {
    const d = insp();
    const prev = new Map(d.fields.map((x) => [x.key, x]));
    expect(flagOf(d.fields[0] as Q, prev, false)).toBe(null);
    expect(flagOf(q('n', 'text', 'Н'), prev, true)?.label).toBe('Новое');
    expect(flagOf({ ...(d.fields[1] as Q), type: 'int' }, prev, true)?.label).toBe('Новый тип');
    expect(flagOf({ ...(d.fields[1] as Q), label: 'Пробег' }, prev, true)?.label).toBe('Изменено');
    expect(flagOf(d.fields[1] as Q, prev, true)).toBe(null);
  });

  it('chipOf (строка) и editorChip (шапка)', () => {
    const base = {
      status: 'published' as const,
      publishedVersionNumber: 3,
      hasUnpublishedChanges: false,
    };
    expect(
      chipOf({ ...base, status: 'draft' as const, publishedVersionNumber: null }),
    ).toMatchObject({
      label: 'Черновик',
      tone: 'neutral',
      icon: 'edit_note',
    });
    expect(chipOf({ ...base, status: 'closed' as const })).toMatchObject({
      label: 'Приём закрыт · v3',
      icon: 'block',
    });
    expect(chipOf({ ...base, hasUnpublishedChanges: true })).toMatchObject({
      label: 'v3 · есть изменения',
      tone: 'warn',
    });
    expect(chipOf(base)).toMatchObject({ label: 'Принимает ответы · v3', tone: 'ok' });
    expect(editorChip({ ...base, status: 'draft' as const }, true).label).toBe(
      'Черновик · не опубликована',
    );
    expect(editorChip(base, true).label).toBe('Действует v3 · есть неопубликованные изменения');
    expect(editorChip(base, false).label).toBe('Принимает ответы · v3');
  });

  it('templateMeta: модуль, вопросы, страницы, модуль не подключён', () => {
    expect(templateMeta({ questionCount: 6, pageCount: 1, available: true }, null)).toBe(
      '6 вопросов',
    );
    expect(templateMeta({ questionCount: 7, pageCount: 3, available: false }, 'Логистика')).toBe(
      'Логистика · 7 вопросов · 3 страницы · модуль не подключён',
    );
  });

  it('uniqName: « · 2», « · 3» без учёта регистра; dayMonth — ДД.ММ по Москве', () => {
    expect(uniqName(['Анкета'], 'Анкета')).toBe('Анкета · 2');
    expect(uniqName(['анкета', 'Анкета · 2'], 'Анкета')).toBe('Анкета · 3');
    expect(uniqName([], 'Новая форма')).toBe('Новая форма');
    expect(dayMonth('2026-09-23T22:30:00Z')).toBe('24.09');
  });
});

describe('проблемы до публикации (issues dc:721–738)', () => {
  it('все проверки эталона в его порядке', () => {
    expect(issuesOf({ pages: [{ id: 'p1', title: 'С' }], fields: [] }, settings()).E).toEqual([
      'В форме нет ни одного вопроса',
    ]);
    const d: Def = {
      pages: [{ id: 'p1', title: 'С' }],
      fields: [
        q('a', 'choice', '', { options: [] }),
        q('b', 'select', 'Б', {
          options: [
            { key: 'o1', label: 'x' },
            { key: 'o2', label: ' ' },
          ],
        }),
        q('c', 'text', 'В', {
          showIf: {
            mode: 'all',
            conditions: [
              { fieldKey: 'zz', operator: 'equals', value: '1' },
              { fieldKey: 'd', operator: 'equals', value: '1' },
            ],
          },
        }),
        q('d', 'text', 'Г', { hidden: true, required: true }),
        q('e', 'number', 'Д', { minValue: '10', maxValue: '5' }),
        q('f', 'person', 'Кто'),
        q('a', 'text', 'Повтор'),
      ],
    };
    expect(issuesOf(d, settings({ access: 'public', scoring: true }))).toEqual({
      E: [
        'Вопрос 1: нет текста',
        'Вопрос 1: нет вариантов ответа',
        '«Б»: есть пустой вариант',
        '«В»: условие ссылается на удалённый вопрос',
        '«В»: условие ссылается на вопрос ниже — условие может зависеть только от вопросов выше',
        '«Г»: скрытый обязательный вопрос без значения по умолчанию',
        '«Д»: «от» больше «до»',
        'Идентификатор a повторяется',
        '«Кто»: публичная форма не может спрашивать данные CRM',
      ],
      W: ['Включён подсчёт баллов, но ни у одного варианта нет баллов'],
    });
    expect(issuesOf(insp(), settings()).E).toEqual([]);
  });
});

describe('предпросмотр (pvPages, pvCheck, score)', () => {
  it('страницы без скрытых и не показанных по условию; перемешивание по зерну', () => {
    const d = insp();
    expect(pvPages(d, {}, 's').map((p) => p.qs.map((x) => x.key))).toEqual([
      ['q-photos'],
      ['q-odo', 'q-fuel'],
      ['q-checks'],
      ['q-defect'],
    ]);
    expect(pvPages(d, { 'q-defect': 'true' }, 's')[3]?.qs.map((x) => x.key)).toEqual([
      'q-defect',
      'q-defect-text',
    ]);
    const sh = { ...d, pages: d.pages.map((p) => (p.id === 'p2' ? { ...p, shuffle: true } : p)) };
    const a = pvPages(sh, {}, 'seed-1')[1]?.qs.map((x) => x.key);
    expect(pvPages(sh, {}, 'seed-1')[1]?.qs.map((x) => x.key)).toEqual(a);
    expect([...(a ?? [])].sort()).toEqual(['q-fuel', 'q-odo']);
  });

  it('pvCheck: тексты эталона', () => {
    expect(pvCheck(q('a', 'text', 'А', { required: true }), '')).toBe('Обязательный вопрос');
    expect(pvCheck(q('a', 'statement', 'А', { required: true }), '')).toBe(null);
    expect(pvCheck(q('a', 'email', 'А'), 'x@y')).toBe('Проверьте адрес почты');
    expect(pvCheck(q('a', 'phone', 'А'), '+7 900')).toBe('Нужно не меньше 10 цифр');
    expect(pvCheck(q('a', 'inn', 'А'), '12345')).toBe('ИНН — 10 или 12 цифр');
    expect(pvCheck(q('a', 'url', 'А'), 'ortus.app')).toBe(
      'Ссылка начинается с http:// или https://',
    );
    expect(pvCheck(q('a', 'money', 'А'), 'abc')).toBe('Нужно число');
    expect(pvCheck(q('a', 'int', 'А'), '1.5')).toBe('Нужно целое число');
    expect(pvCheck(q('a', 'number', 'А', { minValue: '10' }), '9')).toBe('Не меньше 10');
    expect(pvCheck(q('a', 'number', 'А', { maxValue: '10' }), '1 000')).toBe('Не больше 10');
    expect(pvCheck(q('a', 'text', 'А', { minLength: 3 }), 'ab')).toBe('Не короче 3 символов');
    expect(pvCheck(q('a', 'longtext', 'А', { maxLength: 2 }), 'abc')).toBe('Не длиннее 2 символов');
    expect(pvCheck(q('a', 'multi', 'А', { minSelected: 2 }), ['o1'])).toBe('Выберите не меньше 2');
    expect(pvCheck(q('a', 'multi', 'А', { maxSelected: 1 }), ['o1', 'o2'])).toBe(
      'Выберите не больше 1',
    );
    expect(pvCheck(q('a', 'email', 'А'), 'name@example.ru')).toBe(null);
  });

  it('scoreOf: максимум — лучший вариант (multi — сумма положительных), набрано — по выбору', () => {
    const d: Def = {
      pages: [{ id: 'p1', title: 'Т' }],
      fields: [
        q('a', 'choice', 'А', {
          options: [
            { key: 'o1', label: '1', score: 2 },
            { key: 'o2', label: '2', score: 0 },
          ],
        }),
        q('b', 'multi', 'Б', {
          options: [
            { key: 'o1', label: '1', score: 1 },
            { key: 'o2', label: '2', score: 3 },
            { key: 'o3', label: '3', score: -1 },
          ],
        }),
        q('c', 'choice', 'Скрытый', {
          hidden: true,
          options: [{ key: 'o1', label: 'x', score: 5 }],
        }),
      ],
    };
    expect(scoreOf(d, { a: 'o1', b: ['o2', 'o3'] })).toEqual({ got: 4, max: 6 });
  });

  it('previewDefaults: значения по умолчанию — подпись варианта → ключ, «да» → true', () => {
    const d: Def = {
      pages: [{ id: 'p1', title: 'Т' }],
      fields: [
        q('a', 'choice', 'А', {
          defaultValue: 'полный',
          options: [{ key: 'o4', label: 'Полный' }],
        }),
        q('b', 'bool', 'Б', { defaultValue: 'да' }),
        q('c', 'text', 'В', { defaultValue: 'Москва' }),
        q('d', 'text', 'Г'),
      ],
    };
    expect(previewDefaults(d)).toEqual({ a: 'o4', b: 'true', c: 'Москва' });
  });
});

describe('сохранение: cleanDef и sameDef', () => {
  it('cleanDef убирает неверные числа и пустые подписи шкалы, приводит запятую', () => {
    const d: Def = {
      pages: [{ id: 'p1', title: 'Т' }],
      fields: [
        q('a', 'number', 'А', { minValue: '1,5', maxValue: '-' }),
        q('b', 'photo', 'Б', { maxFiles: 50, maxFileMb: 20 }),
        q('c', 'choice', 'В', { options: [{ key: 'o1', label: 'x', score: 'abc' as never }] }),
      ],
    };
    const c = cleanDef(d);
    expect(c.fields[0]).toMatchObject({ minValue: '1.5' });
    expect(c.fields[0]).not.toHaveProperty('maxValue');
    expect(c.fields[1]).not.toHaveProperty('maxFiles');
    expect(c.fields[2]?.options?.[0]).toEqual({ key: 'o1', label: 'x' });
  });

  it('sameDef не зависит от порядка ключей и undefined', () => {
    const a = insp();
    const b = JSON.parse(JSON.stringify(a)) as Def;
    (b.fields[0] as Q & { hint?: string }).hint = undefined;
    b.fields[0] = Object.fromEntries(Object.entries(b.fields[0] as Q).reverse()) as Q;
    expect(sameDef(a, b)).toBe(true);
    expect(sameDef(a, renameKey(a, 'q-odo', 'odo'))).toBe(false);
  });
});
