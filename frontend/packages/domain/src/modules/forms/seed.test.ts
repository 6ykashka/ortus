// Сид форм 14.10 (mock-data.js:231–275; «Лотос» — forms: [], responses: [], mock-data.js:74).
import { describe, expect, it } from 'vitest';
import { formsSeed } from './seed.ts';

describe('formsSeed «Альты»', () => {
  const s = formsSeed('t-alta');

  it('две формы: «Осмотр машины» v3 и черновик отчёта прораба', () => {
    expect(s.forms.map((f) => [f.id, f.name, f.module, f.status, f.published])).toEqual([
      ['fm-insp', 'Осмотр машины', 'logistics', 'published', 3],
      ['fm-foreman', 'Ежедневный отчёт прораба', 'repair', 'draft', null],
    ]);
  });

  it('у осмотра три версии: 3, 4 и 7 вопросов', () => {
    const insp = s.forms[0];
    expect(insp?.versions.map((v) => [v.v, v.at, v.fields.length])).toEqual([
      [1, '02.09.2026', 3],
      [2, '10.09.2026', 4],
      [3, '24.09.2026', 7],
    ]);
    const v3 = insp?.versions[2]?.fields ?? [];
    expect(v3.map((f) => f.id)).toEqual([
      'q-photos',
      'q-odo',
      'q-fuel',
      'q-checks',
      'q-defect',
      'q-defect-text',
      'q-critical',
    ]);
    expect(v3[2]?.options).toEqual(['¼', '½', '¾', 'Полный']);
    expect(v3[5]?.showIf).toEqual({ field: 'q-defect', eq: 'да' });
  });

  it('действия: au-1 задача менеджеру, au-2 строка в таблицу «Осмотры» на kb-5', () => {
    const [au1, au2] = s.forms[0]?.automations ?? [];
    expect(au1).toEqual({
      id: 'au-1',
      text: 'Ответ принят → задача менеджеру «Проверить осмотр»',
      version: 1,
      on: true,
    });
    expect(au2).toMatchObject({
      id: 'au-2',
      kind: 'kb',
      mode: 'table',
      page: 'kb-5',
      table: 'kt-insp',
      pos: 'top',
      when: 'accepted',
      on: true,
      byId: 'm-owner',
    });
    expect(au2?.fields?.map((x) => [x.col, x.src])).toEqual([
      ['c-at', '$at'],
      ['c-obj', '$object'],
      ['c-who', '$author'],
      ['c-odo', 'q-odo'],
      ['c-fuel', 'q-fuel'],
      ['c-def', 'q-defect'],
      ['c-resp', '$id'],
    ]);
  });

  it('черновик прораба — старый формат (массив полей)', () => {
    const d = s.forms[1]?.draft;
    expect(Array.isArray(d) && d.map((f) => f.id)).toEqual(['q-volume', 'q-crew', 'q-photo']);
  });

  it('два принятых ответа с успешным действием au-2', () => {
    expect(s.responses.map((r) => [r.id, r.version, r.author, r.object, r.status])).toEqual([
      ['R-0988', 2, 'Кирилл Громов', 'Рейс Р-171', 'Принят'],
      ['R-1012', 3, 'Илья Васильев', 'Рейс Р-196', 'Принят'],
    ]);
    expect(s.responses.map((r) => r.actions?.map((a) => [a.rule, a.ok, a.table]))).toEqual([
      [['au-2', true, 'kt-insp']],
      [['au-2', true, 'kt-insp']],
    ]);
    expect(s.responses[1]?.values['q-odo']).toBe('84 210');
  });

  it('каждый вызов — новые объекты', () => {
    const a = formsSeed('t-alta');
    const b = formsSeed('t-alta');
    expect(a).toEqual(b);
    expect(a.forms[0]).not.toBe(b.forms[0]);
  });
});

describe('formsSeed других организаций', () => {
  it.each(['t-lotos', 't-other'])('%s — форм и ответов нет', (id) => {
    expect(formsSeed(id)).toEqual({ forms: [], responses: [] });
  });
});
