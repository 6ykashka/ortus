// W1.49 · Проходка Playwright MCP (verification-protocol §4): сервер @playwright/mcp из .mcp.json по stdio
// (как tools/mcp-check.js), клики — по ref снимка, найденному по роли и подписи.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WT = process.argv[2];
const APP = 'http://127.0.0.1:5203';
const REF = 'http://127.0.0.1:4103/%D0%9E%D1%80%D1%82%D1%83%D1%81%20CRM.dc.html';
const OUT = join(WT, '.playwright-mcp', '5203');
const EV_SHELL = join(WT, 'docs/plan/evidence/shell/w1.49');
const EV_GATE = join(WT, 'docs/plan/evidence/access-gate/w1.49');
for (const d of [OUT, EV_SHELL, EV_GATE]) mkdirSync(d, { recursive: true });

const child = spawn(
  'node',
  [
    join(WT, 'frontend/packages/e2e-kit/node_modules/@playwright/mcp/cli.js'),
    '--browser', 'chromium', '--headless', '--isolated', '--output-dir', OUT,
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
    try { m = JSON.parse(line); } catch { continue; }
    const w = pending.get(m.id);
    if (w) { pending.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); }
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
  const text = (r.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  log.push(`### ${name} ${JSON.stringify(args)}\n${text}\n`);
  if (r.isError) throw new Error(`${name}: ${text}`);
  return text;
}
const yaml = (t) => {
  const i = t.indexOf('```yaml');
  if (i < 0) return t;
  return t.slice(i + 7, t.indexOf('```', i + 7)).trim();
};
function ref(snap, role, name, exact = true) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`- ${role} "${esc}${exact ? '' : '[^"]*'}"[^\\n]*\\[ref=([a-z0-9]+)\\]`);
  const m = re.exec(snap);
  if (!m) throw new Error(`нет ${role} "${name}" в снимке`);
  return m[1];
}
const check = (name, ok, detail = '') => {
  checks.push(`| ${checks.length + 1} | ${name} | ${ok ? 'ok' : 'FAIL'} | ${detail.replace(/\|/g, '/')} |`);
  if (!ok) console.error(`FAIL: ${name} ${detail}`);
};
const snap = async (dir, file) => {
  const t = yaml(await call('browser_snapshot'));
  writeFileSync(join(dir, file), `\`\`\`yaml\n${t}\n\`\`\`\n`, 'utf8');
  return t;
};
const shot = async (dir, file) => {
  await call('browser_take_screenshot', { filename: file });
  const src = join(OUT, file);
  if (existsSync(src)) copyFileSync(src, join(dir, file));
};
const evaluate = async (fn) => {
  const t = await call('browser_evaluate', { function: fn });
  const m = /### Result\s*\n([\s\S]*?)(\n###|$)/.exec(t);
  return (m ? m[1] : t).trim();
};
const wait = (s) => call('browser_wait_for', { time: s });
const scenario = (body) =>
  evaluate(`async () => {
    const csrf = /(?:^|;\\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1];
    const r = await fetch('/api/v1/dev/scenario', { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf ?? ''), 'Idempotency-Key': crypto.randomUUID() },
      body: ${JSON.stringify(JSON.stringify(body))} });
    return r.status;
  }`);
const navItems = (s, navName = 'Основная навигация') => {
  const i = s.indexOf(`navigation "${navName}"`);
  if (i < 0) return [];
  const rest = s.slice(i).split('\n').slice(1);
  const indent = /^(\s*)/.exec(s.slice(s.lastIndexOf('\n', i) + 1))[1].length;
  const out = [];
  for (const line of rest) {
    const lead = /^(\s*)/.exec(line)[1].length;
    if (lead <= indent) break;
    const m = /- button "([^"]+)"/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
};

try {
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'w1.49', version: '1' } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  // ── shell · владелец 1440 ──
  await call('browser_resize', { width: 1440, height: 900 });
  await call('browser_navigate', { url: `${APP}/?persona=owner` });
  await wait(3);
  let s = await snap(EV_SHELL, 'snapshot-owner-1440.md');
  check('владелец 1440: шапка, «Основная навигация», «К содержимому»', s.includes('banner') && s.includes('navigation "Основная навигация"') && s.includes('link "К содержимому"'), navItems(s).join(', '));
  await shot(EV_SHELL, 'impl-owner-1440.png');

  // Escape в «Профиль» → фокус на «Профиль»
  await call('browser_click', { element: 'Профиль', target: ref(s, 'button', 'Профиль') });
  s = await snap(EV_SHELL, 'snapshot-owner-profile-1440.md');
  await call('browser_press_key', { key: 'Escape' });
  const focused = await evaluate(`() => document.activeElement?.getAttribute('aria-label') + ' / ' + getComputedStyle(document.activeElement).outlineStyle`);
  check('Escape в поповере «Профиль» → фокус на «Профиль»', focused.includes('Профиль'), focused);

  // Канал реального времени в режиме mock — билет не запрашивается
  let net = await call('browser_network_requests');
  check('режим mock: запросов createRealtimeTicket нет', !net.includes('realtime-tickets'), '');

  // «Выйти» → /auth/login, без 401
  await call('browser_console_messages');
  s = yaml(await call('browser_snapshot'));
  await call('browser_click', { element: 'Профиль', target: ref(s, 'button', 'Профиль') });
  s = yaml(await call('browser_snapshot'));
  await call('browser_click', { element: 'Выйти', target: ref(s, 'button', 'Выйти') });
  await wait(2);
  const url = await evaluate('() => location.pathname');
  const cons = await call('browser_console_messages');
  net = await call('browser_network_requests');
  writeFileSync(join(EV_SHELL, 'logout-console.md'), cons, 'utf8');
  writeFileSync(join(EV_SHELL, 'logout-network.md'), net, 'utf8');
  const tail = net.slice(net.lastIndexOf('/api/v1/auth/logout'));
  check('«Выйти» → /auth/login', url.includes('/auth/login'), url);
  check('после «Выйти» нет ответов 401 (storage, org-units, summary)', !/401/.test(tail) && !/401/.test(cons.slice(cons.lastIndexOf('logout') >= 0 ? cons.lastIndexOf('logout') : 0)), tail.split('\n').filter(Boolean).slice(0, 3).join('; '));

  // ── shell · массажист: «Альта» и «Лотос» ──
  await call('browser_navigate', { url: `${APP}/?persona=therapist` });
  await wait(3);
  s = await snap(EV_SHELL, 'snapshot-therapist-alta-1440.md');
  check('массажист «Альты»: «Мой день», «Чаты», «Календарь», «База знаний» (без «Касса»)', navItems(s).join(',') === 'Мой день,Чаты,Календарь,База знаний', navItems(s).join(', '));
  await call('browser_click', { element: 'сменить бизнес', target: ref(s, 'button', 'Альта Групп — сменить бизнес') });
  s = yaml(await call('browser_snapshot'));
  await call('browser_click', { element: 'SPA «Лотос»', target: ref(s, 'button', 'SPA «Лотос»') });
  await wait(2);
  s = await snap(EV_SHELL, 'snapshot-therapist-lotos-1440.md');
  check('массажист «Лотоса»: «Мой день», «Чаты», «Календарь», «База знаний» — как эталон therapist@t-lotos', navItems(s).join(',') === 'Мой день,Чаты,Календарь,База знаний', navItems(s).join(', '));
  await shot(EV_SHELL, 'impl-therapist-lotos-1440.png');

  // 390: нижняя навигация и лист «Все разделы»
  await call('browser_resize', { width: 390, height: 844 });
  await wait(1);
  s = await snap(EV_SHELL, 'snapshot-therapist-lotos-390.md');
  check('390 «Лотос»: нижняя навигация', /navigation "Навигация"/.test(s), navItems(s, 'Навигация').join(', '));
  await call('browser_click', { element: 'Ещё', target: ref(s, 'button', 'Ещё', false) });
  s = await snap(EV_SHELL, 'snapshot-therapist-lotos-390-sheet.md');
  check('лист «Все разделы» без «Касса»', s.includes('heading "Все разделы"') && !s.includes('Касса'), '');
  await shot(EV_SHELL, 'impl-therapist-lotos-390-sheet.png');
  await call('browser_press_key', { key: 'Escape' });

  // 768: рейл
  await call('browser_resize', { width: 768, height: 1024 });
  await call('browser_navigate', { url: `${APP}/?persona=owner` });
  await wait(3);
  await snap(EV_SHELL, 'snapshot-owner-768.md');
  await shot(EV_SHELL, 'impl-owner-768.png');
  const rail = await evaluate(`() => getComputedStyle(document.querySelector('nav.ox-sidebar')).width`);
  check('768: рейл 68 px', rail.includes('68px'), rail);
  await call('browser_resize', { width: 390, height: 844 });
  await wait(1);
  await snap(EV_SHELL, 'snapshot-owner-390.md');
  await shot(EV_SHELL, 'impl-owner-390.png');

  // Баннер места у массажиста (не оператора): текст сотрудника
  await call('browser_resize', { width: 1440, height: 900 });
  await call('browser_navigate', { url: `${APP}/?persona=therapist` });
  await wait(3);
  const st = await scenario({ preset: 'storage-full' });
  // Массажист после переключения — в «Лотосе» (lastTenantId); пресет заполняет место «Альты».
  const altaId = (await evaluate(`async () => (await (await fetch('/api/v1/me/context')).json()).tenants.find((t) => t.name === 'Альта Групп').tenantId`)).replace(/"/g, '');
  await call('browser_navigate', { url: `${APP}/t/${altaId}/spa` });
  await wait(3);
  s = await snap(EV_SHELL, 'snapshot-therapist-storage-full-1440.md');
  check('storage-full у массажиста: баннер с текстом сотрудника, без кнопки', s.includes('Место организации заполнено.') && s.includes('Новые загрузки ограничены.') && !s.includes('Открыть «Модули и место»'), `dev/scenario ${st}`);
  await shot(EV_SHELL, 'impl-therapist-storage-full-1440.png');
  await scenario({ reset: true });

  // Кадр загрузки
  await call('browser_navigate', { url: `${APP}/?persona=owner` });
  await wait(3);
  await scenario({ scenario: 'getMyContext=loading' });
  await call('browser_navigate', { url: `${APP}/` });
  await wait(2);
  s = await snap(EV_SHELL, 'snapshot-loading-1440.md');
  const sideW = await evaluate(`() => getComputedStyle(document.querySelector('nav.ox-sidebar')).width + ' / ' + document.querySelectorAll('nav.ox-sidebar button').length + ' / ' + (document.querySelector('.ox-brand-letter') ? 'знак' : 'без знака')`);
  check('кадр загрузки: меню 244 px, 0 пунктов, подпись изоляции, без знака', sideW.includes('244px / 0 / без знака') && s.includes('Данные других организаций изолированы'), sideW);
  await shot(EV_SHELL, 'impl-loading-1440.png');
  await scenario({ scenario: null });

  // Консоль и сеть shell
  await call('browser_navigate', { url: `${APP}/?persona=owner` });
  await wait(3);
  writeFileSync(join(EV_SHELL, 'console.md'), await call('browser_console_messages'), 'utf8');
  writeFileSync(join(EV_SHELL, 'network.md'), await call('browser_network_requests'), 'utf8');

  // ── эталон: therapist@t-lotos и therapist (Альта) ──
  await call('browser_navigate', { url: REF });
  await wait(4);
  s = yaml(await call('browser_snapshot'));
  await call('browser_select_option', { element: 'Персонаж', target: ref(s, 'combobox', 'Персонаж'), values: ['therapist@t-lotos'] });
  await wait(2);
  s = await snap(EV_SHELL, 'ref-snapshot-therapist-lotos-1440.md');
  check('эталон therapist@t-lotos: «Мой день», «Чаты 2», «Календарь», «База знаний»', navItems(s).join(',') === 'Мой день,Чаты 2,Календарь,База знаний', navItems(s).join(', '));
  await shot(EV_SHELL, 'ref-therapist-lotos-1440.png');
  await call('browser_select_option', { element: 'Персонаж', target: ref(s, 'combobox', 'Персонаж'), values: ['therapist'] });
  await wait(2);
  s = await snap(EV_SHELL, 'ref-snapshot-therapist-alta-1440.md');
  check('эталон therapist (Альта): «Касса 2» есть — роль «Кассир салона» этапа 5 (allowlist shell-therapist.md)', navItems(s).some((x) => x.startsWith('Касса')), navItems(s).join(', '));
  await shot(EV_SHELL, 'ref-therapist-alta-1440.png');

  // ── access-gate ──
  for (const [w, h] of [[1440, 900], [768, 1024], [390, 844]]) {
    await call('browser_resize', { width: w, height: h });
    await call('browser_navigate', { url: `${APP}/?persona=driver` });
    await wait(3);
    s = await snap(EV_GATE, `snapshot-driver-${w}.md`);
    check(`водитель ${w}: гейт «Логистика» не подключена организацией`, s.includes('«Логистика» не подключена организацией') && s.includes('Модуль не подключён'), '');
    await shot(EV_GATE, `impl-driver-${w}.png`);
  }
  await call('browser_resize', { width: 1440, height: 900 });
  await call('browser_navigate', { url: `${APP}/?persona=therapist` });
  await wait(3);
  const alta = await evaluate(`() => location.pathname.split('/')[2]`);
  await call('browser_navigate', { url: `${APP}/t/${alta.replace(/"/g, '')}/cash` });
  await wait(3);
  s = await snap(EV_GATE, 'snapshot-therapist-cash-1440.md');
  check('массажист без права по прямому URL «Касса»: ветка A «Нет доступа к разделу «Касса»»', s.includes('Нет доступа к разделу «Касса»'), '');
  await shot(EV_GATE, 'impl-therapist-cash-1440.png');
  writeFileSync(join(EV_GATE, 'console.md'), await call('browser_console_messages'), 'utf8');
  writeFileSync(join(EV_GATE, 'network.md'), await call('browser_network_requests'), 'utf8');
} catch (e) {
  console.error(e);
  checks.push(`| — | прерывание | FAIL | ${String(e.message).slice(0, 200)} |`);
} finally {
  writeFileSync(join(EV_SHELL, 'mcp-log.md'), log.join('\n'), 'utf8');
  writeFileSync(join(EV_SHELL, 'checks.md'), `# W1.49 · проходка Playwright MCP (mock, Vite 5203, эталон 4103 design-stage-1)\n\n| # | Проверка | Итог | Детали |\n|---|---|---|---|\n${checks.join('\n')}\n`, 'utf8');
  console.log(checks.join('\n'));
  child.kill();
}
