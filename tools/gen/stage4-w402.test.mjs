// W4.02 · Контрактный PR 1 этапа 4 (0.7.0-stage4, часть 2 W4.00): общий PR для W4.01 по
// docs/plan/v2/analysis/dor/README.md «Порядок контрактных PR этапа 4», п. 1 и «Общие выводы для W4.01 (области)».
// Виды областей Scope.kind и scope_kind (space, page, folder, doc, account, chat, relation, repair_project — RS-08,
// Q-W4.00-tasks-1, Q-W4.00-repair-2), explainAccess с объектом (x-explain-objects), files.purpose task_attachment,
// экраны этапа 4 (снимок design-2026-10-19), Problem.reason и реестр причин invalid_transition (Q-W4.00-tasks-12).
// Новых операций, ключей прав и кодов ошибок нет. Бриф docs/plan/v2/ws/W4.02.md.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { checkRegistry, loadRegistry } from './lib/errors.mjs';
import { checkExamples, loadExamples } from './lib/examples.mjs';
import { operationsById } from './lib/inventory.mjs';
import { abs, SCREENS_PATH, SOURCE_0_1 } from './lib/paths.mjs';
import { flattenActions, loadCatalog, SCOPE_KINDS } from './lib/permissions.mjs';
import { parsePointer } from './lib/refs.mjs';
import { checkScreens } from './lib/screens.mjs';
import { checkAgainstSource, loadDeltas } from './lib/source-diff.mjs';
import { readYaml } from './lib/yaml-io.mjs';

const doc = bundle();
const source = readYaml(SOURCE_0_1);
const ops = operationsById(doc);
const op = (id) => ops.get(id)?.op;
const schemas = doc.components.schemas;
const src = source.components.schemas;
const at = (root, ptr) => parsePointer(ptr).reduce((cur, t) => cur?.[t], root);
const w402 = loadDeltas().filter((d) => /W4\.02/.test(d.source));

/** Виды областей этапов 4–7, которые W4.02 вносит в контракт (порядок — README «Общие выводы для W4.01»). */
const STAGE4_KINDS = [
  'space',
  'page',
  'folder',
  'doc',
  'account',
  'chat',
  'relation',
  'repair_project',
];

/** Объекты explainAccess: модуль и тип объекта → вид области каталога (scope_kind). */
const EXPLAIN_OBJECTS = [
  { objectModule: 'tasks', objectType: 'project', scopeKind: 'project' },
  { objectModule: 'knowledge', objectType: 'space', scopeKind: 'space' },
  { objectModule: 'knowledge', objectType: 'node', scopeKind: 'page' },
  { objectModule: 'inventory', objectType: 'warehouse', scopeKind: 'warehouse' },
  { objectModule: 'fleet', objectType: 'resource_pool', scopeKind: 'resource' },
  { objectModule: 'logistics', objectType: 'resource_pool', scopeKind: 'resource' },
];

/** Причины invalid_transition: переходы задач (tasks.md §2.4, Q-W4.00-tasks-12) и устаревшая версия формы. */
const TRANSITION_REASONS = [
  'not_in_status',
  'checklist_open',
  'children_open',
  'author_forbidden',
  'already_voted',
  'doc_route',
  'form_version_changed',
];

const TASKS = 'design-2026-10-19 · Задачи и проекты.dc.html · ';
const KB = 'design-2026-10-19 · База знаний.dc.html · ';
const FORMS = 'design-2026-10-19 · Формы и опросы.dc.html · ';

/** Экраны этапа 4: [ключ, WS, начало reference] — tasks.md §1.1, knowledge.md §6.1, forms.md §6. */
const SCREENS = [
  ['tasks-projects', 'W4.12', TASKS],
  ['tasks-project-new', 'W4.12', TASKS],
  ['tasks-board', 'W4.12', TASKS],
  ['modal-new-task', 'W4.12', TASKS],
  ['tasks-card', 'W4.12', TASKS],
  ['tasks-people', 'W4.13', TASKS],
  ['tasks-workflow', 'W4.13', TASKS],
  ['tasks-automation', 'W4.13', TASKS],
  ['tasks-leads', 'W4.13', 'design-2026-10-19 · Ортус CRM.dc.html · '],
  ['knowledge-spaces', 'W4.32', KB],
  ['knowledge-space', 'W4.32', KB],
  ['knowledge-people', 'W4.32', KB],
  ['knowledge-automation', 'W4.32', KB],
  ['knowledge-archive', 'W4.32', KB],
  ['modal-kb-space', 'W4.32', KB],
  ['modal-kb-node', 'W4.32', KB],
  ['modal-kb-move', 'W4.32', KB],
  ['modal-kb-access', 'W4.32', KB],
  ['forms-list', 'W4.22', FORMS],
  ['forms-builder', 'W4.22', FORMS],
  ['forms-preview', 'W4.22', FORMS],
  ['modal-form-publish', 'W4.22', FORMS],
  ['forms-settings', 'W4.23', FORMS],
  ['forms-responses', 'W4.23', FORMS],
  ['forms-versions', 'W4.23', FORMS],
  ['modal-form-share', 'W4.23', FORMS],
  ['forms-actions', 'W4.23', FORMS],
  ['form-fill', 'W4.23', 'no-reference'],
  ['public-form', 'W4.23', 'no-reference'],
];

describe('контракт 0.7.0-stage4 (W4.02): виды областей', () => {
  it('Scope.kind: значения 0.1 и восемь видов этапов 4–7 по порядку', () => {
    assert.deepEqual(schemas.Scope.properties.kind.enum, [
      ...src.Scope.properties.kind.enum,
      ...STAGE4_KINDS,
    ]);
    assert.deepEqual(schemas.Scope.required, src.Scope.required, 'required 0.1');
  });

  it('Scope: описание 0.1 в начале; relation — без resourceIds, объектные — ровно один объект, fail-closed', () => {
    const d = schemas.Scope.description;
    assert.ok(d.startsWith(src.Scope.description), 'текст 0.1');
    for (const w of [
      'relation',
      'repair_project',
      'space',
      'PD-53',
      '422 validation_failed',
      'ADR-0014',
      '«Особая область»',
    ]) {
      assert.ok(d.includes(w), `Scope.description: ${w}`);
    }
  });

  it('Permission.allowedScopeKinds манифеста — тот же список, что Scope.kind', () => {
    assert.deepEqual(
      schemas.Permission.properties.allowedScopeKinds.items.enum,
      schemas.Scope.properties.kind.enum,
    );
  });

  it('каталог прав: SCOPE_KINDS — виды SQL tenant 0001 и все виды этапов 4–7 (имена каталога)', () => {
    assert.deepEqual(
      [...SCOPE_KINDS].sort(),
      [
        'tenant',
        'unit',
        'project',
        'self',
        'resource',
        'warehouse',
        'chat',
        'relation',
        'space',
        'page',
        'folder',
        'doc',
        'account',
        'repair_project',
      ].sort(),
    );
  });

  it('новых ключей прав и кодов ошибок нет', () => {
    assert.equal(flattenActions(loadCatalog()).size, 123);
    assert.equal(Object.keys(loadRegistry().codes).length, 52);
  });
});

describe('контракт 0.7.0-stage4 (W4.02): explainAccess с объектом', () => {
  const e = op('explainAccess');

  it('x-explain-objects: объекты этапов 1–4 и их вид области (каталог)', () => {
    assert.deepEqual(e['x-explain-objects'], EXPLAIN_OBJECTS);
    const objectBound = SCOPE_KINDS.filter(
      (k) => !['tenant', 'unit', 'self', 'relation'].includes(k),
    );
    for (const o of e['x-explain-objects']) {
      assert.ok(objectBound.includes(o.scopeKind), `${o.objectModule}/${o.objectType}`);
    }
  });

  it('права и область операции не меняются; описание — объекты, 422 для прочих, PD-53', () => {
    assert.deepEqual(e['x-permissions'], ['roles.read']);
    assert.equal(e['x-scope'], 'tenant-or-org-unit');
    for (const w of ['x-explain-objects', '422 validation_failed', 'PD-53', 'resource-scope']) {
      assert.ok(e.description.includes(w), `explainAccess: ${w}`);
    }
    const p = Object.fromEntries(e.parameters.filter((x) => x.name).map((x) => [x.name, x]));
    assert.match(p.objectType.description, /x-explain-objects/);
    assert.match(p.objectModule.description, /x-explain-objects/);
  });
});

describe('контракт 0.7.0-stage4 (W4.02): вложения задач', () => {
  const purposes = (s) => s.enum;
  const OLD = [
    'inspection',
    'expense_receipt',
    'knowledge_attachment',
    'form_attachment',
    'repair_evidence',
  ];

  it('purpose task_attachment — в загрузке, сессии, списке файлов и фильтре listFiles', () => {
    assert.deepEqual(purposes(src.UploadCreate.properties.purpose), OLD);
    const want = [...OLD, 'task_attachment'];
    assert.deepEqual(purposes(schemas.UploadCreate.properties.purpose), want);
    assert.deepEqual(purposes(schemas.UploadSession.properties.purpose), want);
    assert.deepEqual(purposes(schemas.FileListItem.properties.purpose), want);
    const f = op('listFiles').parameters.find((x) => x.name === 'purpose');
    assert.deepEqual(f.schema.enum, want);
  });

  it('владелец вложения — задача (tasks/task), группа места — «Вложения задач и форм»', () => {
    assert.ok(schemas.UploadCreate.description.startsWith(src.UploadCreate.description));
    assert.match(schemas.UploadCreate.description, /task_attachment/);
    assert.match(schemas.UploadCreate.description, /tasks\/task/);
    assert.match(schemas.StorageBreakdownGroup.properties.key.description, /task_attachment/);
  });
});

describe('контракт 0.7.0-stage4 (W4.02): Problem.reason и реестр причин', () => {
  const registry = loadRegistry();

  it('Problem.reason — необязательная машиночитаемая причина внутри кода', () => {
    const r = schemas.Problem.properties.reason;
    assert.equal(r?.type, 'string');
    assert.equal(r.pattern, '^[a-z][a-z0-9_]{1,63}$');
    assert.match(r.description, /api\/errors\.yaml/);
    assert.ok(!schemas.Problem.required.includes('reason'));
  });

  it('invalid_transition: причины переходов задач и устаревшей версии формы', () => {
    const reasons = registry.codes.invalid_transition.reasons;
    assert.deepEqual(Object.keys(reasons ?? {}), TRANSITION_REASONS);
    for (const [k, v] of Object.entries(reasons)) {
      assert.ok(v.title, `${k}: title`);
      assert.ok(v.source, `${k}: source`);
    }
    assert.equal(reasons.checklist_open.ui, 'Сначала закройте чек-лист');
    assert.equal(reasons.already_voted.ui, 'Вы уже согласовали, ждём остальных');
    assert.match(reasons.children_open.ui, /^Сначала завершите подзадачи: /);
    assert.deepEqual(checkRegistry(registry), []);
  });

  it('возврат 1: children_open перечисляет только подзадачи, которые актор видит (reason не называет скрытое)', () => {
    const c = registry.codes.invalid_transition.reasons.children_open;
    assert.match(c.note ?? '', /\{ids\} — только подзадачи, которые актор видит/);
    assert.match(c.note, /скрыт/);
    assert.match(c.note, /W4\.11/);
  });

  it('проверка реестра ловит причину не в snake_case и без title или source', () => {
    const bad = structuredClone(registry);
    bad.codes.invalid_transition.reasons = { 'Bad-Reason': { title: 'x', source: 'y' }, empty: {} };
    assert.deepEqual(checkRegistry(bad), [
      'invalid_transition.reasons.Bad-Reason: не snake_case',
      'invalid_transition.reasons.empty: нет поля title',
      'invalid_transition.reasons.empty: нет поля source',
    ]);
  });

  it('причина примера — из реестра его кода', () => {
    const fake = new Map([
      [
        'transitionTask',
        new Map([
          [
            'invalid_transition',
            {
              type: 'https://docs.ortus.example/errors/invalid_transition',
              title: registry.codes.invalid_transition.title,
              status: 409,
              code: 'invalid_transition',
              requestId: '01J9Z4QK8M6T2V5X7Y9A1B3C5D',
              reason: 'no_such_reason',
            },
          ],
        ]),
      ],
    ]);
    assert.deepEqual(checkExamples(doc, fake), [
      'transitionTask/invalid_transition: reason no_such_reason нет в api/errors.yaml (invalid_transition.reasons)',
    ]);
  });

  it('transitionTask: 409 invalid_transition несёт reason; описание 0.1 в начале', () => {
    const d = op('transitionTask').description;
    assert.ok(d.startsWith('Execute an allowed workflow transition'), 'текст 0.1');
    for (const w of ['reason', 'checklist_open', '403 forbidden_action', 'Q-W4.00-tasks-12']) {
      assert.ok(d.includes(w), `transitionTask: ${w}`);
    }
  });
});

describe('контракт 0.7.0-stage4 (W4.02): экраны этапа 4', () => {
  const screens = readYaml(SCREENS_PATH);

  it('29 экранов задач, базы знаний и форм: этап 4, WS карточки, эталон снимка 19.10', () => {
    const stage4 = Object.entries(screens.screens).filter(([, s]) => s.stage === 4);
    assert.deepEqual(
      stage4.map(([k]) => k).filter((k) => k !== 'platform-users'),
      SCREENS.map(([k]) => k),
    );
    for (const [key, ws, ref] of SCREENS) {
      const s = screens.screens[key];
      assert.equal(s.ws, ws, `${key}: ws`);
      assert.ok(s.reference?.startsWith(ref), `${key}: reference ${s.reference}`);
      assert.ok(s.title, `${key}: title`);
      assert.ok(Array.isArray(s.operations), `${key}: operations`);
    }
    assert.deepEqual(checkScreens(doc, screens), []);
  });

  it('операции экранов этапа 4, которые уже есть в контракте', () => {
    const s = screens.screens;
    assert.ok(s['tasks-card'].operations.includes('transitionTask'));
    assert.ok(s['modal-new-task'].operations.includes('initiateUpload'));
    assert.ok(s['tasks-people'].operations.includes('explainAccess'));
    assert.ok(s['forms-responses'].operations.includes('reviewFormResponse'));
    assert.ok(s['public-form'].operations.includes('submitPublicForm'));
  });

  it('экран этапа 4 без эталона ловится проверкой', () => {
    const bad = structuredClone(screens);
    delete bad.screens['tasks-board'].reference;
    assert.deepEqual(checkScreens(doc, bad), [
      'tasks-board: reference — «design-<снимок> · …» или «no-reference …»',
    ]);
  });
});

describe('контракт 0.7.0-stage4 (W4.02): примеры, аддитивность, журнал, версия', () => {
  const examples = loadExamples();

  it('примеры валидны; объяснение с объектом проекта и переход с причиной', () => {
    assert.deepEqual(checkExamples(doc, examples), []);
    const x = examples.get('explainAccess')?.get('project');
    assert.ok(x, 'explainAccess/project');
    const ok = examples.get('explainAccess').get('ok');
    assert.equal(x.memberId, ok.memberId);
    assert.equal(x.permission, 'tasks.update');
    assert.equal(x.allowed, true);
    assert.equal(x.denyCode, undefined);
    assert.deepEqual(x.object, {
      moduleKey: 'tasks',
      entityType: 'project',
      entityId: ok.grants[0].scope.resourceIds[0],
    });
    assert.deepEqual(
      x.checks.map((c) => [c.check, c.passed]),
      [
        ['tenant-membership-and-binding', true],
        ['tenant-state', true],
        ['module-installation', true],
        ['plan-entitlement', true],
        ['separation-of-duties', true],
        ['permission', true],
        ['resource-scope', true],
      ],
    );
    assert.equal(x.grants[0].matches, true);
    assert.equal(x.grants[0].mismatch, undefined);
    const t = examples.get('transitionTask')?.get('invalid_transition');
    assert.equal(t?.reason, 'checklist_open');
    assert.equal(t.detail, 'Сначала закройте чек-лист');
  });

  it('дельты W4.02: перечисления — надмножество 0.1, описания — с текстом 0.1 в начале', () => {
    assert.deepEqual(checkAgainstSource(doc, source, loadDeltas()).errors, []);
    const pointers = new Set(w402.map((d) => d.pointer));
    for (const p of [
      '/components/schemas/Scope/properties/kind/enum',
      '/components/schemas/Scope/description',
      '/components/schemas/Permission/properties/allowedScopeKinds/items/enum',
      '/components/schemas/UploadCreate/properties/purpose/enum',
      '/components/schemas/UploadCreate/description',
      '/components/schemas/Problem/properties/reason',
    ]) {
      assert.ok(pointers.has(p), `дельта ${p}`);
    }
    for (const d of w402.filter((x) => x.kind === 'change' && x.pointer !== '/info/version')) {
      const before = at(source, d.pointer);
      const now = at(doc, d.pointer);
      if (d.pointer.endsWith('/enum')) {
        assert.ok(
          before.every((v) => now.includes(v)) && now.length > before.length,
          `${d.pointer}: не надмножество`,
        );
      } else {
        assert.match(d.pointer, /\/description$/, `${d.pointer}: change не по описанию`);
        assert.ok(
          typeof before === 'string' && now.startsWith(before) && now.length > before.length,
          `${d.pointer}: описание 0.1 не сохранено в начале`,
        );
      }
    }
    assert.match(loadDeltas().find((x) => x.pointer === '/info/version').source, /W4\.02/);
  });

  it('журнал api/CHANGELOG.md и api/README.md: раздел 0.7.0-stage4, миграция tenant 0020 выдана W4.02', () => {
    const log = readFileSync(abs('api/CHANGELOG.md'), 'utf8');
    assert.match(log, /^## 0\.7\.0-stage4 — W4\.02/m);
    assert.ok(
      log.indexOf('## 0.7.0-stage4') < log.indexOf('## 0.6.2-stage2'),
      'новый раздел — сверху',
    );
    for (const w of ['Q-W4.00-repair-2', 'x-explain-objects', 'task_attachment', 'reason']) {
      assert.ok(log.includes(w), `CHANGELOG: ${w}`);
    }
    const readme = readFileSync(abs('api/README.md'), 'utf8');
    assert.match(readme, /## Этап 4, W4\.02 \(`0\.7\.0-stage4`\)/);
    assert.match(
      readme,
      /\|\s*tenant\s*\|\s*0020\s*\|\s*`0020_access_scope_kinds_stage4\.sql`[^|]*\|\s*W4\.02/,
    );
    assert.match(readme, /\|\s*tenant\s*\|\s*0021–0039\s*\|/);
  });

  it('возврат 1: api/README.md — порядок вливания tenant 0019 (W2.71) и 0020 (W4.02), goose без out-of-order', () => {
    const readme = readFileSync(abs('api/README.md'), 'utf8');
    const p = readme
      .split(/\n\n/)
      .find((x) => x.startsWith('**Порядок вливания номеров ниже применённого'));
    assert.ok(p, 'абзац «Порядок вливания номеров ниже применённого…»');
    for (const w of [
      'WithAllowOutofOrder',
      'missing migrations',
      'TestStage4W402LateLowerVersionRefused',
      'W2.71',
      '0019',
      '0020',
      '0021',
    ]) {
      assert.ok(p.includes(w), `README: ${w}`);
    }
  });

  it('версия контракта — 0.7.0-stage4', () => {
    assert.equal(doc.info.version, '0.7.0-stage4');
  });
});
