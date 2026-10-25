// W4.05 · Контрактный PR 4 этапа 4 (0.11.0-stage4, номер версии согласует интегратор): «Формы и опросы» —
// FormDefinition v2 (страницы, 21 тип прототипа, условия «И / ИЛИ», скрытые вопросы, баллы), черновик на сервере,
// публикация из черновика, настройки у формы, FormPatch v2 (переделывается — C п. 13), шаблоны, группы, правила пяти
// видов («в БЗ» — схемы W4.04, «задача» — проект W4.03), перенос и повтор, отправка сотрудником, ответы v2, сводка,
// CSV, варианты вопросов CRM. Эталон — «Формы и опросы.dc.html» (design-2026-10-19); разбор
// docs/plan/v2/analysis/dor/forms.md §2, §3; домен W4.20. Бриф docs/plan/v2/ws/W4.05.md §4.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { checkExamples, loadExamples } from './lib/examples.mjs';
import { operationsById } from './lib/inventory.mjs';
import { abs, ERRORS_PATH, SCREENS_PATH, SOURCE_0_1 } from './lib/paths.mjs';
import { flattenActions, loadCatalog } from './lib/permissions.mjs';
import { escapeToken, parsePointer } from './lib/refs.mjs';
import { checkAgainstSource, loadDeltas } from './lib/source-diff.mjs';
import { readYaml } from './lib/yaml-io.mjs';
import { W5_CODES } from './lib/stage5.mjs';

const T = '/api/v1/tenants/{tenantId}';
const F = `${T}/forms/{formId}`;
const PRJ = 'tenant-org-unit-project';
const RESP = 'tenant-org-unit-project-assigned';

/** [operationId, метод, путь, x-permissions, x-scope] — бриф W4.05 §4. Тег — Forms. */
const OPS = [
  ['getFormDraft', 'get', `${F}/draft`, ['forms.read'], PRJ],
  ['saveFormDraft', 'put', `${F}/draft`, ['forms.manage'], PRJ],
  ['discardFormDraft', 'delete', `${F}/draft`, ['forms.manage'], PRJ],
  ['publishForm', 'post', `${F}/publish`, ['forms.publish'], PRJ],
  ['listFormRules', 'get', `${F}/rules`, ['forms.read'], PRJ],
  ['createFormRule', 'post', `${F}/rules`, ['forms.manage'], PRJ],
  ['updateFormRule', 'patch', `${F}/rules/{ruleId}`, ['forms.manage'], PRJ],
  ['deleteFormRule', 'delete', `${F}/rules/{ruleId}`, ['forms.manage'], PRJ],
  ['backfillFormRule', 'post', `${F}/rules/{ruleId}/backfill`, ['forms.manage'], PRJ],
  ['submitFormResponse', 'post', `${F}/responses`, ['forms.read'], PRJ],
  [
    'retryFormResponseAction',
    'post',
    `${F}/responses/{responseId}/actions/{ruleId}/retry`,
    ['forms.manage'],
    PRJ,
  ],
  ['getFormResponseSummary', 'get', `${F}/summary`, ['forms.responses.read'], RESP],
  ['exportFormResponses', 'get', `${F}/export`, ['forms.responses.read'], RESP],
  ['listFormFieldOptions', 'get', `${F}/fields/{fieldKey}/options`, ['forms.read'], PRJ],
  ['listFormTemplates', 'get', `${T}/form-templates`, ['forms.create'], PRJ],
  ['listFormGroups', 'get', `${T}/form-groups`, ['forms.read'], PRJ],
  ['createFormGroup', 'post', `${T}/form-groups`, ['forms.manage'], 'tenant'],
  ['deleteFormGroup', 'delete', `${T}/form-groups/{groupId}`, ['forms.manage'], 'tenant'],
];
const NEW = OPS.map((o) => o[0]);
/** Операции 0.1, которые PR переделывает (схемы, параметры, описания). */
const CHANGED = [
  'listForms',
  'createForm',
  'getForm',
  'updateForm',
  'listFormVersions',
  'listFormResponses',
  'getFormResponse',
  'reviewFormResponse',
];
const DEPRECATED = ['createFormVersion', 'publishFormVersion'];
const COMMANDS = OPS.filter((o) => o[1] !== 'get').map((o) => o[0]);
const IF_MATCH = [
  'saveFormDraft',
  'discardFormDraft',
  'publishForm',
  'updateFormRule',
  'deleteFormRule',
];
/** Ответ успеха: [operationId, статус, схема тела | null, схема запроса | null]. */
const SHAPES = [
  ['getFormDraft', '200', 'FormDraft', null],
  ['saveFormDraft', '200', 'FormDraft', 'FormDraftSave'],
  ['discardFormDraft', '200', 'FormDraft', null],
  ['publishForm', '200', 'Form', 'FormPublishRequest'],
  ['listFormRules', '200', 'FormRuleList', null],
  ['createFormRule', '201', 'FormRule', 'FormRuleCreate'],
  ['updateFormRule', '200', 'FormRule', 'FormRulePatch'],
  ['deleteFormRule', '204', null, null],
  ['backfillFormRule', '200', 'FormRuleBackfillResult', null],
  ['submitFormResponse', '201', 'FormResponse', 'FormResponseCreate'],
  ['retryFormResponseAction', '200', 'FormResponseAction', null],
  ['getFormResponseSummary', '200', 'FormResponseSummary', null],
  ['exportFormResponses', '200', 'FormResponsesExport', null],
  ['listFormFieldOptions', '200', 'FormFieldOptionList', null],
  ['listFormTemplates', '200', 'FormTemplateList', null],
  ['listFormGroups', '200', 'FormGroupList', null],
  ['createFormGroup', '201', 'FormGroup', 'FormGroupCreate'],
  ['deleteFormGroup', '204', null, null],
];
/** 21 активный тип конструктора эталона (TYPES, dc:474–482; Q-W4.00-forms-5). */
const TYPES = [
  'text',
  'longtext',
  'number',
  'money',
  'email',
  'phone',
  'inn',
  'url',
  'choice',
  'multi',
  'select',
  'bool',
  'person',
  'unit',
  'ref',
  'date',
  'int',
  'scale',
  'rating',
  'photo',
  'statement',
];
const REASONS = [
  'form_draft_flow',
  'form_not_published',
  'form_no_changes',
  'form_closed',
  'form_already_answered',
  'form_group_not_empty',
  'form_rule_disabled',
  'form_rule_deleted',
  'form_no_responses',
];

const doc = bundle();
const source = readYaml(SOURCE_0_1);
const ops = operationsById(doc);
const op = (id) => ops.get(id)?.op;
const schemas = doc.components.schemas;
const src = source.components.schemas;
const deref = (x) => (x?.$ref ? doc.components.parameters[x.$ref.split('/').pop()] : x);
const params = (id) =>
  [...(doc.paths[ops.get(id).path].parameters ?? []), ...(op(id).parameters ?? [])].map(deref);
const param = (id, where, n) =>
  params(id).find((p) => p.in === where && p.name.toLowerCase() === n.toLowerCase());
const name = (ref) => ref?.split('/').pop();
const bodyOf = (id) => name(op(id).requestBody?.content?.['application/json']?.schema?.$ref);
const okOf = (id, status) =>
  name(op(id).responses[status]?.content?.['application/json']?.schema?.$ref);
const at = (root, ptr) => parsePointer(ptr).reduce((cur, t) => cur?.[t], root);
const w405 = () => loadDeltas().filter((d) => /W4\.05/.test(d.source));
const props = (s) => Object.keys(schemas[s]?.properties ?? {});
const prop = (s, p) => schemas[s]?.properties?.[p];

describe('контракт 0.11.0-stage4 (W4.05): операции и права', () => {
  it('18 новых операций тега Forms: метод, путь, x-permissions, x-scope', () => {
    assert.equal(OPS.length, 18);
    const wrong = [];
    for (const [id, method, path, perms, scope] of OPS) {
      const o = ops.get(id);
      if (!o) {
        wrong.push(`${id}: нет в бандле`);
        continue;
      }
      const got = [o.method, o.path, o.tag, o.op['x-permissions'], o.op['x-scope']];
      const want = [method, path, 'Forms', perms, scope];
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        wrong.push(`${id}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
      }
      if (o.op['x-permissions-mode'] !== 'all') wrong.push(`${id}: режим`);
    }
    assert.deepEqual(wrong, []);
  });

  it('операции 0.1 на месте; createFormVersion и publishFormVersion — устаревшие (Q-W4.00-forms-1)', () => {
    for (const id of [...CHANGED, ...DEPRECATED]) assert.ok(ops.get(id), id);
    for (const id of DEPRECATED) {
      assert.equal(op(id).deprecated, true, id);
      assert.match(op(id).description, /deprecated — .*publishForm/, id);
      assert.match(op(id).description, /409 invalid_transition, reason form_draft_flow/, id);
    }
    for (const id of [...NEW, ...CHANGED]) assert.notEqual(op(id).deprecated, true, id);
  });

  it('команды: Idempotency-Key, X-CSRF-Token, Origin, x-csrf, ответы; If-Match — у черновика, публикации, правила', () => {
    const gaps = [];
    for (const id of COMMANDS) {
      if (param(id, 'header', 'Idempotency-Key')?.required !== true)
        gaps.push(`${id}: Idempotency-Key`);
      if (!param(id, 'header', 'X-CSRF-Token')) gaps.push(`${id}: X-CSRF-Token`);
      if (!param(id, 'header', 'Origin')) gaps.push(`${id}: Origin`);
      if (op(id)['x-csrf-required-for-cookie'] !== true) gaps.push(`${id}: x-csrf`);
      for (const s of ['401', '403', '404', '409', '422']) {
        if (!op(id).responses[s]) gaps.push(`${id}: ответ ${s}`);
      }
      const im = param(id, 'header', 'If-Match');
      if (IF_MATCH.includes(id) !== Boolean(im)) gaps.push(`${id}: If-Match ${Boolean(im)}`);
      if (IF_MATCH.includes(id)) {
        for (const s of ['412', '428']) if (!op(id).responses[s]) gaps.push(`${id}: ответ ${s}`);
      }
    }
    for (const id of NEW.filter((x) => !COMMANDS.includes(x))) {
      if (param(id, 'header', 'Idempotency-Key')) gaps.push(`${id}: чтение с Idempotency-Key`);
    }
    assert.deepEqual(gaps, []);
  });

  it('тела запросов и ответов; ETag у черновика, публикации и правила', () => {
    const wrong = [];
    for (const [id, status, ok, body] of SHAPES) {
      if (!op(id).responses[status]) wrong.push(`${id}: нет ответа ${status}`);
      if ((okOf(id, status) ?? null) !== ok) wrong.push(`${id}: ответ ${okOf(id, status)} ≠ ${ok}`);
      if ((bodyOf(id) ?? null) !== body) wrong.push(`${id}: тело ${bodyOf(id)} ≠ ${body}`);
    }
    for (const id of ['getFormDraft', 'saveFormDraft', 'discardFormDraft', 'publishForm']) {
      if (!op(id).responses['200'].headers?.ETag) wrong.push(`${id}: ETag`);
    }
    for (const id of ['createFormRule', 'updateFormRule']) {
      const s = id === 'createFormRule' ? '201' : '200';
      if (!op(id).responses[s].headers?.ETag) wrong.push(`${id}: ETag`);
    }
    assert.deepEqual(wrong, []);
  });

  it('параметры: ruleId, fieldKey, groupId форм; фильтры listForms после параметров 0.1', () => {
    assert.equal(name(param('updateFormRule', 'path', 'ruleId')?.schema?.$ref), 'Id');
    assert.equal(name(param('retryFormResponseAction', 'path', 'ruleId')?.schema?.$ref), 'Id');
    assert.match(param('listFormFieldOptions', 'path', 'fieldKey')?.schema?.pattern, /A-Z/);
    assert.equal(name(param('deleteFormGroup', 'path', 'groupId')?.schema?.$ref), 'Id');
    const names = (op('listForms').parameters ?? []).map((p) => deref(p).name);
    assert.deepEqual(names, ['cursor', 'limit', 'q', 'owner', 'status', 'groupId']);
    assert.deepEqual(param('listForms', 'query', 'status').schema.enum, [
      'draft',
      'open',
      'closed',
    ]);
    assert.deepEqual(param('listForms', 'query', 'owner').schema.enum, ['me']);
  });

  it('права: новых ключей нет (Q-W4.00-forms-7, -8); x-permissions — ключи core.forms', () => {
    const catalog = loadCatalog();
    const keys = Object.keys(catalog.modules['core.forms'].actions);
    assert.deepEqual(keys, [
      'forms.read',
      'forms.create',
      'forms.manage',
      'forms.publish',
      'forms.publish_public',
      'forms.responses.read',
      'forms.responses.review',
      'forms.responses.assign',
    ]);
    // Ответить может тот, у кого forms.read в области формы (Q-W4.00-forms-8): своего ключа отправки нет.
    assert.ok(Object.hasOwn(catalog.prototype_renames, 'forms.responses.create'));
    assert.equal(catalog.prototype_renames['forms.responses.create'], null);
    const actions = flattenActions(catalog);
    for (const id of [...NEW, ...CHANGED]) {
      for (const k of op(id)['x-permissions']) {
        assert.ok(actions.has(k), `${id}: ${k}`);
        assert.ok(k.startsWith('forms.'), `${id}: ${k}`);
      }
    }
  });

  it('ошибки: кодов не прибавилось; причины invalid_transition форм — добавлением', () => {
    const reg = readYaml(ERRORS_PATH).codes;
    const reasons = Object.keys(reg.invalid_transition.reasons);
    for (const r of [...REASONS, 'form_version_changed']) assert.ok(reasons.includes(r), r);
    for (const r of REASONS) assert.match(reg.invalid_transition.reasons[r].source, /W4\.05/, r);
    assert.equal(reg.invalid_transition.reasons.form_closed.ui, 'Приём ответов закрыт');
    assert.equal(
      reg.invalid_transition.reasons.form_already_answered.ui,
      'Вы уже отвечали на эту форму',
    );
    assert.equal(
      reg.invalid_transition.reasons.form_rule_disabled.ui,
      'Действие выключено — включите его, чтобы перенести ответы',
    );
    assert.equal(Object.keys(reg).length - W5_CODES.length, 53);
  });
});

describe('контракт 0.11.0-stage4 (W4.05): схемы', () => {
  it('FormDefinitionV2: страницы, 21 тип, условия «И / ИЛИ», ключи прототипа и сида', () => {
    assert.deepEqual(schemas.FormQuestionType.enum, TYPES);
    assert.deepEqual(schemas.FormDefinitionV2.required, ['pages', 'fields']);
    assert.equal(schemas.FormDefinitionV2.properties.pages.minItems, 1);
    const q = schemas.FormQuestion;
    assert.deepEqual(q.required, ['key', 'pageId', 'type', 'label', 'required']);
    const key = new RegExp(q.properties.key.pattern);
    for (const k of ['q-photos', 'q_odo', 'Q1', 'q-defect-text-v4']) assert.match(k, key, k);
    for (const k of ['1q', '-q', 'q.x', '']) assert.doesNotMatch(k, key, k);
    for (const p of [
      'hint',
      'defaultValue',
      'hidden',
      'options',
      'otherOption',
      'optionView',
      'optionOrder',
      'showIf',
      'minLength',
      'maxLength',
      'minValue',
      'maxValue',
      'minSelected',
      'maxSelected',
      'scaleMin',
      'scaleMax',
      'scaleLeftLabel',
      'scaleRightLabel',
      'withTime',
      'accept',
      'maxFiles',
      'maxFileMb',
      'unitLevel',
      'refKind',
    ]) {
      assert.ok(q.properties[p], p);
    }
    assert.deepEqual(q.properties.refKind.enum, ['vehicle', 'trip', 'object', 'task']);
    assert.deepEqual(q.properties.unitLevel.enum, ['any', 'region', 'firm']);
    assert.deepEqual(q.properties.accept.enum, ['photo', 'docs', 'any']);
    assert.deepEqual(schemas.FormShowIf.properties.mode.enum, ['all', 'any']);
    assert.deepEqual(schemas.FormShowIfCondition.properties.operator.enum, [
      'equals',
      'not_equals',
    ]);
    assert.deepEqual(schemas.FormOption.required, ['key', 'label']);
    assert.ok(schemas.FormOption.properties.score);
    // 0.1 остаётся форматом чек-листа осмотра (W2.52) и тела устаревшей createFormVersion.
    assert.deepEqual(schemas.FormDefinition, src.FormDefinition);
    assert.equal(name(prop('FormVersionCreate', 'definition').$ref), 'FormDefinition');
    assert.equal(name(prop('InspectionChecklist', 'definition').$ref), 'FormDefinition');
  });

  it('Form: черновик без версий, «вся организация» — null, настройки, ссылки, мои права', () => {
    const f = schemas.Form;
    for (const p of Object.keys(src.Form.properties)) assert.ok(f.properties[p], `поле 0.1 ${p}`);
    assert.ok(!f.required.includes('latestVersionId'), 'черновик без версий (D-24 комплекта)');
    for (const p of ['id', 'name', 'status', 'revision']) assert.ok(f.required.includes(p), p);
    assert.deepEqual(f.properties.orgUnitId.type, ['string', 'null']);
    assert.deepEqual(f.properties.status.enum, ['draft', 'published', 'closed']);
    for (const p of [
      'moduleKey',
      'templateId',
      'groupId',
      'owner',
      'updatedAt',
      'publishedVersionNumber',
      'versionCount',
      'hasUnpublishedChanges',
      'questionCount',
      'responseCount',
      'enabledRuleCount',
      'settings',
      'share',
      'my',
    ]) {
      assert.ok(f.required.includes(p), p);
    }
    assert.deepEqual(schemas.FormSettings.properties.access.enum, ['members', 'public']);
    assert.deepEqual(schemas.FormSettings.properties.retainResponsesDays.enum, [90, 365, 1095]);
    assert.deepEqual(props('FormSettingsPatch'), props('FormSettings'));
    assert.equal(schemas.FormSettingsPatch.minProperties, 1);
    assert.deepEqual(schemas.FormShare.required, ['publicToken']);
    assert.deepEqual(schemas.FormMy.required, [
      'create',
      'manage',
      'publish',
      'publishPublic',
      'readResponses',
      'reviewResponses',
      'respond',
    ]);
  });

  it('FormCreate и FormPatch v2 (C п. 13): шаблон или копия, статус open | closed, область, группа, настройки', () => {
    const c = schemas.FormCreate;
    assert.deepEqual(c.required, ['orgUnitId', 'name']);
    for (const p of ['templateId', 'sourceFormId', 'groupId', 'definition']) {
      assert.ok(c.properties[p], p);
    }
    assert.equal(name(c.properties.definition.$ref), 'FormDefinitionV2');
    const p = schemas.FormPatch;
    assert.deepEqual(p.properties.status.enum, ['open', 'closed']);
    assert.equal(p.properties.status.const, undefined);
    assert.deepEqual(Object.keys(p.properties), [
      'name',
      'status',
      'orgUnitId',
      'groupId',
      'settings',
    ]);
    assert.equal(p.minProperties, 1);
    assert.equal(name(p.properties.settings.$ref), 'FormSettingsPatch');
  });

  it('черновик и публикация: ревизия черновика, проблемы до публикации, ревизия черновика в запросе', () => {
    const d = schemas.FormDraft;
    assert.deepEqual(d.required, [
      'formId',
      'definition',
      'revision',
      'hasChanges',
      'baseVersionNumber',
      'issues',
    ]);
    assert.equal(name(d.properties.definition.$ref), 'FormDefinitionV2');
    assert.deepEqual(schemas.FormIssue.required, ['fieldKey', 'message']);
    assert.deepEqual(schemas.FormPublishRequest.required, ['draftRevision']);
    assert.match(
      op('saveFormDraft').description,
      /412 revision_mismatch «Черновик изменил другой редактор — обновите страницу»/,
    );
    assert.match(op('discardFormDraft').description, /«У формы ещё нет опубликованной версии»/);
    for (const t of [
      '«В форме нет ни одного вопроса»',
      '«У вопроса нет текста»',
      '«Найдено ошибок: N. Исправьте их в конструкторе.»',
      'form_no_changes',
      'forms.publish_public',
    ]) {
      assert.ok(op('publishForm').description.includes(t), t);
    }
  });

  it('FormVersion v2: определение v2, автор, число вопросов, «Действует»', () => {
    const v = schemas.FormVersion;
    assert.equal(name(v.properties.definition.$ref), 'FormDefinitionV2');
    for (const p of ['createdBy', 'questionCount', 'current']) assert.ok(v.required.includes(p), p);
    for (const p of src.FormVersion.required) assert.ok(v.required.includes(p), `0.1 ${p}`);
  });

  it('шаблоны и группы: каталог кода (15), доступность модуля, группы организации', () => {
    assert.deepEqual(schemas.FormTemplate.properties.category.enum, [
      'basic',
      'survey',
      'people',
      'quiz',
      'industry',
    ]);
    for (const p of ['moduleKey', 'available', 'pageCount', 'questionCount']) {
      assert.ok(schemas.FormTemplate.required.includes(p), p);
    }
    assert.deepEqual(schemas.FormGroup.required, ['id', 'name', 'formCount']);
    assert.match(
      op('createFormGroup').description,
      /«Название группы — от 2 символов», «Такая группа уже есть»/,
    );
    assert.match(op('deleteFormGroup').description, /form_group_not_empty/);
  });

  it('правила: пять видов, «в БЗ» — узел и таблица W4.04, «задача» — проект W4.03, версия правила', () => {
    assert.deepEqual(schemas.FormRuleKind.enum, ['task', 'notify', 'email', 'http', 'kb']);
    assert.deepEqual(schemas.FormRuleTrigger.enum, ['submitted', 'accepted']);
    const r = schemas.FormRule;
    for (const p of ['task', 'notify', 'email', 'http', 'kb', 'author', 'version', 'condition']) {
      assert.ok(r.properties[p], p);
    }
    assert.equal(name(schemas.FormRuleKb.properties.node.$ref), 'KnowledgeNodeRef');
    assert.match(schemas.FormRuleKb.description, /createKnowledgeNode and createKnowledgeTable/);
    assert.match(schemas.FormRuleKbField.description, /KnowledgeTableColumn\.id of W4\.04/);
    const src = new RegExp(schemas.FormRuleKbField.properties.source.pattern);
    for (const s of ['$at', '$author', '$object', '$id', '$form', '$ver', 'q-odo']) {
      assert.match(s, src, s);
    }
    assert.doesNotMatch('$version', src);
    assert.deepEqual(schemas.FormRuleTask.required, ['projectId', 'title', 'assigneeMemberId']);
    assert.match(schemas.FormRuleTask.description, /Project of W4\.03/);
    assert.equal(schemas.FormRuleHttp.properties.url.pattern, '^https://');
    assert.deepEqual(schemas.FormRuleCondition.properties.fieldKey.type, ['string', 'null']);
    assert.equal(schemas.FormRulePatch.minProperties, 1);
    assert.ok(!schemas.FormRulePatch.properties.kind, 'вид правила не меняется');
  });

  it('ответ v2: номер, версия, автор, объект, канал, баллы, журнал действий; поля 0.1 на месте', () => {
    const r = schemas.FormResponse;
    for (const p of Object.keys(src.FormResponse.properties))
      assert.ok(r.properties[p], `0.1 ${p}`);
    for (const p of src.FormResponse.required) assert.ok(r.required.includes(p), `0.1 ${p}`);
    for (const p of ['number', 'versionNumber', 'author', 'channel', 'actions']) {
      assert.ok(r.required.includes(p), p);
    }
    assert.match('R-1012', new RegExp(r.properties.number.pattern));
    assert.deepEqual(r.properties.channel.enum, ['member', 'public', 'inspection']);
    assert.equal(name(schemas.FormResponseAction.properties.node.$ref), 'KnowledgeNodeRef');
    assert.deepEqual(schemas.FormResponseCreate.required, ['versionId', 'answers']);
    assert.equal(schemas.ChoicesValue.properties.otherText.maxLength, 500);
    assert.equal(schemas.ReferenceValue.properties.label.maxLength, 200);
    assert.deepEqual(schemas.ReferenceValue.required, src.ReferenceValue.required);
    for (const t of ['form_version_changed', 'form_closed', 'form_already_answered']) {
      assert.ok(op('submitFormResponse').description.includes(t), t);
    }
  });

  it('сводка, CSV и варианты CRM; публичная форма — то же определение v2', () => {
    assert.deepEqual(schemas.FormResponseSummary.required, ['formId', 'total', 'questions']);
    assert.equal(name(schemas.FormQuestionSummary.properties.type.$ref), 'FormQuestionType');
    assert.equal(
      schemas.FormResponsesExport.properties.contentType.const,
      'text/csv; charset=utf-8',
    );
    assert.equal(schemas.FormFieldOptionList.properties.items.maxItems, 50);
    assert.equal(name(schemas.PublicForm.properties.definition.$ref), 'FormDefinitionV2');
    assert.ok(schemas.PublicFormPresentation);
  });
});

describe('контракт 0.11.0-stage4 (W4.05): дельты, экраны, примеры, журнал', () => {
  it('дельты W4.05: пути и схемы — add, описания 0.1 — с текстом 0.1 в начале, параметры 0.1 на месте', () => {
    assert.deepEqual(checkAgainstSource(doc, source, loadDeltas()).errors, []);
    const pointers = new Set(w405().map((d) => d.pointer));
    for (const p of [
      `/paths/${escapeToken(`${F}/draft`)}`,
      `/paths/${escapeToken(`${F}/responses`)}/post`,
      `/paths/${escapeToken(`${T}/form-groups`)}`,
      '/components/schemas/FormDefinitionV2',
      '/components/schemas/FormRule',
      '/components/schemas/Form/properties/settings',
      '/components/schemas/FormPatch/properties/status',
      '/components/parameters/formRuleId',
    ]) {
      assert.ok(pointers.has(p), `дельта ${p}`);
    }
    /** Переделка схем 0.1 (C п. 13): объявленные отличия не по описанию. */
    const SCHEMA_CHANGES = [
      '/components/schemas/Form/properties/orgUnitId',
      '/components/schemas/Form/required',
      '/components/schemas/FormCreate/properties/orgUnitId',
      '/components/schemas/FormCreate/properties/name', // описание 3–200 символов, уникальность (D-24 комплекта)
      '/components/schemas/FormCreate/properties/definition',
      '/components/schemas/FormCreate/required',
      '/components/schemas/FormPatch/properties/status',
      '/components/schemas/FormPatch/description',
      '/components/schemas/FormVersion/properties/definition',
      '/components/schemas/FormVersion/required',
      '/components/schemas/FormResponse/required',
      '/components/schemas/PublicForm/properties/definition',
    ];
    const changes = w405().filter((x) => x.kind === 'change' && x.pointer !== '/info/version');
    for (const d of changes) {
      if (SCHEMA_CHANGES.includes(d.pointer)) continue;
      const before = at(source, d.pointer);
      const now = at(doc, d.pointer);
      if (d.pointer.endsWith('/parameters')) {
        assert.deepEqual(now.slice(0, before.length), before, `${d.pointer}: параметры 0.1`);
      } else {
        assert.match(d.pointer, /\/description$/, `${d.pointer}: change не по описанию`);
        assert.ok(now.startsWith(before) && now.length > before.length, d.pointer);
      }
    }
    assert.ok(changes.some((d) => d.pointer === '/components/schemas/FormPatch/properties/status'));
    assert.match(loadDeltas().find((x) => x.pointer === '/info/version').source, /W4\.05/);
  });

  it('screens.yaml: операции экранов «Форм и опросов» этапа 4; устаревшие операции не на экранах', () => {
    const screens = readYaml(SCREENS_PATH).screens;
    const want = {
      'forms-list': [
        'listForms',
        'createForm',
        'listFormTemplates',
        'listFormGroups',
        'createFormGroup',
        'deleteFormGroup',
        'updateForm',
      ],
      'forms-builder': [
        'getForm',
        'getFormDraft',
        'saveFormDraft',
        'discardFormDraft',
        'updateForm',
      ],
      'forms-preview': ['getForm', 'getFormDraft'],
      'modal-form-publish': ['publishForm', 'getFormDraft'],
      'forms-settings': ['getForm', 'updateForm'],
      'forms-responses': [
        'listFormResponses',
        'getFormResponse',
        'reviewFormResponse',
        'getFormResponseSummary',
        'exportFormResponses',
        'retryFormResponseAction',
      ],
      'forms-versions': ['listFormVersions'],
      'modal-form-share': ['getForm'],
      'forms-actions': [
        'listFormRules',
        'createFormRule',
        'updateFormRule',
        'deleteFormRule',
        'backfillFormRule',
        'createKnowledgeNode',
        'createKnowledgeTable',
        'listTaskProjects',
      ],
      'form-fill': ['getForm', 'submitFormResponse', 'listFormFieldOptions'],
    };
    const missing = [];
    for (const [key, list] of Object.entries(want)) {
      const s = screens[key];
      if (!s) {
        missing.push(`${key}: нет экрана`);
        continue;
      }
      assert.equal(s.stage, 4, key);
      for (const o of list) if (!s.operations.includes(o)) missing.push(`${key}: ${o}`);
    }
    assert.deepEqual(missing, []);
    const all = new Set(Object.values(screens).flatMap((s) => s.operations ?? []));
    assert.deepEqual(
      NEW.filter((id) => !all.has(id)),
      [],
      'каждая новая операция — на экране',
    );
    assert.deepEqual(
      DEPRECATED.filter((id) => all.has(id)),
      [],
      'устаревшие операции не на экранах',
    );
  });

  it('примеры валидны; успех и ошибка у каждой новой и переделанной операции экранов', () => {
    const examples = loadExamples();
    assert.deepEqual(checkExamples(doc, examples), []);
    const reg = readYaml(ERRORS_PATH).codes;
    const gaps = [];
    for (const id of [...NEW, ...CHANGED]) {
      const names = [...(examples.get(id)?.keys() ?? [])];
      if (!names.some((n) => n in reg)) gaps.push(`${id}: нет примера ошибки`);
      const noBody = SHAPES.find((s) => s[0] === id)?.[2] === null;
      if (!noBody && !names.some((n) => !(n in reg))) gaps.push(`${id}: нет примера успеха`);
    }
    assert.deepEqual(gaps, []);
    // Сюжет эталона: «Осмотр машины» v3 действует, у формы два ответа «Альты» и правило «в БЗ» au-2.
    const form = examples.get('getForm')?.get('ok');
    assert.equal(form?.name, 'Осмотр машины');
    assert.equal(form?.publishedVersionNumber, 3);
    const rules = examples.get('listFormRules')?.get('ok');
    assert.ok(rules?.items?.some((r) => r.kind === 'kb' && r.kb?.mode === 'table'));
  });

  it('журнал api/CHANGELOG.md и api/README.md: раздел 0.11.0-stage4, tenant 0026 выдан W4.05', () => {
    const log = readFileSync(abs('api/CHANGELOG.md'), 'utf8');
    assert.match(log, /^## 0\.11\.0-stage4 — W4\.05/m);
    assert.ok(
      log.indexOf('## 0.11.0-stage4') < log.indexOf('## 0.10.0-stage4'),
      'новый раздел — сверху',
    );
    const readme = readFileSync(abs('api/README.md'), 'utf8');
    assert.match(readme, /## Этап 4, W4\.05 \(`0\.11\.0-stage4`\)/);
    assert.match(readme, /\|\s*tenant\s*\|\s*0026\s*\|\s*`0026_forms_v2\.sql`[^|]*\|\s*W4\.05/);
    assert.match(readme, /\|\s*tenant\s*\|\s*00(2[7-9]|3\d)–0039\s*\|/);
  });

  it('версия контракта — этап 4, не ниже 0.11.0-stage4 (номер при вливании — интегратор)', () => {
    const m = /^0\.(\d+)\.(\d+)-stage(\d+)$/.exec(doc.info.version);
    assert.ok(m, doc.info.version);
    assert.ok(Number(m[3]) >= 4, doc.info.version);
    assert.ok(Number(m[1]) >= 11, doc.info.version);
  });
});

// Возврат 1 (ревью W4.05): хранение публичного токена, данные гостя, CSV, правила, отправка, проверка ответа.
describe('контракт 0.11.0-stage4 (W4.05, возврат 1): безопасность и согласованность со схемой tenant 0026', () => {
  const migration = readFileSync(abs('backend/migrations/tenant/0026_forms_v2.sql'), 'utf8');

  it('публичный токен не хранится: выводится HMAC-SHA256 ключом FORMS_PUBLIC_LINK_KEY из id ссылки, в БД — дайджест', () => {
    const d = prop('FormShare', 'publicToken').description;
    for (const t of [
      'HMAC-SHA256',
      'FORMS_PUBLIC_LINK_KEY',
      'forms.public_links.id',
      'key_version',
      'token_digest',
    ]) {
      assert.ok(d.includes(t), `FormShare.publicToken: ${t}`);
    }
    assert.match(schemas.PublicForm.description, /token_digest/);
    // Схема и комментарий столбца описывают ту же схему вывода (W4.21, W4.25 читают её из миграции).
    assert.match(migration, /key_version\s+smallint not null default 1/);
    assert.match(
      migration,
      /comment on column forms\.public_links\.token_digest is '[^']*HMAC-SHA256[^']*FORMS_PUBLIC_LINK_KEY/,
    );
  });

  it('гостю публичной формы не отдаются баллы вариантов и значения по умолчанию скрытых вопросов', () => {
    const d = schemas.PublicForm.description;
    assert.ok(d.startsWith(src.PublicForm.description), 'текст 0.1 в начале');
    for (const t of ['FormOption.score', 'defaultValue', 'hidden', 'never']) {
      assert.ok(d.includes(t), `PublicForm: ${t}`);
    }
    assert.match(prop('PublicForm', 'definition').description ?? '', /without FormOption\.score/);
  });

  it('выгрузка CSV: ячейки как у exportDataset (RFC 4180, защита от формул), журнал forms.responses.exported', () => {
    const d = op('exportFormResponses').description;
    for (const t of [
      'CRLF',
      'RFC 4180',
      'CSV formula injection',
      'apostrophe',
      '=, +, -, @, tab or CR',
      'forms.responses.exported',
      'Q-W4.05-15',
    ]) {
      assert.ok(d.includes(t), `exportFormResponses: ${t}`);
    }
    assert.match(schemas.FormResponsesExport.description, /formula injection/);
    assert.equal(ops.get('exportFormResponses').method, 'get', 'GET оставлен (Q-W4.05-15)');
  });

  it('журнал действий: один раз на «ответ × правило» — как PK forms.response_actions', () => {
    for (const s of ['FormRule', 'FormRuleTask']) {
      const d = schemas[s].description;
      assert.match(d, /once per «response × rule»/, s);
      assert.doesNotMatch(d, /version of the rule»/, s);
    }
    assert.match(migration, /primary key \(response_id, rule_id\)/);
  });

  it('отправка: лимит ответов и «Один ответ от сотрудника» — сериализация по строке формы', () => {
    const d = op('submitFormResponse').description;
    assert.ok(d.includes('select … for update'), 'submitFormResponse: select … for update');
    assert.ok(d.includes('forms.forms'), 'submitFormResponse: строка forms.forms');
  });

  it('адрес письма и HTTP-запроса — только с forms.manage; SSRF — до выполнения запросов', () => {
    assert.match(op('listFormRules').description, /email and http .* forms\.manage/);
    assert.match(schemas.FormRule.description, /without forms\.manage/);
    assert.match(schemas.FormRuleHttp.description, /SSRF/);
    assert.match(schemas.FormRuleHttp.description, /loopback/);
  });

  it('новая версия: ключ {key}-v{N} не длиннее 64 знаков; условия правил и источники «в БЗ» не переименовываются', () => {
    const d = schemas.FormVersion.description;
    assert.match(d, /at most 64 characters/);
    assert.match(d, /not remapped/);
  });

  it('проверка ответа: в области формы, назначенному или по связи с объектом у формы «Вся организация»', () => {
    const d = op('reviewFormResponse').description;
    for (const t of ['in the area of the form', 'assignee', 'Вся организация', 'Q-W4.05-16']) {
      assert.ok(d.includes(t), `reviewFormResponse: ${t}`);
    }
  });
});

// Возврат 2 (ревью W4.05): маршрут гостя без tenantId, видимость объекта ответа, скрытые вопросы, пустая проверка,
// право проверки по ответу.
describe('контракт 0.11.0-stage4 (W4.05, возврат 2): маршрут публичного токена и проверки ответа', () => {
  const index = abs('backend/migrations/control/0009_public_form_links.sql');

  it('тенант гостя — по индексу control 0009 public_form_links (дайджест → тенант), токен без части тенанта', () => {
    assert.ok(existsSync(index), 'control 0009_public_form_links.sql');
    const share = prop('FormShare', 'publicToken').description;
    for (const t of [
      'public_form_links',
      'control 0009',
      'ADR 0006',
      'tenant_routing',
      'source of truth',
    ]) {
      assert.ok(share.includes(t), `FormShare.publicToken: ${t}`);
    }
    assert.match(schemas.PublicForm.description, /public_form_links/);
    const p = doc.components.parameters.publicToken.description;
    assert.ok(
      p.startsWith(source.components.parameters.publicToken.description),
      'текст 0.1 в начале',
    );
    assert.match(p, /public_form_links/);
    const readme = readFileSync(abs('api/README.md'), 'utf8');
    assert.match(
      readme,
      /\|\s*control\s*\|\s*0009\s*\|\s*`0009_public_form_links\.sql`[^|]*\|\s*W4\.05/,
    );
    assert.match(readme, /\|\s*control\s*\|\s*0010\+\s*\|/);
  });

  it('объект ответа и ответы-ссылки — только видимые отвечающему; иначе 422 «Объект не найден»', () => {
    const d = prop('FormResponseCreate', 'subject').description ?? '';
    for (const t of ['sees', 'tasks.read', '422', 'Объект не найден', 'label']) {
      assert.ok(d.includes(t), `FormResponseCreate.subject: ${t}`);
    }
    const a = prop('FormResponseCreate', 'answers').description ?? '';
    for (const t of ['person', 'unit', 'ref', 'listFormFieldOptions', 'Сотрудник не найден']) {
      assert.ok(a.includes(t), `FormResponseCreate.answers: ${t}`);
    }
  });

  it('значение скрытого вопроса — только из defaultValue и параметра ссылки: ключ в answers — 422', () => {
    const a = prop('FormResponseCreate', 'answers').description ?? '';
    assert.match(a, /hidden question .* 422/);
    assert.match(
      prop('FormResponseCreate', 'linkParams').description,
      /only from defaultValue or linkParams/,
    );
  });

  it('пустой PATCH проверки ответа — 422 (minProperties: 1)', () => {
    assert.equal(schemas.ResponseReviewPatch.minProperties, 1);
    assert.match(schemas.ResponseReviewPatch.description, /empty body — 422/);
  });

  it('право проверки — у ответа (FormResponse.my): назначенный видит «Принять», «Отклонить», хотя у формы — нет', () => {
    assert.ok(schemas.FormResponse.required.includes('my'), 'FormResponse.my обязателен');
    assert.equal(name(prop('FormResponse', 'my').$ref), 'FormResponseMy');
    assert.deepEqual(Object.keys(schemas.FormResponseMy.properties).sort(), ['assign', 'review']);
    assert.deepEqual([...schemas.FormResponseMy.required].sort(), ['assign', 'review']);
    assert.match(schemas.FormResponseMy.description, /Q-W4\.05-16/);
    assert.match(prop('FormMy', 'reviewResponses').description, /FormResponse\.my/);
  });
});

// Возврат 3 (ревью W4.05): параметры ссылки и скрытые вопросы у гостя, «ответ × правило» во всех текстах,
// гонка «Повторить» и переноса, длина имени формы и группы.
describe('контракт 0.11.0-stage4 (W4.05, возврат 3): параметры ссылки гостя, гонка действий, длина имени', () => {
  it('гость присылает параметры ссылки в PublicResponseCreate.linkParams — та же схема, что у сотрудника', () => {
    const pub = prop('PublicResponseCreate', 'linkParams');
    assert.ok(pub, 'PublicResponseCreate.linkParams');
    const member = prop('FormResponseCreate', 'linkParams');
    for (const k of ['type', 'maxProperties', 'additionalProperties']) {
      assert.deepEqual(pub[k], member[k], `linkParams.${k} — как FormResponseCreate`);
    }
    assert.equal(pub.maxProperties, 50);
    assert.equal(pub.additionalProperties.maxLength, 500);
    for (const t of ['hidden', 'never CRM and file', 'Q-W4.00-forms-20', 'not_hidden', '422']) {
      assert.ok(pub.description.includes(t), `PublicResponseCreate.linkParams: ${t}`);
    }
    assert.ok(!schemas.PublicResponseCreate.required.includes('linkParams'), 'необязательно');
  });

  it('ключ скрытого вопроса в answers гостя — 422 hidden: defaultValue и параметр ссылки гость не подменяет', () => {
    const a = prop('PublicResponseCreate', 'answers').description ?? '';
    assert.match(a, /hidden question .* 422/);
    for (const t of ['code hidden', 'defaultValue', 'linkParams']) {
      assert.ok(a.includes(t), `PublicResponseCreate.answers: ${t}`);
    }
    const d = schemas.PublicResponseCreate.description;
    assert.ok(d.startsWith(src.PublicResponseCreate.description), 'текст 0.1 в начале');
    for (const t of ['linkParamKeys', 'link_param_keys', 'public']) {
      assert.ok(d.includes(t), `PublicResponseCreate: ${t}`);
    }
    // Страница гостя берёт ?{key}=… из своего адреса и отдаёт их при отправке.
    assert.match(schemas.PublicForm.description, /PublicResponseCreate\.linkParams/);
  });

  it('журнал действий — «ответ × правило» и в backfillFormRule, и в api/README.md', () => {
    const b = op('backfillFormRule').description;
    assert.doesNotMatch(b, /version of the rule»/);
    assert.match(b, /«response × rule»/);
    const readme = readFileSync(abs('api/README.md'), 'utf8');
    const w405 = readme.slice(readme.indexOf('## Этап 4, W4.05'));
    const rule = w405.split('\n').find((l) => l.includes('(`FormRule`)')) ?? '';
    assert.doesNotMatch(rule, /версия правила/);
    assert.match(rule, /«ответ × правило»/);
  });

  it('«Повторить» и перенос: строка forms.response_actions блокируется в транзакции действия', () => {
    for (const id of ['retryFormResponseAction', 'backfillFormRule']) {
      const d = op(id).description;
      for (const t of [
        'on conflict',
        'select … for update',
        'same transaction',
        'Idempotency-Key',
        'forms.response_actions',
      ]) {
        assert.ok(d.includes(t), `${id}: ${t}`);
      }
    }
  });

  it('длина имени формы и группы: minLength 0.1 остаётся, сервер проверяет после обрезки пробелов — 422', () => {
    const cases = [
      ['FormCreate', 'Укажите название формы — не короче 3 символов'],
      ['FormPatch', 'Название формы — не короче 3 символов'],
      ['FormGroupCreate', 'Название группы — от 2 символов'],
    ];
    for (const [s, text] of cases) {
      const p = prop(s, 'name');
      assert.equal(p.minLength, 1, `${s}.name: minLength 1`);
      const d = p.description ?? '';
      for (const t of ['trimmed', '422 validation_failed', text, 'before the insert']) {
        assert.ok(d.includes(t), `${s}.name: ${t}`);
      }
    }
  });
});

// Строки изоляции у каждой новой и переделанной операции (README матрицы): без сессии — 401, владелец чужой
// организации — 404 (AC-02), шлюз без права x-permissions — 403 forbidden_action. Устаревшие операции 0.1 тоже
// маршрутизируются (409 form_draft_flow) — у них те же строки (возврат 1).
describe('строки изоляции W4.05 (backend/test/isolation/forms_w405*.yaml)', () => {
  const FILES = ['forms_w405', 'forms_w405_gate'];
  const endpoints = FILES.flatMap((f) => {
    const path = abs(`backend/test/isolation/${f}.yaml`);
    return existsSync(path) ? readYaml(path).endpoints.map((e) => ({ ...e, file: f })) : [];
  });

  it('у каждой из 18 новых, 8 переделанных и 2 устаревших операций: 401 без сессии, 404 чужой организации, 403 шлюза', () => {
    const missing = [];
    for (const id of [...NEW, ...CHANGED, ...DEPRECATED]) {
      const rows = endpoints.filter((e) => e.op === id).flatMap((e) => e.rows);
      if (!rows.some((r) => r.actor === 'anonymous' && r.status === 401)) {
        missing.push(`${id}: 401 anonymous`);
      }
      if (
        !rows.some(
          (r) => r.actor === 'b.owner' && r.status === 404 && r.params?.tenantId === 'tenant:a',
        )
      ) {
        missing.push(`${id}: 404 b.owner → tenant:a`);
      }
      if (
        id !== 'reviewFormResponse' &&
        !rows.some((r) => r.status === 403 && r.code === 'forbidden_action')
      ) {
        missing.push(`${id}: 403 forbidden_action`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it('метод и путь строк — как в контракте; без pending — хендлеры тегов Forms и PublicForms написал W4.21', () => {
    const wrong = [];
    for (const e of endpoints) {
      const o = ops.get(e.op);
      if (!o) {
        wrong.push(`${e.file}/${e.op}: нет в контракте`);
        continue;
      }
      // Ключ вопроса — не UUID: в строке пути — литерал (как ключ перехода у W4.03).
      const re = new RegExp(
        `^${o.path
          .replace(/[.*+?^$()|[\]\\]/g, '\\$&')
          .replace(/\{fieldKey\}/g, '[a-zA-Z][a-zA-Z0-9_-]*')}(\\?.*)?$`,
      );
      if (e.method.toLowerCase() !== o.method || !re.test(e.path)) {
        wrong.push(`${e.file}/${e.op}: ${e.method} ${e.path} ≠ ${o.method} ${o.path}`);
      }
      if (e.pending !== undefined) {
        wrong.push(
          `${e.file}/${e.op}: pending ${e.pending} — хендлеры тега Forms уже есть (W4.21)`,
        );
      }
    }
    assert.deepEqual(wrong, []);
  });
});
