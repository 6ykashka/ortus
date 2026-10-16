// W1.49 · Возврат 1 · Проходка Playwright MCP (verification-protocol §4): переключатель бизнеса массажиста —
// цель ≥ 44 px на 390, 768 и 1440, вся цель кликабельна, поповер «Бизнесы» открывается; консоль без ошибок.
// Сервер @playwright/mcp из .mcp.json по stdio (как ../walk.mjs). Запуск: node walk.mjs <worktree>.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WT = process.argv[2];
const APP = 'http://127.0.0.1:5203';
const OUT = join(WT, '.playwright-mcp', '5203');
const EV = join(WT, 'docs/plan/evidence/shell/w1.49/return-1');
for (const d of [OUT, EV]) mkdirSync(d, { recursive: true });

const child = spawn(
  'node',
  [
    join(WT, 'frontend/packages/e2e-kit/node_modules/@playwright/mcp/cli.js'),
    '--browser',
    'chromium',
    '--headless',
    '--isolated',
    '--output-dir',
    OUT,
  ],
  { cwd: WT, stdio: ['pipe', 'pipe', 'pipe'] },
);
const pending = new Map();
let buf = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    const w = pending.get(m.id);
    if (w) {
      pending.delete(m.id);
      if (m.error) w.rej(new Error(JSON.stringify(m.error)));
      else w.res(m.result);
    }
  }
});
child.stderr.on('data', () => {});
let id = 1;
const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
const request = (method, params) => {
  const i = id++;
  send({ jsonrpc: '2.0', id: i, method, params });
  return new Promise((res, rej) => pending.set(i, { res, rej }));
};
const log = [];
const checks = [];
async function call(name, args = {}) {
  const r = await request('tools/call', { name, arguments: args });
  const text = (r.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  log.push(`### ${name} ${JSON.stringify(args)}\n${text}\n`);
  if (r.isError) throw new Error(`${name}: ${text}`);
  return text;
}
const yaml = (t) => {
  const i = t.indexOf('```yaml');
  if (i < 0) return t;
  return t.slice(i + 7, t.indexOf('```', i + 7)).trim();
};
function ref(snap, role, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`- ${role} "[^"]*${esc}[^"]*"[^\\n]*\\[ref=([a-z0-9]+)\\]`).exec(snap);
  if (!m) throw new Error(`нет ${role} "${name}" в снимке`);
  return m[1];
}
const check = (name, ok, detail = '') => {
  checks.push(`| ${checks.length + 1} | ${name} | ${ok ? 'ok' : 'FAIL'} | ${detail.replace(/\|/g, '/')} |`);
  if (!ok) console.error(`FAIL: ${name} ${detail}`);
};
const snap = async (file) => {
  const t = yaml(await call('browser_snapshot'));
  writeFileSync(join(EV, file), `\`\`\`yaml\n${t}\n\`\`\`\n`, 'utf8');
  return t;
};
const shot = async (file) => {
  await call('browser_take_screenshot', { filename: file });
  const src = join(OUT, file);
  if (existsSync(src)) copyFileSync(src, join(EV, file));
};
const evaluate = async (fn) => {
  const t = await call('browser_evaluate', { function: fn });
  const m = /### Result\s*\n([\s\S]*?)(\n###|$)/.exec(t);
  return (m ? m[1] : t).trim();
};
const wait = (s) => call('browser_wait_for', { time: s });

// Цель переключателя: размер, попадания в верх, середину и низ, место названия (верх строки названия).
const MEASURE = `() => {
  const el = document.querySelector('.ox-org-switch');
  if (!el) return 'нет .ox-org-switch';
  const r = el.getBoundingClientRect();
  const name = el.querySelector('.ox-org-name').getBoundingClientRect();
  const x = r.left + r.width / 2;
  const hits = [r.top + 4, r.top + r.height / 2, r.bottom - 4].map((y) => el.contains(document.elementFromPoint(x, y)));
  return { w: Math.round(r.width), h: Math.round(r.height), nameTop: Math.round(name.top), nameH: Math.round(name.height), hits };
}`;

try {
  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'w1.49-return-1', version: '1' },
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  await call('browser_resize', { width: 1440, height: 900 });
  await call('browser_navigate', { url: `${APP}/?persona=therapist` });
  await wait(3);
  for (const [w, h] of [
    [390, 844],
    [768, 1024],
    [1440, 900],
  ]) {
    await call('browser_resize', { width: w, height: h });
    await wait(1);
    const m = JSON.parse(await evaluate(MEASURE));
    check(
      `${w}: переключатель «… — сменить бизнес» ≥ 44×44 px`,
      m.h >= 44 && m.w >= 44,
      `${m.w}×${m.h} px; строка названия ${m.nameH} px, верх ${m.nameTop} px`,
    );
    check(`${w}: верх, середина и низ цели — переключатель`, m.hits.every(Boolean), JSON.stringify(m.hits));
    const s = await snap(`snap-therapist-${w}.md`);
    await shot(`impl-therapist-${w}.png`);
    await call('browser_click', {
      element: 'сменить бизнес',
      target: ref(s, 'button', 'сменить бизнес'),
    });
    const open = await snap(`snap-therapist-${w}-switcher.md`);
    check(`${w}: клик — поповер «Бизнесы»`, open.includes('dialog "Бизнесы"'));
    if (w === 390) await shot('impl-therapist-390-switcher.png');
    await call('browser_press_key', { key: 'Escape' });
    await evaluate(`() => { document.activeElement?.blur(); return 'ok'; }`);
    const closed = await snap(`snap-therapist-${w}-closed.md`);
    if (closed.includes('dialog "Бизнесы"')) {
      await call('browser_click', {
        element: 'сменить бизнес',
        target: ref(closed, 'button', 'сменить бизнес'),
      });
    }
  }
  const consoleText = await call('browser_console_messages', { level: 'error' });
  writeFileSync(join(EV, 'console.md'), consoleText, 'utf8');
  // Запрос браузера /favicon.ico (в index.html W0.09 значка нет) — не ошибка приложения; учитывается отдельно.
  const lines = consoleText.split('\n').filter((l) => l.startsWith('[ERROR]'));
  const favicon = lines.filter((l) => l.includes('/favicon.ico'));
  const app = lines.length - favicon.length;
  check(
    'консоль: ошибок приложения нет',
    app === 0,
    `ошибок приложения ${app}; 404 /favicon.ico браузера — ${favicon.length} (console.md)`,
  );
} catch (e) {
  check('проходка без исключений', false, String(e?.message ?? e));
} finally {
  writeFileSync(
    join(EV, 'checks.md'),
    `# W1.49 · возврат 1 · проходка MCP — переключатель бизнеса\n\n| # | Проверка | Итог | Детали |\n|---|---|---|---|\n${checks.join('\n')}\n`,
    'utf8',
  );
  writeFileSync(join(EV, 'mcp-log.md'), log.join('\n'), 'utf8');
  child.kill();
  console.log(checks.join('\n'));
}
