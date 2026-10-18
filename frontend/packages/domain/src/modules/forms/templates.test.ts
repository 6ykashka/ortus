// Шаблоны форм 14.10 (models.js:80–107, B §2.5 «Формы», факт 12).
import { describe, expect, it } from 'vitest';
import { FORM_SETTINGS, FORM_TEMPLATES, FORM_VARS, templateDef } from './templates.ts';
import type { FormTemplate } from './types.ts';

const tpl = (id: string): FormTemplate => {
  const t = FORM_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error('нет шаблона ' + id);
  return t;
};

describe('FORM_SETTINGS', () => {
  it('13 настроек формы по умолчанию', () => {
    expect(FORM_SETTINGS).toEqual({
      access: 'internal',
      until: '',
      limit: null,
      onePerPerson: false,
      allowEdit: true,
      thanks: 'Спасибо! Ответ отправлен.',
      quiz: false,
      passScore: null,
      showScore: true,
      progress: true,
      backButton: true,
      logo: true,
      retainDays: 365,
    });
  });
});

describe('FORM_TEMPLATES', () => {
  it('15 шаблонов в порядке списка «Все шаблоны»', () => {
    expect(FORM_TEMPLATES.map((t) => t.id)).toEqual([
      'blank',
      'tpl-profile',
      'tpl-feedback',
      'tpl-request',
      'tpl-event',
      'tpl-csat',
      'tpl-nps',
      'tpl-ces',
      'tpl-support',
      'tpl-pulse',
      'tpl-onboard',
      'tpl-quiz',
      'tpl-insp',
      'tpl-foreman',
      'tpl-spa',
    ]);
  });

  it.each([
    ['basic', ['blank', 'tpl-profile', 'tpl-feedback', 'tpl-request', 'tpl-event']],
    ['survey', ['tpl-csat', 'tpl-nps', 'tpl-ces', 'tpl-support']],
    ['people', ['tpl-pulse', 'tpl-onboard']],
    ['quiz', ['tpl-quiz']],
    ['industry', ['tpl-insp', 'tpl-foreman', 'tpl-spa']],
  ])('раздел %s', (cat, ids) => {
    expect(FORM_TEMPLATES.filter((t) => t.cat === cat).map((t) => t.id)).toEqual(ids);
  });

  it.each([
    ['tpl-insp', 'logistics', 'Круговой осмотр машины'],
    ['tpl-foreman', 'repair', 'Ежедневный отчёт прораба'],
    ['tpl-spa', 'spa', 'Анкета клиента перед процедурой'],
  ])('отраслевой шаблон %s требует модуль %s', (id, mod, name) => {
    expect(tpl(id).module).toBe(mod);
    expect(tpl(id).name).toBe(name);
  });

  it('у остальных шаблонов модуля нет', () => {
    expect(FORM_TEMPLATES.filter((t) => t.cat !== 'industry').every((t) => t.module === null)).toBe(
      true,
    );
  });

  it('настройки шаблонов: обратная связь публичная, тест с баллами', () => {
    expect(tpl('tpl-feedback').settings).toEqual({ access: 'public' });
    expect(tpl('tpl-quiz').settings).toEqual({ quiz: true, passScore: 4, showScore: true });
    expect(FORM_TEMPLATES.filter((t) => t.settings).map((t) => t.id)).toEqual([
      'tpl-feedback',
      'tpl-quiz',
    ]);
  });

  it('вопрос по умолчанию необязательный, R — обязательный', () => {
    const [blankQ] = tpl('blank').pages[0]?.fields ?? [];
    expect(blankQ).toEqual({ id: 'q-1', type: 'text', label: 'Вопрос 1', required: false });
    const name = tpl('tpl-profile').pages[0]?.fields[0];
    expect(name).toEqual({ id: 'q-name', type: 'text', label: 'Имя и фамилия', required: true });
  });

  it('варианты o1…oN, баллы теста — score', () => {
    const q1 = tpl('tpl-quiz').pages[0]?.fields[0];
    expect(q1?.options).toEqual([
      { id: 'o1', label: 'Выехать и сообщить после рейса', score: 0 },
      { id: 'o2', label: 'Отметить дефект в осмотре и сообщить менеджеру', score: 1 },
      { id: 'o3', label: 'Ничего, если дефект мелкий', score: 0 },
    ]);
    const fuel = tpl('tpl-insp').pages[1]?.fields[1];
    expect(fuel?.options).toEqual([
      { id: 'o1', label: '¼' },
      { id: 'o2', label: '½' },
      { id: 'o3', label: '¾' },
      { id: 'o4', label: 'Полный' },
    ]);
  });

  it('условие показа: «И» по одному вопросу и «ИЛИ» в оценке поддержки', () => {
    const better = tpl('tpl-feedback').pages[0]?.fields[2];
    expect(better?.showIf).toEqual({
      mode: 'all',
      conds: [{ field: 'q-recommend', op: 'eq', value: 'Нет' }],
    });
    const left = tpl('tpl-support').pages[0]?.fields[3];
    expect(left?.showIf).toEqual({
      mode: 'any',
      conds: [
        { field: 'q-solved', op: 'eq', value: 'Частично' },
        { field: 'q-solved', op: 'eq', value: 'Нет' },
      ],
    });
  });

  it('круговой осмотр: 3 страницы, фото 5 × 20 МБ, дефект — при «да»', () => {
    const t = tpl('tpl-insp');
    expect(t.pages.map((p) => p.title)).toEqual(['Фото', 'Показания', 'Проверка']);
    expect(t.pages[0]?.fields[0]).toEqual({
      id: 'q-photos',
      type: 'photo',
      label: 'Фото: спереди, сзади, слева, справа, одометр',
      required: true,
      accept: 'photo',
      maxFiles: 5,
      maxMb: 20,
    });
    const photo = t.pages[2]?.fields[3];
    expect(photo?.label).toBe('Фото дефекта');
    expect(photo?.maxFiles).toBe(3);
    expect(photo?.showIf).toEqual({
      mode: 'all',
      conds: [{ field: 'q-defect', op: 'eq', value: 'да' }],
    });
  });

  it('шкалы NPS 0–10, CES 1–7, пульс 1–5 с подписями краёв', () => {
    const nps = tpl('tpl-nps').pages[0]?.fields[0];
    expect([nps?.scaleMin, nps?.scaleMax, nps?.left, nps?.right]).toEqual([
      0,
      10,
      'Точно нет',
      'Точно да',
    ]);
    const ces = tpl('tpl-ces').pages[0]?.fields[0];
    expect([ces?.scaleMin, ces?.scaleMax]).toEqual([1, 7]);
    const pulse = tpl('tpl-pulse')
      .pages.flatMap((p) => p.fields)
      .filter((f) => f.type === 'scale');
    expect(pulse.map((f) => [f.scaleMin, f.scaleMax, f.left, f.right])).toEqual([
      [1, 5, 'Совсем нет', 'Полностью'],
      [1, 5, 'Совсем нет', 'Полностью'],
      [1, 5, 'Совсем нет', 'Полностью'],
    ]);
  });

  it.each([
    ['blank', [1]],
    ['tpl-profile', [6]],
    ['tpl-feedback', [5]],
    ['tpl-request', [4, 4]],
    ['tpl-event', [3, 4]],
    ['tpl-csat', [2]],
    ['tpl-nps', [2]],
    ['tpl-ces', [2]],
    ['tpl-support', [4]],
    ['tpl-pulse', [2, 2]],
    ['tpl-onboard', [2, 2, 3]],
    ['tpl-quiz', [3, 1]],
    ['tpl-insp', [1, 2, 4]],
    ['tpl-foreman', [4, 3]],
    ['tpl-spa', [2, 4]],
  ])('%s: вопросов по страницам %j', (id, counts) => {
    expect(tpl(id).pages.map((p) => p.fields.length)).toEqual(counts);
  });

  it('прораб: объект — ссылка на объект CRM, бригада — сотрудник', () => {
    const [obj, , , crew] = tpl('tpl-foreman').pages[0]?.fields ?? [];
    expect([obj?.type, obj?.refKind, crew?.type]).toEqual(['ref', 'object', 'person']);
  });
});

describe('templateDef', () => {
  it('заявка на услугу: страницы p1/p2, 8 вопросов (4 + 4) с page и section', () => {
    const d = templateDef(tpl('tpl-request'));
    expect(d.pages).toEqual([
      { id: 'p1', title: 'Что нужно' },
      { id: 'p2', title: 'Контакты' },
    ]);
    expect(d.fields).toHaveLength(8);
    expect(d.fields.map((f) => f.page)).toEqual(['p1', 'p1', 'p1', 'p1', 'p2', 'p2', 'p2', 'p2']);
    expect(d.fields[4]).toEqual({
      id: 'q-name',
      type: 'text',
      label: 'Как к вам обращаться',
      required: true,
      page: 'p2',
      section: 'Контакты',
    });
  });

  it.each([[undefined], [null]])('без шаблона (%s) — одна пустая «Страница 1»', (t) => {
    expect(templateDef(t)).toEqual({ pages: [{ id: 'p1', title: 'Страница 1' }], fields: [] });
  });

  it('черновик — глубокая копия: правка не меняет шаблон', () => {
    const d = templateDef(tpl('tpl-support'));
    const f = d.fields[0];
    if (!f?.options) throw new Error('нет вариантов');
    (f.options[0] as { label: string }).label = 'Изменено';
    f.label = 'Изменено';
    const src = tpl('tpl-support').pages[0]?.fields[0];
    expect(src?.label).toBe('Ваш вопрос решён?');
    expect(src?.options?.[0]).toEqual({ id: 'o1', label: 'Да' });
  });

  it('у каждого шаблона id вопросов в черновике не повторяются', () => {
    for (const t of FORM_TEMPLATES) {
      const ids = templateDef(t).fields.map((f) => f.id);
      expect(new Set(ids).size, t.id).toBe(ids.length);
    }
  });
});

describe('FORM_VARS', () => {
  it('6 служебных переменных ответа с подписями', () => {
    expect(FORM_VARS).toEqual([
      ['$at', 'Дата и время ответа'],
      ['$author', 'Автор ответа'],
      ['$object', 'Объект CRM'],
      ['$id', 'Номер ответа'],
      ['$form', 'Название формы'],
      ['$ver', 'Версия формы'],
    ]);
  });
});
