// Проверяющий access-gate (W1.49, повтор 2) · проходка Playwright MCP по stdio (как tools/mcp-check.js).
// node walk.mjs <worktree> <evidenceDir>
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WT = process.argv[2];
const EV = process.argv[3];
const APP = 'http://127.0.0.1:6102';
const REF = 'http://127.0.0.1:4118/%D0%9E%D1%80%D1%82%D1%83%D1%81%20CRM.dc.html';
const OUT = join(WT, '.playwright-mcp', '6102');
for (const d of [OUT, EV]) mkdirSync(d, { recursive: true });

const child = spawn(
  'node',
  [join(WT, 'frontend/packages/e2e-kit/node_modules/@playwright/mcp/cli.js'), '--browser', 'chromium', '--headless', '--isolated', '--output-dir', OUT],
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
  log.push(`### ${name} ${JSON.stringify(args).slice(0, 300)}\n${text.slice(0, 4000)}\n`);
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
  checks.push(`| ${checks.length + 1} | ${name} | ${ok ? 'ok' : 'FAIL'} | ${String(detail).replace(/\|/g, '/').replace(/\n/g, ' ')} |`);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${ok ? '' : detail}`);
};
const snap = async (file) => {
  const t = yaml(await call('browser_snapshot'));
  if (file) writeFileSync(join(EV, file), `\`\`\`yaml\n${t}\n\`\`\`\n`, 'utf8');
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
  const raw = (m ? m[1] : t).trim();
  let v = raw;
  for (let i = 0; i < 2 && typeof v === 'string'; i++) {
    try { v = JSON.parse(v); } catch { break; }
  }
  return v;
};
const wait = (s) => call('browser_wait_for', { time: s });
const api = (method, path, body, ifMatch) =>
  evaluate(`async () => {
    const h = {};
    if (${JSON.stringify(method)} !== 'GET') {
      const csrf = /(?:^|;\\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1];
      h['X-CSRF-Token'] = decodeURIComponent(csrf ?? ''); h['Idempotency-Key'] = crypto.randomUUID();
    }
    const body = ${JSON.stringify(body === undefined ? null : JSON.stringify(body))};
    if (body) h['Content-Type'] = 'application/json';
    if (${JSON.stringify(ifMatch ?? '')}) h['If-Match'] = ${JSON.stringify(ifMatch ?? '')};
    const r = await fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, credentials: 'include', headers: h, body: body ?? undefined });
    const t = await r.text();
    return JSON.stringify({ status: r.status, etag: r.headers.get('etag'), body: t.slice(0, 400) });
  }`);
const parsed = async (p) => { const v = await p; return typeof v === 'string' ? JSON.parse(v) : v; };
const scenario = (body) => parsed(api('POST', '/api/v1/dev/scenario', body));
const setModule = async (tenant, key, enabled) => {
  const cur = await parsed(api('GET', `/api/v1/tenants/${tenant}/modules/${key}`));
  const body = enabled ? { enabled } : { enabled, retainedAccess: 'history_read' };
  return parsed(api('PUT', `/api/v1/tenants/${tenant}/modules/${key}`, body, cur.etag));
};
const altaId = async () => {
  const r = await parsed(api('GET', '/api/v1/me/context'));
  return JSON.parse(r.body.length >= 400 ? (await evaluate(`async () => JSON.stringify((await (await fetch('/api/v1/me/context')).json()).tenants)`)) : r.body);
};
const tenantIdByName = async (name) => {
  const ts = await evaluate(`async () => JSON.stringify((await (await fetch('/api/v1/me/context')).json()).tenants.map(t => [t.name, t.tenantId]))`);
  const arr = typeof ts === 'string' ? JSON.parse(ts) : ts;
  return arr.find((x) => x[0] === name)[1];
};
const gateInfo = () =>
  evaluate(`() => {
    const g = document.querySelector('.ox-gate');
    const main = document.querySelector('#ox-main, main');
    const q = (s) => g ? [...g.querySelectorAll(s)] : [];
    const sty = (el) => { if (!el) return null; const s = getComputedStyle(el); return { font: s.fontSize + '/' + s.fontWeight, color: s.color, bg: s.backgroundColor, r: s.borderRadius, pad: s.padding, w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }; };
    return JSON.stringify({
      path: location.pathname,
      gate: g ? g.innerText.split('\\n').map(s => s.trim()).filter(Boolean) : null,
      h1: [...document.querySelectorAll('h1')].map(h => h.textContent.trim()),
      buttons: q('button').map(b => b.textContent.trim()),
      focusableInGate: q('a,button,input,select,textarea,[tabindex]').length,
      iconHidden: q('.material-symbols-rounded').map(i => i.getAttribute('aria-hidden')),
      card: sty(g), chip: sty(q('span')[1] ?? null), circle: sty(q('span')[0] ?? null),
      scrollW: document.scrollingElement.scrollWidth, vw: innerWidth,
      banners: [...document.querySelectorAll('[role=status],[role=alert]')].map(b => b.textContent.trim().slice(0, 140)),
      title: document.title,
    });
  }`);
const navLayout = () =>
  evaluate(`() => JSON.stringify({
    navs: [...document.querySelectorAll('nav')].map(n => (n.getAttribute('aria-label') || '?') + ':' + getComputedStyle(n).display + ':' + Math.round(n.getBoundingClientRect().width) + 'x' + Math.round(n.getBoundingClientRect().height)),
    small: [...document.querySelectorAll('button, a')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44); }).map(e => (e.getAttribute('aria-label') || e.textContent.trim()).slice(0, 30) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)),
  })`);
const tabOrder = (n) =>
  evaluate(`async () => {
    const out = [];
    document.activeElement?.blur?.();
    document.body.focus();
    return JSON.stringify(out);
  }`);

try {
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'verifier-w1.49-gate', version: '1' } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  // ── 1. Водитель на трёх ширинах ──
  for (const [w, h] of [[1440, 900], [768, 1024], [390, 844]]) {
    await call('browser_resize', { width: w, height: h });
    await call('browser_navigate', { url: `${APP}/?persona=driver` });
    await wait(3);
    const s = await snap(`impl-driver-${w}.snapshot.md`);
    const g = await gateInfo();
    writeFileSync(join(EV, `impl-driver-${w}.gate.json`), JSON.stringify(g, null, 2), 'utf8');
    check(`водитель ${w}: дерево — h1 ««Логистика» не подключена организацией», чип, текст, без кнопок`,
      s.includes('heading "«Логистика» не подключена организацией" [level=1]') && s.includes('Модуль не подключён') &&
      s.includes('Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — понадобится ещё роль с областью.') &&
      g.buttons.length === 0 && g.focusableInGate === 0 && g.iconHidden.every((x) => x === 'true'), JSON.stringify(g.gate));
    check(`водитель ${w}: нет горизонтальной прокрутки`, g.scrollW <= g.vw, `${g.scrollW}/${g.vw}`);
    const nl = await navLayout();
    writeFileSync(join(EV, `impl-driver-${w}.layout.json`), JSON.stringify(nl, null, 2), 'utf8');
    check(`водитель ${w}: навигация`, w === 390 ? nl.navs.some((x) => x.startsWith('Навигация:flex')) : nl.navs.some((x) => x.startsWith('Основная навигация:flex')), nl.navs.join(', '));
    if (w === 390) check('390: цели нажатия ≥ 44 px (кроме скрытых)', nl.small.length === 0, nl.small.join(', '));
    await shot(`impl-driver-${w}.png`);
  }

  // Клавиатура: Tab-обход и фокус на водителе 1440
  await call('browser_resize', { width: 1440, height: 900 });
  await call('browser_navigate', { url: `${APP}/?persona=driver` });
  await wait(3);
  const order = [];
  for (let i = 0; i < 14; i++) {
    await call('browser_press_key', { key: 'Tab' });
    const f = await evaluate(`() => { const a = document.activeElement; const s = getComputedStyle(a); return a.tagName + '|' + (a.getAttribute('aria-label') || a.textContent.trim()).slice(0, 40) + '|' + s.outlineStyle + ' ' + s.outlineWidth + '|inGate=' + !!a.closest('.ox-gate'); }`);
    order.push(f);
  }
  writeFileSync(join(EV, 'keyboard-driver-1440.txt'), order.join('\n'), 'utf8');
  check('Tab: обход шапки и меню, фокус виден (outline solid), в гейте фокусируемых нет',
    order.filter((x) => !x.startsWith('BODY')).every((x) => x.includes('solid')) && !order.some((x) => x.includes('inGate=true')), order.slice(0, 4).join(' ; '));
  // «К содержимому»
  await call('browser_navigate', { url: `${APP}/?persona=driver` });
  await wait(3);
  await call('browser_press_key', { key: 'Tab' });
  await call('browser_press_key', { key: 'Enter' });
  const skip = await evaluate(`() => (document.activeElement.id || document.activeElement.tagName) + ' ' + location.hash`);
  check('«К содержимому» → фокус в основную область', /ox-main|MAIN/.test(String(skip)), skip);

  // ── 2. Прораб ──
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    await call('browser_resize', { width: w, height: h });
    await call('browser_navigate', { url: `${APP}/?persona=foreman` });
    await wait(3);
    const s = await snap(`impl-foreman-${w}.snapshot.md`);
    const g = await gateInfo();
    check(`прораб ${w}: ветка A «Ремонт и стройка» не подключён организацией, текст «…нужна ещё роль.»`,
      g.path.endsWith('/repair') && s.includes('heading "«Ремонт и стройка» не подключён организацией" [level=1]') &&
      g.gate.includes('Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — нужна ещё роль.') && g.buttons.length === 0, JSON.stringify(g.gate));
    await shot(`impl-foreman-${w}.png`);
  }

  // ── 3. Владелец: прямой URL /repair, /fleet ──
  await call('browser_resize', { width: 1440, height: 900 });
  await call('browser_navigate', { url: `${APP}/?persona=owner` });
  await wait(3);
  const alta = await tenantIdByName('Альта Групп');
  await call('browser_navigate', { url: `${APP}/t/${alta}/repair` });
  await wait(3);
  let s = await snap('impl-owner-repair-1440.snapshot.md');
  let g = await gateInfo();
  check('владелец /repair: текст владельца и кнопка «Открыть «Модули и место»»',
    g.gate.includes('Подключите модуль в разделе «Модули и место». Права сотрудникам выдаются отдельно.') && g.buttons.join() === 'Открыть «Модули и место»', JSON.stringify(g.gate));
  await shot('impl-owner-repair-1440.png');
  const btnStyle = await evaluate(`() => { const b = document.querySelector('.ox-gate button'); const s = getComputedStyle(b); const r = b.getBoundingClientRect(); return JSON.stringify({ h: r.height, w: Math.round(r.width), bg: s.backgroundColor, color: s.color, radius: s.borderRadius, pad: s.padding, weight: s.fontWeight, type: b.type }); }`);
  check('кнопка гейта: 44 px, радиус 8, акцент, белый текст, 500', btnStyle.h >= 44 && btnStyle.radius === '8px' && btnStyle.weight === '500' && btnStyle.color === 'rgb(255, 255, 255)', JSON.stringify(btnStyle));
  // клавиатура до кнопки
  let reached = '';
  for (let i = 0; i < 40; i++) {
    await call('browser_press_key', { key: 'Tab' });
    const f = await evaluate(`() => { const a = document.activeElement; return (a.closest('.ox-gate') ? 'GATE:' : '') + a.textContent.trim().slice(0, 40) + '|' + getComputedStyle(a).outlineStyle; }`);
    if (String(f).startsWith('GATE:')) { reached = `${i + 1}: ${f}`; break; }
  }
  await shot('impl-owner-repair-focus-1440.png');
  check('Tab доходит до «Открыть «Модули и место»», фокус виден', reached.includes('Открыть «Модули и место»|solid'), reached);
  await call('browser_press_key', { key: 'Enter' });
  await wait(2);
  g = await gateInfo();
  check('Enter → «Модули и место» (/modules)', g.path.endsWith('/modules') && g.h1.includes('Модули и место'), `${g.path} ${g.h1}`);

  await call('browser_navigate', { url: `${APP}/t/${alta}/fleet` });
  await wait(3);
  g = await gateInfo();
  check('владелец /fleet: ветка B «Логистика» не подключена; текст «…затем назначьте роли сотрудникам.»; кнопка',
    g.gate.includes('«Логистика» не подключена организацией') && g.gate.includes('Подключите модуль в разделе «Модули и место», затем назначьте роли сотрудникам.') && g.buttons.join() === 'Открыть «Модули и место»', JSON.stringify(g.gate));
  s = yaml(await call('browser_snapshot'));
  await call('browser_click', { element: 'Открыть «Модули и место»', target: ref(s, 'button', 'Открыть «Модули и место»') });
  await wait(2);
  g = await gateInfo();
  check('клик «Открыть «Модули и место»» → /modules', g.path.endsWith('/modules'), g.path);

  // ── 4. Логист: формы, логистика выключена ──
  await call('browser_navigate', { url: `${APP}/t/${alta}/forms?persona=manager` });
  await call('browser_navigate', { url: `${APP}/?persona=manager` });
  await wait(3);
  await call('browser_navigate', { url: `${APP}/t/${alta}/forms` });
  await wait(3);
  s = await snap('impl-manager-forms-1440.snapshot.md');
  g = await gateInfo();
  writeFileSync(join(EV, 'impl-manager-forms-1440.gate.json'), JSON.stringify(g, null, 2), 'utf8');
  check('логист /forms: ветка A «Нет права», «Нет доступа к разделу «Формы»», иконка lock',
    g.gate[0] === 'lock' && g.gate.includes('Нет права') && g.gate.includes('Нет доступа к разделу «Формы»') &&
    g.gate.includes('Ни одна ваша роль не разрешает его просматривать. Владелец бизнеса может добавить действие в роль.') && g.buttons.length === 0, JSON.stringify(g.gate));
  await shot('impl-manager-forms-1440.png');
  await call('browser_navigate', { url: `${APP}/t/${alta}/fleet` });
  await wait(3);
  g = await gateInfo();
  check('логист /fleet (выключена): «Логистика» не подключена, текст сотрудника, без кнопки',
    g.gate.includes('«Логистика» не подключена организацией') && g.gate.includes('Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — понадобится ещё роль с областью.') && g.buttons.length === 0, JSON.stringify(g.gate));

  // ── 5. Подключить «Логистику» (владелец) ──
  await call('browser_navigate', { url: `${APP}/?persona=owner` });
  await wait(3);
  const on = await setModule(alta, 'fleet', true);
  check('владелец подключает «Логистику» (setModuleInstallation 200)', on.status === 200, on.status);
  await call('browser_navigate', { url: `${APP}/?persona=manager` });
  await wait(3);
  for (const [page, title, extra] of [
    ['fleet', 'Нет роли с доступом к модулю «Логистика»', 'Модуль подключён, но ни одна ваша роль не разрешает это действие. Владелец бизнеса может назначить роль и область.'],
    ['review', 'Нет права на приёмку смен', 'Модуль подключён, но ни одна ваша роль не разрешает это действие («Проверять»). Владелец бизнеса может назначить роль и область.'],
    ['pool', 'Нет роли с доступом к модулю «Логистика»', null],
  ]) {
    await call('browser_navigate', { url: `${APP}/t/${alta}/${page}` });
    await wait(3);
    g = await gateInfo();
    if (page !== 'pool') await snap(`impl-manager-${page}-on-1440.snapshot.md`);
    await shot(`impl-manager-${page}-on-1440.png`);
    check(`логист /${page} (подключена, роли нет): «${title}», без кнопки`, g.gate.includes(title) && g.gate.includes('Нет права') && (!extra || g.gate.includes(extra)) && g.buttons.length === 0, JSON.stringify(g.gate));
  }
  await call('browser_navigate', { url: `${APP}/?persona=driver` });
  await wait(3);
  g = await gateInfo();
  check('водитель при подключённой «Логистике»: гейта нет, «Сегодня»', g.gate === null && g.h1.includes('Сегодня'), `${g.path} ${g.h1}`);

  // ── 6. Отключить с историей ──
  await call('browser_navigate', { url: `${APP}/?persona=owner` });
  await wait(3);
  const off = await setModule(alta, 'fleet', false);
  check('владелец отключает «Логистику» с историей (200)', off.status === 200, off.status);
  await call('browser_navigate', { url: `${APP}/?persona=driver` });
  await wait(3);
  g = await gateInfo();
  await shot('impl-driver-readonly-1440.png');
  check('водитель, модуль отключён с историей: гейта нет, баннер «Модуль «Логистика» отключён.»', g.gate === null && g.banners.some((b) => b.includes('Модуль «Логистика» отключён.')), JSON.stringify(g.banners));
  await call('browser_navigate', { url: `${APP}/?persona=manager` });
  await wait(3);
  await call('browser_navigate', { url: `${APP}/t/${alta}/fleet` });
  await wait(3);
  g = await gateInfo();
  await shot('impl-manager-fleet-disabled-1440.png');
  check('логист без права, модуль отключён: чип «Модуль отключён», «Логистика» не подключена', g.gate.includes('Модуль отключён') && g.gate.includes('«Логистика» не подключена организацией'), JSON.stringify(g.gate));
  await call('browser_navigate', { url: `${APP}/?persona=owner` });
  await wait(3);
  const rs = await scenario({ reset: true });
  check('сброс сценарного сервера', rs.status === 200, rs.status);

  // ── 7. Массажист: «Касса» по прямому URL (ветка A, W1.49) ──
  await call('browser_navigate', { url: `${APP}/?persona=therapist` });
  await wait(3);
  const altaT = await tenantIdByName('Альта Групп');
  await call('browser_navigate', { url: `${APP}/t/${altaT}/cash` });
  await wait(3);
  s = await snap('impl-therapist-alta-cash-1440.snapshot.md');
  g = await gateInfo();
  await shot('impl-therapist-alta-cash-1440.png');
  check('массажист «Альты» /cash: «Нет права», «Нет доступа к разделу «Касса»», текст ветки A',
    g.gate.includes('Нет доступа к разделу «Касса»') && g.gate.includes('Ни одна ваша роль не разрешает его просматривать. Владелец бизнеса может добавить действие в роль.') && g.buttons.length === 0, JSON.stringify(g.gate));
  const lotos = await tenantIdByName('SPA «Лотос»');
  await call('browser_navigate', { url: `${APP}/t/${lotos}/cash` });
  await wait(3);
  g = await gateInfo();
  writeFileSync(join(EV, 'impl-therapist-lotos-cash-1440.gate.json'), JSON.stringify(g, null, 2), 'utf8');
  s = await snap('impl-therapist-lotos-cash-1440.snapshot.md');
  await shot('impl-therapist-lotos-cash-1440.png');
  check('массажист «Лотоса» /cash: «Нет доступа к разделу «Касса»»', g.gate !== null && g.gate.includes('Нет доступа к разделу «Касса»'), `${g.path} ${JSON.stringify(g.gate)} h1=${g.h1}`);
  await call('browser_navigate', { url: `${APP}/t/${altaT}/spa` });
  await wait(3);

  // ── 8. Состояния: загрузка, ошибка, офлайн ──
  await call('browser_navigate', { url: `${APP}/?persona=driver` });
  await wait(3);
  for (const sc of ['loading', 'dependency_unavailable', 'offline']) {
    const r = await scenario({ scenario: `getMyContext=${sc}` });
    await call('browser_navigate', { url: `${APP}/` });
    await wait(sc === 'loading' ? 2 : 4);
    s = await snap(`impl-driver-state-${sc}-1440.snapshot.md`);
    g = await gateInfo();
    await shot(`impl-driver-state-${sc}-1440.png`);
    check(`состояние getMyContext=${sc}: гейт не показан до контекста`, g.gate === null, `scenario ${r.status}; h1=${g.h1}; alerts=${JSON.stringify(g.banners)}`);
    await scenario({ scenario: null });
  }

  // ── 9. Консоль и сеть ──
  await call('browser_navigate', { url: `${APP}/?persona=driver` });
  await wait(3);
  const cons = await call('browser_console_messages');
  const net = await call('browser_network_requests');
  writeFileSync(join(EV, 'console.md'), cons, 'utf8');
  writeFileSync(join(EV, 'network.md'), net, 'utf8');
  const errs = cons.split('\n').filter((l) => /\[(ERROR|WARNING)\]/i.test(l));
  check('консоль: нет ошибок и предупреждений', errs.length === 0, errs.slice(0, 5).join(' ; '));
  const hosts = [...new Set([...net.matchAll(/https?:\/\/([^/\s\]]+)/g)].map((m) => m[1]))];
  check('сеть: только 127.0.0.1:6102', hosts.every((h) => h === '127.0.0.1:6102'), hosts.join(', '));

  // ── 10. Эталон ──
  for (const [w, h] of [[1440, 900], [768, 1024], [390, 844]]) {
    await call('browser_resize', { width: w, height: h });
    await call('browser_navigate', { url: REF });
    await wait(5);
    s = yaml(await call('browser_snapshot'));
    await call('browser_select_option', { element: 'Персонаж', target: ref(s, 'combobox', 'Персонаж'), values: ['driver'] });
    await wait(2);
    await snap(`ref-driver-${w}.snapshot.md`);
    await shot(`ref-driver-${w}.png`);
    if (w === 1440) {
      s = yaml(await call('browser_snapshot'));
      await call('browser_select_option', { element: 'Персонаж', target: ref(s, 'combobox', 'Персонаж'), values: ['foreman'] });
      await wait(2);
      await snap('ref-foreman-1440.snapshot.md');
      await shot('ref-foreman-1440.png');
      // массажист «Лотоса» на «Касса»
      s = yaml(await call('browser_snapshot'));
      await call('browser_select_option', { element: 'Персонаж', target: ref(s, 'combobox', 'Персонаж'), values: ['therapist@t-lotos'] });
      await wait(2);
      const res = await evaluate(`() => { const el = document.getElementById('ox-main'); const k = Object.keys(el).find(k => k.startsWith('__reactFiber')); let f = el[k]; while (f && !(f.stateNode && typeof f.stateNode.setPage === 'function')) f = f.return; if (!f) return 'нет компонента'; f.stateNode.setPage('cash'); return 'ok'; }`);
      await wait(2);
      s = await snap('ref-therapist-lotos-cash-1440.snapshot.md');
      await shot('ref-therapist-lotos-cash-1440.png');
      check('эталон therapist@t-lotos на «Касса»: «Нет доступа к разделу «Касса»»', s.includes('Нет доступа к разделу «Касса»'), res);
    }
  }
} catch (e) {
  console.error(e);
  checks.push(`| — | прерывание | FAIL | ${String(e.message).slice(0, 300)} |`);
} finally {
  writeFileSync(join(EV, 'mcp-log.md'), log.join('\n'), 'utf8');
  writeFileSync(join(EV, 'checks.md'), `# Проверяющий access-gate (W1.49, повтор) · проходка Playwright MCP (mock, Vite 6102, эталон 4118 design-stage-1)\n\n| # | Проверка | Итог | Детали |\n|---|---|---|---|\n${checks.join('\n')}\n`, 'utf8');
  child.kill();
}
