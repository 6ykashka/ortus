// W0.09 · make gen: кодогенерация из бандла OpenAPI (бриф docs/plan/v2/ws/W0.09.md §4.2, тест T1).
// Чистые функции модели и рендера; сам запуск oapi-codegen и openapi-typescript проверяет дрейф CI
// (`contract/codegen-drift`): повторный `pnpm run gen` не меняет файлов.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { oapiConfig, operationsOf, problemsOf, tagsOf, tenantActionsOf } from './codegen/model.mjs';
import {
  renderOperationsGo,
  renderPermissionsGo,
  renderProblemsGo,
  renderRouterGo,
} from './codegen/render.mjs';
import { abs, BUNDLE_PATH, ERRORS_PATH, PERMISSIONS_PATH } from './lib/paths.mjs';
import { readYaml } from './lib/yaml-io.mjs';
import { W5_CODES } from './lib/stage5.mjs';

const bundle = readYaml(BUNDLE_PATH);
const errors = readYaml(ERRORS_PATH);
const permissions = readYaml(PERMISSIONS_PATH);

describe('теги → пакеты Go (план v2 §3.5: backend/internal/api/<tag>/)', () => {
  const tags = tagsOf(bundle);

  // Контракт после 0.1 только аддитивный (W0.08 добавил тег Auth): число тегов не зашито.
  it('все теги бандла в порядке объявления; 18 тегов 0.1 на месте', () => {
    assert.deepEqual(
      tags.map((t) => t.tag),
      bundle.tags.map((t) => t.name),
    );
    assert.ok(tags.length >= 18);
    assert.equal(tags[0].tag, 'Context');
    assert.equal(tags.at(-1).tag, 'Repairs');
  });

  it('пакет — имя тега в нижнем регистре, псевдоним импорта <pkg>api', () => {
    const pf = tags.find((t) => t.tag === 'PublicForms');
    assert.deepEqual(pf, {
      tag: 'PublicForms',
      pkg: 'publicforms',
      alias: 'publicformsapi',
      field: 'PublicForms',
      dir: 'backend/internal/api/publicforms',
      file: 'backend/internal/api/publicforms/publicforms.gen.go',
    });
  });

  it('конфиг oapi-codegen: strict server на chi, только операции тега, без встроенной спецификации', () => {
    const cfg = oapiConfig(tagsOf(bundle)[0]);
    assert.match(cfg, /^package: context$/m);
    assert.match(cfg, /^ {2}chi-server: true$/m);
    assert.match(cfg, /^ {2}strict-server: true$/m);
    assert.match(cfg, /^ {2}models: true$/m);
    assert.match(cfg, /^ {2}include-tags:\n {4}- Context$/m);
    assert.doesNotMatch(cfg, /embedded-spec: true/);
    assert.match(cfg, /^output: backend\/internal\/api\/context\/context\.gen\.go$/m);
  });
});

describe('каталог операций (шлюз cmd/api)', () => {
  const ops = operationsOf(bundle);
  const byId = Object.fromEntries(ops.map((o) => [o.id, o]));

  it('каждая операция бандла (не меньше 118 операций 0.1), отсортированы по пути и методу', () => {
    const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];
    const inBundle = Object.values(bundle.paths).flatMap((item) =>
      METHODS.filter((m) => item[m]?.operationId),
    ).length;
    assert.equal(ops.length, inBundle);
    assert.ok(ops.length >= 118);
    const keys = ops.map((o) => `${o.path} ${o.method}`);
    assert.deepEqual(keys, [...keys].sort());
  });

  it('getMyContext: identity, права пусты, не публичная, не изменяющая', () => {
    assert.deepEqual(byId.getMyContext, {
      id: 'getMyContext',
      tag: 'Context',
      method: 'GET',
      path: '/api/v1/me/context',
      permissions: [],
      permissionsMode: 'all',
      scope: 'identity',
      public: false,
      mutating: false,
      idempotent: false,
    });
  });

  it('listMembers: право members.read по x-permissions', () => {
    assert.deepEqual(byId.listMembers.permissions, ['members.read']);
    assert.equal(byId.listMembers.tag, 'Access');
  });

  it('security: [] → публичная операция; POST → изменяющая', () => {
    assert.equal(byId.submitPublicForm.public, true);
    assert.equal(byId.submitPublicForm.mutating, true);
    assert.equal(byId.listPlatformTenants.public, false);
  });

  // Ревью W1.00 (возврат 2, Q-W1.01-2): шлюз W1.01 включает guard идемпотентности по признаку операции, а не
  // по методу — одноразовый билет (createRealtimeTicket) и POST-чтения не сохраняются по чужому ключу.
  it('idempotent — операция объявляет параметр Idempotency-Key', () => {
    assert.equal(byId.selectTenant.idempotent, true);
    assert.equal(byId.logout.idempotent, true);
    assert.equal(byId.createRealtimeTicket.mutating, true);
    assert.equal(byId.createRealtimeTicket.idempotent, false);
    assert.equal(byId.getMyContext.idempotent, false);
    for (const o of ops) if (o.idempotent) assert.ok(o.mutating, `${o.id}: ключ только у команд`);
  });
});

describe('реестры для Go: коды ошибок и права', () => {
  it('52 кода errors.yaml со статусом и title, без client_states', () => {
    const p = problemsOf(errors);
    // 52 кода W0.07 и offer_closed W2.71 (0.6.3-stage2, D-35 комплекта).
    assert.equal(p.length, 53 + W5_CODES.length); // + 5 кодов кассы W5.00
    assert.deepEqual(
      p.find((x) => x.code === 'session_expired'),
      {
        code: 'session_expired',
        status: 401,
        title: 'Нет или истекла сессия',
      },
    );
    assert.equal(
      p.find((x) => x.code === 'offline'),
      undefined,
    );
  });

  it('tenant actions — все ключи каталога, кроме модуля platform, по алфавиту', () => {
    const a = tenantActionsOf(permissions);
    assert.ok(a.includes('members.read'));
    assert.ok(!a.some((k) => k.startsWith('platform.')));
    assert.deepEqual(a, [...a].sort());
    assert.equal(new Set(a).size, a.length);
  });
});

describe('рендер Go', () => {
  it('файлы помечены как сгенерированные (golangci-lint их пропускает)', () => {
    for (const text of [
      renderOperationsGo(operationsOf(bundle)),
      renderProblemsGo(problemsOf(errors)),
      renderPermissionsGo(tenantActionsOf(permissions)),
      renderRouterGo(tagsOf(bundle)),
    ]) {
      assert.match(text, /^\/\/ Code generated by tools\/gen\/codegen\.mjs\. DO NOT EDIT\.$/m);
    }
  });

  // W1.45: в имени «<файл>.go —», не «<файл>.go:» — иначе matcher setup-go даёт аннотацию X в CI.
  it('operations.gen.go — строка операции с правами', () => {
    const go = renderOperationsGo(operationsOf(bundle));
    assert.match(go, /^package catalog$/m);
    assert.match(
      go,
      /\{ID: "listMembers", Tag: "Access", Method: "GET", Path: "\/api\/v1\/tenants\/\{tenantId\}\/members", Permissions: \[\]string\{"members\.read"\}, PermissionsMode: "all", Scope: "tenant-or-org-unit", Public: false, Mutating: false, Idempotent: false\},/,
    );
  });

  it('problems.gen.go — код → статус и title', () => {
    const go = renderProblemsGo(problemsOf(errors));
    assert.match(go, /"session_expired": \{Status: 401, Title: "Нет или истекла сессия"\},/);
    assert.match(go, /"not_implemented": \{Status: 501, Title: /);
  });

  it('router.go — Servers с полем на тег; тег без реализации — 501', () => {
    const go = renderRouterGo(tagsOf(bundle));
    assert.match(go, /^package main$/m);
    assert.match(
      go,
      /^\tcontextapi "github\.com\/ortus\/ortus-crm\/backend\/internal\/api\/context"$/m,
    );
    assert.match(go, /^\tContext contextapi\.StrictServerInterface$/m);
    assert.match(go, /^\tif s\.Fleet != nil \{$/m);
    assert.match(go, /o\.notImplemented\(r, "Fleet"\)/);
    assert.match(
      go,
      /fleetapi\.NewStrictHandlerWithOptions\(s\.Fleet, nil, fleetapi\.StrictHTTPServerOptions\{/,
    );
  });

  it('рендер детерминирован', () => {
    assert.equal(renderRouterGo(tagsOf(bundle)), renderRouterGo(tagsOf(bundle)));
    assert.equal(
      renderOperationsGo(operationsOf(bundle)),
      renderOperationsGo(operationsOf(bundle)),
    );
  });
});

describe('корневой скрипт gen (≡ make gen)', () => {
  it('вызывает tools/gen/codegen.mjs, а не заглушку W0.03', () => {
    const pkg = JSON.parse(readFileSync(abs('package.json'), 'utf8'));
    assert.equal(pkg.scripts.gen, 'node tools/gen/codegen.mjs');
  });
});
