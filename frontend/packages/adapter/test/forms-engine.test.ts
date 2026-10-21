// Логика «Форм» сценарного сервера (W4.05, возврат 1) — эталон поведения для Go-модуля W4.21: ячейки CSV выгрузки
// ответов (защита от формул, как exportDataset), ключ вопроса новой версии в пределах контракта, проверка ответа в
// области формы (Q-W4.05-16).
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import { csvOf, mayReview, nextVersion, responseMy } from '../src/msw/forms/engine.ts';
import type { Def, FormRow, FormsView, ResponseRow } from '../src/msw/forms/state.ts';

type S = components['schemas'];

const KEY = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

const def = (fields: Def['fields']): Def => ({
  pages: [{ id: 'p1', title: 'Страница 1' }],
  fields,
});

function form(d: Def, orgUnitId: string | null = null): FormRow {
  return {
    id: 'f1',
    proto: 'fm-1',
    name: 'Анкета',
    orgUnitId,
    moduleKey: null,
    templateId: null,
    groupId: null,
    ownerId: 'm1',
    ownerName: 'Дарья Зимина',
    status: 'published',
    versions: [{ id: 'v1', number: 1, definition: d, createdAt: '', byId: 'm1', byName: '' }],
    draft: { definition: d, revision: 1, hasChanges: false },
    settings: {} as S['FormSettings'],
    publicToken: null,
    revision: 1,
    createdAt: '2026-10-01T07:00:00Z',
    updatedAt: '2026-10-01T07:00:00Z',
  };
}

function response(answers: S['FieldEntry'][], over: Partial<ResponseRow> = {}): ResponseRow {
  return {
    id: 'r1',
    proto: 'R-0001',
    formId: 'f1',
    number: 'R-0001',
    versionNumber: 1,
    submittedAt: '2026-10-01T07:30:00Z',
    channel: 'public',
    authorId: null,
    authorName: 'Гость',
    answers,
    reviewStatus: 'pending',
    revision: 1,
    actions: [],
    ...over,
  };
}

describe('csvOf — ячейки выгрузки ответов (описание exportFormResponses)', () => {
  const d = def([
    { key: 'q-name', pageId: 'p1', type: 'text', label: 'Имя', required: false },
    { key: 'q-sum', pageId: 'p1', type: 'number', label: 'Сумма', required: false },
    { key: 'q-day', pageId: 'p1', type: 'date', label: 'Дата', required: false },
    { key: 'q-note', pageId: 'p1', type: 'longtext', label: '=Комментарий', required: false },
  ]);
  const text = (fieldKey: string, value: string): S['FieldEntry'] => ({
    fieldKey,
    value: { type: 'text', value },
  });
  const lines = (rs: ResponseRow[]) =>
    csvOf(form(d), rs)
      .replace(/^\uFEFF/, '')
      .split('\r\n');

  it('текст гостя с = + - @ TAB CR в начале (и после пробелов) — с апострофом, кавычки RFC 4180', () => {
    const [head, row] = lines([
      response([
        text('q-name', '=HYPERLINK("http://x";"y")'),
        { fieldKey: 'q-sum', value: { type: 'decimal', value: '-5' } },
        { fieldKey: 'q-day', value: { type: 'date', value: '2026-10-01' } },
        text('q-note', '  @SUM(A1)'),
      ]),
    ]);
    expect(head).toBe("Ответ;Дата;Автор;Объект;Версия;Статус;Имя;Сумма;Дата;'=Комментарий");
    const cells = row?.split(';') ?? [];
    expect(row?.startsWith('R-0001;01.10.2026 10:30;Гость;;v1;На проверке;')).toBe(true);
    expect(row).toContain('"\'=HYPERLINK(""http://x"";""y"")"');
    expect(cells.at(-3)).toBe('-5');
    expect(cells.at(-2)).toBe('01.10.2026');
    expect(cells.at(-1)).toBe("'  @SUM(A1)");
  });

  it('автор и объект — тоже текстовые ячейки; перевод строки и CR — в кавычках', () => {
    const [, row] = lines([
      response([text('q-name', 'строка\rвторая'), text('q-note', '+7 900')], {
        authorName: '-Иван',
        subject: {
          ref: { moduleKey: 'fleet', entityType: 'trip', entityId: 't1' },
          label: '@Рейс',
        },
      }),
    ]);
    expect(row).toContain(";'-Иван;'@Рейс;");
    expect(row).toContain('"строка\rвторая"');
    expect(row?.endsWith(";'+7 900")).toBe(true);
  });
});

describe('nextVersion — ключ вопроса, сменившего тип', () => {
  it('«{key}-v{N}» не длиннее 64 знаков и проходит шаблон ключа; условия показа следуют за ключом', () => {
    const long = `q${'x'.repeat(63)}`;
    const prev = def([{ key: long, pageId: 'p1', type: 'text', label: 'Пробег', required: false }]);
    const next = nextVersion(
      def([
        { key: long, pageId: 'p1', type: 'number', label: 'Пробег', required: false },
        {
          key: 'q-why',
          pageId: 'p1',
          type: 'text',
          label: 'Почему',
          required: false,
          showIf: { mode: 'all', conditions: [{ fieldKey: long, operator: 'equals', value: '0' }] },
        },
      ]),
      prev,
      12,
    );
    const key = next.fields[0]?.key ?? '';
    expect(key).toMatch(KEY);
    expect(key.endsWith('-v12')).toBe(true);
    expect(key).not.toBe(long);
    expect(next.fields[1]?.showIf?.conditions[0]?.fieldKey).toBe(key);
  });

  it('ключ уже занят другим вопросом — следующий свободный, тоже в пределах 64 знаков', () => {
    const prev = def([
      { key: 'q-odo', pageId: 'p1', type: 'text', label: 'Пробег', required: false },
    ]);
    const next = nextVersion(
      def([
        { key: 'q-odo', pageId: 'p1', type: 'number', label: 'Пробег', required: false },
        { key: 'q-odo-v2', pageId: 'p1', type: 'text', label: 'Старый', required: false },
      ]),
      prev,
      2,
    );
    const keys = next.fields.map((q) => q.key);
    expect(new Set(keys).size).toBe(2);
    for (const k of keys) expect(k).toMatch(KEY);
  });
});

describe('mayReview — «Принять» / «Отклонить» и назначение в области формы (Q-W4.05-16)', () => {
  const r = response([], { authorId: 'm9', channel: 'member' });
  /** Вид участника: ключи в области формы (`area`), ключи где-либо (`anywhere`), видит ли ответ по связи. */
  const view = (area: string[], anywhere: string[], sees = true) =>
    ({
      me: 'm5',
      can: (_f: FormRow, k: string) => area.includes(k),
      any: (k: string) => anywhere.includes(k),
      sees: () => sees,
    }) as unknown as FormsView;
  const REVIEW = 'forms.responses.review';

  it('право в области формы — можно', () => {
    expect(mayReview(view([REVIEW], [REVIEW]), form(def([]), 'u-x'), r, REVIEW)).toBe(true);
  });

  it('проверяющий подразделения Y видит ответ формы подразделения X по рейсу — нельзя', () => {
    expect(mayReview(view([], [REVIEW]), form(def([]), 'u-x'), r, REVIEW)).toBe(false);
  });

  it('назначенный на ответ с правом где-либо — можно', () => {
    const mine = { ...r, assigneeMemberId: 'm5' };
    expect(mayReview(view([], [REVIEW]), form(def([]), 'u-x'), mine, REVIEW)).toBe(true);
  });

  it('форма «Вся организация»: право где-либо и ответ виден по связи с объектом — можно; без связи — нельзя', () => {
    expect(mayReview(view([], [REVIEW], true), form(def([]), null), r, REVIEW)).toBe(true);
    expect(mayReview(view([], [REVIEW], false), form(def([]), null), r, REVIEW)).toBe(false);
  });

  it('без ключа нигде — нельзя', () => {
    expect(mayReview(view([], []), form(def([]), null), r, REVIEW)).toBe(false);
  });

  it('возврат 2: право — у ответа (FormResponse.my), не только у формы: назначенный видит «Принять» и «Отклонить»', () => {
    const ASSIGN = 'forms.responses.assign';
    const unit = form(def([]), 'u-x');
    const mine = { ...r, assigneeMemberId: 'm5' };
    expect(responseMy(view([], [REVIEW]), unit, mine)).toEqual({ review: true, assign: false });
    expect(responseMy(view([], [REVIEW]), unit, r)).toEqual({ review: false, assign: false });
    expect(responseMy(view([REVIEW, ASSIGN], [REVIEW, ASSIGN]), unit, r)).toEqual({
      review: true,
      assign: true,
    });
  });
});
