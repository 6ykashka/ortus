// Команды форм 14.10: publishForm (api.js:555–573), retryFormAction (856–864), backfillKbRule
// (846–855). Guard: подписка активна (`subscription_restricted`) и право «Формы · Настраивать».
import { describe, expect, it } from 'vitest';
import { ACCESS } from '../../core/module.ts';
import { REASON } from '../../core/dictionaries.ts';
import { ApiError } from '../../core/errors/index.ts';
import type { Grant } from '../../core/types/index.ts';
import { createFormsCommands } from './commands.ts';
import { FORM_SETTINGS } from './templates.ts';
import { formsCtx, formsFixture, inspResponse, type FormsDb } from './testing/fixture.ts';
import type { Form, FormField, FormResponse } from './types.ts';

const RESTRICTED =
  'Пробный период завершён: новые операции недоступны. История доступна для чтения.';

function err(fn: () => unknown): { code: string; message: string } {
  try {
    fn();
  } catch (e) {
    if (e instanceof ApiError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error('ошибки нет');
}

function setup(actor: string | null = 'm-owner') {
  const db = formsFixture();
  const cmd = createFormsCommands(formsCtx(db, actor));
  return { db, cmd, insp: db.forms[0] as Form, foreman: db.forms[1] as Form };
}

const setStatus = (db: FormsDb, status: 'restricted' | 'suspended') => {
  const t = db.platform?.tenants.find((x) => x.id === db.tenantId);
  if (!t) throw new Error('нет тенанта');
  t.status = status;
};

/** Вопросы с вариантами получают варианты: в сиде 14.10 у «Чек-листа» и «Явки бригады» их нет. */
const ready = (fields: FormField[]): FormField[] =>
  fields.map((x) =>
    ['choice', 'multi', 'select'].includes(x.type) && !x.options?.length
      ? { ...x, options: ['Кузов', 'Шины', 'Документы'] }
      : x,
  );

const v3 = (insp: Form): FormField[] =>
  ready(JSON.parse(JSON.stringify(insp.versions[2]?.fields)) as FormField[]);

describe('guard команд форм', () => {
  it.each(['restricted', 'suspended'] as const)(
    'подписка %s — новые операции закрыты',
    (status) => {
      const { db, cmd } = setup();
      setStatus(db, status);
      const want = { code: 'subscription_restricted', message: RESTRICTED };
      expect(err(() => cmd.publishForm('fm-insp', []))).toEqual(want);
      expect(err(() => cmd.retryFormAction('R-1012', 'au-2'))).toEqual(want);
      expect(err(() => cmd.backfillKbRule('fm-insp', 'au-2'))).toEqual(want);
    },
  );

  it.each([
    ['менеджер логистики — только просмотр и проверка', 'm-kotova'],
    ['водитель', 'm-vasiliev'],
    ['без участника', null],
  ])('нет права «Формы · Настраивать»: %s', (_n, actor) => {
    const { cmd } = setup(actor);
    const want = { code: 'no_permission', message: REASON.no_permission.text };
    expect(err(() => cmd.publishForm('fm-insp', []))).toEqual(want);
    expect(err(() => cmd.retryFormAction('R-1012', 'au-2'))).toEqual(want);
    expect(err(() => cmd.backfillKbRule('fm-insp', 'au-2'))).toEqual(want);
  });

  it('у организации нет записи в платформе — подписка не проверяется', () => {
    const { db, cmd } = setup();
    delete db.platform;
    expect(() => cmd.backfillKbRule('fm-insp', 'au-2')).not.toThrow();
  });
});

describe('publishForm', () => {
  it('формы нет — not_found «Форма не найдена»', () => {
    const { cmd } = setup();
    expect(err(() => cmd.publishForm('fm-404', []))).toEqual({
      code: 'not_found',
      message: 'Форма не найдена',
    });
  });

  it('проверки определения — validation с текстом эталона', () => {
    const { cmd } = setup();
    expect(err(() => cmd.publishForm('fm-insp', { pages: null, fields: [] }))).toEqual({
      code: 'validation',
      message: 'В форме нет ни одного вопроса',
    });
  });

  it('публичная форма не спрашивает справочники CRM', () => {
    const { cmd, insp } = setup();
    insp.settings = { ...FORM_SETTINGS, access: 'public' };
    const def = [
      ...v3(insp),
      { id: 'q-who', type: 'person', label: 'Механик', required: false },
    ] as FormField[];
    expect(err(() => cmd.publishForm('fm-insp', def)).message).toBe(
      'Публичная форма не может спрашивать «Механик»: справочники CRM гостю не показываются',
    );
  });

  it('новая версия v4: тип сменился — id с суффиксом, автор — актор, черновик снят', () => {
    const { db, cmd, insp } = setup();
    const fields = v3(insp).map((x) => (x.id === 'q-odo' ? { ...x, type: 'int' as const } : x));
    const pages = [{ id: 'p1', title: 'Осмотр' }];
    insp.draft = { pages, fields };
    const n = db.events.length;
    expect(cmd.publishForm('fm-insp', { pages, fields })).toBe(4);
    expect(insp.published).toBe(4);
    expect(insp.status).toBe('published');
    expect(insp.updated).toBe('01.10');
    expect(insp.draft).toBeUndefined();
    const v4 = insp.versions[3];
    expect([v4?.v, v4?.at, v4?.by]).toEqual([4, '01.10.2026', 'Дарья Зимина']);
    expect(v4?.fields.map((x) => x.id)).toContain('q-odo-v4');
    expect(v4?.fields.map((x) => x.id)).toContain('q-fuel');
    expect(v4?.pages).toEqual(pages);
    expect(v4?.pages).not.toBe(pages);
    expect(v4?.fields[0]).not.toBe(fields[0]);
    expect(fields.find((x) => x.type === 'int')?.id).toBe('q-odo');
    expect(db.events).toHaveLength(n + 1);
    expect(db.events[0]).toMatchObject({
      text: 'Опубликована форма «Осмотр машины» v4. Старые ответы сохраняют свои версии',
      to: ['m-owner'],
      at: '10:30',
    });
  });

  it('первая публикация черновика прораба (массив полей) — v1, без страниц', () => {
    const { cmd, foreman } = setup();
    const def = ready(foreman.draft as FormField[]);
    expect(cmd.publishForm('fm-foreman', def)).toBe(1);
    expect(foreman.versions).toHaveLength(1);
    expect(foreman.versions[0]?.pages).toBeNull();
    expect(foreman.versions[0]?.fields.map((x) => x.id)).toEqual(['q-volume', 'q-crew', 'q-photo']);
    expect(foreman.status).toBe('published');
  });

  it('закрытая форма после публикации снова принимает ответы', () => {
    const { cmd, insp } = setup();
    insp.status = 'closed';
    cmd.publishForm('fm-insp', v3(insp));
    expect(insp.status).toBe('published');
  });

  it('действующей версии нет в списке — прошлых вопросов нет, id не меняются', () => {
    const { cmd, insp } = setup();
    insp.published = 7;
    expect(cmd.publishForm('fm-insp', v3(insp))).toBe(8);
    expect(insp.versions.at(-1)?.fields.map((x) => x.id)).toContain('q-odo');
  });

  it('актор не участник организации (доступ проверен адаптером) — автор «—»', () => {
    const db = formsFixture();
    const grant = { roleObj: { all: true } } as unknown as Grant;
    const ctx = { ...formsCtx(db, 'm-ghost'), can: { ...ACCESS, assertCan: () => grant } };
    const cmd = createFormsCommands(ctx);
    cmd.publishForm('fm-foreman', ready((db.forms[1] as Form).draft as FormField[]));
    expect(db.forms[1]?.versions[0]?.by).toBe('—');
  });

  it('у организации нет форм — not_found', () => {
    const { db, cmd } = setup();
    delete (db as Partial<FormsDb>).forms;
    expect(err(() => cmd.publishForm('fm-insp', [])).code).toBe('not_found');
  });
});

describe('retryFormAction', () => {
  it('ответа нет — not_found «Ответ не найден»', () => {
    const { cmd } = setup();
    expect(err(() => cmd.retryFormAction('R-404', 'au-2'))).toEqual({
      code: 'not_found',
      message: 'Ответ не найден',
    });
  });

  it.each([
    ['правило удалено', (db: FormsDb) => db.forms[0]?.automations.splice(1, 1)],
    ['форма удалена', (db: FormsDb) => db.forms.splice(0, 1)],
  ])('%s — «Действие удалено из формы — повторить нельзя»', (_n, drop) => {
    const { db, cmd } = setup();
    drop(db);
    expect(err(() => cmd.retryFormAction('R-1012', 'au-2'))).toEqual({
      code: 'validation',
      message: 'Действие удалено из формы — повторить нельзя',
    });
  });

  it('успех — результат действия, строка в таблице', () => {
    const { db, cmd } = setup();
    const r = inspResponse('R-1050');
    db.responses.unshift(r);
    const res = cmd.retryFormAction('R-1050', 'au-2');
    expect(res).toMatchObject({ rule: 'au-2', ok: true, table: 'kt-insp', at: '10:30' });
    expect(db.knowledge.tables?.[0]?.rows[0]?.src?.resp).toBe('R-1050');
    expect(cmd.retryFormAction('R-1050', 'au-2')).toBe(res);
  });

  it('уже выполнено — прошлый результат без новой строки', () => {
    const { db, cmd } = setup();
    const res = cmd.retryFormAction('R-1012', 'au-2');
    expect(res.at).toBe('27.09 09:12');
    expect(db.knowledge.tables?.[0]?.rows).toHaveLength(2);
  });

  it('не выполнено — validation «Не выполнено: …», ошибка в журнале ответа и событии', () => {
    const { db, cmd } = setup();
    const r = inspResponse('R-1050');
    db.responses.unshift(r);
    db.knowledge.tables = [];
    expect(err(() => cmd.retryFormAction('R-1050', 'au-2'))).toEqual({
      code: 'validation',
      message: 'Не выполнено: таблица удалена со страницы «Журнал осмотров машин»',
    });
    expect(r.actions?.[0]).toMatchObject({ rule: 'au-2', ok: false });
    expect(db.events[0]?.text).toBe(
      'Форма «Осмотр машины»: ответ R-1050 не сохранён в Базу знаний — таблица удалена со страницы «Журнал осмотров машин»',
    );
  });

  it('правило-задача au-1 — как в эталоне: «страница удалена из Базы знаний»', () => {
    const { cmd } = setup();
    expect(err(() => cmd.retryFormAction('R-1012', 'au-1')).message).toBe(
      'Не выполнено: страница удалена из Базы знаний',
    );
  });

  it('База знаний берётся из opts.knowledge', () => {
    const db = formsFixture();
    const cmd = createFormsCommands(formsCtx(db), { knowledge: () => undefined });
    db.responses.unshift(inspResponse('R-1050'));
    expect(err(() => cmd.retryFormAction('R-1050', 'au-2')).message).toBe(
      'Не выполнено: страница удалена из Базы знаний',
    );
  });

  it('у организации нет ответов — not_found', () => {
    const { db, cmd } = setup();
    delete (db as Partial<FormsDb>).responses;
    expect(err(() => cmd.retryFormAction('R-1012', 'au-2')).code).toBe('not_found');
  });
});

describe('backfillKbRule', () => {
  it('формы нет — not_found «Форма не найдена»', () => {
    const { cmd } = setup();
    expect(err(() => cmd.backfillKbRule('fm-404', 'au-2'))).toEqual({
      code: 'not_found',
      message: 'Форма не найдена',
    });
  });

  it.each([['au-404'], ['au-1']])(
    'действия «в БЗ» %s нет — not_found «Действие не найдено»',
    (id) => {
      const { cmd } = setup();
      expect(err(() => cmd.backfillKbRule('fm-insp', id))).toEqual({
        code: 'not_found',
        message: 'Действие не найдено',
      });
    },
  );

  it('действие выключено — validation', () => {
    const { db, cmd } = setup();
    const x = db.forms[0]?.automations[1];
    if (x) x.on = false;
    expect(err(() => cmd.backfillKbRule('fm-insp', 'au-2'))).toEqual({
      code: 'validation',
      message: 'Действие выключено — включите его, чтобы перенести ответы',
    });
  });

  it('переносит прошлые подходящие ответы по номеру; выполненные, чужие и непринятые — нет', () => {
    const { db, cmd } = setup();
    const add = (r: FormResponse) => db.responses.unshift(r);
    add(inspResponse('R-1050'));
    add(inspResponse('R-1041'));
    add(inspResponse('R-1060', { status: 'На проверке' }));
    add(inspResponse('R-1070', { formId: 'fm-foreman' }));
    expect(cmd.backfillKbRule('fm-insp', 'au-2')).toEqual({ added: 2, failed: 0, err: null });
    const resp = db.knowledge.tables?.[0]?.rows.map((y) => y.src?.resp);
    expect(resp).toEqual(['R-1050', 'R-1041', 'R-1012', 'R-0988']);
    expect(cmd.backfillKbRule('fm-insp', 'au-2')).toEqual({ added: 0, failed: 0, err: null });
  });

  it('ошибки считаются, последняя — в err; ответ без номера идёт первым', () => {
    const { db, cmd } = setup();
    db.responses.unshift(inspResponse('R-1050'), inspResponse('ответ'));
    db.knowledge.tables = [];
    expect(cmd.backfillKbRule('fm-insp', 'au-2')).toEqual({
      added: 0,
      failed: 2,
      err: 'таблица удалена со страницы «Журнал осмотров машин»',
    });
    const at = db.events.slice(0, 2).map((e) => e.text.split(' ')[4]);
    expect(at).toEqual(['R-1050', 'ответ']);
  });
});
