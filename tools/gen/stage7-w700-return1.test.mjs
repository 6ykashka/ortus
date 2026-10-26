// W7.00 · возврат 1 ревью: публичные пути без тенанта получают маршрут «токен/slug/ключ → тенант» (control 0011,
// формат ключа версии документа с тенантом), callback сервера документов объявляет схему безопасности и
// недвусмысленные ответы, отчёт согласован с матрицей изоляции. Бриф docs/plan/v2/ws/W7.00.md, ADR-0016.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { operationsById } from './lib/inventory.mjs';
import { abs } from './lib/paths.mjs';
import { readYaml } from './lib/yaml-io.mjs';

const doc = bundle();
const ops = operationsById(doc);
const op = (id) => ops.get(id)?.op;
const schemas = doc.components.schemas;
const text = (p) => readFileSync(abs(p), 'utf8');

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** Ключ версии: тенант, документ и версия — по нему адаптер находит базу тенанта без сессии. */
const KEY_RE = new RegExp(`^t${UUID}\\.d${UUID}\\.v[1-9][0-9]{0,9}$`);

describe('W7.00 возврат 1: ключ версии документа несёт тенанта', () => {
  it('documentKey и DocServerCallback.key — один формат t<тенант>.d<документ>.v<версия>', () => {
    for (const [name, prop] of [
      ['DocSessionConfig', 'documentKey'],
      ['DocServerCallback', 'key'],
    ]) {
      const p = schemas[name].properties[prop];
      assert.ok(p.pattern, `${name}.${prop}: pattern`);
      assert.equal(p.pattern, schemas.DocServerCallback.properties.key.pattern, name);
      const re = new RegExp(p.pattern);
      assert.ok(
        re.test(
          `t${'a'.repeat(8)}-aaaa-aaaa-aaaa-${'a'.repeat(12)}.d${'b'.repeat(8)}-bbbb-bbbb-bbbb-${'b'.repeat(12)}.v4`,
        ),
        name,
      );
      assert.ok(!re.test('doc-fuel:v4'), `${name}: старый формат отвергнут`);
      assert.ok(p.maxLength <= 128, name);
      assert.match(p.description, /tenant/i, name);
    }
    assert.ok(
      KEY_RE.test(
        `t${'1'.repeat(8)}-1111-1111-1111-${'1'.repeat(12)}.d${'2'.repeat(8)}-2222-2222-2222-${'2'.repeat(12)}.v12`,
      ),
    );
  });

  it('примеры сессии и публичного открытия — в новом формате', () => {
    for (const id of ['openDocumentSession', 'openDocLink']) {
      const ex = JSON.parse(text(`api/openapi/examples/${id}/ok.json`));
      const key = ex.documentKey ?? ex.config?.documentKey;
      assert.match(key, KEY_RE, id);
    }
    const names = readdirSync(abs('api/openapi/examples/docServerCallback')).sort();
    assert.deepEqual(names, [
      'invalid_transition.json',
      'not_found.json',
      'ok.json',
      'session_expired.json',
      'validation_failed.json',
    ]);
  });

  it('ADR-0016 фиксирует формат ключа и порядок определения тенанта', () => {
    const adr = text('docs/adr/0016-docs-server-and-chat-hints.md');
    assert.match(adr, /t<тенант>\.d<документ>\.v<версия>/);
    assert.match(adr, /control 0011/);
    assert.doesNotMatch(adr, /`<документ>:v<версия>`/);
  });
});

describe('W7.00 возврат 1: docServerCallback', () => {
  const o = op('docServerCallback');

  it('схема безопасности объявлена: docServerJwt, ответ 401, без cookie и bearer пользователя', () => {
    assert.deepEqual(o.security, [{ docServerJwt: [] }]);
    const sch = doc.components.securitySchemes.docServerJwt;
    assert.equal(sch.type, 'http');
    assert.equal(sch.scheme, 'bearer');
    assert.equal(sch.bearerFormat, 'JWT');
    assert.ok(o.responses['401']);
    assert.ok(o.responses['404']);
    assert.ok(o['x-public-capability']);
  });

  it('описание — по-английски, без обрывочных фраз; неизвестный ключ при верной подписи — 404', () => {
    assert.doesNotMatch(o.description, /[А-Яа-яЁё]/, 'русские слова в английском контракте');
    assert.doesNotMatch(o.description, /is not used/);
    assert.match(o.description, /404 not_found/);
    assert.match(o.description, /409 invalid_transition/);
    assert.match(o.description, /t<tenantId>\.d<documentId>\.v<version>/);
    assert.match(o.description, /control/);
  });

  it('401 — неверная подпись; 403 не используется для подписи', () => {
    assert.match(o.description, /401 session_expired|401 unauthenticated|401/);
    assert.doesNotMatch(o.description, /403 forbidden_action for a bad signature/);
  });
});

describe('W7.00 возврат 1: публичные пути и control-индекс', () => {
  it('README фиксирует control 0011 и индекс токенов, slug и ключей', () => {
    const readme = text('api/README.md');
    assert.match(readme, /\|\s*control\s*\|\s*0011\s*\|\s*`0011_public_docs_service_index\.sql`/);
    assert.match(readme, /\|\s*control\s*\|\s*0012\+\s*\|/);
    const log = text('api/CHANGELOG.md');
    assert.match(log, /control 0011/);
  });

  it('публичные пути объявляют, чем выбирается тенант', () => {
    for (const id of [
      'openDocLink',
      'getPublicServicePage',
      'submitPublicServiceRequest',
      'getPublicServiceRequest',
    ]) {
      assert.match(op(id).description, /control/, id);
    }
  });

  it('все операции публичных тегов перечислены; control-таблицы названы в описаниях', () => {
    const open = op('openDocLink').description;
    assert.match(open, /public_doc_links/);
    assert.match(op('getPublicServicePage').description, /public_service_slugs/);
    assert.match(op('getPublicServiceRequest').description, /public_service_tokens/);
  });
});

describe('W7.00 возврат 1: отчёт и матрица изоляции согласованы', () => {
  it('число тенантных операций Docs в матрице = 45 и в отчёте', () => {
    const dir = abs('backend/test/isolation');
    const files = readdirSync(dir).filter((f) => /^docs_w700(_gate)?\.yaml$/.test(f));
    assert.equal(files.length, 2);
    for (const f of files) {
      const y = readYaml(`${dir}/${f}`);
      assert.equal(y.endpoints.length, 45, f);
    }
    const report = text('docs/plan/v2/reports/W7.00.md');
    assert.doesNotMatch(report, /docs_w700\.yaml[^\n]*43 тенантн/);
    assert.match(report, /docs_w700\.yaml[^\n]*45 тенантных операций/);
  });
});
