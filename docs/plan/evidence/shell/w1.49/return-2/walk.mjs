// W1.49 · Возврат 2 · Проходка Playwright MCP (verification-protocol §4): кольцо :focus-visible переключателя
// бизнеса массажиста с клавиатуры — внутри шапки, только на строке названия; цель ≥ 44 px попаданием; поповер.
// Сервер @playwright/mcp из .mcp.json по stdio (как ../walk.mjs). Запуск: node walk.mjs <worktree>.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WT = process.argv[2];
const APP = 'http://127.0.0.1:5203';
const OUT = join(WT, '.playwright-mcp', '5203');
const EV = join(WT, 'docs/plan/evidence/shell/w1.49/return-2');
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
  // Эта версия @playwright/mcp пишет снимок относительно cwd (корня worktree), прежняя — в --output-dir.
  for (const src of [join(OUT, file), join(WT, file)]) {
    if (!existsSync(src)) continue;
    copyFileSync(src, join(EV, file));
    if (src === join(WT, file)) rmSync(src);
    break;
  }
};
const evaluate = async (fn) => {
  const t = await call('browser_evaluate', { function: fn });
  const m = /### Result\s*\n([\s\S]*?)(\n###|$)/.exec(t);
  return (m ? m[1] : t).trim();
};
const wait = (s) => call('browser_wait_for', { time: s });

// Кольцо фокуса и цель: рамка кнопки, кольцо (outline + offset), строка названия и области, шапка; полоса
// попаданий elementFromPoint через центр названия (шаг 0,5 px) в пределах шапки.
const MEASURE = `() => {
  const el = document.activeElement;
  if (!el || !el.classList.contains('ox-org-switch')) return JSON.stringify({ focused: false, label: el?.getAttribute('aria-label') ?? el?.tagName });
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const hdr = el.closest('header').getBoundingClientRect();
  const name = el.querySelector('.ox-org-name').getBoundingClientRect();
  const scope = el.parentElement.querySelector('.ox-org-scope').getBoundingClientRect();
  const out = parseFloat(s.outlineWidth) + Math.max(0, parseFloat(s.outlineOffset));
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const hit = (x, y) => el.contains(document.elementFromPoint(x, y));
  let lo = cy, hi = cy;
  while (lo - 0.5 >= Math.max(0, hdr.top) && hit(cx, lo - 0.5)) lo -= 0.5;
  while (hi + 0.5 <= hdr.bottom - 0.5 && hit(cx, hi + 0.5)) hi += 0.5;
  const f = (v) => Math.round(v * 10) / 10;
  return JSON.stringify({
    focused: true,
    outline: s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor + ' off ' + s.outlineOffset,
    box: [f(r.left), f(r.top), f(r.width), f(r.height)],
    ring: [f(r.top - out), f(r.bottom + out)],
    name: [f(name.top), f(name.bottom)],
    scope: [f(scope.top), f(scope.bottom)],
    header: [f(hdr.top), f(hdr.bottom)],
    target: [lo, hi, hi - lo + 0.5],
  });
}`;

try {
  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'w1.49-return-2', version: '1' },
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  for (const [w, h] of [
    [390, 844],
    [768, 1024],
    [1440, 900],
  ]) {
    await call('browser_resize', { width: w, height: h });
    await call('browser_navigate', { url: `${APP}/?persona=therapist` });
    await wait(3);
    // С клавиатуры: Tab до переключателя (первый Tab — «К содержимому»).
    let m = { focused: false };
    for (let i = 0; i < 6 && !m.focused; i++) {
      await call('browser_press_key', { key: 'Tab' });
      m = JSON.parse(JSON.parse(await evaluate(MEASURE)));
    }
    check(`${w}: Tab — фокус на «… — сменить бизнес»`, m.focused, m.outline ?? JSON.stringify(m));
    if (!m.focused) continue;
    check(
      `${w}: кольцо видно и внутри шапки`,
      !m.outline.startsWith('none') && m.ring[0] >= Math.max(0, m.header[0]) && m.ring[1] <= m.header[1],
      `кольцо y ${m.ring[0]}…${m.ring[1]}, шапка ${m.header[0]}…${m.header[1]}; ${m.outline}`,
    );
    check(
      `${w}: рамка — строка названия, строка области вне рамки`,
      m.box[1] >= m.name[0] - 1 && m.box[1] + m.box[3] <= Math.min(m.name[1], m.scope[0]) + 1,
      `рамка y ${m.box[1]}…${Math.round((m.box[1] + m.box[3]) * 10) / 10}, название ${m.name[0]}…${m.name[1]}, область ${m.scope[0]}…${m.scope[1]}`,
    );
    check(
      `${w}: кольцо не заходит на текст строки области (≤ 2 px в строку)`,
      m.ring[1] <= m.scope[0] + 2,
      `низ кольца ${m.ring[1]}, верх строки области ${m.scope[0]}`,
    );
    check(
      `${w}: цель ≥ 44 px попаданием, внутри шапки`,
      m.target[2] >= 44 && m.box[2] >= 44 && m.target[0] >= 0 && m.target[1] <= m.header[1],
      `полоса y ${m.target[0]}…${m.target[1]} (${m.target[2]} px), ширина ${m.box[2]} px`,
    );
    await shot(`impl-therapist-${w}-focus.png`);
    await call('browser_press_key', { key: 'Enter' });
    const open = await snap(`snap-therapist-${w}-switcher.md`);
    check(`${w}: Enter — поповер «Бизнесы»`, open.includes('dialog "Бизнесы"'));
    await call('browser_press_key', { key: 'Escape' });
    const back = JSON.parse(JSON.parse(await evaluate(MEASURE)));
    check(`${w}: Escape — фокус снова на переключателе`, back.focused === true, back.outline ?? '');
  }
  const consoleText = await call('browser_console_messages', { level: 'error' });
  writeFileSync(join(EV, 'console.md'), consoleText, 'utf8');
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
    `# W1.49 · возврат 2 · проходка MCP — кольцо фокуса переключателя бизнеса\n\n| # | Проверка | Итог | Детали |\n|---|---|---|---|\n${checks.join('\n')}\n`,
    'utf8',
  );
  writeFileSync(join(WT, '.playwright-mcp', 'w1.49-return-2-log.md'), log.join('\n'), 'utf8');
  child.kill();
  console.log(checks.join('\n'));
}
