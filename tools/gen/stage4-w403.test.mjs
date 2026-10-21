// W4.03 · Контрактный PR 2 этапа 4 (0.10.0-stage4, номер версии согласует интегратор): «Задачи и проекты» — проекты с
// уровнем доступа и процессом, участники (роли с областью project), процесс с версиями и черновиком, задачи с
// переходами, согласованием и отказом, чек-листом, иерархией, вложениями, историей и комментарием, автоматизация с
// журналом запусков. Эталон — «Задачи и проекты.dc.html» (design-2026-10-19); разбор docs/plan/v2/analysis/dor/tasks.md
// §2.2, §2.5, §3; домен W4.10. Бриф docs/plan/v2/ws/W4.03.md §4.
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

const T = '/api/v1/tenants/{tenantId}';
const P = `${T}/projects/{projectId}`;
const K = `${T}/tasks/{taskId}`;
const PRJ = 'tenant-org-unit-project';
const SELF = 'tenant-org-unit-project-self';

/** [operationId, метод, путь, x-permissions, x-scope, x-permissions-mode] — бриф W4.03 §4. */
const OPS = [
  ['getTaskProject', 'get', P, ['tasks.projects.read'], PRJ, 'all'],
  ['updateTaskProject', 'patch', P, ['tasks.projects.manage', 'tasks.members.manage'], PRJ, 'any'],
  ['initTaskProjectWorkflow', 'post', `${P}/workflow/init`, ['tasks.workflow.manage'], PRJ, 'all'],
  ['getTaskWorkflow', 'get', `${P}/workflow`, ['tasks.projects.read'], PRJ, 'all'],
  ['saveTaskWorkflowDraft', 'put', `${P}/workflow/draft`, ['tasks.workflow.manage'], PRJ, 'all'],
  [
    'discardTaskWorkflowDraft',
    'delete',
    `${P}/workflow/draft`,
    ['tasks.workflow.manage'],
    PRJ,
    'all',
  ],
  [
    'publishTaskWorkflow',
    'post',
    `${P}/workflow/draft/publish`,
    ['tasks.workflow.manage'],
    PRJ,
    'all',
  ],
  ['listTaskProjectMembers', 'get', `${P}/members`, ['tasks.projects.read'], PRJ, 'all'],
  [
    'setTaskProjectMemberRole',
    'put',
    `${P}/members/{memberId}`,
    ['tasks.members.manage'],
    PRJ,
    'all',
  ],
  [
    'removeTaskProjectMember',
    'delete',
    `${P}/members/{memberId}`,
    ['tasks.members.manage'],
    PRJ,
    'all',
  ],
  [
    'checkTaskProjectAccess',
    'get',
    `${P}/members/{memberId}/access`,
    ['tasks.members.manage', 'members.read'],
    PRJ,
    'any',
  ],
  ['listTaskAutomations', 'get', `${P}/automations`, ['tasks.projects.read'], PRJ, 'all'],
  ['createTaskAutomation', 'post', `${P}/automations`, ['tasks.automation.manage'], PRJ, 'all'],
  [
    'updateTaskAutomation',
    'patch',
    `${P}/automations/{automationId}`,
    ['tasks.automation.manage'],
    PRJ,
    'all',
  ],
  [
    'deleteTaskAutomation',
    'delete',
    `${P}/automations/{automationId}`,
    ['tasks.automation.manage'],
    PRJ,
    'all',
  ],
  ['listTaskAutomationRuns', 'get', `${P}/automation-runs`, ['tasks.projects.read'], PRJ, 'all'],
  [
    'updateTaskChecklistItem',
    'patch',
    `${K}/checklist/{checklistItemId}`,
    ['tasks.update'],
    SELF,
    'all',
  ],
  [
    'rejectTaskApproval',
    'post',
    `${K}/approvals/{transitionKey}/reject`,
    ['tasks.approve'],
    PRJ,
    'all',
  ],
  ['setTaskParent', 'put', `${K}/parent`, ['tasks.update'], SELF, 'all'],
  ['attachTaskFiles', 'post', `${K}/files`, ['tasks.update'], SELF, 'all'],
  [
    'removeTaskFile',
    'delete',
    `${K}/files/{fileId}`,
    ['tasks.update', 'tasks.projects.manage'],
    SELF,
    'any',
  ],
  ['commentTask', 'post', `${K}/comments`, ['tasks.read'], SELF, 'all'],
  ['listTaskHistory', 'get', `${K}/history`, ['tasks.read'], SELF, 'all'],
];
const NEW = OPS.map((o) => o[0]);
/** Операции 0.1, которые PR расширяет (схемы, параметры, описания). */
const CHANGED = [
  'listTaskProjects',
  'createTaskProject',
  'listTasks',
  'getTask',
  'createTask',
  'updateTask',
  'transitionTask',
];
const COMMANDS = OPS.filter((o) => o[1] !== 'get').map((o) => o[0]);
const IF_MATCH = [
  'updateTaskProject',
  'saveTaskWorkflowDraft',
  'discardTaskWorkflowDraft',
  'publishTaskWorkflow',
  'updateTaskAutomation',
  'deleteTaskAutomation',
  'updateTaskChecklistItem',
  'rejectTaskApproval',
  'setTaskParent',
  'attachTaskFiles',
  'removeTaskFile',
];
/** Ответ успеха: [operationId, статус, схема тела | null, схема запроса | null]. */
const SHAPES = [
  ['getTaskProject', '200', 'Project', null],
  ['updateTaskProject', '200', 'Project', 'TaskProjectPatch'],
  ['initTaskProjectWorkflow', '200', 'TaskWorkflow', null],
  ['getTaskWorkflow', '200', 'TaskWorkflow', null],
  ['saveTaskWorkflowDraft', '200', 'TaskWorkflow', 'TaskWorkflowDraftInput'],
  ['discardTaskWorkflowDraft', '200', 'TaskWorkflow', null],
  ['publishTaskWorkflow', '200', 'TaskWorkflow', null],
  ['listTaskProjectMembers', '200', 'TaskProjectMemberList', null],
  ['setTaskProjectMemberRole', '200', 'TaskProjectMember', 'TaskProjectMemberRoleSet'],
  ['removeTaskProjectMember', '204', null, null],
  ['checkTaskProjectAccess', '200', 'TaskProjectAccessCheck', null],
  ['listTaskAutomations', '200', 'TaskAutomationList', null],
  ['createTaskAutomation', '201', 'TaskAutomation', 'TaskAutomationCreate'],
  ['updateTaskAutomation', '200', 'TaskAutomation', 'TaskAutomationPatch'],
  ['deleteTaskAutomation', '204', null, null],
  ['listTaskAutomationRuns', '200', 'TaskAutomationRunList', null],
  ['updateTaskChecklistItem', '200', 'Task', 'TaskChecklistItemPatch'],
  ['rejectTaskApproval', '200', 'Task', 'TaskApprovalRejection'],
  ['setTaskParent', '200', 'Task', 'TaskParentSet'],
  ['attachTaskFiles', '200', 'Task', 'TaskFilesAttach'],
  ['removeTaskFile', '200', 'Task', null],
  ['commentTask', '201', 'TaskHistoryEntry', 'TaskCommentCreate'],
  ['listTaskHistory', '200', 'TaskHistoryPage', null],
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
const w403 = () => loadDeltas().filter((d) => /W4\.03/.test(d.source));
const was = (id) => {
  const o = ops.get(id);
  return source.paths[o.path][o.method].description;
};
const props = (s) => Object.keys(schemas[s]?.properties ?? {});
const enumOf = (s, p) => {
  const x = schemas[s]?.properties?.[p];
  return x?.enum ?? schemas[name(x?.$ref)]?.enum ?? schemas[name(x?.items?.$ref)]?.enum;
};

describe('контракт 0.10.0-stage4 (W4.03): операции и права', () => {
  it('23 новые операции тега Tasks: метод, путь, x-permissions, x-scope, режим', () => {
    const wrong = [];
    for (const [id, method, path, perms, scope, mode] of OPS) {
      const o = ops.get(id);
      if (!o) {
        wrong.push(`${id}: нет в бандле`);
        continue;
      }
      const got = [o.method, o.path, o.tag, o.op['x-permissions'], o.op['x-scope']];
      const want = [method, path, 'Tasks', perms, scope];
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        wrong.push(`${id}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
      }
      if ((o.op['x-permissions-mode'] ?? 'all') !== mode) wrong.push(`${id}: режим ≠ ${mode}`);
    }
    assert.deepEqual(wrong, []);
  });

  // Возврат 1 (ревью, major): «Согласующий» проекта (project_approver: tasks.approve без tasks.transition) голосует
  // через transitionTask — шлюз пускает по любому из двух прав (tasks.md §2.2 «tasks.transition (+ tasks.approve для
  // согласующего)»); какое право нужно для перехода, решает хендлер: согласование — tasks.approve, остальное —
  // tasks.transition.
  it('transitionTask: tasks.transition или tasks.approve (режим any) — голос согласующего проходит шлюз', () => {
    const o = op('transitionTask');
    assert.deepEqual(o['x-permissions'], ['tasks.transition', 'tasks.approve']);
    assert.equal(o['x-permissions-mode'], 'any');
    assert.equal(o['x-scope'], SELF, 'область 0.1 та же');
    const post = `/paths/${escapeToken(`${K}/transitions`)}/post`;
    const changes = new Set(
      w403()
        .filter((d) => d.kind === 'change')
        .map((d) => d.pointer),
    );
    for (const p of [`${post}/x-permissions`, `${post}/x-permissions-mode`]) {
      assert.ok(changes.has(p), `дельта change ${p}`);
    }
    for (const w of [
      'x-permissions-mode any',
      'project_approver',
      'tasks.transition for any other',
    ]) {
      assert.ok(o.description.includes(w), `transitionTask: ${w}`);
    }
  });

  // Возврат 1 (ревью): роль в проекте — без ревизии; две правки одновременно — побеждает последняя (Q-W4.03-10).
  it('роль в проекте без If-Match: последняя правка побеждает — записано в описаниях', () => {
    for (const id of ['setTaskProjectMemberRole', 'removeTaskProjectMember']) {
      assert.equal(param(id, 'header', 'If-Match'), undefined, `${id}: без If-Match`);
      assert.match(op(id).description, /last write wins[^.]*Q-W4\.03-10/, id);
    }
  });

  it('команды: Idempotency-Key, X-CSRF-Token, Origin, x-csrf, ответы; If-Match — у правок с ревизией', () => {
    const gaps = [];
    for (const id of COMMANDS) {
      if (!op(id)) {
        gaps.push(`${id}: нет`);
        continue;
      }
      if (param(id, 'header', 'Idempotency-Key')?.required !== true) {
        gaps.push(`${id}: Idempotency-Key`);
      }
      if (!param(id, 'header', 'X-CSRF-Token')) gaps.push(`${id}: X-CSRF-Token`);
      if (!param(id, 'header', 'Origin')) gaps.push(`${id}: Origin`);
      if (op(id)['x-csrf-required-for-cookie'] !== true) gaps.push(`${id}: x-csrf`);
      for (const s of ['400', '401', '403', '404', '409', '422', '429']) {
        if (!op(id).responses[s]) gaps.push(`${id}: ответ ${s}`);
      }
      const im = param(id, 'header', 'If-Match');
      if (IF_MATCH.includes(id) !== (im?.required === true)) gaps.push(`${id}: If-Match`);
      if (IF_MATCH.includes(id)) {
        for (const s of ['412', '428']) if (!op(id).responses[s]) gaps.push(`${id}: ответ ${s}`);
      }
    }
    for (const id of NEW.filter((x) => !COMMANDS.includes(x))) {
      if (!op(id)) continue;
      for (const s of ['400', '401', '403', '404', '429']) {
        if (!op(id).responses[s]) gaps.push(`${id}: ответ ${s}`);
      }
    }
    assert.deepEqual(gaps, []);
  });

  it('тела запросов и ответов; ETag у чтения и правки проекта, процесса, правила и задачи', () => {
    const wrong = [];
    for (const [id, status, ok, body] of SHAPES) {
      if (!op(id)) {
        wrong.push(`${id}: нет`);
        continue;
      }
      if (!op(id).responses[status]) wrong.push(`${id}: нет ответа ${status}`);
      if (ok && okOf(id, status) !== ok) wrong.push(`${id}: ${okOf(id, status)} ≠ ${ok}`);
      if ((bodyOf(id) ?? null) !== body) wrong.push(`${id}: тело ${bodyOf(id)} ≠ ${body}`);
      const etag = ['Project', 'TaskWorkflow', 'TaskAutomation', 'Task'].includes(ok);
      if (etag && !op(id).responses[status].headers?.ETag) wrong.push(`${id}: ETag`);
    }
    assert.deepEqual(wrong, []);
  });

  it('параметры пути projectId, automationId, checklistItemId, transitionKey', () => {
    const P2 = doc.components.parameters;
    for (const [p, id] of [
      ['projectId', 'getTaskProject'],
      ['automationId', 'updateTaskAutomation'],
      ['checklistItemId', 'updateTaskChecklistItem'],
      ['transitionKey', 'rejectTaskApproval'],
    ]) {
      assert.ok(param(id, 'path', p)?.required, `параметр пути ${p}`);
      assert.ok(P2[p], `components/parameters/${p}`);
    }
    assert.equal(name(P2.projectId.schema.$ref), 'Id');
    assert.equal(name(P2.automationId.schema.$ref), 'Id');
    assert.match('ch-1', new RegExp(P2.checklistItemId.schema.pattern));
    assert.match('t3', new RegExp(P2.transitionKey.schema.pattern));
    assert.doesNotMatch('T 3', new RegExp(P2.transitionKey.schema.pattern));
  });

  it('права: ключей не прибавилось, tasks.projects.manage получил область project (Q-W4.00-tasks-6)', () => {
    const actions = flattenActions(loadCatalog());
    // W4.03 своих ключей не добавляет: 125 — после W2.71 (fleet.reservations.choose) и W4.07 (branding.manage);
    // W4.04 (влит раньше) — ещё 5 ключей «Базы знаний»: 130.
    assert.equal(actions.size, 130);
    assert.deepEqual(actions.get('tasks.projects.manage').scopes, ['tenant', 'unit', 'project']);
    for (const [k, scopes] of [
      ['tasks.read', ['tenant', 'unit', 'project', 'self']],
      ['tasks.approve', ['tenant', 'unit', 'project']],
      ['tasks.members.manage', ['tenant', 'unit', 'project']],
      ['tasks.workflow.manage', ['tenant', 'unit', 'project']],
      ['tasks.automation.manage', ['tenant', 'unit', 'project']],
    ]) {
      assert.deepEqual(actions.get(k).scopes, scopes, k);
    }
    assert.equal(
      op('createTaskProject')['x-scope'],
      'tenant-or-org-unit',
      'создание — не из роли проекта',
    );
    assert.deepEqual(op('updateTaskProject')['x-field-permissions'], {
      name: 'tasks.projects.manage',
      access: 'tasks.members.manage',
    });
    assert.equal(doc.tags.length, 21, 'тег Branding — W4.07; W4.03 тегов не добавляет');
  });

  it('ошибки: кодов не прибавилось; причины invalid_transition — workflow_exists, funnel_fixed', () => {
    const reg = readYaml(ERRORS_PATH);
    // W4.03 кодов не добавляет: 53 — после W2.71 (offer_closed).
    assert.equal(Object.keys(reg.codes).length, 53);
    const reasons = reg.codes.invalid_transition.reasons;
    for (const r of ['workflow_exists', 'funnel_fixed']) {
      assert.ok(reasons[r]?.title, r);
      assert.match(reasons[r].source, /W4\.03/, r);
    }
    for (const r of [
      'not_in_status',
      'checklist_open',
      'children_open',
      'author_forbidden',
      'already_voted',
      'doc_route',
    ]) {
      assert.ok(reasons[r], `причина W4.02 ${r} на месте`);
    }
  });
});

describe('контракт 0.10.0-stage4 (W4.03): проекты', () => {
  it('Project: доступ, воронка, владелец, процесс, счётчики, мой доступ; поля 0.1 на месте', () => {
    for (const p of Object.keys(src.Project.properties)) assert.ok(props('Project').includes(p), p);
    assert.deepEqual(schemas.Project.required, src.Project.required, 'required 0.1');
    for (const p of [
      'access',
      'flow',
      'ownerMemberId',
      'ownerDisplayName',
      'workflow',
      'counts',
      'myAccess',
    ]) {
      assert.ok(props('Project').includes(p), p);
    }
    assert.deepEqual(enumOf('Project', 'access'), ['open', 'limited', 'closed']);
    assert.deepEqual(enumOf('Project', 'flow'), ['tasks', 'leads']);
    assert.deepEqual(schemas.Project.properties.orgUnitId.type, ['string', 'null']);
    assert.deepEqual(schemas.TaskProjectWorkflowSummary.required, ['version', 'hasDraft']);
    assert.deepEqual(schemas.TaskProjectCounts.required, ['members', 'open']);
    const my = schemas.TaskProjectMyAccess;
    assert.deepEqual(my.required, ['actions', 'roleName', 'source', 'via']);
    assert.deepEqual(my.properties.source.enum, ['assigned', 'group', 'inherited', 'system']);
    const d = op('listTaskProjects').description;
    assert.ok(d.startsWith(was('listTaskProjects')), 'текст 0.1');
    for (const w of ['TP-03', 'closed', 'limited', 'leads', 'Проектов, доступных вам, пока нет']) {
      assert.ok(d.includes(w), `listTaskProjects: ${w}`);
    }
  });

  it('ProjectCreate: ключ кириллицей 2–6, «вся организация» — null, шаблон процесса, копия, уровень доступа', () => {
    const c = schemas.ProjectCreate;
    const key = new RegExp(c.properties.key.pattern);
    for (const ok of ['LOG', 'ЗАЯ', 'РЧН', 'ДОК2', 'AB']) assert.match(ok, key, ok);
    for (const bad of ['A', 'ABCDEFG', '1AB', 'log']) assert.doesNotMatch(bad, key, bad);
    assert.deepEqual(c.properties.orgUnitId.type, ['string', 'null']);
    assert.deepEqual(c.properties.workflowKey.enum, ['simple', 'approval', 'copy']);
    assert.equal(name(c.properties.copyFromProjectId.$ref), 'Id');
    assert.equal(c.properties.access.default, 'limited');
    assert.deepEqual(c.required, src.ProjectCreate.required, 'required 0.1');
    const d = op('createTaskProject').description;
    assert.ok(d.startsWith(was('createTaskProject')), 'текст 0.1');
    for (const w of [
      'project_manager',
      'Название — не короче 3 символов',
      'Ключ {K} уже занят',
      'Выберите проект, процесс которого копировать',
      'disabled',
    ]) {
      assert.ok(d.includes(w), `createTaskProject: ${w}`);
    }
  });

  it('правка проекта, «Настроить процесс» (TP-06), участники и «Проверить доступ»', () => {
    assert.equal(schemas.TaskProjectPatch.minProperties, 1);
    assert.deepEqual(Object.keys(schemas.TaskProjectPatch.properties), ['name', 'access']);
    const init = op('initTaskProjectWorkflow').description;
    for (const w of ['TP-06', 'workflow_exists', 'Новая, В работе, На проверке, Готово']) {
      assert.ok(init.includes(w), `initTaskProjectWorkflow: ${w}`);
    }
    const m = schemas.TaskProjectMember;
    for (const f of ['memberId', 'displayName', 'roleName', 'source', 'via', 'actions']) {
      assert.ok(m.required.includes(f), `TaskProjectMember.${f}`);
    }
    assert.deepEqual(m.properties.source.enum, ['assigned', 'group', 'inherited', 'system']);
    assert.ok(m.properties.functionNotes, 'functionNotes («финансы скрыты»)');
    assert.deepEqual(schemas.TaskProjectMemberList.required, ['items', 'roles']);
    assert.deepEqual(schemas.TaskProjectMemberRoleSet.required, ['roleId']);
    const set = op('setTaskProjectMemberRole').description;
    for (const w of [
      'В проекте назначаются роли проекта',
      'заблокирован — назначить роль нельзя',
    ]) {
      assert.ok(set.includes(w), `setTaskProjectMemberRole: ${w}`);
    }
    const chk = schemas.TaskProjectAccessCheck;
    assert.deepEqual(chk.required, ['memberId', 'action', 'allowed']);
    const action = param('checkTaskProjectAccess', 'query', 'action');
    assert.equal(action?.required, true);
    assert.ok(action.schema.enum.includes('tasks.approve'));
    const why = op('checkTaskProjectAccess').description;
    for (const w of [
      'Q-W4.00-tasks-7',
      'закрытый проект — нужна роль в самом проекте',
      'в ограниченном проекте унаследованный доступ — только чтение',
    ]) {
      assert.ok(why.includes(w), `checkTaskProjectAccess: ${w}`);
    }
  });
});

describe('контракт 0.10.0-stage4 (W4.03): процесс с версиями', () => {
  it('TaskWorkflow: версия, статусы, переходы, черновик, неизменяемая воронка', () => {
    const w = schemas.TaskWorkflow;
    assert.deepEqual(w.required, [
      'projectId',
      'version',
      'statuses',
      'transitions',
      'fixed',
      'revision',
    ]);
    assert.equal(name(w.properties.draft.$ref), 'TaskWorkflowDraft');
    const s = schemas.TaskWorkflowStatus;
    assert.deepEqual(s.required, ['id', 'name', 'category']);
    assert.deepEqual(enumOf('TaskWorkflowStatus', 'category'), ['todo', 'progress', 'done']);
    const t = schemas.TaskWorkflowTransition;
    for (const f of [
      'key',
      'name',
      'from',
      'to',
      'who',
      'notAuthor',
      'commentRequired',
      'checklistClosed',
      'childrenDone',
      'assignAuthor',
    ]) {
      assert.ok(t.required.includes(f), `TaskWorkflowTransition.${f}`);
    }
    assert.deepEqual(t.properties.who.items.enum, [
      'project_manager',
      'project_approver',
      'project_executor',
      'assignee',
      'author',
    ]);
    assert.deepEqual(schemas.TaskWorkflowApproval.properties.mode.enum, ['any', 'all']);
    assert.deepEqual(schemas.TaskWorkflowDraftInput.required, ['statuses', 'transitions']);
  });

  it('публикация: нарушения эталона дословно, задачи остаются в своих статусах, правила на удалённый статус', () => {
    const d = op('publishTaskWorkflow').description;
    for (const w of [
      'Изменений нет',
      'У статуса нет названия',
      'Названия статусов повторяются',
      'Нужен хотя бы один статус категории «Готово»',
      'ссылается на удалённый статус или без названия',
      'Есть задачи в статусах, которых нет в новой версии',
      'Q-W4.00-tasks-13',
      'funnel_fixed',
    ]) {
      assert.ok(d.includes(w), `publishTaskWorkflow: ${w}`);
    }
    assert.match(op('saveTaskWorkflowDraft').description, /funnel_fixed/);
  });
});

describe('контракт 0.10.0-stage4 (W4.03): задачи', () => {
  it('Task: номер, статус процесса, приоритет, метки, автор, чек-лист, вложения, связи, согласование, переходы', () => {
    for (const p of Object.keys(src.Task.properties)) assert.ok(props('Task').includes(p), p);
    assert.deepEqual(schemas.Task.required, src.Task.required, 'required 0.1');
    for (const p of [
      'key',
      'statusName',
      'statusCategory',
      'workflowVersion',
      'priority',
      'labels',
      'authorMemberId',
      'authorDisplayName',
      'assigneeDisplayName',
      'checklist',
      'files',
      'parent',
      'children',
      'approval',
      'availableTransitions',
      'docRoute',
    ]) {
      assert.ok(props('Task').includes(p), `Task.${p}`);
    }
    assert.deepEqual(enumOf('Task', 'priority'), ['urgent', 'high', 'normal', 'low']);
    assert.equal(schemas.Task.properties.labels.maxItems, 10);
    // Метки «Через запятую»: сервер обрезает и приводит к нижнему регистру — запрос с заглавными допустим.
    assert.match(' Тормоза ', new RegExp(schemas.TaskLabel.pattern));
    assert.doesNotMatch('шины, закупка', new RegExp(schemas.TaskLabel.pattern));
    assert.match('T-65', new RegExp(schemas.Task.properties.key.pattern));
    assert.match('ЗАЯ-101', new RegExp(schemas.Task.properties.key.pattern));
    assert.deepEqual(schemas.TaskParentRef.properties.state.enum, ['visible', 'hidden', 'deleted']);
    // Возврат 1 (ревью): id задачи, которую участник не видит, не отдаётся — ни parent.taskId, ни Task.parentTaskId.
    assert.deepEqual(schemas.TaskParentRef.required, ['state']);
    assert.match(schemas.TaskParentRef.description, /hidden[^.]*no taskId/);
    assert.match(schemas.Task.properties.parentTaskId.description ?? '', /hidden/);
    assert.deepEqual(schemas.TaskChildrenSummary.required, ['total', 'done', 'hidden']);
    const ap = schemas.TaskApprovalState;
    for (const f of ['transitionKey', 'mode', 'workflowVersion', 'approvers', 'canReject']) {
      assert.ok(ap.required.includes(f), `TaskApprovalState.${f}`);
    }
    assert.deepEqual(schemas.TaskApprover.properties.state.enum, ['approved', 'waiting']);
    const o = schemas.TaskTransitionOption;
    for (const f of ['key', 'name', 'toStatusId', 'approval', 'commentRequired', 'allowed']) {
      assert.ok(o.required.includes(f), `TaskTransitionOption.${f}`);
    }
    assert.ok(o.properties.reason && o.properties.reasonText, 'причина недоступности');
    const at2 = schemas.TaskAttachment;
    for (const f of ['fileId', 'name', 'sizeBytes', 'contentType', 'uploadedByMemberId']) {
      assert.ok(at2.required.includes(f), `TaskAttachment.${f}`);
    }
  });

  it('TaskCreate и TaskPatch: приоритет и метки; поля 0.1 на месте', () => {
    for (const s of ['TaskCreate', 'TaskPatch']) {
      for (const p of Object.keys(src[s].properties)) assert.ok(props(s).includes(p), `${s}.${p}`);
      assert.deepEqual(enumOf(s, 'priority'), ['urgent', 'high', 'normal', 'low'], s);
      assert.equal(schemas[s].properties.labels.maxItems, 10, s);
    }
    assert.deepEqual(schemas.TaskCreate.required, src.TaskCreate.required);
    for (const w of ['Тема — не короче 3 символов', 'Описание — не длиннее 5000 символов']) {
      assert.ok(op('createTask').description.includes(w), `createTask: ${w}`);
    }
  });

  it('listTasks: фильтры доски — проект, мои, ждут моего согласия, подзадачи; параметры 0.1 на месте', () => {
    const names = params('listTasks').map((p) => p.name);
    assert.deepEqual(names.slice(0, 3), ['tenantId', 'cursor', 'limit']);
    for (const n of ['projectId', 'assignee', 'awaitingMyApproval', 'parentTaskId']) {
      const p = param('listTasks', 'query', n);
      assert.ok(p, n);
      assert.notEqual(p.required, true, `${n}: необязательный`);
    }
    assert.deepEqual(param('listTasks', 'query', 'assignee').schema.enum, ['me']);
    assert.equal(param('listTasks', 'query', 'awaitingMyApproval').schema.type, 'boolean');
  });

  it('переход, голос «нужны все», отказ, чек-лист, иерархия, вложения, история', () => {
    const tr = op('transitionTask').description;
    for (const w of ['vote', 'mode all', 'Q-W4.00-tasks-9', 'Q-W4.00-tasks-10']) {
      assert.ok(tr.includes(w), `transitionTask: ${w}`);
    }
    const rej = op('rejectTaskApproval').description;
    for (const w of ['Напишите, что доработать', 'Q-W4.00-tasks-8', 'rejectTo']) {
      assert.ok(rej.includes(w), `rejectTaskApproval: ${w}`);
    }
    const par = op('setTaskParent').description;
    for (const w of [
      'Задача не может входить в саму себя',
      'Получится цикл',
      'Не больше трёх уровней: задача → подзадача → подзадача',
      'уже завершена — сначала верните её в работу',
    ]) {
      assert.ok(par.includes(w), `setTaskParent: ${w}`);
    }
    // Возврат 1 (ревью): родителя нет — «Задача не найдена» без {id}, как отвечает MSW: в API родитель — UUID, а не
    // номер задачи эталона («Задача T-12 не найдена»), номера несуществующей задачи сервер не знает (Q-W4.03-9).
    assert.ok(
      par.includes('«Задача не найдена» (field parentTaskId)'),
      'setTaskParent: нет родителя',
    );
    assert.ok(!par.includes('Задача {id} не найдена'), 'setTaskParent: без {id}');
    const att = op('attachTaskFiles').description;
    for (const w of [
      'task_attachment',
      'К задаче можно прикрепить не больше 30 файлов',
      'Q-W4.02-10',
      // Возврат 1 (ревью): чужая загрузка, владелец не задача, повтор файла — один отказ.
      'started by the requesting member',
      'entityType task',
      'the same file twice',
    ]) {
      assert.ok(att.includes(w), `attachTaskFiles: ${w}`);
    }
    assert.match(
      op('removeTaskFile').description,
      /Удалить можно свой файл; чужие — руководитель проекта/,
    );
    assert.deepEqual(schemas.TaskFilesAttach.properties.fileIds.maxItems, 30);
    assert.equal(schemas.TaskCommentCreate.properties.text.maxLength, 5000);
    assert.deepEqual(schemas.TaskHistoryPage.required, ['items', 'nextCursor']);
    assert.ok(enumOf('TaskHistoryEntry', 'kind').includes('comment'));
    assert.deepEqual(schemas.TaskParentSet.required, ['parentTaskId']);
    assert.deepEqual(schemas.TaskParentSet.properties.parentTaskId.type, ['string', 'null']);
  });
});

describe('контракт 0.10.0-stage4 (W4.03): автоматизация', () => {
  it('правило: когда — если — тогда, от имени автора, версия; журнал до 30 запусков', () => {
    const r = schemas.TaskAutomation;
    for (const f of [
      'id',
      'projectId',
      'name',
      'trigger',
      'action',
      'enabled',
      'version',
      'authorMemberId',
      'authorDisplayName',
      'runCount',
      'revision',
    ]) {
      assert.ok(r.required.includes(f), `TaskAutomation.${f}`);
    }
    assert.deepEqual(schemas.TaskAutomationTrigger.properties.kind.enum, [
      'created',
      'status_entered',
    ]);
    assert.deepEqual(schemas.TaskAutomationAction.properties.kind.enum, [
      'assign',
      'set_priority',
      'comment',
    ]);
    assert.deepEqual(schemas.TaskAutomationCreate.required, ['name', 'trigger', 'action']);
    assert.equal(schemas.TaskAutomationPatch.minProperties, 1);
    assert.equal(schemas.TaskAutomationRunList.properties.items.maxItems, 30);
    assert.deepEqual(schemas.TaskAutomationRun.properties.result.enum, ['ok', 'stopped', 'error']);
    const c = op('createTaskAutomation').description;
    for (const w of ['Назовите правило', 'Выберите статус для триггера', 'Заполните действие']) {
      assert.ok(c.includes(w), `createTaskAutomation: ${w}`);
    }
    assert.match(op('updateTaskAutomation').description, /version/);
  });
});

describe('контракт 0.10.0-stage4 (W4.03): аддитивность, экраны, примеры, журнал, миграции, версия', () => {
  it('дельты W4.03: пути и схемы — add, описания 0.1 — с текстом 0.1 в начале, параметры 0.1 на месте', () => {
    assert.deepEqual(checkAgainstSource(doc, source, loadDeltas()).errors, []);
    const pointers = new Set(w403().map((d) => d.pointer));
    for (const p of [
      `/paths/${escapeToken(P)}`,
      `/paths/${escapeToken(`${P}/workflow/draft/publish`)}`,
      `/paths/${escapeToken(`${K}/history`)}`,
      '/components/schemas/TaskWorkflow',
      '/components/schemas/Task/properties/availableTransitions',
      '/components/schemas/Project/properties/myAccess',
      '/components/schemas/ProjectCreate/properties/key/pattern',
      '/components/parameters/projectId',
    ]) {
      assert.ok(pointers.has(p), `дельта ${p}`);
    }
    const SCHEMA_CHANGES = [
      '/components/schemas/Project/properties/orgUnitId',
      '/components/schemas/ProjectCreate/properties/orgUnitId',
      '/components/schemas/ProjectCreate/properties/key/pattern',
      '/components/schemas/ProjectCreate/properties/workflowKey',
    ];
    // Права голоса согласующего (возврат 1): x-permissions 0.1 сохранены в начале списка, режим all → any.
    const post = `/paths/${escapeToken(`${K}/transitions`)}/post`;
    const PERMISSION_CHANGES = [`${post}/x-permissions`, `${post}/x-permissions-mode`];
    for (const d of w403().filter((x) => x.kind === 'change' && x.pointer !== '/info/version')) {
      if (SCHEMA_CHANGES.includes(d.pointer)) continue;
      if (PERMISSION_CHANGES.includes(d.pointer)) {
        const before = at(source, d.pointer);
        const now = at(doc, d.pointer);
        if (Array.isArray(before)) assert.deepEqual(now.slice(0, before.length), before, d.pointer);
        else assert.deepEqual([before, now], ['all', 'any'], d.pointer);
        continue;
      }
      const before = at(source, d.pointer);
      const now = at(doc, d.pointer);
      if (d.pointer.endsWith('/parameters')) {
        assert.deepEqual(now.slice(0, before.length), before, `${d.pointer}: параметры 0.1`);
      } else {
        assert.match(d.pointer, /\/description$/, `${d.pointer}: change не по описанию`);
        assert.ok(now.startsWith(before) && now.length > before.length, d.pointer);
      }
    }
    assert.match(loadDeltas().find((x) => x.pointer === '/info/version').source, /W4\.03/);
  });

  it('screens.yaml: операции экранов «Задач и проектов» этапа 4', () => {
    const screens = readYaml(SCREENS_PATH).screens;
    const want = {
      'tasks-projects': ['listTaskProjects'],
      'tasks-project-new': ['createTaskProject', 'listOrgUnits', 'listTaskProjects'],
      'tasks-board': [
        'getTaskProject',
        'getTaskWorkflow',
        'listTasks',
        'createTask',
        'transitionTask',
        'initTaskProjectWorkflow',
      ],
      'modal-new-task': ['createTask', 'attachTaskFiles', 'initiateUpload', 'completeUpload'],
      'tasks-card': [
        'getTask',
        'updateTask',
        'transitionTask',
        'rejectTaskApproval',
        'updateTaskChecklistItem',
        'setTaskParent',
        'attachTaskFiles',
        'removeTaskFile',
        'listTaskHistory',
        'commentTask',
        'listTasks',
      ],
      'tasks-people': [
        'listTaskProjectMembers',
        'setTaskProjectMemberRole',
        'removeTaskProjectMember',
        'checkTaskProjectAccess',
        'updateTaskProject',
      ],
      'tasks-workflow': [
        'getTaskWorkflow',
        'saveTaskWorkflowDraft',
        'discardTaskWorkflowDraft',
        'publishTaskWorkflow',
      ],
      'tasks-automation': [
        'listTaskAutomations',
        'createTaskAutomation',
        'updateTaskAutomation',
        'deleteTaskAutomation',
        'listTaskAutomationRuns',
      ],
      'tasks-leads': [
        'listTaskProjects',
        'getTaskWorkflow',
        'listTasks',
        'transitionTask',
        'commentTask',
      ],
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
  });

  it('примеры валидны; успех и ошибка у каждой новой и расширенной операции; сюжет T-65', () => {
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
    const t65 = examples.get('getTask')?.get('awaiting_approval');
    assert.equal(t65?.key, 'T-65');
    assert.equal(t65?.statusName, 'На проверке');
    assert.equal(t65?.approval?.transitionKey, 't3');
    // Пример forbidden_action — отказ шлюза (возврат 1): MSW берёт из него detail, когда шлюз отклоняет запрос, поэтому
    // текст — шлюза, а не причина хендлера («у вас роль «Исполнитель»…» — кейс conformance без примера, как
    // author_forbidden). Пример invalid_transition (checklist_open) — W4.02.
    const gate = examples.get('transitionTask')?.get('forbidden_action');
    assert.equal(gate?.detail, 'Ни одна роль не разрешает менять статус задач или согласовывать.');
    assert.equal(
      examples.get('transitionTask')?.get('invalid_transition')?.reason,
      'checklist_open',
    );
  });

  it('журнал api/CHANGELOG.md и api/README.md: раздел 0.10.0-stage4, tenant 0025 выдан W4.03', () => {
    const log = readFileSync(abs('api/CHANGELOG.md'), 'utf8');
    assert.match(log, /^## 0\.10\.0-stage4 — W4\.03/m);
    assert.ok(
      log.indexOf('## 0.10.0-stage4') < log.indexOf('## 0.7.0-stage4'),
      'новый раздел — сверху',
    );
    const readme = readFileSync(abs('api/README.md'), 'utf8');
    assert.match(readme, /## Этап 4, W4\.03 \(`0\.10\.0-stage4`\)/);
    assert.match(
      readme,
      /\|\s*tenant\s*\|\s*0025\s*\|\s*`0025_tasks_projects_workflow\.sql`[^|]*\|\s*W4\.03/,
    );
  });

  it('версия контракта — этап 4, не ниже 0.10.0-stage4 (номер при вливании — интегратор)', () => {
    const m = /^0\.(\d+)\.(\d+)-stage(\d+)$/.exec(doc.info.version);
    assert.ok(m, doc.info.version);
    assert.ok(Number(m[3]) >= 4, doc.info.version);
    assert.ok(Number(m[1]) >= 10, doc.info.version);
  });
});

// Строки изоляции у каждой новой и изменённой операции (README матрицы): без сессии — 401, владелец чужой
// организации — 404 (AC-02), шлюз без права x-permissions — 403 forbidden_action.
describe('строки изоляции W4.03 (backend/test/isolation/tasks_w403*.yaml)', () => {
  const FILES = ['tasks_w403', 'tasks_w403_gate'];
  const endpoints = FILES.flatMap((f) => {
    const path = abs(`backend/test/isolation/${f}.yaml`);
    return existsSync(path) ? readYaml(path).endpoints.map((e) => ({ ...e, file: f })) : [];
  });
  const LEGACY = ['createTaskProject', 'listTaskProjects']; // 403 шлюза — уже в authz_gate.yaml (W1.04)

  it('у каждой из 23 новых и 7 изменённых операций: 401 без сессии, 404 чужой организации, 403 шлюза', () => {
    const missing = [];
    for (const id of [...NEW, ...CHANGED]) {
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
        !LEGACY.includes(id) &&
        !rows.some((r) => r.status === 403 && r.code === 'forbidden_action')
      ) {
        missing.push(`${id}: 403 forbidden_action`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it('метод и путь строк — как в контракте; без pending — хендлеры тега Tasks написал W4.11', () => {
    const wrong = [];
    for (const e of endpoints) {
      const o = ops.get(e.op);
      if (!o) {
        wrong.push(`${e.file}/${e.op}: нет в контракте`);
        continue;
      }
      // Ключ перехода и пункт чек-листа — не UUID: в строке пути — литералы (как datasetId у W4.06); строка запроса
      // (?action=…) — параметры query.
      const re = new RegExp(
        `^${o.path
          .replace(/[.*+?^$()|[\]\\]/g, '\\$&')
          .replace(/\{(transitionKey|checklistItemId)\}/g, '[a-z0-9][a-z0-9_-]*')}(\\?.*)?$`,
      );
      if (e.method.toLowerCase() !== o.method || !re.test(e.path)) {
        wrong.push(`${e.file}/${e.op}: ${e.method} ${e.path} ≠ ${o.method} ${o.path}`);
      }
      if (e.pending !== undefined) {
        wrong.push(
          `${e.file}/${e.op}: pending ${e.pending} — хендлеры тега Tasks уже есть (W4.11)`,
        );
      }
    }
    assert.deepEqual(wrong, []);
  });
});
