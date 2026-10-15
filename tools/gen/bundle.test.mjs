// W0.07 · Раскладка OpenAPI 0.1 по тегам и бандл с проверкой равенства исходнику
// (бриф docs/plan/v2/ws/W0.07.md §4.1, план v2 PD-56).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { bundle, serializeBundle } from './lib/bundle.mjs';
import { parseRef, resolveTokens } from './lib/refs.mjs';
import { listOperations } from './lib/inventory.mjs';
import { abs, BUNDLE_PATH, ROOT, ROOT_SPEC, SOURCE_0_1 } from './lib/paths.mjs';
import { checkAgainstSource, loadDeltas } from './lib/source-diff.mjs';
import { splitSpec } from './openapi-split.mjs';
import { readYaml } from './lib/yaml-io.mjs';

const TAGS = [
  'Context',
  'Platform',
  'Billing',
  'Access',
  'Modules',
  'Data',
  'Files',
  'Tasks',
  'Knowledge',
  'Calendar',
  'Forms',
  'PublicForms',
  'Fleet',
  'Earnings',
  'Spa',
  'Inventory',
  'Cash',
  'Repairs',
];

const source = readYaml(SOURCE_0_1);

// Теги корня: 18 тегов 0.1 + добавленные контрактными PR этапов (W0.08: Auth).
const rootTags = readYaml(ROOT_SPEC).tags.map((t) => t.name);

describe('раскладка OpenAPI 0.1 по тегам', () => {
  it('18 тегов 0.1 на месте; файл paths на каждый тег корня (имя — тег в нижнем регистре)', () => {
    assert.deepEqual(
      TAGS.filter((t) => !rootTags.includes(t)),
      [],
    );
    const files = readdirSync(abs('api/openapi/paths'))
      .filter((f) => f.endsWith('.yaml'))
      .sort();
    assert.deepEqual(files, rootTags.map((t) => `${t.toLowerCase()}.yaml`).sort());
  });

  it('в файле тега только операции этого тега', () => {
    for (const tag of rootTags) {
      const doc = readYaml(abs(`api/openapi/paths/${tag.toLowerCase()}.yaml`));
      const wrong = listOperations({ paths: doc }).filter((o) => o.tag !== tag);
      assert.deepEqual(
        wrong.map((o) => o.operationId),
        [],
        `paths/${tag.toLowerCase()}.yaml`,
      );
    }
  });

  it('исходник самодостаточен: каждый $ref и discriminator.mapping разрешается от своего файла', () => {
    const files = [
      ROOT_SPEC,
      ...readdirSync(abs('api/openapi/paths')).map((f) => abs(`api/openapi/paths/${f}`)),
      ...readdirSync(abs('api/openapi/components')).flatMap((g) =>
        readdirSync(abs(`api/openapi/components/${g}`)).map((f) =>
          abs(`api/openapi/components/${g}/${f}`),
        ),
      ),
    ];
    const broken = [];
    for (const file of files) {
      const refs = [];
      const walk = (o) => {
        if (Array.isArray(o)) o.forEach(walk);
        else if (o && typeof o === 'object') {
          for (const [k, v] of Object.entries(o)) {
            if (k === '$ref' && typeof v === 'string') refs.push(v);
            else if (k === 'discriminator' && v?.mapping) refs.push(...Object.values(v.mapping));
            else walk(v);
          }
        }
      };
      walk(readYaml(file));
      for (const ref of refs) {
        const { file: target, tokens } = parseRef(ref);
        const label = `${relative(ROOT, file).replaceAll('\\', '/')}: ${ref}`;
        try {
          resolveTokens(readYaml(target ? resolve(dirname(file), target) : file), tokens, label);
        } catch {
          broken.push(label);
        }
      }
    }
    assert.deepEqual(broken, []);
  });

  it('раскладка 0.1 переписывает discriminator.mapping в относительные ссылки', () => {
    const files = splitSpec(source);
    const mapping = files.get('components/modules/schemas.yaml').value.ModuleSettings.discriminator
      .mapping;
    assert.equal(mapping.fleet, './schemas.yaml#/LogisticsSettings');
  });

  it('корень не содержит компонентов: только ссылки на файлы тегов', () => {
    const root = readYaml(ROOT_SPEC);
    assert.equal(root.components, undefined);
    for (const [p, item] of Object.entries(root.paths)) {
      assert.match(item.$ref, /^paths\/[a-z]+\.yaml#\//, p);
    }
  });
});

describe('бандл', () => {
  const doc = bundle();

  it('бандл содержит все 118 операций и 76 путей 0.1 (контракт после 0.1 только аддитивный)', () => {
    assert.equal(listOperations(source).length, 118);
    assert.equal(Object.keys(source.paths).length, 76);
    assert.deepEqual(
      Object.keys(source.paths).filter((p) => !(p in doc.paths)),
      [],
    );
  });

  it('все operationId 0.1 на месте, operationId бандла уникальны', () => {
    const ids = listOperations(doc).map((o) => o.operationId);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(
      listOperations(source)
        .map((o) => o.operationId)
        .filter((id) => !ids.includes(id)),
      [],
    );
  });

  it('бандл равен 0.1 вне объявленных отличий source-delta.yaml', () => {
    const { errors } = checkAgainstSource(doc, source, loadDeltas());
    assert.deepEqual(errors, []);
  });

  it('лишнее отличие от 0.1 ловится с указателем', () => {
    const changed = structuredClone(doc);
    changed.paths['/api/v1/me/context'].get.summary = 'Подмена';
    const { errors } = checkAgainstSource(changed, source, loadDeltas());
    assert.equal(errors.length, 1);
    assert.match(errors[0], /\/paths\/~1api~1v1~1me~1context\/get\/summary/);
  });

  it('неиспользуемая дельта ловится', () => {
    const deltas = [
      ...loadDeltas(),
      { pointer: '/info/x-never', kind: 'add', source: 'тест', reason: 'тест' },
    ];
    const { errors } = checkAgainstSource(doc, source, deltas);
    assert.ok(
      errors.some((e) => e.includes('/info/x-never') && e.includes('не используется')),
      errors.join('\n'),
    );
  });

  it('бандл детерминирован: два прогона байт-в-байт', async () => {
    const a = await serializeBundle(bundle());
    const b = await serializeBundle(bundle());
    assert.equal(a, b);
    assert.ok(!a.includes('\r'), 'только LF');
  });

  it('api/dist/ortus.bundle.yaml свежий (нет дрейфа)', async () => {
    const fresh = await serializeBundle(doc);
    assert.equal(readFileSync(BUNDLE_PATH, 'utf8'), fresh);
  });

  it('бандл отслеживается git (корневой .gitignore исключает dist/)', () => {
    const r = spawnSync('git', ['ls-files', '--error-unmatch', 'api/dist/ortus.bundle.yaml'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
  });

  it('api/dist не игнорируется git: новый бандл добавляется без git add -f', () => {
    const r = spawnSync(
      'git',
      ['check-ignore', '--no-index', '-v', 'api/dist/ortus.bundle.yaml', 'api/dist/other.yaml'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    assert.equal(r.status, 1, `игнорируется: ${r.stdout}`);
  });

  it('ссылки в бандле только внутренние', () => {
    const external = [];
    const walk = (o, p) => {
      if (Array.isArray(o)) o.forEach((x, i) => walk(x, `${p}/${i}`));
      else if (o && typeof o === 'object') {
        for (const [k, v] of Object.entries(o)) {
          if (k === '$ref' && !String(v).startsWith('#/components/')) external.push(`${p}: ${v}`);
          else walk(v, `${p}/${k}`);
        }
      }
    };
    walk(doc, '');
    assert.deepEqual(external, []);
  });

  it('дубликат имени компонента в двух группах отклоняется', () => {
    assert.throws(
      () => bundle(abs('tools/gen/fixtures/dup-component/ortus.yaml')),
      /дубликат.*schemas\/Foo/,
    );
  });
});
