// Кейсы контрактного PR 4 этапа 4 (W4.05, 0.11.0-stage4): «Формы и опросы» (W4.21–W4.23, кандидаты W4.27, W4.28) на
// сиде домена W4.20 «Альты» и пресете logistics-ready («Логистика» подключена, Марина Котова — «Менеджер логистики»
// в «Север Логистик»: видит формы, читает и проверяет ответы): «Осмотр машины» v3 (правила au-1 «задача» и au-2 «в БЗ»
// — таблица «Осмотры» страницы «Журнал осмотров машин»), ответы R-0988 и R-1012, черновик «Ежедневный отчёт прораба».
// Илья Васильев — без ролей «Форм» (403 шлюза). Примеры — tools/gen/examples-w405.mjs.
import { expect } from 'vitest';

import type { Reply, Session } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

type Body = Record<string, unknown> & {
  items?: Record<string, unknown>[];
  revision?: number;
  definition?: { pages: { id: string; title: string }[]; fields: Record<string, unknown>[] };
  code?: string;
  reason?: string;
};
const body = (r: Reply): Body => r.body as Body;

const at = (ctx: CaseContext, rest: string) => `${ctx.alta}/${rest}`;
const FORM = (ctx: CaseContext) => ctx.A('fm-insp');
const FOREMAN = (ctx: CaseContext) => ctx.A('fm-foreman');
const MISSING = '00000000-0000-5000-8000-0000000000aa';

/** Пресет «Логистика подключена» и сессия персонажа. */
async function as(ctx: CaseContext, persona = 'owner'): Promise<Session> {
  ctx.server.applyPreset('logistics-ready');
  return ctx.as(persona);
}

/** Черновик «Осмотра машины» с новым вопросом «Шины в порядке?» на странице «Проверка». */
async function changedDraft(ctx: CaseContext, s: Session) {
  const d = body(await s.get(at(ctx, `forms/${FORM(ctx)}/draft`)));
  const def = structuredClone(d.definition) as NonNullable<Body['definition']>;
  def.fields.push({
    key: 'q-tires',
    pageId: 'p3',
    type: 'bool',
    label: 'Шины в порядке?',
    required: false,
  });
  const r = await s.put(
    at(ctx, `forms/${FORM(ctx)}/draft`),
    { definition: def },
    { ifMatch: d.revision as number },
  );
  return { r, def, rev: d.revision as number };
}

/** Новая форма «Вся организация» с одной страницей и вопросами `fields`, опубликованная v1. */
async function published(
  ctx: CaseContext,
  s: Session,
  name: string,
  fields: Record<string, unknown>[],
): Promise<{ url: string; versionId: string }> {
  const f = body(await s.post(at(ctx, 'forms'), { name, orgUnitId: null, templateId: 'blank' }));
  const url = at(ctx, `forms/${String(f.id)}`);
  const d = body(await s.get(`${url}/draft`));
  const saved = body(
    await s.put(
      `${url}/draft`,
      { definition: { pages: [{ id: 'p1', title: 'Страница 1' }], fields } },
      { ifMatch: d.revision as number },
    ),
  );
  const pub = body(
    await s.post(
      `${url}/publish`,
      { draftRevision: saved.revision },
      { ifMatch: f.revision as number },
    ),
  );
  return { url, versionId: String(pub.publishedVersionId) };
}

/** Ответ на «Осмотр машины» v3 (действующая версия). */
const ANSWERS = (ctx: CaseContext) => [
  { fieldKey: 'q-photos', value: { type: 'files', value: [ctx.A('fmfile-1')] } },
  { fieldKey: 'q-odo', value: { type: 'decimal', value: '84530' } },
  { fieldKey: 'q-fuel', value: { type: 'choices', value: ['o3'] } },
  { fieldKey: 'q-checks', value: { type: 'choices', value: ['o1', 'o2', 'o3'] } },
  { fieldKey: 'q-defect', value: { type: 'boolean', value: false } },
];

export const formsCases = cases('forms')([
  // ── Список, шаблоны, группы ──
  {
    title: 'владелец видит «Осмотр машины» (v3, 2 ответа) и черновик «Ежедневный отчёт прораба»',
    operationId: 'listForms',
    expect: 'success',
    example: 'listForms/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(await s.get(at(ctx, 'forms')), 'listForms/ok');
    },
  },
  {
    title: 'фильтры: «Черновики», «Принимают ответы», «Мои формы», поиск',
    operationId: 'listForms',
    expect: 'success',
    run: async (ctx) => {
      const s = await as(ctx);
      const names = async (q: string) =>
        (body(await s.get(at(ctx, `forms?${q}`))).items ?? []).map((x) => x.name);
      expect(await names('status=draft')).toEqual(['Ежедневный отчёт прораба']);
      expect(await names('status=open')).toEqual(['Осмотр машины']);
      expect(await names('owner=me')).toHaveLength(2);
      expect(await names('q=ОСМОТР')).toEqual(['Осмотр машины']);
      const m = await ctx.as('manager');
      expect((body(await m.get(at(ctx, 'forms'))).items ?? []).map((x) => x.name)).toHaveLength(2);
    },
  },
  {
    title: 'водитель без «Форм» — 403 шлюза',
    operationId: 'listForms',
    expect: 'error',
    example: 'listForms/forbidden_action',
    run: async (ctx) => {
      const s = await as(ctx, 'driver');
      ctx.expectExample(await s.get(at(ctx, 'forms')), 'listForms/forbidden_action');
    },
  },
  {
    title:
      '15 шаблонов: «Круговой осмотр машины» доступен, «Ежедневный отчёт прораба» — нет (модуль не подключён)',
    operationId: 'listFormTemplates',
    expect: 'success',
    example: 'listFormTemplates/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.get(at(ctx, 'form-templates'));
      ctx.expectExample(r, 'listFormTemplates/ok');
      expect(body(r).items).toHaveLength(15);
    },
  },
  {
    title: 'менеджер без «Создавать формы» — 403 шлюза',
    operationId: 'listFormTemplates',
    expect: 'error',
    example: 'listFormTemplates/forbidden_action',
    run: async (ctx) => {
      const s = await as(ctx, 'manager');
      ctx.expectExample(
        await s.get(at(ctx, 'form-templates')),
        'listFormTemplates/forbidden_action',
      );
    },
  },
  {
    title: 'группа «Опросы клиентов» с перенесённым черновиком прораба',
    operationId: 'listFormGroups',
    expect: 'success',
    example: 'listFormGroups/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const g = body(await s.post(at(ctx, 'form-groups'), { name: 'Опросы клиентов' }));
      const f = body(await s.get(at(ctx, `forms/${FOREMAN(ctx)}`)));
      await s.patch(
        at(ctx, `forms/${FOREMAN(ctx)}`),
        { groupId: g.id },
        { ifMatch: f.revision as number },
      );
      ctx.expectExample(await s.get(at(ctx, 'form-groups')), 'listFormGroups/ok');
      const inGroup = body(await s.get(at(ctx, `forms?groupId=${String(g.id)}`))).items ?? [];
      expect(inGroup.map((x) => x.name)).toEqual(['Ежедневный отчёт прораба']);
    },
  },
  {
    title: 'водитель — 403 шлюза',
    operationId: 'listFormGroups',
    expect: 'error',
    example: 'listFormGroups/forbidden_action',
    run: async (ctx) => {
      const s = await as(ctx, 'driver');
      ctx.expectExample(await s.get(at(ctx, 'form-groups')), 'listFormGroups/forbidden_action');
    },
  },
  {
    title: 'владелец создаёт группу «Опросы клиентов»',
    operationId: 'createFormGroup',
    expect: 'success',
    example: 'createFormGroup/created',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(at(ctx, 'form-groups'), { name: 'Опросы клиентов' }),
        'createFormGroup/created',
      );
      const again = await s.post(at(ctx, 'form-groups'), { name: 'опросы КЛИЕНТОВ' });
      ctx.expectProblem(again, 'validation_failed');
      expect(body(again).detail).toBe('Такая группа уже есть');
    },
  },
  {
    title: 'название из одной буквы — «Название группы — от 2 символов»',
    operationId: 'createFormGroup',
    expect: 'error',
    example: 'createFormGroup/validation_failed',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(at(ctx, 'form-groups'), { name: 'О' }),
        'createFormGroup/validation_failed',
      );
    },
  },
  {
    title: 'пустая группа удаляется без подтверждения',
    operationId: 'deleteFormGroup',
    expect: 'success',
    run: async (ctx) => {
      const s = await as(ctx);
      const g = body(await s.post(at(ctx, 'form-groups'), { name: 'Опросы клиентов' }));
      expect((await s.delete(at(ctx, `form-groups/${String(g.id)}`))).status).toBe(204);
      expect(body(await s.get(at(ctx, 'form-groups'))).items).toEqual([]);
    },
  },
  {
    title: 'группа с формой — 409 form_group_not_empty',
    operationId: 'deleteFormGroup',
    expect: 'error',
    example: 'deleteFormGroup/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      const g = body(await s.post(at(ctx, 'form-groups'), { name: 'Опросы клиентов' }));
      const f = body(await s.get(at(ctx, `forms/${FOREMAN(ctx)}`)));
      await s.patch(
        at(ctx, `forms/${FOREMAN(ctx)}`),
        { groupId: g.id },
        { ifMatch: f.revision as number },
      );
      ctx.expectExample(
        await s.delete(at(ctx, `form-groups/${String(g.id)}`)),
        'deleteFormGroup/invalid_transition',
      );
    },
  },

  // ── Создание, карточка, правка ──
  {
    title: 'из шаблона «Форма обратной связи» — черновик без версий, публичный доступ шаблона',
    operationId: 'createForm',
    expect: 'success',
    example: 'createForm/created',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(at(ctx, 'forms'), {
        name: 'Форма обратной связи',
        orgUnitId: null,
        templateId: 'tpl-feedback',
      });
      ctx.expectExample(r, 'createForm/created');
      const d = body(await s.get(at(ctx, `forms/${String(body(r).id)}/draft`)));
      expect(d.definition?.fields.map((x) => x.key)).toEqual([
        'q-rate',
        'q-recommend',
        'q-better',
        'q-comment',
        'q-phone',
      ]);
    },
  },
  {
    title: 'копия «Осмотра машины» — «Осмотр машины · копия», черновик из действующей версии',
    operationId: 'createForm',
    expect: 'success',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(at(ctx, 'forms'), {
        name: 'Осмотр машины · копия',
        orgUnitId: null,
        sourceFormId: FORM(ctx),
      });
      expect(r.status).toBe(201);
      expect(body(r)).toMatchObject({
        status: 'draft',
        moduleKey: 'fleet',
        questionCount: 7,
        versionCount: 0,
      });
    },
  },
  {
    title: 'имя занято — «Форма «Осмотр машины» уже есть — измените название»',
    operationId: 'createForm',
    expect: 'error',
    example: 'createForm/validation_failed',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(at(ctx, 'forms'), {
          name: 'осмотр машины',
          orgUnitId: null,
          templateId: 'blank',
        }),
        'createForm/validation_failed',
      );
    },
  },
  {
    title: 'шаблон отраслевого модуля, который не подключён, — 403 module_not_installed',
    operationId: 'createForm',
    expect: 'error',
    example: 'createForm/module_not_installed',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(at(ctx, 'forms'), {
          name: 'Отчёт прораба',
          orgUnitId: null,
          templateId: 'tpl-foreman',
        }),
        'createForm/module_not_installed',
      );
    },
  },
  {
    title: 'менеджер без «Создавать формы» — 403 шлюза',
    operationId: 'createForm',
    expect: 'error',
    example: 'createForm/forbidden_action',
    run: async (ctx) => {
      const s = await as(ctx, 'manager');
      ctx.expectExample(
        await s.post(at(ctx, 'forms'), {
          name: 'Опрос водителей',
          orgUnitId: null,
          templateId: 'blank',
        }),
        'createForm/forbidden_action',
      );
    },
  },
  {
    title: '«Осмотр машины»: v3 действует, правила, ссылки, мои права владельца',
    operationId: 'getForm',
    expect: 'success',
    example: 'getForm/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(await s.get(at(ctx, `forms/${FORM(ctx)}`)), 'getForm/ok');
    },
  },
  {
    title: 'менеджер видит форму «Вся организация» только для просмотра (нет «Настраивать»)',
    operationId: 'getForm',
    expect: 'success',
    run: async (ctx) => {
      const s = await as(ctx, 'manager');
      const f = body(await s.get(at(ctx, `forms/${FORM(ctx)}`)));
      expect(f.my).toMatchObject({
        manage: false,
        publish: false,
        readResponses: true,
        reviewResponses: true,
      });
      expect(f.responseCount).toBe(2);
    },
  },
  {
    title: 'чужая или несуществующая форма — 404 «Форма не найдена»',
    operationId: 'getForm',
    expect: 'error',
    example: 'getForm/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(await s.get(at(ctx, `forms/${MISSING}`)), 'getForm/not_found');
    },
  },
  {
    title: '«Закрыть приём ответов» — статус closed, без новой версии',
    operationId: 'updateForm',
    expect: 'success',
    example: 'updateForm/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const f = body(await s.get(at(ctx, `forms/${FORM(ctx)}`)));
      ctx.expectExample(
        await s.patch(
          at(ctx, `forms/${FORM(ctx)}`),
          { status: 'closed' },
          { ifMatch: f.revision as number },
        ),
        'updateForm/ok',
      );
    },
  },
  {
    title: 'настройки: «Все, у кого есть ссылка» — публичная ссылка; срок и лимит',
    operationId: 'updateForm',
    expect: 'success',
    run: async (ctx) => {
      const s = await as(ctx);
      const f = body(await s.get(at(ctx, `forms/${FORM(ctx)}`)));
      const r = await s.patch(
        at(ctx, `forms/${FORM(ctx)}`),
        { settings: { access: 'public', acceptUntil: '2026-12-31', responseLimit: 500 } },
        { ifMatch: f.revision as number },
      );
      expect(r.status).toBe(200);
      const share = body(r).share as { publicToken: string | null };
      expect(share.publicToken).toMatch(/^f[0-9a-f]{32}$/);
      expect(body(r).settings).toMatchObject({
        access: 'public',
        acceptUntil: '2026-12-31',
        responseLimit: 500,
      });
    },
  },
  {
    title: 'закрыть приём у черновика — 409 form_not_published «Форма ещё не опубликована»',
    operationId: 'updateForm',
    expect: 'error',
    example: 'updateForm/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      const f = body(await s.get(at(ctx, `forms/${FOREMAN(ctx)}`)));
      ctx.expectExample(
        await s.patch(
          at(ctx, `forms/${FOREMAN(ctx)}`),
          { status: 'closed' },
          { ifMatch: f.revision as number },
        ),
        'updateForm/invalid_transition',
      );
    },
  },
  {
    title: 'название короче 3 символов — «Название формы — не короче 3 символов»',
    operationId: 'updateForm',
    expect: 'error',
    example: 'updateForm/validation_failed',
    run: async (ctx) => {
      const s = await as(ctx);
      const f = body(await s.get(at(ctx, `forms/${FORM(ctx)}`)));
      ctx.expectExample(
        await s.patch(
          at(ctx, `forms/${FORM(ctx)}`),
          { name: 'Ос' },
          { ifMatch: f.revision as number },
        ),
        'updateForm/validation_failed',
      );
    },
  },
  {
    title: 'менеджер без «Настраивать» — 403',
    operationId: 'updateForm',
    expect: 'error',
    example: 'updateForm/forbidden_action',
    run: async (ctx) => {
      const s = await as(ctx, 'manager');
      ctx.expectExample(
        await s.patch(at(ctx, `forms/${FORM(ctx)}`), { status: 'closed' }, { ifMatch: 1 }),
        'updateForm/forbidden_action',
      );
    },
  },
  {
    title: 'устаревшая ревизия формы — 412',
    operationId: 'updateForm',
    expect: 'error',
    example: 'updateForm/revision_mismatch',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.patch(at(ctx, `forms/${FORM(ctx)}`), { name: 'Осмотр' }, { ifMatch: 7 }),
        'updateForm/revision_mismatch',
      );
    },
  },

  // ── Черновик, публикация, версии ──
  {
    title: 'черновик отчёта прораба: «Явка бригады» без вариантов — до публикации исправьте',
    operationId: 'getFormDraft',
    expect: 'success',
    example: 'getFormDraft/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(await s.get(at(ctx, `forms/${FOREMAN(ctx)}/draft`)), 'getFormDraft/ok');
    },
  },
  {
    title: 'черновик несуществующей формы — 404',
    operationId: 'getFormDraft',
    expect: 'error',
    example: 'getFormDraft/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(await s.get(at(ctx, `forms/${MISSING}/draft`)), 'getFormDraft/not_found');
    },
  },
  {
    title: 'автосохранение: новый вопрос «Шины в порядке?» — есть неопубликованные изменения',
    operationId: 'saveFormDraft',
    expect: 'success',
    example: 'saveFormDraft/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const { r } = await changedDraft(ctx, s);
      ctx.expectExample(r, 'saveFormDraft/ok');
      const f = body(await s.get(at(ctx, `forms/${FORM(ctx)}`)));
      expect(f).toMatchObject({ hasUnpublishedChanges: true, questionCount: 8 });
    },
  },
  {
    title:
      'второй редактор с прежней ревизией — 412 «Черновик изменил другой редактор — обновите страницу»',
    operationId: 'saveFormDraft',
    expect: 'error',
    example: 'saveFormDraft/revision_mismatch',
    run: async (ctx) => {
      const s = await as(ctx);
      const { def, rev } = await changedDraft(ctx, s);
      ctx.expectExample(
        await s.put(at(ctx, `forms/${FORM(ctx)}/draft`), { definition: def }, { ifMatch: rev }),
        'saveFormDraft/revision_mismatch',
      );
    },
  },
  {
    title: 'идентификатор повторяется — «Такой идентификатор уже есть»',
    operationId: 'saveFormDraft',
    expect: 'error',
    example: 'saveFormDraft/validation_failed',
    run: async (ctx) => {
      const s = await as(ctx);
      const d = body(await s.get(at(ctx, `forms/${FORM(ctx)}/draft`)));
      const def = structuredClone(d.definition) as NonNullable<Body['definition']>;
      def.fields.push({ key: 'q-odo', pageId: 'p2', type: 'int', label: 'Пробег', required: true });
      ctx.expectExample(
        await s.put(
          at(ctx, `forms/${FORM(ctx)}/draft`),
          { definition: def },
          { ifMatch: d.revision as number },
        ),
        'saveFormDraft/validation_failed',
      );
    },
  },
  {
    title: '«Отменить неопубликованные изменения» — черновик снова v3',
    operationId: 'discardFormDraft',
    expect: 'success',
    example: 'discardFormDraft/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const { r } = await changedDraft(ctx, s);
      ctx.expectExample(
        await s.delete(at(ctx, `forms/${FORM(ctx)}/draft`), {
          ifMatch: body(r).revision as number,
        }),
        'discardFormDraft/ok',
      );
    },
  },
  {
    title: 'форма без версий — 409 form_not_published «У формы ещё нет опубликованной версии»',
    operationId: 'discardFormDraft',
    expect: 'error',
    example: 'discardFormDraft/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      const d = body(await s.get(at(ctx, `forms/${FOREMAN(ctx)}/draft`)));
      ctx.expectExample(
        await s.delete(at(ctx, `forms/${FOREMAN(ctx)}/draft`), { ifMatch: d.revision as number }),
        'discardFormDraft/invalid_transition',
      );
    },
  },
  {
    title: '«Опубликовать v4»: новый вопрос в новой версии, ответы v3 остаются',
    operationId: 'publishForm',
    expect: 'success',
    example: 'publishForm/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const { r } = await changedDraft(ctx, s);
      const f = body(await s.get(at(ctx, `forms/${FORM(ctx)}`)));
      ctx.expectExample(
        await s.post(
          at(ctx, `forms/${FORM(ctx)}/publish`),
          { draftRevision: body(r).revision },
          { ifMatch: f.revision as number },
        ),
        'publishForm/ok',
      );
      const versions = body(await s.get(at(ctx, `forms/${FORM(ctx)}/versions`))).items ?? [];
      expect(versions.map((x) => [x.number, x.current])).toEqual([
        [4, true],
        [3, false],
        [2, false],
        [1, false],
      ]);
    },
  },
  {
    title: 'смена типа вопроса — новый идентификатор «{key}-v{N}»',
    operationId: 'publishForm',
    expect: 'success',
    run: async (ctx) => {
      const s = await as(ctx);
      const d = body(await s.get(at(ctx, `forms/${FORM(ctx)}/draft`)));
      const def = structuredClone(d.definition) as NonNullable<Body['definition']>;
      const odo = def.fields.find((x) => x.key === 'q-odo') as Record<string, unknown>;
      odo.type = 'int';
      const saved = body(
        await s.put(
          at(ctx, `forms/${FORM(ctx)}/draft`),
          { definition: def },
          { ifMatch: d.revision as number },
        ),
      );
      const f = body(await s.get(at(ctx, `forms/${FORM(ctx)}`)));
      await s.post(
        at(ctx, `forms/${FORM(ctx)}/publish`),
        { draftRevision: saved.revision },
        { ifMatch: f.revision as number },
      );
      const v4 = (body(await s.get(at(ctx, `forms/${FORM(ctx)}/versions`))).items ?? [])[0] as Body;
      expect(v4.definition?.fields.map((x) => x.key)).toContain('q-odo-v4');
    },
  },
  {
    title: 'черновик с ошибками — 422 «Найдено ошибок: N. Исправьте их в конструкторе.»',
    operationId: 'publishForm',
    expect: 'error',
    example: 'publishForm/validation_failed',
    run: async (ctx) => {
      const s = await as(ctx);
      const d = body(await s.get(at(ctx, `forms/${FOREMAN(ctx)}/draft`)));
      const f = body(await s.get(at(ctx, `forms/${FOREMAN(ctx)}`)));
      ctx.expectExample(
        await s.post(
          at(ctx, `forms/${FOREMAN(ctx)}/publish`),
          { draftRevision: d.revision },
          { ifMatch: f.revision as number },
        ),
        'publishForm/validation_failed',
      );
    },
  },
  {
    title: 'изменений нет — 409 form_no_changes',
    operationId: 'publishForm',
    expect: 'error',
    example: 'publishForm/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      const d = body(await s.get(at(ctx, `forms/${FORM(ctx)}/draft`)));
      const f = body(await s.get(at(ctx, `forms/${FORM(ctx)}`)));
      ctx.expectExample(
        await s.post(
          at(ctx, `forms/${FORM(ctx)}/publish`),
          { draftRevision: d.revision },
          { ifMatch: f.revision as number },
        ),
        'publishForm/invalid_transition',
      );
    },
  },
  {
    title: 'черновик изменили после открытия диалога — 412',
    operationId: 'publishForm',
    expect: 'error',
    example: 'publishForm/revision_mismatch',
    run: async (ctx) => {
      const s = await as(ctx);
      const { rev } = await changedDraft(ctx, s);
      const f = body(await s.get(at(ctx, `forms/${FORM(ctx)}`)));
      ctx.expectExample(
        await s.post(
          at(ctx, `forms/${FORM(ctx)}/publish`),
          { draftRevision: rev },
          { ifMatch: f.revision as number },
        ),
        'publishForm/revision_mismatch',
      );
    },
  },
  {
    title: 'версии «Осмотра машины»: v3 действует, v1 и v2 — по своей структуре',
    operationId: 'listFormVersions',
    expect: 'success',
    example: 'listFormVersions/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(await s.get(at(ctx, `forms/${FORM(ctx)}/versions`)), 'listFormVersions/ok');
    },
  },
  {
    title: 'версии несуществующей формы — 404',
    operationId: 'listFormVersions',
    expect: 'error',
    example: 'listFormVersions/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(at(ctx, `forms/${MISSING}/versions`)),
        'listFormVersions/not_found',
      );
    },
  },

  // ── Действия после ответа ──
  {
    title: 'правила «Осмотра машины»: задача менеджеру (au-1) и строка в таблицу «Осмотры» (au-2)',
    operationId: 'listFormRules',
    expect: 'success',
    example: 'listFormRules/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(await s.get(at(ctx, `forms/${FORM(ctx)}/rules`)), 'listFormRules/ok');
    },
  },
  {
    title: 'адрес письма и HTTP-запроса видит только участник с «Настраивать» (Q-W4.05-18)',
    operationId: 'listFormRules',
    expect: 'success',
    run: async (ctx) => {
      const s = await as(ctx);
      const rules = at(ctx, `forms/${FORM(ctx)}/rules`);
      const mail = await s.post(rules, {
        kind: 'email',
        trigger: 'submitted',
        email: { to: 'dispatch@alta.example' },
      });
      const hook = await s.post(rules, {
        kind: 'http',
        trigger: 'submitted',
        http: { url: 'https://hooks.example/forms?secret=s3cr3t' },
      });
      expect([mail.status, hook.status]).toEqual([201, 201]);
      const mine = body(await s.get(rules)).items ?? [];
      expect(mine.find((x) => x.kind === 'email')?.email).toEqual({ to: 'dispatch@alta.example' });
      expect(mine.find((x) => x.kind === 'http')?.http).toEqual({
        url: 'https://hooks.example/forms?secret=s3cr3t',
      });
      const m = await ctx.as('manager');
      const theirs = body(await m.get(rules)).items ?? [];
      const email = theirs.find((x) => x.kind === 'email');
      const http = theirs.find((x) => x.kind === 'http');
      expect(email).toBeDefined();
      expect(http).toBeDefined();
      expect(email && 'email' in email).toBe(false);
      expect(http && 'http' in http).toBe(false);
      expect(JSON.stringify(theirs)).not.toContain('s3cr3t');
    },
  },
  {
    title: 'правила несуществующей формы — 404',
    operationId: 'listFormRules',
    expect: 'error',
    example: 'listFormRules/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(await s.get(at(ctx, `forms/${MISSING}/rules`)), 'listFormRules/not_found');
    },
  },
  {
    title: '«Уведомить сотрудника» Марину Котову, если «Есть дефекты?» = да',
    operationId: 'createFormRule',
    expect: 'success',
    example: 'createFormRule/created',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(at(ctx, `forms/${FORM(ctx)}/rules`), {
          kind: 'notify',
          trigger: 'submitted',
          condition: { fieldKey: 'q-defect', value: 'true' },
          notify: { memberId: ctx.A('m-kotova') },
        }),
        'createFormRule/created',
      );
    },
  },
  {
    title: 'страница Базы знаний не выбрана — «Выберите страницу Базы знаний»',
    operationId: 'createFormRule',
    expect: 'error',
    example: 'createFormRule/validation_failed',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(at(ctx, `forms/${FORM(ctx)}/rules`), {
          kind: 'kb',
          trigger: 'accepted',
          kb: {
            nodeId: MISSING,
            mode: 'entry',
            position: 'top',
            fields: [{ name: 'Пробег', source: 'q-odo' }],
            showLink: false,
            allEmployeesConfirmed: false,
          },
        }),
        'createFormRule/validation_failed',
      );
    },
  },
  {
    title: '«Включено» выключает задачу au-1 — версия правила та же',
    operationId: 'updateFormRule',
    expect: 'success',
    example: 'updateFormRule/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.patch(
          at(ctx, `forms/${FORM(ctx)}/rules/${ctx.A('au-1')}`),
          { enabled: false },
          { ifMatch: 1 },
        ),
        'updateFormRule/ok',
      );
    },
  },
  {
    title: '«Изменить» — новая версия правила, автор — кто изменил',
    operationId: 'updateFormRule',
    expect: 'success',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.patch(
        at(ctx, `forms/${FORM(ctx)}/rules/${ctx.A('au-1')}`),
        {
          task: {
            projectId: ctx.A('fleet'),
            title: 'Проверить осмотр и пробег',
            assigneeMemberId: ctx.A('m-kotova'),
          },
        },
        { ifMatch: 1 },
      );
      expect(body(r)).toMatchObject({ version: 2, revision: 2 });
    },
  },
  {
    title: 'правила нет — 404 «Действие не найдено»',
    operationId: 'updateFormRule',
    expect: 'error',
    example: 'updateFormRule/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.patch(
          at(ctx, `forms/${FORM(ctx)}/rules/${MISSING}`),
          { enabled: false },
          { ifMatch: 1 },
        ),
        'updateFormRule/not_found',
      );
    },
  },
  {
    title: 'удалить действие — записанные строки остаются в Базе знаний',
    operationId: 'deleteFormRule',
    expect: 'success',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.delete(at(ctx, `forms/${FORM(ctx)}/rules/${ctx.A('au-2')}`), {
        ifMatch: 1,
      });
      expect(r.status).toBe(204);
      const rules = body(await s.get(at(ctx, `forms/${FORM(ctx)}/rules`))).items ?? [];
      expect(rules.map((x) => x.id)).toEqual([ctx.A('au-1')]);
      const resp = body(await s.get(at(ctx, `forms/${FORM(ctx)}/responses/${ctx.A('R-1012')}`)));
      expect((resp.actions as { retryable: boolean }[])[0]?.retryable).toBe(false);
    },
  },
  {
    title: 'удалить несуществующее действие — 404',
    operationId: 'deleteFormRule',
    expect: 'error',
    example: 'deleteFormRule/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.delete(at(ctx, `forms/${FORM(ctx)}/rules/${MISSING}`), { ifMatch: 1 }),
        'deleteFormRule/not_found',
      );
    },
  },
  {
    title: '«Перенести прошлые ответы»: оба ответа уже в таблице — новых нет',
    operationId: 'backfillFormRule',
    expect: 'success',
    example: 'backfillFormRule/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(at(ctx, `forms/${FORM(ctx)}/rules/${ctx.A('au-2')}/backfill`)),
        'backfillFormRule/ok',
      );
    },
  },
  {
    title: 'выключенное действие — 409 form_rule_disabled',
    operationId: 'backfillFormRule',
    expect: 'error',
    example: 'backfillFormRule/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      await s.patch(
        at(ctx, `forms/${FORM(ctx)}/rules/${ctx.A('au-2')}`),
        { enabled: false },
        { ifMatch: 1 },
      );
      ctx.expectExample(
        await s.post(at(ctx, `forms/${FORM(ctx)}/rules/${ctx.A('au-2')}/backfill`)),
        'backfillFormRule/invalid_transition',
      );
    },
  },

  // ── Ответы ──
  {
    title: 'лента: R-1012 и R-0988, журнал «в БЗ»',
    operationId: 'listFormResponses',
    expect: 'success',
    example: 'listFormResponses/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(at(ctx, `forms/${FORM(ctx)}/responses`)),
        'listFormResponses/ok',
      );
      const m = await ctx.as('manager');
      const items = body(await m.get(at(ctx, `forms/${FORM(ctx)}/responses`))).items ?? [];
      expect(items.map((x) => x.number)).toEqual(['R-1012', 'R-0988']);
    },
  },
  {
    title: 'водитель без «Читать ответы» — 403 шлюза',
    operationId: 'listFormResponses',
    expect: 'error',
    example: 'listFormResponses/forbidden_action',
    run: async (ctx) => {
      const s = await as(ctx, 'driver');
      ctx.expectExample(
        await s.get(at(ctx, `forms/${FORM(ctx)}/responses`)),
        'listFormResponses/forbidden_action',
      );
    },
  },
  {
    title: 'ответ сотрудника R-1013: принят, задача LOG и строка в «Осмотры»',
    operationId: 'submitFormResponse',
    expect: 'success',
    example: 'submitFormResponse/created',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(at(ctx, `forms/${FORM(ctx)}/responses`), {
        versionId: ctx.A('fm-insp:v3'),
        answers: ANSWERS(ctx),
      });
      ctx.expectExample(r, 'submitFormResponse/created');
      const acts = body(r).actions as { kind: string; ok: boolean; taskKey?: string }[];
      expect(acts.map((a) => [a.kind, a.ok])).toEqual([
        ['task', true],
        ['kb', true],
      ]);
      const task = await s.get(
        at(ctx, `tasks/${String((body(r).actions as { taskId: string }[])[0]?.taskId)}`),
      );
      expect(body(task)).toMatchObject({
        title: 'Проверить осмотр',
        assigneeMemberId: ctx.A('m-kotova'),
      });
      const kb = body(await s.get(at(ctx, `knowledge/nodes/${ctx.A('kb-5')}`)));
      const rows =
        (kb.tables as { rows: { source?: { responseNumber: string } }[] }[])[0]?.rows ?? [];
      expect(rows[0]?.source?.responseNumber).toBe('R-1013');
    },
  },
  {
    title: 'без обязательных ответов — 422 «Обязательный вопрос»',
    operationId: 'submitFormResponse',
    expect: 'error',
    example: 'submitFormResponse/validation_failed',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(at(ctx, `forms/${FORM(ctx)}/responses`), {
          versionId: ctx.A('fm-insp:v3'),
          answers: [{ fieldKey: 'q-odo', value: { type: 'decimal', value: '84530' } }],
        }),
        'submitFormResponse/validation_failed',
      );
    },
  },
  {
    title: 'ответ по прежней версии — 409 form_version_changed',
    operationId: 'submitFormResponse',
    expect: 'error',
    example: 'submitFormResponse/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(at(ctx, `forms/${FORM(ctx)}/responses`), {
          versionId: ctx.A('fm-insp:v2'),
          answers: ANSWERS(ctx),
        }),
        'submitFormResponse/invalid_transition',
      );
    },
  },
  {
    title: 'приём закрыт — 409 form_closed; «Один ответ от сотрудника» — form_already_answered',
    operationId: 'submitFormResponse',
    expect: 'error',
    run: async (ctx) => {
      const s = await as(ctx);
      const url = at(ctx, `forms/${FORM(ctx)}`);
      const f = body(await s.get(url));
      const once = body(
        await s.patch(url, { settings: { onePerMember: true } }, { ifMatch: f.revision as number }),
      );
      const send = () =>
        s.post(at(ctx, `forms/${FORM(ctx)}/responses`), {
          versionId: ctx.A('fm-insp:v3'),
          answers: ANSWERS(ctx),
        });
      expect((await send()).status).toBe(201);
      expect(body(await send())).toMatchObject({
        code: 'invalid_transition',
        reason: 'form_already_answered',
      });
      await s.patch(url, { status: 'closed' }, { ifMatch: once.revision as number });
      expect(body(await send())).toMatchObject({
        reason: 'form_closed',
        detail: 'Приём ответов закрыт',
      });
    },
  },
  {
    title:
      'значение скрытого вопроса — только из ссылки и defaultValue: ключ в answers — 422 (возврат 2)',
    operationId: 'submitFormResponse',
    expect: 'error',
    run: async (ctx) => {
      const s = await as(ctx);
      const { url, versionId } = await published(ctx, s, 'Заявка с сайта', [
        { key: 'q-text', pageId: 'p1', type: 'text', label: 'Вопрос', required: true },
        {
          key: 'q-src',
          pageId: 'p1',
          type: 'text',
          label: 'Источник',
          required: false,
          hidden: true,
          defaultValue: 'сайт',
        },
      ]);
      const text = (fieldKey: string, value: string) => ({
        fieldKey,
        value: { type: 'text', value },
      });
      const bad = await s.post(`${url}/responses`, {
        versionId,
        answers: [text('q-text', 'Когда доставка?'), text('q-src', 'реклама')],
      });
      expect(bad.status).toBe(422);
      expect(body(bad)).toMatchObject({
        code: 'validation_failed',
        violations: [
          {
            field: 'q-src',
            code: 'hidden',
            message: 'Скрытый вопрос заполняют ссылка и значение по умолчанию',
          },
        ],
      });
      const byLink = body(
        await s.post(`${url}/responses`, {
          versionId,
          answers: [text('q-text', 'Когда доставка?')],
          linkParams: { 'q-src': 'email' },
        }),
      );
      expect(byLink.linkParamKeys).toEqual(['q-src']);
      expect(byLink.answers).toContainEqual(text('q-src', 'email'));
      const byDefault = body(
        await s.post(`${url}/responses`, { versionId, answers: [text('q-text', 'Есть скидки?')] }),
      );
      expect(byDefault.answers).toContainEqual(text('q-src', 'сайт'));
    },
  },
  {
    title: 'карточка R-1012: ответы по структуре v3, «в БЗ» выполнено',
    operationId: 'getFormResponse',
    expect: 'success',
    example: 'getFormResponse/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(at(ctx, `forms/${FORM(ctx)}/responses/${ctx.A('R-1012')}`)),
        'getFormResponse/ok',
      );
    },
  },
  {
    title: 'ответа нет — 404 «Ответ не найден»',
    operationId: 'getFormResponse',
    expect: 'error',
    example: 'getFormResponse/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(at(ctx, `forms/${FORM(ctx)}/responses/${MISSING}`)),
        'getFormResponse/not_found',
      );
    },
  },
  {
    title: 'менеджер отклоняет ответ R-1012 с комментарием',
    operationId: 'reviewFormResponse',
    expect: 'success',
    example: 'reviewFormResponse/ok',
    run: async (ctx) => {
      const s = await as(ctx, 'manager');
      ctx.expectExample(
        await s.patch(
          at(ctx, `forms/${FORM(ctx)}/responses/${ctx.A('R-1012')}`),
          { reviewStatus: 'rejected', reviewComment: 'Нет фото одометра' },
          { ifMatch: 1 },
        ),
        'reviewFormResponse/ok',
      );
    },
  },
  {
    title: 'пустое тело проверки — 422, ревизия ответа не меняется (возврат 2)',
    operationId: 'reviewFormResponse',
    expect: 'error',
    run: async (ctx) => {
      const s = await as(ctx, 'manager');
      const url = at(ctx, `forms/${FORM(ctx)}/responses/${ctx.A('R-1012')}`);
      const r = await s.patch(url, {}, { ifMatch: 1 });
      expect(r.status).toBe(422);
      expect(body(r).code).toBe('validation_failed');
      expect(body(await s.get(url)).revision).toBe(1);
    },
  },
  {
    title: 'право проверки — у ответа: FormResponse.my у менеджера (принять — да, назначить — нет)',
    operationId: 'getFormResponse',
    expect: 'success',
    run: async (ctx) => {
      const m = await as(ctx, 'manager');
      const url = at(ctx, `forms/${FORM(ctx)}/responses/${ctx.A('R-1012')}`);
      expect(body(await m.get(url)).my).toEqual({ review: true, assign: false });
      const o = await ctx.as('owner');
      expect(body(await o.get(url)).my).toEqual({ review: true, assign: true });
    },
  },
  {
    title: 'менеджер без «Назначать ответственного» — 403',
    operationId: 'reviewFormResponse',
    expect: 'error',
    example: 'reviewFormResponse/forbidden_action',
    run: async (ctx) => {
      const s = await as(ctx, 'manager');
      ctx.expectExample(
        await s.patch(
          at(ctx, `forms/${FORM(ctx)}/responses/${ctx.A('R-1012')}`),
          { assigneeMemberId: ctx.A('m-kotova') },
          { ifMatch: 1 },
        ),
        'reviewFormResponse/forbidden_action',
      );
    },
  },
  {
    title: '«Повторить» выполненное действие — прежний результат, вторая строка не создаётся',
    operationId: 'retryFormResponseAction',
    expect: 'success',
    example: 'retryFormResponseAction/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(
          at(ctx, `forms/${FORM(ctx)}/responses/${ctx.A('R-1012')}/actions/${ctx.A('au-2')}/retry`),
        ),
        'retryFormResponseAction/ok',
      );
    },
  },
  {
    title: 'действие удалено из формы — 409 form_rule_deleted',
    operationId: 'retryFormResponseAction',
    expect: 'error',
    example: 'retryFormResponseAction/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      await s.delete(at(ctx, `forms/${FORM(ctx)}/rules/${ctx.A('au-2')}`), { ifMatch: 1 });
      ctx.expectExample(
        await s.post(
          at(ctx, `forms/${FORM(ctx)}/responses/${ctx.A('R-1012')}/actions/${ctx.A('au-2')}/retry`),
        ),
        'retryFormResponseAction/invalid_transition',
      );
    },
  },
  {
    title: 'сводка «Осмотра машины» по вопросам всех версий',
    operationId: 'getFormResponseSummary',
    expect: 'success',
    example: 'getFormResponseSummary/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(at(ctx, `forms/${FORM(ctx)}/summary`)),
        'getFormResponseSummary/ok',
      );
    },
  },
  {
    title: 'водитель — 403 шлюза',
    operationId: 'getFormResponseSummary',
    expect: 'error',
    example: 'getFormResponseSummary/forbidden_action',
    run: async (ctx) => {
      const s = await as(ctx, 'driver');
      ctx.expectExample(
        await s.get(at(ctx, `forms/${FORM(ctx)}/summary`)),
        'getFormResponseSummary/forbidden_action',
      );
    },
  },
  {
    title: '«Выгрузить CSV»: «;», BOM, «Ответ;Дата;Автор;Объект;Версия;Статус;…»',
    operationId: 'exportFormResponses',
    expect: 'success',
    example: 'exportFormResponses/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.get(at(ctx, `forms/${FORM(ctx)}/export`));
      ctx.expectExample(r, 'exportFormResponses/ok');
      expect(String(body(r).content).startsWith('﻿Ответ;Дата;Автор;Объект;Версия;Статус;')).toBe(
        true,
      );
    },
  },
  {
    title:
      'ответ «=HYPERLINK(…)» — в CSV с апострофом и в кавычках (защита от формул, как exportDataset)',
    operationId: 'exportFormResponses',
    expect: 'success',
    run: async (ctx) => {
      const s = await as(ctx);
      const f = body(
        await s.post(at(ctx, 'forms'), { name: 'Отзыв', orgUnitId: null, templateId: 'blank' }),
      );
      const url = at(ctx, `forms/${String(f.id)}`);
      const d = body(await s.get(`${url}/draft`));
      const saved = body(
        await s.put(
          `${url}/draft`,
          {
            definition: {
              pages: [{ id: 'p1', title: 'Страница 1' }],
              fields: [
                { key: 'q-text', pageId: 'p1', type: 'text', label: 'Отзыв', required: true },
                { key: 'q-n', pageId: 'p1', type: 'number', label: 'Оценка', required: false },
              ],
            },
          },
          { ifMatch: d.revision as number },
        ),
      );
      const pub = body(
        await s.post(
          `${url}/publish`,
          { draftRevision: saved.revision },
          { ifMatch: f.revision as number },
        ),
      );
      const sent = await s.post(`${url}/responses`, {
        versionId: pub.publishedVersionId,
        answers: [
          { fieldKey: 'q-text', value: { type: 'text', value: '=HYPERLINK("http://x";"y")' } },
          { fieldKey: 'q-n', value: { type: 'decimal', value: '-3' } },
        ],
      });
      expect(sent.status).toBe(201);
      const csv = String(body(await s.get(`${url}/export`)).content);
      const row = csv.split('\r\n')[1] ?? '';
      expect(row.endsWith(';"\'=HYPERLINK(""http://x"";""y"")";-3')).toBe(true);
    },
  },
  {
    title: 'ответов нет — 409 form_no_responses «Ответов пока нет»',
    operationId: 'exportFormResponses',
    expect: 'error',
    example: 'exportFormResponses/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(at(ctx, `forms/${FOREMAN(ctx)}/export`)),
        'exportFormResponses/invalid_transition',
      );
    },
  },
  {
    title: 'вопрос «Сотрудник»: сотрудники организации по поиску',
    operationId: 'listFormFieldOptions',
    expect: 'success',
    example: 'listFormFieldOptions/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const f = body(
        await s.post(at(ctx, 'forms'), {
          name: 'Кто дежурит',
          orgUnitId: null,
          templateId: 'blank',
        }),
      );
      const url = at(ctx, `forms/${String(f.id)}`);
      const d = body(await s.get(`${url}/draft`));
      const saved = body(
        await s.put(
          `${url}/draft`,
          {
            definition: {
              pages: [{ id: 'p1', title: 'Страница 1' }],
              fields: [
                {
                  key: 'q-who',
                  pageId: 'p1',
                  type: 'person',
                  label: 'Кто дежурит',
                  required: true,
                },
              ],
            },
          },
          { ifMatch: d.revision as number },
        ),
      );
      await s.post(
        `${url}/publish`,
        { draftRevision: saved.revision },
        { ifMatch: f.revision as number },
      );
      ctx.expectExample(await s.get(`${url}/fields/q-who/options?q=ов`), 'listFormFieldOptions/ok');
    },
  },
  {
    title: 'вопрос не CRM — 404 «Вопрос не найден»',
    operationId: 'listFormFieldOptions',
    expect: 'error',
    example: 'listFormFieldOptions/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(at(ctx, `forms/${FORM(ctx)}/fields/q-odo/options`)),
        'listFormFieldOptions/not_found',
      );
    },
  },

  // ── PublicForms: гость по публичной ссылке (W4.70; поведение backend W4.21 — public.go) ──
  {
    title: 'гость читает форму: без баллов и умолчаний скрытых вопросов, оформление, нонс',
    operationId: 'getPublicForm',
    expect: 'success',
    run: async (ctx) => {
      const s = await as(ctx);
      const p = await publicForm(ctx, s, 'Тест для гостей', QUIZ);
      const r = await ctx.anon().get(pub(p.token));
      expect(r.status).toBe(200);
      const b = body(r);
      expect(b).toMatchObject({
        formId: p.formId,
        versionId: p.versionId,
        acceptingResponses: true,
        uploadAllowed: false,
        uploadMaxBytes: 0,
        presentation: {
          title: 'Тест для гостей',
          organizationName: 'Альта Групп',
          progressBar: true,
          backButton: true,
          confirmationText: 'Спасибо! Ответ отправлен.',
          showScore: true,
        },
      });
      expect(String(b.submissionNonce).length).toBeGreaterThanOrEqual(16);
      const fields = b.definition?.fields ?? [];
      expect(fields.map((x) => x.key)).toEqual(['q-helmet', 'q-src']);
      expect(fields[0]?.options).toEqual([
        { key: 'o1', label: 'Да' },
        { key: 'o2', label: 'Нет' },
      ]);
      expect(fields[1]).not.toHaveProperty('defaultValue');
      expect(fields[1]).toMatchObject({ hidden: true });
    },
  },
  {
    title: 'закрытая форма — 200 и acceptingResponses false; форма с файлом — загрузка до 10 МБ',
    operationId: 'getPublicForm',
    expect: 'success',
    run: async (ctx) => {
      const s = await as(ctx);
      const p = await publicForm(ctx, s, 'Заявка с фото', PHOTO);
      expect(body(await ctx.anon().get(pub(p.token)))).toMatchObject({
        uploadAllowed: true,
        uploadMaxBytes: 10 * 1024 * 1024,
      });
      const f = body(await s.get(p.url));
      await s.patch(p.url, { status: 'closed' }, { ifMatch: f.revision as number });
      expect(body(await ctx.anon().get(pub(p.token)))).toMatchObject({
        acceptingResponses: false,
      });
    },
  },
  {
    title: 'неизвестный токен — 404; форма больше не публичная — 410 public_token_expired',
    operationId: 'getPublicForm',
    expect: 'error',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectProblem(await ctx.anon().get(pub('fUnknownToken0000000000000000')), 'not_found');
      const p = await publicForm(ctx, s, 'Отзыв о доставке');
      const f = body(await s.get(p.url));
      await s.patch(p.url, { settings: { access: 'members' } }, { ifMatch: f.revision as number });
      ctx.expectProblem(await ctx.anon().get(pub(p.token)), 'public_token_expired');
    },
  },
  {
    title:
      'ответ гостя: квитанция, «На проверке», «Гость», ключи из ссылки; повтор с тем же нонсом — та же квитанция',
    operationId: 'submitPublicForm',
    expect: 'success',
    run: async (ctx) => {
      const s = await as(ctx);
      const p = await publicForm(ctx, s, 'Тест по технике', QUIZ);
      const g = ctx.anon();
      const form = body(await g.get(pub(p.token)));
      const send = {
        versionId: p.versionId,
        submissionNonce: form.submissionNonce,
        answers: [{ fieldKey: 'q-helmet', value: { type: 'choices', value: ['o1'] } }],
        linkParams: { 'q-src': 'email' },
      };
      const r = await g.post(`${pub(p.token)}/responses`, send);
      expect(r.status).toBe(201);
      expect(body(r).message).toBe(
        'Спасибо! Ответ отправлен.\nРезультат: 1 из 1 балла · тест пройден',
      );
      const again = await g.post(`${pub(p.token)}/responses`, send);
      expect(again.status).toBe(201);
      expect(again.headers.get('Idempotency-Replayed')).toBe('true');
      expect(body(again).receiptId).toBe(body(r).receiptId);
      const list = body(await s.get(`${p.url}/responses`)).items ?? [];
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        id: body(r).receiptId,
        channel: 'public',
        reviewStatus: 'pending',
        author: { memberId: null, displayName: 'Гость' },
        linkParamKeys: ['q-src'],
        score: { points: 1, maxPoints: 1, passed: true },
      });
      expect(list[0]?.answers).toContainEqual({
        fieldKey: 'q-src',
        value: { type: 'text', value: 'email' },
      });
    },
  },
  {
    title: 'нонс: другие ответы — 410 nonce_used, чужой — 422, устаревший — 410',
    operationId: 'submitPublicForm',
    expect: 'error',
    run: async (ctx) => {
      const s = await as(ctx);
      const p = await publicForm(ctx, s, 'Отзыв о курьере', QUIZ);
      const g = ctx.anon();
      const nonce = String(body(await g.get(pub(p.token))).submissionNonce);
      const ans = (k: string) => [{ fieldKey: 'q-helmet', value: { type: 'choices', value: [k] } }];
      const url = `${pub(p.token)}/responses`;
      const r1 = await g.post(url, {
        versionId: p.versionId,
        submissionNonce: nonce,
        answers: ans('o1'),
      });
      expect(r1.status).toBe(201);
      const used = await g.post(url, {
        versionId: p.versionId,
        submissionNonce: nonce,
        answers: ans('o2'),
      });
      ctx.expectProblem(used, 'nonce_used');
      expect(body(used).detail).toBe('Ответ с этой страницы уже отправлен');
      const forged = await g.post(url, {
        versionId: p.versionId,
        submissionNonce: 'forged-nonce-0000000000000000',
        answers: ans('o1'),
      });
      ctx.expectProblem(forged, 'validation_failed');
      expect(body(forged).violations).toEqual([
        { field: 'submissionNonce', code: 'invalid', message: 'Откройте форму по ссылке заново' },
      ]);
      const fresh = String(body(await g.get(pub(p.token))).submissionNonce);
      ctx.server.setNow('2026-10-01T10:00:00Z');
      const old = await g.post(url, {
        versionId: p.versionId,
        submissionNonce: fresh,
        answers: ans('o1'),
      });
      ctx.expectProblem(old, 'nonce_used');
      expect(body(old).detail).toBe('Страница формы устарела — откройте ссылку заново');
    },
  },
  {
    title: 'новая версия — 409 form_version_changed; закрыта — 409 form_closed',
    operationId: 'submitPublicForm',
    expect: 'error',
    run: async (ctx) => {
      const s = await as(ctx);
      const p = await publicForm(ctx, s, 'Отзыв о мастере', QUIZ);
      const g = ctx.anon();
      const nonce = String(body(await g.get(pub(p.token))).submissionNonce);
      const send = (n: string) =>
        g.post(`${pub(p.token)}/responses`, {
          versionId: p.versionId,
          submissionNonce: n,
          answers: [{ fieldKey: 'q-helmet', value: { type: 'choices', value: ['o1'] } }],
        });
      const d = body(await s.get(`${p.url}/draft`));
      const def = structuredClone(d.definition) as NonNullable<Body['definition']>;
      def.fields.push({
        key: 'q-city',
        pageId: 'p1',
        type: 'text',
        label: 'Город',
        required: false,
      });
      const saved = body(
        await s.put(`${p.url}/draft`, { definition: def }, { ifMatch: d.revision as number }),
      );
      const f = body(await s.get(p.url));
      await s.post(
        `${p.url}/publish`,
        { draftRevision: saved.revision },
        { ifMatch: f.revision as number },
      );
      const moved = await send(nonce);
      expect(body(moved)).toMatchObject({
        code: 'invalid_transition',
        reason: 'form_version_changed',
        detail: 'Форма обновилась — откройте её заново',
      });
      const f2 = body(await s.get(p.url));
      await s.patch(p.url, { status: 'closed' }, { ifMatch: f2.revision as number });
      const v2 = body(await g.get(pub(p.token)));
      const closed = await g.post(`${pub(p.token)}/responses`, {
        versionId: v2.versionId,
        submissionNonce: v2.submissionNonce,
        answers: [{ fieldKey: 'q-helmet', value: { type: 'choices', value: ['o1'] } }],
      });
      expect(body(closed)).toMatchObject({
        code: 'invalid_transition',
        reason: 'form_closed',
        detail: 'Приём ответов закрыт',
      });
    },
  },
  {
    title: 'ответ гостя: обязательный, скрытый вопрос в answers, параметр ссылки не скрытого — 422',
    operationId: 'submitPublicForm',
    expect: 'error',
    run: async (ctx) => {
      const s = await as(ctx);
      const p = await publicForm(ctx, s, 'Тест по охране труда', QUIZ);
      const g = ctx.anon();
      const nonce = String(body(await g.get(pub(p.token))).submissionNonce);
      const r = await g.post(`${pub(p.token)}/responses`, {
        versionId: p.versionId,
        submissionNonce: nonce,
        answers: [{ fieldKey: 'q-src', value: { type: 'text', value: 'реклама' } }],
        linkParams: { 'q-helmet': 'o1' },
      });
      ctx.expectProblem(r, 'validation_failed');
      expect(body(r).violations).toEqual([
        {
          field: 'q-src',
          code: 'hidden',
          message: 'Скрытый вопрос заполняют ссылка и значение по умолчанию',
        },
        {
          field: 'linkParams.q-helmet',
          code: 'not_hidden',
          message: 'Параметр ссылки — только для скрытого вопроса',
        },
        { field: 'q-helmet', code: 'invalid', message: 'Обязательный вопрос' },
      ]);
    },
  },
  {
    title: 'файл гостя: билет загрузки на вопрос «Файл или фото»',
    operationId: 'initiatePublicUpload',
    expect: 'success',
    run: async (ctx) => {
      const s = await as(ctx);
      const p = await publicForm(ctx, s, 'Заявка на ремонт', PHOTO);
      const g = ctx.anon();
      const nonce = String(body(await g.get(pub(p.token))).submissionNonce);
      const r = await g.post(`${pub(p.token)}/uploads`, upload(p.versionId, nonce));
      expect(r.status).toBe(201);
      expect(body(r)).toMatchObject({ method: 'PUT', requiredContentType: 'image/jpeg' });
    },
  },
  {
    title: 'не вопрос файла — 422, больше 10 МБ — 413, нонс уже с ответом — 410',
    operationId: 'initiatePublicUpload',
    expect: 'error',
    run: async (ctx) => {
      const s = await as(ctx);
      const p = await publicForm(ctx, s, 'Заявка с фото дефекта', PHOTO);
      const g = ctx.anon();
      const nonce = String(body(await g.get(pub(p.token))).submissionNonce);
      const url = `${pub(p.token)}/uploads`;
      const wrong = await g.post(url, { ...upload(p.versionId, nonce), fieldKey: 'q-what' });
      ctx.expectProblem(wrong, 'validation_failed');
      expect(body(wrong).violations).toEqual([
        { field: 'fieldKey', code: 'invalid', message: 'Вопрос не найден' },
      ]);
      const big = await g.post(url, { ...upload(p.versionId, nonce), sizeBytes: 11 * 1024 * 1024 });
      ctx.expectProblem(big, 'payload_too_large');
      expect(body(big).detail).toBe('Файл больше 10 МБ.');
      const done = await g.post(`${pub(p.token)}/responses`, {
        versionId: p.versionId,
        submissionNonce: nonce,
        answers: [{ fieldKey: 'q-what', value: { type: 'text', value: 'Течёт кран' } }],
      });
      expect(done.status).toBe(201);
      ctx.expectProblem(await g.post(url, upload(p.versionId, nonce)), 'nonce_used');
    },
  },
  {
    title: 'завершение загрузки своего нонса: файл на проверке; после проверки — ответ с файлом',
    operationId: 'completePublicUpload',
    expect: 'success',
    run: async (ctx) => {
      const s = await as(ctx);
      const p = await publicForm(ctx, s, 'Заявка на замену стекла', PHOTO);
      const g = ctx.anon();
      const nonce = String(body(await g.get(pub(p.token))).submissionNonce);
      const t = body(await g.post(`${pub(p.token)}/uploads`, upload(p.versionId, nonce)));
      await putFile(String(t.uploadUrl));
      const c = await g.post(`${pub(p.token)}/uploads/${String(t.uploadId)}/complete`, {
        submissionNonce: nonce,
        sha256: SHA,
      });
      expect(c.status).toBe(202);
      expect(body(c)).toMatchObject({ id: t.fileId, status: 'quarantined' });
      const answers = [
        { fieldKey: 'q-what', value: { type: 'text', value: 'Трещина' } },
        { fieldKey: 'q-photo', value: { type: 'files', value: [t.fileId] } },
      ];
      const early = await g.post(`${pub(p.token)}/responses`, {
        versionId: p.versionId,
        submissionNonce: nonce,
        answers,
      });
      ctx.expectProblem(early, 'validation_failed');
      expect(body(early).violations).toEqual([
        { field: 'q-photo', code: 'invalid', message: 'Файл не найден' },
      ]);
      await g.post('/api/v1/dev/scenario', { scanFiles: true });
      const r = await g.post(`${pub(p.token)}/responses`, {
        versionId: p.versionId,
        submissionNonce: nonce,
        answers,
      });
      expect(r.status).toBe(201);
    },
  },
  {
    title: 'чужая загрузка или другой нонс — 404; контрольная сумма — 422',
    operationId: 'completePublicUpload',
    expect: 'error',
    run: async (ctx) => {
      const s = await as(ctx);
      const p = await publicForm(ctx, s, 'Заявка на уборку', PHOTO);
      const g = ctx.anon();
      const n1 = String(body(await g.get(pub(p.token))).submissionNonce);
      const n2 = String(body(await g.get(pub(p.token))).submissionNonce);
      const t = body(await g.post(`${pub(p.token)}/uploads`, upload(p.versionId, n1)));
      await putFile(String(t.uploadUrl));
      const url = `${pub(p.token)}/uploads/${String(t.uploadId)}/complete`;
      ctx.expectProblem(await g.post(url, { submissionNonce: n2, sha256: SHA }), 'not_found');
      const bad = await g.post(url, { submissionNonce: n1, sha256: 'f'.repeat(64) });
      ctx.expectProblem(bad, 'validation_failed');
    },
  },
  {
    title: 'состояние проверки своего файла: quarantined → ready',
    operationId: 'getPublicUploadStatus',
    expect: 'success',
    run: async (ctx) => {
      const s = await as(ctx);
      const p = await publicForm(ctx, s, 'Заявка на покраску', PHOTO);
      const g = ctx.anon();
      const nonce = String(body(await g.get(pub(p.token))).submissionNonce);
      const t = body(await g.post(`${pub(p.token)}/uploads`, upload(p.versionId, nonce)));
      await putFile(String(t.uploadUrl));
      await g.post(`${pub(p.token)}/uploads/${String(t.uploadId)}/complete`, {
        submissionNonce: nonce,
        sha256: SHA,
      });
      const url = `${pub(p.token)}/uploads/${String(t.uploadId)}/status`;
      const q = await g.post(url, { submissionNonce: nonce });
      expect(q.status).toBe(200);
      expect(body(q)).toMatchObject({ id: t.fileId, status: 'quarantined' });
      await g.post('/api/v1/dev/scenario', { scanFiles: true });
      expect(body(await g.post(url, { submissionNonce: nonce }))).toMatchObject({
        status: 'ready',
      });
    },
  },
  {
    title: 'загрузка другого нонса — 404',
    operationId: 'getPublicUploadStatus',
    expect: 'error',
    run: async (ctx) => {
      const s = await as(ctx);
      const p = await publicForm(ctx, s, 'Заявка на вывоз', PHOTO);
      const g = ctx.anon();
      const n1 = String(body(await g.get(pub(p.token))).submissionNonce);
      const n2 = String(body(await g.get(pub(p.token))).submissionNonce);
      const t = body(await g.post(`${pub(p.token)}/uploads`, upload(p.versionId, n1)));
      ctx.expectProblem(
        await g.post(`${pub(p.token)}/uploads/${String(t.uploadId)}/status`, {
          submissionNonce: n2,
        }),
        'not_found',
      );
    },
  },
]);

// ---------------------------------------------------------------------------------------------
// PublicForms (W4.70): публичная форма «Альты» и запросы гостя

const pub = (token: string): string => `/api/v1/public/forms/${token}`;

/** Тест с баллами и скрытым вопросом со значением по умолчанию. */
const QUIZ = {
  settings: { scoring: true, passScore: 1, showScore: true },
  fields: [
    {
      key: 'q-helmet',
      pageId: 'p1',
      type: 'choice',
      label: 'Каска обязательна?',
      required: true,
      options: [
        { key: 'o1', label: 'Да', score: 1 },
        { key: 'o2', label: 'Нет', score: 0 },
      ],
    },
    {
      key: 'q-src',
      pageId: 'p1',
      type: 'text',
      label: 'Источник',
      required: false,
      hidden: true,
      defaultValue: 'сайт',
    },
  ],
};

/** Заявка с вопросом «Файл или фото». */
const PHOTO = {
  settings: {},
  fields: [
    { key: 'q-what', pageId: 'p1', type: 'text', label: 'Что случилось', required: true },
    { key: 'q-photo', pageId: 'p1', type: 'photo', label: 'Фото', required: false, maxFiles: 3 },
  ],
};

const SHA = 'a'.repeat(64);

const upload = (versionId: string, submissionNonce: string) => ({
  versionId,
  submissionNonce,
  fieldKey: 'q-photo',
  fileName: 'kran.jpg',
  contentType: 'image/jpeg',
  sizeBytes: 4,
  sha256: SHA,
});

/** PUT объекта по билету в хранилище mock (W2.53). */
async function putFile(url: string): Promise<void> {
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  });
  expect(r.status).toBe(200);
}

/**
 * Публичная форма «Альты» («Все, у кого есть ссылка»), опубликованная v1: шаблон «Форма обратной связи» или пустая с
 * вопросами и настройками `spec`; токен — FormShare.publicToken владельца.
 */
async function publicForm(
  ctx: CaseContext,
  s: Session,
  name: string,
  spec?: { settings: Record<string, unknown>; fields: Record<string, unknown>[] },
): Promise<{ url: string; formId: string; versionId: string; token: string }> {
  const f = body(
    await s.post(at(ctx, 'forms'), {
      name,
      orgUnitId: null,
      templateId: spec ? 'blank' : 'tpl-feedback',
    }),
  );
  const url = at(ctx, `forms/${String(f.id)}`);
  if (spec) {
    const d = body(await s.get(`${url}/draft`));
    await s.put(
      `${url}/draft`,
      { definition: { pages: [{ id: 'p1', title: 'Страница 1' }], fields: spec.fields } },
      { ifMatch: d.revision as number },
    );
    const cur = body(await s.get(url));
    await s.patch(
      url,
      { settings: { ...spec.settings, access: 'public' } },
      { ifMatch: cur.revision as number },
    );
  }
  const d = body(await s.get(`${url}/draft`));
  const cur = body(await s.get(url));
  const pubd = body(
    await s.post(
      `${url}/publish`,
      { draftRevision: d.revision },
      { ifMatch: cur.revision as number },
    ),
  );
  const token = (pubd.share as { publicToken: string | null }).publicToken;
  if (!token) throw new Error(`нет публичной ссылки: ${JSON.stringify(pubd)}`);
  return { url, formId: String(f.id), versionId: String(pubd.publishedVersionId), token };
}
