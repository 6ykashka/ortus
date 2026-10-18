// Паритет домена форм с эталоном 14.10: одинаковые входы → одинаковые выходы.
// Эталон (`models.js`, `mock-data.js`, `api.js`) только импортируется — см. `seed/reference.ts`.
// Время (`at` действий и строк) и id строк зависят от часов и счётчика и не сравниваются.
// Намеренное расхождение одно — PD-53 (роль пространства БЗ у автора правила), отдельный тест.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../core/errors/index.ts';
import { importReference, referenceModels } from '../../seed/reference.ts';
import { createFormsCommands, type FormsCommands } from './commands.ts';
import { formVal } from './form-val.ts';
import { formsSeed } from './seed.ts';
import { FORM_SETTINGS, FORM_TEMPLATES, FORM_VARS, templateDef } from './templates.ts';
import { formsCtx, formsFixture, withKbEditor, type FormsDb } from './testing/fixture.ts';
import type { Form, FormField, FormResponse, FormRule, FormTemplate } from './types.ts';

interface RefModels {
  FORM_SETTINGS: unknown;
  FORM_TEMPLATES: FormTemplate[];
  FORM_VARS: unknown;
  templateDef(T: FormTemplate | null | undefined): unknown;
  formVal(f: Form | null, r: FormResponse, src: string, fields?: FormField[]): string;
}
interface RefDb {
  forms: Form[];
  responses: FormResponse[];
  platform: unknown;
}
interface RefMockData {
  seed(): RefDb;
  seedLotos(platform: unknown): RefDb;
}
interface RefView {
  forms: Form[];
  responses: FormResponse[];
  events: { text: string }[];
  knowledge: {
    tables: { id: string; rows: { id: string; at: string; src: unknown; cells: unknown }[] }[];
    entries: { id: string; at: string; page: string; head: string; lines: unknown; src: unknown }[];
  };
}
type RefCall = Promise<{ data: unknown; db: RefView }>;
interface RefAdapter {
  setActor(memberId: string, tenantId?: string): void;
  load(ms?: number): Promise<RefView>;
  publishForm(formId: string, def: unknown): RefCall;
  updateForm(formId: string, patch: unknown): RefCall;
  retryFormAction(respId: string, ruleId: string): RefCall;
  backfillKbRule(formId: string, ruleId: string): RefCall;
}

let M: RefModels;
let D: RefMockData;
let createAdapter: () => RefAdapter;

beforeAll(async () => {
  M = await referenceModels<RefModels>();
  D = await importReference<RefMockData>('mock-data.js');
  createAdapter = (await importReference<{ createMockAdapter(): RefAdapter }>('api.js'))
    .createMockAdapter;
});

const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('справочники и чистые функции = models.js', () => {
  it('FORM_SETTINGS, FORM_TEMPLATES (15), FORM_VARS', () => {
    expect(json(FORM_SETTINGS)).toEqual(json(M.FORM_SETTINGS));
    expect(json(FORM_TEMPLATES)).toEqual(json(M.FORM_TEMPLATES));
    expect(json(FORM_VARS)).toEqual(json(M.FORM_VARS));
  });

  it('templateDef для каждого шаблона и без шаблона', () => {
    for (const t of [...FORM_TEMPLATES, null, undefined]) {
      const ref = M.templateDef(t ? (M.FORM_TEMPLATES.find((x) => x.id === t.id) ?? null) : t);
      expect(json(templateDef(t)), t?.id ?? String(t)).toEqual(json(ref));
    }
  });

  it('formVal на ответах сида и сгенерированных ответах × все источники × версии', () => {
    const insp = formsSeed('t-alta').forms[0] as Form;
    const base = formsSeed('t-alta').responses;
    const extra: FormResponse[] = [
      { ...(base[1] as FormResponse), id: 'R-2001', values: { 'q-checks': ['Кузов', 'Шины'] } },
      { ...(base[1] as FormResponse), id: 'R-2002', values: { 'q-odo': 'я'.repeat(600) } },
      { ...(base[1] as FormResponse), id: 'R-2003', values: { 'q-odo': '', 'q-fuel': null } },
      { ...(base[1] as FormResponse), id: 'R-2004', values: { 'q-photos': ['1', '2'] } },
      { ...(base[1] as FormResponse), id: 'R-2005', object: null as unknown as string },
    ];
    const srcs = [
      ...FORM_VARS.map(([k]) => k),
      ...new Set(insp.versions.flatMap((v) => v.fields.map((x) => x.id))),
      'q-defect',
      'q-unknown',
    ];
    const versions = [undefined, ...insp.versions.map((v) => v.fields)];
    let n = 0;
    for (const r of [...base, ...extra]) {
      for (const src of srcs) {
        for (const fields of versions) {
          for (const f of [insp, null]) {
            expect(formVal(f, r, src, fields), r.id + ' ' + src).toBe(M.formVal(f, r, src, fields));
            n++;
          }
        }
      }
    }
    expect(n).toBeGreaterThan(500);
  });
});

describe('сид форм = mock-data.js', () => {
  it('«Альта»: формы и ответы', () => {
    const ref = D.seed();
    const ours = formsSeed('t-alta');
    expect(json(ours.forms)).toEqual(json(ref.forms));
    expect(json(ours.responses)).toEqual(json(ref.responses));
  });

  it('«Лотос»: форм и ответов нет', () => {
    const ref = D.seedLotos(D.seed().platform);
    expect(formsSeed('t-lotos')).toEqual({ forms: ref.forms, responses: ref.responses });
  });
});

type Outcome =
  | { ok: true; data: unknown; db?: RefView }
  | { ok: false; code: string; message: string; db?: undefined };

const fail = (e: unknown): Outcome => {
  const x = e as { code?: string; message?: string };
  return { ok: false, code: String(x.code), message: String(x.message) };
};

/** Вызов команды эталона на фальшивых таймерах: задержки `cmd` не ждём. */
async function ref(p: RefCall): Promise<Outcome> {
  const settled = p.then(
    (v): Outcome => ({ ok: true, data: v.data, db: v.db }),
    (e: unknown) => fail(e),
  );
  await vi.advanceTimersByTimeAsync(2000);
  return settled;
}

function ours(fn: () => unknown): Outcome {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    if (e instanceof ApiError) return fail(e);
    throw e;
  }
}

const strip = (o: Outcome): Outcome => (o.ok ? { ok: true, data: noAt(o.data) } : o);
const noAt = (x: unknown): unknown => {
  if (!x || typeof x !== 'object') return x;
  const rest: Record<string, unknown> = { ...(x as Record<string, unknown>) };
  delete rest['at'];
  delete rest['id'];
  return json(rest);
};

const RULE: FormRule = {
  id: 'au-3',
  kind: 'kb',
  mode: 'table',
  page: 'kb-5',
  table: 'kt-insp',
  pos: 'top',
  when: 'accepted',
  on: true,
  version: 2,
  by: 'Дарья Зимина',
  byId: 'm-owner',
  fields: [
    { col: 'c-at', name: 'Дата', src: '$at' },
    { col: 'c-obj', name: 'Рейс', src: '$object' },
    { col: 'c-odo', name: 'Пробег', src: 'q-odo' },
    { col: 'c-fuel', name: 'Топливо', src: 'q-fuel' },
    { col: 'c-def', name: 'Фото', src: 'q-photos' },
    { col: 'c-resp', name: 'Ответ', src: '$ver' },
  ],
};

interface Pair {
  A: RefAdapter;
  db: FormsDb;
  cmd: FormsCommands;
}

/** Эталон и домен в одном состоянии: те же действия формы «Осмотр машины». */
async function pair(actor = 'm-owner', rules: FormRule[] = []): Promise<Pair> {
  const A = createAdapter();
  A.setActor('m-owner', 't-alta');
  const db = formsFixture();
  const insp = db.forms[0] as Form;
  if (rules.length) {
    insp.automations.push(...json(rules));
    const r = await ref(A.updateForm('fm-insp', { automations: insp.automations }));
    expect(r.ok).toBe(true);
  }
  A.setActor(actor, 't-alta');
  return { A, db, cmd: createFormsCommands(formsCtx(db, actor)) };
}

describe('команды = createMockAdapter эталона', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const field = (id: string, type: FormField['type'], label: string, x: Partial<FormField> = {}) =>
    ({ id, type, label, required: false, ...x }) as FormField;
  const choice = (id: string, label: string) =>
    field(id, 'choice', label, { options: [{ id: 'o1', label: 'Да' }] });

  it.each<[string, unknown]>([
    ['нет определения', undefined],
    ['пустой массив', []],
    ['пустые страницы', { pages: [], fields: [] }],
    ['только текст', [field('s-1', 'statement', 'Правила')]],
    ['пустой текст', [field('q-1', 'text', ' ')]],
    ['нет вариантов', [field('q-1', 'multi', 'Чек-лист')]],
    ['варианты-строки', [field('q-1', 'choice', 'Топливо', { options: ['¼', '½'] })]],
    ['пустые варианты-строки', [field('q-1', 'choice', 'Топливо', { options: [' '] })]],
    ['повтор id', [choice('q-1', 'А'), choice('q-1', 'Б')]],
    ['CRM во внутренней форме', [field('q-1', 'person', 'Механик')]],
    [
      'смена типа и страницы',
      {
        pages: [{ id: 'p1', title: 'Осмотр' }],
        fields: [
          field('q-odo', 'int', 'Пробег'),
          choice('q-defect', 'Дефект'),
          field('q-new', 'date', 'Дата'),
        ],
      },
    ],
  ])('publishForm: %s', async (_n, def) => {
    const { A, db, cmd } = await pair();
    const r = await ref(A.publishForm('fm-insp', def));
    const o = ours(() => cmd.publishForm('fm-insp', def as FormField[]));
    expect(strip(o)).toEqual(strip(r));
    if (r.ok && r.db) {
      const theirs = r.db.forms.find((f) => f.id === 'fm-insp');
      expect(json(db.forms[0]?.versions)).toEqual(json(theirs?.versions));
      expect(db.forms[0]?.status).toBe(theirs?.status);
      expect(db.events[0]?.text).toBe(r.db.events[0]?.text);
    }
  });

  it('publishForm: черновик прораба v1 и публичная форма со справочником CRM', async () => {
    const { A, db, cmd } = await pair();
    const def = [field('q-volume', 'number', 'Объём'), choice('q-crew', 'Явка')];
    const r = await ref(A.publishForm('fm-foreman', def));
    expect(strip(ours(() => cmd.publishForm('fm-foreman', def)))).toEqual(strip(r));
    expect(json(db.forms[1]?.versions)).toEqual(
      json(r.ok ? r.db?.forms.find((f) => f.id === 'fm-foreman')?.versions : null),
    );

    await ref(A.updateForm('fm-insp', { settings: { access: 'public' } }));
    (db.forms[0] as Form).settings = { ...FORM_SETTINGS, access: 'public' };
    const crm = [field('q-1', 'text', 'Имя'), field('q-2', 'ref', 'Объект')];
    expect(ours(() => cmd.publishForm('fm-insp', crm))).toEqual(
      await ref(A.publishForm('fm-insp', crm)),
    );
  });

  it.each([
    ['формы нет', 'm-owner', 'fm-404'],
    ['нет права', 'm-kotova', 'fm-insp'],
    ['нет права у водителя', 'm-vasiliev', 'fm-insp'],
  ])('publishForm: %s', async (_n, actor, formId) => {
    const { A, cmd } = await pair(actor);
    const def = [choice('q-1', 'Вопрос')];
    expect(ours(() => cmd.publishForm(formId, def))).toEqual(await ref(A.publishForm(formId, def)));
  });

  const RULES: FormRule[] = [
    RULE,
    { ...RULE, id: 'au-4', mode: 'entry', table: undefined, head: '$author', pos: 'bottom' },
    { ...RULE, id: 'au-5', page: 'kb-404' },
    { ...RULE, id: 'au-6', table: 'kt-404' },
    { ...RULE, id: 'au-7', byId: 'm-vasiliev', by: 'Илья Васильев' },
    { ...RULE, id: 'au-8', byId: 'm-gromov', by: 'Кирилл Громов' },
    { ...RULE, id: 'au-9', byId: undefined, by: 'Никто' },
    { ...RULE, id: 'au-10', on: false, page: 'kb-1' },
    { ...RULE, id: 'au-11', mode: 'entry', page: 'kb-4', head: 'q-unknown' },
  ];

  it.each([
    ['R-1012', 'au-2'],
    ['R-1012', 'au-1'],
    ['R-404', 'au-2'],
    ['R-1012', 'au-404'],
    ...RULES.map((x) => ['R-1012', x.id] as [string, string]),
    ...RULES.map((x) => ['R-0988', x.id] as [string, string]),
  ])('retryFormAction(%s, %s)', async (resp, rule) => {
    const { A, db, cmd } = await pair('m-owner', RULES);
    const r = await ref(A.retryFormAction(resp, rule));
    const o = ours(() => cmd.retryFormAction(resp, rule));
    expect(strip(o)).toEqual(strip(r));
    if (!r.db) return;
    const tr = r.db.knowledge.tables.find((t) => t.id === 'kt-insp')?.rows ?? [];
    expect((db.knowledge.tables?.[0]?.rows ?? []).map(noAt)).toEqual(tr.map(noAt));
    expect((db.knowledge.entries ?? []).map(noAt)).toEqual(
      (r.db.knowledge.entries ?? []).map(noAt),
    );
    const mine = db.responses.find((x) => x.id === resp)?.actions?.map(noAt);
    const theirs = r.db.responses.find((x) => x.id === resp)?.actions?.map(noAt);
    expect(mine).toEqual(theirs);
  });

  it('retryFormAction: ошибка действия — то же событие владельцам', async () => {
    const { A, db, cmd } = await pair('m-owner', RULES);
    await ref(A.retryFormAction('R-1012', 'au-6'));
    const loading = A.load(0);
    await vi.advanceTimersByTimeAsync(10);
    const v = await loading;
    ours(() => cmd.retryFormAction('R-1012', 'au-6'));
    expect(db.events[0]?.text).toBe(v.events[0]?.text);
  });

  it.each([
    ['au-2'],
    ['au-1'],
    ['au-404'],
    ['au-10'],
    ...RULES.filter((x) => x.on).map((x) => [x.id]),
  ])('backfillKbRule(fm-insp, %s)', async (rule) => {
    const { A, db, cmd } = await pair('m-owner', RULES);
    const r = await ref(A.backfillKbRule('fm-insp', rule));
    expect(ours(() => cmd.backfillKbRule('fm-insp', rule))).toEqual(
      r.ok ? { ok: true, data: r.data } : r,
    );
    if (!r.db) return;
    const tr = r.db.knowledge.tables.find((t) => t.id === 'kt-insp')?.rows ?? [];
    expect((db.knowledge.tables?.[0]?.rows ?? []).map(noAt)).toEqual(tr.map(noAt));
    expect((db.knowledge.entries ?? []).map(noAt)).toEqual(
      (r.db.knowledge.entries ?? []).map(noAt),
    );
  });

  it.each([['m-kotova'], ['m-vasiliev']])(
    'retryFormAction и backfillKbRule без права: %s',
    async (actor) => {
      const { A, cmd } = await pair(actor);
      expect(ours(() => cmd.retryFormAction('R-1012', 'au-2'))).toEqual(
        await ref(A.retryFormAction('R-1012', 'au-2')),
      );
      expect(ours(() => cmd.backfillKbRule('fm-insp', 'au-2'))).toEqual(
        await ref(A.backfillKbRule('fm-insp', 'au-2')),
      );
    },
  );

  describe('PD-53: роль пространства у автора правила (намеренное расхождение)', () => {
    const KOT = {
      byId: 'm-kotelnikova',
      by: 'Вера Котельникова',
      mode: 'entry' as const,
      table: undefined,
    };

    it('своё пространство «Логистика» (kb-5): как в эталоне — запись сделана', async () => {
      const rule = { ...RULE, ...KOT, id: 'au-20' };
      const { A, db, cmd } = await pair('m-owner', [rule]);
      withKbEditor(db, 'sp-log');
      const r = await ref(A.retryFormAction('R-1012', 'au-20'));
      expect(strip(ours(() => cmd.retryFormAction('R-1012', 'au-20')))).toEqual(strip(r));
    });

    it('чужое пространство «Салон и SPA» (kb-3): эталон пишет, домен — нет права', async () => {
      const rule = { ...RULE, ...KOT, id: 'au-21', page: 'kb-3' };
      const { A, db, cmd } = await pair('m-owner', [rule]);
      withKbEditor(db, 'sp-log');
      const r = await ref(A.retryFormAction('R-1012', 'au-21'));
      expect(r.ok).toBe(true);
      expect(ours(() => cmd.retryFormAction('R-1012', 'au-21'))).toEqual({
        ok: false,
        code: 'validation',
        message:
          'Не выполнено: у автора правила Вера Котельникова нет права «Создавать» в Базе знаний',
      });
    });
  });
});
