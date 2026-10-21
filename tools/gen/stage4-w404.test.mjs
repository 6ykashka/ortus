// W4.04 · Контрактный PR 3 этапа 4 (номер версии согласует интегратор): «База знаний» — пространства, дерево, версии,
// доступ узла, запросы доступа, участники пространства, автоматизация (docs/plan/v2/analysis/dor/knowledge.md §2.2,
// §3, §5; design/docs/23-knowledge-spaces.md «Новые права»). Эталон — «База знаний.dc.html» (design-2026-10-19),
// домен W4.30. Бриф docs/plan/v2/ws/W4.04.md §4.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { checkExamples, loadExamples } from './lib/examples.mjs';
import { operationsById } from './lib/inventory.mjs';
import { abs, SCREENS_PATH, SOURCE_0_1, SPECTRAL_RULESET } from './lib/paths.mjs';
import { flattenActions, loadCatalog } from './lib/permissions.mjs';
import { escapeToken, parsePointer } from './lib/refs.mjs';
import { checkAgainstSource, loadDeltas } from './lib/source-diff.mjs';
import { readYaml } from './lib/yaml-io.mjs';

const K = '/api/v1/tenants/{tenantId}/knowledge';
const NODE = 'knowledge-space-node';
const SPACE = 'knowledge-space';
const READ = ['knowledge.read'];
const MANAGE = ['knowledge.access.manage'];
const AUTO = ['knowledge.automation.manage'];
const ORG = ['knowledge.organize'];

/** [operationId, метод, путь, x-permissions, x-scope] — knowledge.md §2.2, бриф W4.04 §4. Тег — Knowledge. */
const OPS = [
  ['listKnowledgeSpaces', 'get', `${K}/spaces`, READ, NODE],
  ['createKnowledgeSpace', 'post', `${K}/spaces`, ['knowledge.spaces.manage'], 'tenant-org-unit'],
  [
    'listKnowledgeSpaceTemplates',
    'get',
    `${K}/space-templates`,
    ['knowledge.spaces.manage'],
    'tenant-org-unit',
  ],
  ['updateKnowledgeSpace', 'patch', `${K}/spaces/{spaceId}`, MANAGE, SPACE],
  ['getKnowledgeSpaceTree', 'get', `${K}/spaces/{spaceId}/tree`, READ, NODE],
  ['searchKnowledge', 'get', `${K}/search`, READ, NODE],
  ['getKnowledgeNode', 'get', `${K}/nodes/{nodeId}`, READ, NODE],
  ['getKnowledgeNodeVersion', 'get', `${K}/nodes/{nodeId}/versions/{version}`, READ, NODE],
  // Возврат 1 (ревью): создание и правка узла — по цепочке доступа (записи «правит», связь, автор, руководитель),
  // шлюз пускает читающего, право проверяет модуль.
  ['createKnowledgeNode', 'post', `${K}/spaces/{spaceId}/nodes`, READ, NODE],
  ['publishKnowledgeNodeVersion', 'post', `${K}/nodes/{nodeId}/versions`, READ, NODE],
  ['setKnowledgeNodeStatus', 'post', `${K}/nodes/{nodeId}/status`, ['knowledge.publish'], NODE],
  ['moveKnowledgeNode', 'post', `${K}/nodes/{nodeId}/move`, ORG, SPACE],
  ['archiveKnowledgeNode', 'post', `${K}/nodes/{nodeId}/archive`, ORG, SPACE],
  ['restoreKnowledgeNode', 'post', `${K}/nodes/{nodeId}/restore`, ORG, SPACE],
  ['listKnowledgeArchive', 'get', `${K}/spaces/{spaceId}/archive`, ORG, SPACE],
  ['ackKnowledgeNode', 'post', `${K}/nodes/{nodeId}/ack`, READ, NODE],
  ['getKnowledgeNodeAccess', 'get', `${K}/nodes/{nodeId}/access`, READ, NODE],
  ['listKnowledgeAccessCandidates', 'get', `${K}/nodes/{nodeId}/access/candidates`, MANAGE, SPACE],
  ['setKnowledgeNodeAccess', 'put', `${K}/nodes/{nodeId}/access`, MANAGE, SPACE],
  ['getKnowledgeAccessMap', 'get', `${K}/spaces/{spaceId}/access-map`, MANAGE, SPACE],
  ['explainKnowledgeAccess', 'get', `${K}/nodes/{nodeId}/explain`, MANAGE, SPACE],
  ['createKnowledgeAccessRequest', 'post', `${K}/nodes/{nodeId}/requests`, READ, NODE],
  ['decideKnowledgeAccessRequest', 'post', `${K}/requests/{requestId}/decision`, MANAGE, SPACE],
  ['listKnowledgeAccessRequests', 'get', `${K}/spaces/{spaceId}/requests`, MANAGE, SPACE],
  ['listKnowledgeSpaceMembers', 'get', `${K}/spaces/{spaceId}/members`, READ, NODE],
  [
    'setKnowledgeSpaceMember',
    'put',
    `${K}/spaces/{spaceId}/members/{memberId}`,
    ['knowledge.members.manage'],
    SPACE,
  ],
  ['listKnowledgeRules', 'get', `${K}/spaces/{spaceId}/rules`, AUTO, SPACE],
  ['setKnowledgeRuleEnabled', 'patch', `${K}/rules/{ruleId}`, AUTO, SPACE],
  ['runKnowledgeReviewCheck', 'post', `${K}/spaces/{spaceId}/review-check`, AUTO, SPACE],
  ['runKnowledgeSection', 'post', `${K}/spaces/{spaceId}/sections`, AUTO, SPACE],
  ['listKnowledgeRuns', 'get', `${K}/spaces/{spaceId}/runs`, AUTO, SPACE],
  ['createKnowledgeTable', 'post', `${K}/nodes/{nodeId}/tables`, READ, NODE],
];
const NEW = OPS.map((o) => o[0]);
const LEGACY = [
  'listKnowledgePages',
  'createKnowledgePage',
  'getKnowledgePage',
  'updateKnowledgePage',
];
const COMMANDS = OPS.filter((o) => o[1] !== 'get').map((o) => o[0]);
const IF_MATCH = ['updateKnowledgeSpace', 'publishKnowledgeNodeVersion', 'setKnowledgeNodeAccess'];

const doc = bundle();
const source = readYaml(SOURCE_0_1);
const ops = operationsById(doc);
const op = (id) => ops.get(id)?.op;
const schemas = doc.components.schemas;
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
const w404 = () => loadDeltas().filter((d) => /W4\.04/.test(d.source));
const was = (id) => {
  const o = ops.get(id);
  return source.paths[o.path][o.method].description;
};
const catalog = loadCatalog();
const actions = flattenActions(catalog);

describe('контракт этапа 4 (W4.04): операции «Базы знаний»', () => {
  it('32 новые операции тега Knowledge: метод, путь, x-permissions, x-scope', () => {
    assert.equal(OPS.length, 32);
    const wrong = [];
    for (const [id, method, path, perms, scope] of OPS) {
      const o = ops.get(id);
      if (!o) {
        wrong.push(`${id}: нет в бандле`);
        continue;
      }
      const got = [o.method, o.path, o.tag, o.op['x-permissions'], o.op['x-scope']];
      const want = [method, path, 'Knowledge', perms, scope];
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        wrong.push(`${id}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
      }
    }
    assert.deepEqual(wrong, []);
  });

  it('возврат 1: создание, публикация и таблица — шлюз пускает с knowledge.read, правку проверяет модуль', () => {
    for (const id of [
      'createKnowledgeNode',
      'publishKnowledgeNodeVersion',
      'createKnowledgeTable',
    ]) {
      const d = op(id).description;
      assert.match(
        d,
        /The gateway admits a member who reads the knowledge base \(knowledge\.read\)/,
        id,
      );
      assert.match(d, /«правит» entry of the nearest own access/, id);
      assert.match(d, /the relation «прораб объекта»/, id);
      assert.match(d, /an approved request to edit/, id);
    }
  });

  it('команды: Idempotency-Key, X-CSRF-Token, Origin, x-csrf; If-Match — правка пространства, публикация, доступ', () => {
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
    }
    for (const id of IF_MATCH) {
      if (!op(id)) continue;
      if (param(id, 'header', 'If-Match')?.required !== true) gaps.push(`${id}: If-Match`);
      for (const s of ['412', '428']) if (!op(id).responses[s]) gaps.push(`${id}: ответ ${s}`);
    }
    for (const id of NEW.filter((x) => !COMMANDS.includes(x))) {
      if (!op(id)) continue;
      for (const s of ['401', '403', '404']) {
        if (!op(id).responses[s]) gaps.push(`${id}: ответ ${s}`);
      }
    }
    assert.deepEqual(gaps, []);
  });

  it('тела и ответы: схемы БЗ', () => {
    const want = {
      listKnowledgeSpaces: ['200', 'KnowledgeSpaceList'],
      createKnowledgeSpace: ['201', 'KnowledgeSpace', 'KnowledgeSpaceCreate'],
      listKnowledgeSpaceTemplates: ['200', 'KnowledgeSpaceTemplateList'],
      updateKnowledgeSpace: ['200', 'KnowledgeSpaceChange', 'KnowledgeSpacePatch'],
      getKnowledgeSpaceTree: ['200', 'KnowledgeTree'],
      searchKnowledge: ['200', 'KnowledgeSearchResult'],
      getKnowledgeNode: ['200', 'KnowledgeNode'],
      getKnowledgeNodeVersion: ['200', 'KnowledgeVersion'],
      createKnowledgeNode: ['201', 'KnowledgeNode', 'KnowledgeNodeCreate'],
      publishKnowledgeNodeVersion: ['201', 'KnowledgePublishResult', 'KnowledgePublish'],
      setKnowledgeNodeStatus: ['200', 'KnowledgeNode', 'KnowledgeNodeStatusChange'],
      moveKnowledgeNode: ['200', 'KnowledgeMoveResult', 'KnowledgeMove'],
      archiveKnowledgeNode: ['200', 'KnowledgeArchiveResult'],
      restoreKnowledgeNode: ['200', 'KnowledgeArchiveResult'],
      listKnowledgeArchive: ['200', 'KnowledgeArchiveList'],
      ackKnowledgeNode: ['200', 'KnowledgeAck', 'KnowledgeAckCreate'],
      getKnowledgeNodeAccess: ['200', 'KnowledgeNodeAccess'],
      listKnowledgeAccessCandidates: ['200', 'KnowledgeAccessCandidateList'],
      setKnowledgeNodeAccess: ['200', 'KnowledgeAccessImpact', 'KnowledgeAccessChange'],
      getKnowledgeAccessMap: ['200', 'KnowledgeAccessMap'],
      explainKnowledgeAccess: ['200', 'KnowledgeAccessExplanation'],
      createKnowledgeAccessRequest: [
        '201',
        'KnowledgeAccessRequest',
        'KnowledgeAccessRequestCreate',
      ],
      decideKnowledgeAccessRequest: [
        '200',
        'KnowledgeAccessRequest',
        'KnowledgeAccessRequestDecision',
      ],
      listKnowledgeAccessRequests: ['200', 'KnowledgeAccessRequestList'],
      listKnowledgeSpaceMembers: ['200', 'KnowledgeSpaceMembers'],
      setKnowledgeSpaceMember: ['200', 'KnowledgeSpaceMembers', 'KnowledgeSpaceMemberChange'],
      listKnowledgeRules: ['200', 'KnowledgeRuleList'],
      setKnowledgeRuleEnabled: ['200', 'KnowledgeRule', 'KnowledgeRulePatch'],
      runKnowledgeReviewCheck: ['200', 'KnowledgeRunReport'],
      runKnowledgeSection: ['200', 'KnowledgeRunReport', 'KnowledgeSectionCreate'],
      listKnowledgeRuns: ['200', 'KnowledgeRunList'],
      createKnowledgeTable: ['201', 'KnowledgeTable', 'KnowledgeTableCreate'],
    };
    const wrong = [];
    for (const [id, [status, res, body]] of Object.entries(want)) {
      if (!op(id)) {
        wrong.push(`${id}: нет`);
        continue;
      }
      if (okOf(id, status) !== res) wrong.push(`${id}: ${status} ${okOf(id, status)} ≠ ${res}`);
      if (body && bodyOf(id) !== body) wrong.push(`${id}: тело ${bodyOf(id)} ≠ ${body}`);
    }
    assert.deepEqual(wrong, []);
    for (const id of ['getKnowledgeNode', 'createKnowledgeNode', 'getKnowledgeNodeAccess']) {
      const status = id === 'createKnowledgeNode' ? '201' : '200';
      assert.ok(op(id).responses[status].headers?.ETag, `${id}: ETag`);
    }
    for (const p of ['spaceId', 'nodeId', 'ruleId']) {
      assert.equal(name(doc.components.parameters[p]?.schema?.$ref), 'Id', `${p}: Id`);
    }
    const v = param('getKnowledgeNodeVersion', 'path', 'version');
    assert.equal(v?.schema?.type, 'integer');
    assert.equal(v.schema.minimum, 1);
    assert.equal(param('explainKnowledgeAccess', 'query', 'memberId')?.required, true);
    assert.ok(param('searchKnowledge', 'query', 'q')?.required);
    assert.ok(param('searchKnowledge', 'query', 'spaceId'));
    assert.ok(param('getKnowledgeAccessMap', 'query', 'memberIds'));
    assert.deepEqual(param('listKnowledgeAccessRequests', 'query', 'status')?.schema?.enum, [
      'open',
      'approved',
      'denied',
    ]);
  });
});

describe('контракт этапа 4 (W4.04): права и области (knowledge.md §3.1, docs/23)', () => {
  it('новые ключи, уровни, области и чувствительность; comment и export не вводятся', () => {
    const want = {
      'knowledge.organize': ['edit', ['tenant', 'unit', 'space'], undefined],
      'knowledge.access.manage': ['settings', ['tenant', 'unit', 'space'], 'sensitive'],
      'knowledge.members.manage': ['settings', ['tenant', 'unit', 'space'], 'sensitive'],
      'knowledge.automation.manage': ['settings', ['tenant', 'unit', 'space'], 'sensitive'],
      'knowledge.spaces.manage': ['settings', ['tenant', 'unit'], undefined],
    };
    for (const [key, [level, scopes, sens]] of Object.entries(want)) {
      const a = actions.get(key);
      assert.ok(a, key);
      assert.equal(a.module, 'core.knowledge', key);
      assert.equal(a.level, level, key);
      assert.deepEqual(a.scopes, scopes, key);
      assert.equal(a.sensitivity, sens, key);
    }
    assert.ok(!actions.has('knowledge.comment'));
    assert.ok(!actions.has('knowledge.export'));
  });

  it('области space, page, relation у прежних ключей; knowledge.publish — уровень review', () => {
    const scopes = (k) => actions.get(k).scopes;
    for (const k of ['knowledge.read', 'knowledge.update']) {
      for (const s of ['tenant', 'unit', 'project', 'space', 'page', 'relation']) {
        assert.ok(scopes(k).includes(s), `${k}: ${s}`);
      }
    }
    for (const k of ['knowledge.create', 'knowledge.publish']) {
      for (const s of ['tenant', 'unit', 'project', 'space', 'page']) {
        assert.ok(scopes(k).includes(s), `${k}: ${s}`);
      }
      assert.ok(!scopes(k).includes('relation'), `${k}: без relation`);
    }
    assert.equal(actions.get('knowledge.publish').level, 'review');
    assert.equal(actions.get('knowledge.read').label, 'Читать');
  });

  it('шаблоны ролей пространства: руководитель, редактор, читатель (KB-02 — без «Автора»)', () => {
    const t = catalog.role_templates;
    const lead = [
      'knowledge.read',
      'knowledge.create',
      'knowledge.update',
      'knowledge.organize',
      'knowledge.publish',
      'knowledge.access.manage',
      'knowledge.members.manage',
      'knowledge.automation.manage',
    ];
    const editor = lead.slice(0, 5);
    for (const [k, label, acts, scope] of [
      ['kb_space_lead', 'Руководитель пространства', lead, ['space']],
      ['kb_space_editor', 'Редактор', editor, ['space']],
      ['kb_space_reader', 'Читатель', ['knowledge.read'], ['space', 'page']],
    ]) {
      assert.ok(t[k], k);
      assert.equal(t[k].label, label, k);
      assert.equal(t[k].kind, 'system', k);
      assert.equal(t[k].default_scope, 'space', k);
      assert.deepEqual(t[k].scopes, scope, k);
      assert.deepEqual([...t[k].actions].sort(), [...acts].sort(), k);
    }
    assert.ok(!t.kb_space_author, 'KB-02');
    assert.ok(!t.owner.actions, 'владелец — все ключи организации, без списка');
  });

  it('x-scope БЗ — в словаре Spectral; описания называют проверку узла', () => {
    const rules = readYaml(SPECTRAL_RULESET).rules;
    const values = rules['ortus-x-scope-known'].then.functionOptions.values;
    assert.ok(values.includes(NODE));
    assert.ok(values.includes(SPACE));
    const d = op('getKnowledgeNode').description;
    for (const w of ['404 not_found', 'Страница не найдена или недоступна', 'finance', 'driver']) {
      assert.ok(d.includes(w), `getKnowledgeNode: ${w}`);
    }
  });
});

describe('контракт этапа 4 (W4.04): схемы БЗ', () => {
  it('KnowledgeSpace: область, уровень, мои права, руководители, главная страница, ревизия', () => {
    const s = schemas.KnowledgeSpace;
    assert.ok(s, 'KnowledgeSpace');
    assert.equal(s.additionalProperties, false);
    for (const f of [
      'id',
      'name',
      'icon',
      'color',
      'orgUnitId',
      'areaLabel',
      'access',
      'homeNodeId',
      'my',
      'leadNames',
      'pageCount',
      'revision',
    ]) {
      assert.ok(s.required.includes(f), `KnowledgeSpace.${f}`);
    }
    assert.deepEqual(s.properties.access.enum, ['open', 'limited', 'closed']);
    assert.deepEqual(schemas.KnowledgeSpaceMy.required, [
      'owner',
      'lead',
      'view',
      'create',
      'edit',
      'role',
    ]);
    const c = schemas.KnowledgeSpaceCreate;
    assert.deepEqual(c.required, ['name', 'access']);
    assert.equal(c.properties.name.minLength, 2);
    assert.equal(c.properties.name.maxLength, 120);
    assert.deepEqual(c.properties.templateKey.enum, ['regs', 'staff', 'objects', 'blank']);
    assert.equal(schemas.KnowledgeSpacePatch.minProperties, 1);
    assert.equal(schemas.KnowledgeSpacePatch.properties.dryRun.type, 'boolean');
  });

  it('KnowledgeNode: вид, статус, режим доступа, версии, ознакомление, таблицы и записи', () => {
    const n = schemas.KnowledgeNode;
    assert.ok(n, 'KnowledgeNode');
    assert.deepEqual(n.properties.kind.enum, [
      'page',
      'folder',
      'table',
      'diagram',
      'file',
      'link',
    ]);
    assert.deepEqual(n.properties.status.enum, ['draft', 'review', 'active', 'outdated']);
    assert.deepEqual(n.properties.accessMode.enum, ['inherit', 'edit_listed', 'listed']);
    assert.deepEqual(n.properties.sensitivity.enum, ['normal', 'finance']);
    for (const f of [
      'id',
      'spaceId',
      'parentId',
      'kind',
      'title',
      'status',
      'accessMode',
      'archived',
      'path',
      'owner',
      'current',
      'versions',
      'tables',
      'entries',
      'my',
      'revision',
    ]) {
      assert.ok(n.required.includes(f), `KnowledgeNode.${f}`);
    }
    assert.equal(name(n.properties.ack.$ref), 'KnowledgeAck');
    assert.equal(name(n.properties.current.$ref), 'KnowledgeVersion');
    const p = schemas.KnowledgePublish;
    assert.deepEqual(p.required, ['body']);
    assert.equal(p.properties.body.maxLength, 20000);
    assert.equal(p.properties.title.minLength, 2);
    assert.equal(p.properties.steps.maxItems, 8);
    assert.deepEqual(schemas.KnowledgeNodeCreate.properties.kind.enum, [
      'page',
      'folder',
      'diagram',
    ]);
    assert.deepEqual(schemas.KnowledgeNodeStatusChange.properties.status.enum, [
      'draft',
      'review',
      'active',
      'outdated',
    ]);
  });

  it('доступ узла: записи (роль, группа, сотрудник, связь), цепочка, влияние, кандидаты, объяснение', () => {
    const e = schemas.KnowledgeAccessEntry;
    assert.deepEqual(e.properties.who.enum, ['member', 'group', 'role', 'relation']);
    assert.deepEqual(e.properties.can.enum, ['view', 'edit']);
    assert.deepEqual(e.properties.relation.enum, ['foreman']);
    assert.equal(name(e.properties.object.$ref), 'ObjectRef');
    assert.deepEqual(schemas.KnowledgeAccessStep.properties.kind.enum, [
      'ok',
      'no',
      'wait',
      'inherit',
    ]);
    const ch = schemas.KnowledgeAccessChange;
    assert.deepEqual(ch.required, ['mode', 'entries']);
    for (const f of ['applyToOwn', 'dryRun']) assert.equal(ch.properties[f].type, 'boolean', f);
    const imp = schemas.KnowledgeAccessImpact;
    for (const f of ['applied', 'pages', 'own', 'gainView', 'loseView', 'gainEdit', 'loseEdit']) {
      assert.ok(imp.required.includes(f), `KnowledgeAccessImpact.${f}`);
    }
    assert.deepEqual(schemas.KnowledgeAccessMap.properties.cells.items.items.enum, [
      'edit',
      'view',
      'none',
      'function',
    ]);
    assert.equal(schemas.KnowledgeAccessMap.properties.members.maxItems, 8);
    for (const f of ['view', 'edit', 'functionBlocked', 'chain']) {
      assert.ok(schemas.KnowledgeAccessExplanation.required.includes(f), f);
    }
  });

  it('запросы, участники, правила, запуски; запрос — только право правки (Q-W4.00-knowledge-6)', () => {
    assert.deepEqual(schemas.KnowledgeAccessRequestCreate.properties.can.enum, ['edit']);
    assert.deepEqual(schemas.KnowledgeAccessRequestDecision.properties.decision.enum, [
      'approve',
      'deny',
    ]);
    assert.deepEqual(schemas.KnowledgeAccessRequest.properties.status.enum, [
      'open',
      'approved',
      'denied',
    ]);
    assert.deepEqual(schemas.KnowledgeSpaceMemberChange.properties.role.enum, [
      'kb_space_lead',
      'kb_space_editor',
      'kb_space_reader',
      null,
    ]);
    assert.deepEqual(schemas.KnowledgeRule.properties.kind.enum, ['ack', 'review', 'section']);
    assert.deepEqual(schemas.KnowledgeRun.properties.result.enum, [
      'ok',
      'warn',
      'stopped',
      'error',
    ]);
    assert.equal(name(schemas.KnowledgeSectionCreate.properties.projectId.$ref), 'Id');
  });

  it('описания: тексты эталона дословно (ошибки команд)', () => {
    const texts = {
      createKnowledgeSpace: [
        'Создавать пространства может владелец бизнеса или роль с правом «База знаний · Настраивать»',
        'Пространство «{name}» уже есть',
      ],
      createKnowledgeNode: [
        'Выберите тип: страница, папка или схема',
        'Не больше шести уровней вложенности',
      ],
      publishKnowledgeNodeVersion: [
        'Страницу уже изменили (v{N}). Обновите и повторите правку.',
        'Текст — не длиннее 20 000 символов',
        '412 revision_mismatch',
      ],
      moveKnowledgeNode: [
        'Переносить можно только внутри пространства',
        'Нельзя перенести страницу внутрь её же подстраницы',
        'dryRun',
      ],
      archiveKnowledgeNode: ['Главную страницу пространства архивировать нельзя'],
      ackKnowledgeNode: [
        'Ознакомление со страницей не запрошено',
        'Ознакомление запрошено у другой роли',
      ],
      setKnowledgeNodeAccess: [
        'Выберите, кто видит страницу',
        'Связь с записью CRM задаётся шаблоном раздела',
        'Это может руководитель пространства или владелец бизнеса',
      ],
      createKnowledgeAccessRequest: [
        'Вы уже можете править страницу',
        '409 request_pending',
        'Запрос уже отправлен',
      ],
      decideKnowledgeAccessRequest: ['Запрос не найден или уже решён', '30 days'],
      setKnowledgeSpaceMember: [
        'Владелец бизнеса видит всё без назначения',
        'Свою роль руководителя снимает владелец бизнеса',
        '409 delegation_exceeds_grant',
      ],
      runKnowledgeReviewCheck: ['Правило «Пора пересмотреть» выключено'],
      runKnowledgeSection: ['В пространстве нет папки «Объекты»', 'Объект не найден'],
    };
    for (const [id, list] of Object.entries(texts)) {
      for (const t of list) assert.ok(op(id)?.description?.includes(t), `${id}: ${t}`);
    }
    const legacy = op('listKnowledgePages').description;
    assert.ok(legacy.includes('projection'), 'listKnowledgePages — проекция узлов');
  });
});

describe('контракт этапа 4 (W4.04): аддитивность, экраны, примеры, журнал, миграция, версия', () => {
  it('дельты W4.04: пути и схемы — add, описания 0.1 — с текстом 0.1 в начале', () => {
    assert.deepEqual(checkAgainstSource(doc, source, loadDeltas()).errors, []);
    const pointers = new Set(w404().map((d) => d.pointer));
    for (const p of [
      `/paths/${escapeToken(`${K}/spaces`)}`,
      `/paths/${escapeToken(`${K}/nodes/{nodeId}/access`)}`,
      '/components/schemas/KnowledgeSpace',
      '/components/schemas/KnowledgeNode',
      '/components/parameters/spaceId',
    ]) {
      assert.ok(pointers.has(p), `дельта ${p}`);
    }
    for (const d of w404().filter((x) => x.kind === 'change' && x.pointer !== '/info/version')) {
      assert.match(d.pointer, /\/description$/, `${d.pointer}: change не по описанию`);
      const before = at(source, d.pointer);
      const now = at(doc, d.pointer);
      assert.ok(now.startsWith(before) && now.length > before.length, d.pointer);
    }
    for (const id of LEGACY) {
      assert.ok(op(id).description.startsWith(was(id)), `${id}: текст 0.1`);
    }
    assert.match(loadDeltas().find((x) => x.pointer === '/info/version').source, /W4\.04/);
  });

  it('screens.yaml: операции у экранов «Базы знаний»', () => {
    const screens = readYaml(SCREENS_PATH).screens;
    const want = {
      'knowledge-spaces': ['listKnowledgeSpaces', 'searchKnowledge'],
      'knowledge-space': [
        'getKnowledgeSpaceTree',
        'getKnowledgeNode',
        'getKnowledgeNodeVersion',
        'publishKnowledgeNodeVersion',
        'setKnowledgeNodeStatus',
        'ackKnowledgeNode',
        'createKnowledgeAccessRequest',
        'archiveKnowledgeNode',
      ],
      'knowledge-people': [
        'listKnowledgeSpaceMembers',
        'setKnowledgeSpaceMember',
        'getKnowledgeAccessMap',
        'explainKnowledgeAccess',
      ],
      'knowledge-automation': [
        'listKnowledgeRules',
        'setKnowledgeRuleEnabled',
        'runKnowledgeReviewCheck',
        'runKnowledgeSection',
        'listKnowledgeRuns',
      ],
      'knowledge-archive': ['listKnowledgeArchive', 'restoreKnowledgeNode'],
      'modal-kb-space': ['createKnowledgeSpace', 'listKnowledgeSpaceTemplates'],
      'modal-kb-node': ['createKnowledgeNode'],
      'modal-kb-move': ['moveKnowledgeNode'],
      'modal-kb-access': [
        'getKnowledgeNodeAccess',
        'listKnowledgeAccessCandidates',
        'setKnowledgeNodeAccess',
        'listKnowledgeAccessRequests',
        'decideKnowledgeAccessRequest',
      ],
    };
    for (const [key, list] of Object.entries(want)) {
      const s = screens[key];
      assert.ok(s, key);
      assert.equal(s.stage, 4, key);
      for (const o of list) assert.ok(s.operations.includes(o), `${key}: ${o}`);
    }
    const all = new Set(Object.values(screens).flatMap((s) => s.operations ?? []));
    const off = NEW.filter((x) => !all.has(x));
    // Правка пространства (Q-W4.00-knowledge-17) — без экрана. Таблица ядра Форм — без экрана БЗ: её вызывает экран
    // «Действия после ответа» форм (W4.05, «Новая таблица по вопросам формы»).
    assert.deepEqual(off.sort(), ['updateKnowledgeSpace']);
    assert.ok(screens['forms-actions'].operations.includes('createKnowledgeTable'));
    const kb = Object.entries(screens).filter(
      ([k]) => k.startsWith('knowledge-') || k.includes('-kb-'),
    );
    assert.ok(!kb.some(([, s]) => (s.operations ?? []).includes('createKnowledgeTable')));
  });

  it('примеры валидны; успех и ошибка у каждой новой операции', () => {
    const examples = loadExamples();
    assert.deepEqual(checkExamples(doc, examples), []);
    const missing = [];
    for (const id of NEW) {
      const names = [...(examples.get(id)?.keys() ?? [])];
      if (names.length < 2) missing.push(`${id}: ${names}`);
      if (!names.some((n) => /^(ok|created|lead|reader|dry-run|applied|approved)/.test(n))) {
        missing.push(`${id}: нет успеха (${names})`);
      }
    }
    assert.deepEqual(missing, []);
  });

  // tenant 0023 занял W2.71 (0.7.1-stage4, влит раньше): W4.04 — следующий свободный номер 0024, резерв — с 0025.
  it('журнал api/CHANGELOG.md и api/README.md: раздел W4.04, tenant 0024 выдан W4.04', () => {
    const log = readFileSync(abs('api/CHANGELOG.md'), 'utf8');
    assert.match(log, /^## 0\.\d+\.\d+-stage4 — W4\.04/m);
    assert.ok(
      log.search(/^## 0\.\d+\.\d+-stage4 — W4\.04/m) < log.indexOf('## 0.7.0-stage4'),
      'новый раздел — выше 0.7.0-stage4',
    );
    const readme = readFileSync(abs('api/README.md'), 'utf8');
    assert.match(readme, /## Этап 4, W4\.04 \(`0\.\d+\.\d+-stage4`\)/);
    assert.match(
      readme,
      /\|\s*tenant\s*\|\s*0024\s*\|\s*`0024_knowledge_spaces\.sql`[^|]*\|\s*W4\.04/,
    );
    assert.match(
      readme,
      /\|\s*tenant\s*\|\s*0023\s*\|\s*`0023_fleet_temporary_driver_vehicle_offer\.sql`[^|]*\|\s*W2\.71/,
    );
    assert.doesNotMatch(readme, /0023_knowledge_spaces/);
    // W4.03 влит позже (tenant 0025): резерв этапа 4 — хвост блока после выданных номеров.
    assert.match(readme, /\|\s*tenant\s*\|\s*00(2[5-9]|3\d)–0039\s*\|/);
    assert.doesNotMatch(log, /0023_knowledge_spaces/);
  });

  it('версия контракта — этап 4, не ниже 0.7.0-stage4 (номер при вливании — интегратор)', () => {
    const m = /^0\.(\d+)\.(\d+)-stage(\d+)$/.exec(doc.info.version);
    assert.ok(m, doc.info.version);
    assert.ok(Number(m[3]) >= 4, doc.info.version);
    assert.ok(Number(m[1]) >= 7, doc.info.version);
    assert.notEqual(doc.info.version, '0.7.0-stage4', 'новая версия контрактного PR');
  });
});
