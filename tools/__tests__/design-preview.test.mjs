// tools/design-preview.js: офлайн-эталон (W0.05, бриф §4.7, §6 п.7).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { abs, load, read } from './_util.mjs';

const MAIN = 'Ортус CRM.dc.html';
const mod = await load('tools/design-preview.js');

async function listen(opts) {
  assert.equal(typeof mod.createPreviewServer, 'function', 'createPreviewServer экспортирован');
  const server = mod.createPreviewServer(opts);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

const close = (s) => new Promise((resolve) => (s ? s.close(resolve) : resolve()));

/** Запрос с «сырым» путём: fetch схлопывает «..» и `%2e%2e` до отправки. */
const rawStatus = (base, path) =>
  new Promise((resolve, reject) => {
    const { hostname, port } = new URL(base);
    const req = request({ hostname, port, path }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
const enc = (name) => `/${encodeURIComponent(name)}`;

describe('rewriteDcHtml (--offline)', () => {
  it('экспортирует чистую функцию rewriteDcHtml', () => {
    assert.equal(typeof mod.rewriteDcHtml, 'function');
  });

  it('вставляет React UMD из /__vendor/ перед ./support.js и не задаёт __resources', () => {
    const out = mod.rewriteDcHtml(read(`design/${MAIN}`));
    const react = out.indexOf('<script src="/__vendor/react.production.min.js"></script>');
    const dom = out.indexOf('<script src="/__vendor/react-dom.production.min.js"></script>');
    const support = out.indexOf('<script src="./support.js"></script>');
    assert.ok(react > 0 && dom > react && support > dom, 'порядок: react → react-dom → support.js');
    assert.ok(!out.includes('__resources'), 'window.__resources не задаётся (support.js:158)');
  });

  it('убирает Google Fonts: нет preconnect, стили → /__fonts/fonts.css', () => {
    const out = mod.rewriteDcHtml(read(`design/${MAIN}`));
    assert.ok(!out.includes('fonts.googleapis.com'));
    assert.ok(!out.includes('rel="preconnect"'));
    assert.equal(out.split('href="/__fonts/fonts.css"').length - 1, 2);
  });

  it('не трогает html без support.js и шрифтов', () => {
    const html = '<!DOCTYPE html><p>x</p>';
    assert.equal(mod.rewriteDcHtml(html), html);
  });
});

describe('parseArgs', () => {
  it('разбирает <dir> <port> и флаги', () => {
    assert.equal(typeof mod.parseArgs, 'function');
    const a = mod.parseArgs(['design', '4106', '--offline', '--ref', 'design-stage-1']);
    assert.equal(a.dir, 'design');
    assert.equal(a.port, 4106);
    assert.equal(a.offline, true);
    assert.equal(a.ref, 'design-stage-1');
    assert.equal(mod.parseArgs(['design']).port, 4173);
    assert.equal(mod.parseArgs(['design']).offline, false);
  });
});

describe('сервер без флагов (regression)', () => {
  let s;
  before(async () => {
    s = await listen({ dir: abs('design') });
  });
  after(() => close(s?.server));

  it('отдаёт .dc.html байт-в-байт и с text/html', async () => {
    const res = await fetch(s.base + enc(MAIN));
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = Buffer.from(await res.arrayBuffer());
    assert.ok(body.equals(readFileSync(abs(`design/${MAIN}`))));
  });

  it('ES-модули ortus/*.js — text/javascript', async () => {
    const res = await fetch(`${s.base}/ortus/models.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/javascript/);
  });

  it('выход за корень → 403, нет файла → 404', async () => {
    assert.equal(await rawStatus(s.base, '/../package.json'), 403);
    assert.equal(await rawStatus(s.base, '/%2e%2e/package.json'), 403);
    const miss = await fetch(`${s.base}/nope.txt`);
    assert.equal(miss.status, 404);
  });

  it('виртуальные /__vendor/ без --offline не отдаются', async () => {
    const res = await fetch(`${s.base}/__vendor/react.production.min.js`);
    assert.equal(res.status, 404);
  });

  it('/favicon.ico, которого нет в эталоне, → 204 (консоль браузера и MCP без 404)', async () => {
    const res = await fetch(`${s.base}/favicon.ico`);
    assert.equal(res.status, 204);
  });
});

describe('сервер --offline', () => {
  let s;
  before(async () => {
    s = await listen({
      dir: abs('design'),
      offline: true,
      fontsDir: abs('tools/__tests__/no-fonts'),
    });
  });
  after(() => close(s?.server));

  it('.dc.html переписан, остальные файлы — байт-в-байт', async () => {
    const html = await (await fetch(s.base + enc(MAIN))).text();
    assert.ok(html.includes('/__vendor/react.production.min.js'));
    assert.ok(!html.includes('fonts.googleapis.com'));
    const js = Buffer.from(await (await fetch(`${s.base}/support.js`)).arrayBuffer());
    assert.ok(js.equals(readFileSync(abs('design/support.js'))));
  });

  it('/__vendor/react*.js → 200 text/javascript', async () => {
    for (const f of ['react.production.min.js', 'react-dom.production.min.js']) {
      const res = await fetch(`${s.base}/__vendor/${f}`);
      assert.equal(res.status, 200, f);
      assert.match(res.headers.get('content-type'), /^text\/javascript/);
    }
  });

  it('/__fonts/fonts.css без шрифтов токенов → 200 text/css (пустой)', async () => {
    const res = await fetch(`${s.base}/__fonts/fonts.css`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/css/);
    assert.match(await res.text(), /W0\.10/);
  });

  it('/__vendor/../ → 403', async () => {
    assert.equal(await rawStatus(s.base, '/__vendor/../design-preview.js'), 403);
    assert.equal(await rawStatus(s.base, '/__vendor/%2e%2e/design-preview.js'), 403);
  });
});

describe('сервер --ref <git-ref> (снимок этапа, PD-57)', () => {
  let s;
  before(async () => {
    s = await listen({ dir: abs('design'), ref: 'design-2026-10-03' });
  });
  after(() => close(s?.server));

  it('отдаёт файл из тега, а не из рабочей копии', async () => {
    const res = await fetch(s.base + enc('Ortus CRM.dc.html'));
    assert.equal(res.status, 200);
    const expected = execFileSync('git', ['show', 'design-2026-10-03:design/Ortus CRM.dc.html'], {
      cwd: abs('.'),
    });
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(expected));
  });

  it('файла нет в теге → 404', async () => {
    const res = await fetch(`${s.base}/nope.txt`);
    assert.equal(res.status, 404);
  });
});

// Хук pre-push из linked worktree получает GIT_DIR=<repo>/.git/worktrees/<name> без GIT_WORK_TREE:
// git тогда считает cwd корнем рабочей копии (W2.82).
describe('сервер --ref при заданном GIT_DIR (хук pre-push из worktree)', () => {
  const REF = 'design-2026-10-03';
  const FILE = 'Ortus CRM.dc.html';
  let s;
  let expected;
  let saved;
  before(async () => {
    const top = abs('.');
    expected = execFileSync('git', ['show', `${REF}:design/${FILE}`], { cwd: top });
    const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: top })
      .toString()
      .trim();
    saved = process.env.GIT_DIR;
    process.env.GIT_DIR = gitDir;
    s = await listen({ dir: abs('design'), ref: REF });
  });
  after(async () => {
    if (saved === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = saved;
    await close(s?.server);
  });

  it('отдаёт файл из тега по пути от корня репозитория', async () => {
    const res = await fetch(s.base + enc(FILE));
    assert.equal(res.status, 200);
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(expected));
  });

  it('файла нет в теге → 404', async () => {
    const res = await fetch(`${s.base}/nope.txt`);
    assert.equal(res.status, 404);
  });
});
