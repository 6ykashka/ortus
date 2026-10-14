// .mcp.json и tools/mcp-check.js: Playwright MCP как в проекте 2.0 (@playwright/mcp 0.0.78),
// --isolated, каталог вывода по порту. Бриф W0.05 §4.8, §6 п.11.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';

import { abs, load, read } from './_util.mjs';

const mod = await load('tools/mcp-check.js');
const need = (name) => {
  assert.equal(typeof mod[name], 'function', `${name} экспортирован`);
  return mod[name];
};
const MCP_CLI = 'frontend/packages/e2e-kit/node_modules/@playwright/mcp/cli.js';

describe('.mcp.json', () => {
  it('сервер playwright: node + cli.js из @ortus/e2e-kit, headless, isolated, вывод по порту', () => {
    assert.ok(existsSync(abs('.mcp.json')), '.mcp.json есть');
    const cfg = JSON.parse(read('.mcp.json'));
    const pw = cfg.mcpServers?.playwright;
    assert.equal(pw?.command, 'node');
    assert.equal(pw.args[0], MCP_CLI);
    for (const flag of ['--headless', '--isolated']) assert.ok(pw.args.includes(flag), flag);
    assert.equal(pw.args[pw.args.indexOf('--browser') + 1], 'chromium');
    assert.equal(pw.args[pw.args.indexOf('--output-dir') + 1], '.playwright-mcp/${PORT:-5200}');
  });

  it('@playwright/mcp — точная версия 0.0.78 в @ortus/e2e-kit', () => {
    const pkg = JSON.parse(read('frontend/packages/e2e-kit/package.json'));
    assert.equal(pkg.devDependencies['@playwright/mcp'], '0.0.78');
  });

  it('зависимости e2e-kit и apps/web — точные версии (кроме workspace:*)', () => {
    for (const file of [
      'frontend/packages/e2e-kit/package.json',
      'frontend/apps/web/package.json',
    ]) {
      const pkg = JSON.parse(read(file));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [name, v] of Object.entries(deps)) {
        assert.match(v, /^(\d+\.\d+\.\d+|workspace:\*)$/, `${file}: ${name}@${v}`);
      }
    }
  });
});

describe('mcp-check', () => {
  it('expandArgs раскрывает ${VAR:-default} и ${VAR}', () => {
    const expand = need('expandArgs');
    assert.deepEqual(expand(['.playwright-mcp/${PORT:-5200}'], {}), ['.playwright-mcp/5200']);
    assert.deepEqual(expand(['.playwright-mcp/${PORT:-5200}'], { PORT: '5206' }), [
      '.playwright-mcp/5206',
    ]);
    assert.deepEqual(expand(['${X}'], { X: 'y' }), ['y']);
  });

  it('REQUIRED_TOOLS — инструменты verification-protocol §4', () => {
    assert.deepEqual(mod.REQUIRED_TOOLS, [
      'browser_navigate',
      'browser_snapshot',
      'browser_click',
      'browser_type',
      'browser_select_option',
      'browser_resize',
      'browser_console_messages',
      'browser_network_requests',
      'browser_take_screenshot',
    ]);
  });

  it('сервер из .mcp.json стартует и отдаёт все нужные инструменты', async () => {
    const r = await need('checkServer')({ timeoutMs: 60_000 });
    assert.deepEqual(r.missing, []);
    assert.ok(r.tools.length >= mod.REQUIRED_TOOLS.length);
    assert.match(r.serverName, /playwright/i);
  });
});
