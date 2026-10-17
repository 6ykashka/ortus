// W1.25 · Проходка Playwright MCP (verification-protocol §4) страниц platform-orgs и platform-org-card: сервер
// @playwright/mcp по stdio (как tools/mcp-check.js) с init-скриптом часов clock.js; клики — по ref снимка,
// найденному по роли и подписи. Приложение — Vite --mode e2e (VITE_ADAPTER=mock) на 5213, эталон — 4113.
//   node docs/plan/evidence/platform-orgs/walk.mjs <worktree> [mock|stand]
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WT = process.argv[2];
const MODE = process.argv[3] ?? 'mock';
const APP = 'http://127.0.0.1:5213';
const REF = 'http://127.0.0.1:4113/%D0%9E%D1%80%D1%82%D1%83%D1%81%20CRM.dc.html';
const OUT = join(WT, '.playwright-mcp', '5213');
const sub = MODE === 'stand' ? 'stand' : 'mock';
const EV_ORGS = join(WT, 'docs/plan/evidence/platform-orgs', sub);
const EV_CARD = join(WT, 'docs/plan/evidence/platform-org-card', sub);
for (const d of [OUT, EV_ORGS, EV_CARD]) mkdirSync(d, { recursive: true });

const child = spawn(
  'node',
  [
    join(WT, 'frontend/packages/e2e-kit/node_modules/@playwright/mcp/cli.js'),
    '--browser', 'chromium', '--headless', '--isolated', '--output-dir', OUT,
    '--init-script', join(WT, 'docs/plan/evidence/platform-orgs/clock.js'),
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
const checks = { orgs: [], card: [] };
let tenantIds = {};
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
  const re = new RegExp(`- '?${role} "${esc}${exact ? '' : '[^"]*'}"[^\\n]*\\[ref=([a-z0-9]+)\\]`);
  const m = re.exec(snap);
  if (!m) throw new Error(`нет ${role} "${name}" в снимке`);
  return m[1];
}
const check = (page, name, ok, detail = '') => {
  const list = checks[page];
  list.push(`| ${list.length + 1} | ${name} | ${ok ? 'ok' : 'FAIL'} | ${String(detail).replace(/\|/g, '/').replace(/\n/g, ' ')} |`);
  if (!ok) console.error(`FAIL: ${name} ${detail}`);
};
const snap = async (dir, file) => {
  const t = yaml(await call('browser_snapshot'));
  writeFileSync(join(dir, file), `\`\`\`yaml\n${t}\n\`\`\`\n`, 'utf8');
  return t;
};
const shot = async (dir, file) => {
  await call('browser_take_screenshot', { filename: file });
  // Версия @playwright/mcp пишет снимок в рабочий каталог сервера (корень worktree), а не в --output-dir.
  for (const src of [join(OUT, file), join(WT, file)]) {
    if (!existsSync(src)) continue;
    copyFileSync(src, join(dir, file));
    rmSync(src);
    break;
  }
};
const evaluate = async (fn) => {
  const t = await call('browser_evaluate', { function: fn });
  const m = /### Result\s*\n([\s\S]*?)(\n###|$)/.exec(t);
  const raw = (m ? m[1] : t).trim();
  try {
    const v = JSON.parse(raw);
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return raw;
  }
};
const wait = (s) => call('browser_wait_for', { time: s });
const waitText = (text) => call('browser_wait_for', { text });
const scenario = (body) =>
  evaluate(`async () => {
    const csrf = /(?:^|;\\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1];
    const r = await fetch('/api/v1/dev/scenario', { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf ?? ''), 'Idempotency-Key': crypto.randomUUID() },
      body: ${JSON.stringify(JSON.stringify(body))} });
    return r.status;
  }`);
const dialogTitle = () => evaluate(`() => document.querySelector('[role=dialog] h2')?.textContent ?? ''`);
const text = (sel) => evaluate(`() => Array.from(document.querySelectorAll(${JSON.stringify(sel)})).map((e) => e.textContent.trim()).join(' | ')`);
const reason = async (s, value) => {
  await call('browser_type', { element: 'Причина', target: ref(s, 'textbox', 'Причина'), text: value });
};

try {
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'w1.25', version: '1' } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  // ── platform-orgs · 1440: из меню ──
  await call('browser_resize', { width: 1440, height: 900 });
  await call('browser_navigate', { url: `${APP}/platform/usage?persona=operator` });
  await wait(3);
  let s = yaml(await call('browser_snapshot'));
  await call('browser_click', { element: 'Организации', target: ref(s, 'button', 'Организации') });
  await waitText('Организации-клиенты');
  await wait(1);
  s = await snap(EV_ORGS, 'snapshot-1440.md');
  const url = await evaluate('() => location.pathname');
  check('orgs', 'меню «Организации» → /platform/tenants, h1 «Организации-клиенты»', url.includes('/platform/tenants') && s.includes('heading "Организации-клиенты" [level=1]'), url);
  check('orgs', 'баннер «Отдельное административное пространство…» и «Платформа Ортус»', s.includes('Отдельное административное пространство.') && s.includes('Платформа Ортус'), '');
  // Порядок строк — порядок ответа listPlatformTenants: MSW — как эталон, стенд W1.48 — (created_at, id) (Q-W1.25-24).
  const apiOrder = JSON.parse(await evaluate(`async () => { const r = await fetch('/api/v1/platform/tenants?limit=100', { credentials: 'include' }); return JSON.stringify((await r.json()).items.map((t) => t.name)); }`));
  tenantIds = JSON.parse(await evaluate(`async () => { const r = await fetch('/api/v1/platform/tenants?limit=100', { credentials: 'include' }); return JSON.stringify(Object.fromEntries((await r.json()).items.map((t) => [t.name, t.id]))); }`));
  const rows = JSON.parse(await evaluate(`() => JSON.stringify(Array.from(document.querySelectorAll('section[aria-labelledby="h-ten"] button[aria-pressed]')).map((b) => ({ name: b.querySelector('.ox-org-name')?.textContent, chip: b.querySelector('.ox-chip-label')?.textContent, trial: b.querySelector('.ox-org-trial')?.textContent, pressed: b.getAttribute('aria-pressed') })))`));
  const names = rows.map((r) => r.name).join(' | ');
  const want = MODE === 'stand' ? apiOrder.join(' | ') : 'Альта Групп | SPA «Лотос» | Ремстрой Плюс | Карго Сити';
  check('orgs', `строки — четыре организации сида в порядке ответа сервера (${want})`, names === want && new Set(rows.map((r) => r.name)).size === 4, names);
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  const chips = ['Альта Групп', 'SPA «Лотос»', 'Ремстрой Плюс', 'Карго Сити'].map((n) => byName[n]?.chip).join(' | ');
  check('orgs', 'чипы Альта / Лотос / Ремстрой / Карго: Пробный период, Действует, Ограничен, Приостановлен', chips === 'Пробный период | Действует | Ограничен | Приостановлен', chips);
  const trials = rows.map((r) => `${r.name}: ${r.trial}`).join('; ');
  check('orgs', MODE === 'stand' ? 'пробный период: «Альта» — «Осталось …», «Ремстрой Плюс» — «Завершён —» (Q-W1.25-14)' : 'пробный период: «Осталось 12 дн. · до 13.10.2026», «Завершён 20.09.2026»', MODE === 'stand' ? /^Осталось \d+ дн\. · до \d\d\.\d\d\.\d{4}$/.test(byName['Альта Групп']?.trial ?? '') && byName['Ремстрой Плюс']?.trial === 'Завершён —' : byName['Альта Групп']?.trial === 'Осталось 12 дн. · до 13.10.2026' && byName['Ремстрой Плюс']?.trial === 'Завершён 20.09.2026', trials);
  const pressed = rows.filter((r) => r.pressed === 'true').map((r) => r.name).join(' | ');
  check('orgs', 'без ?org= выбрана первая строка (aria-pressed)', pressed === rows[0]?.name, pressed);
  await shot(EV_ORGS, 'impl-1440.png');

  // 768 и 390
  await call('browser_resize', { width: 768, height: 1024 });
  await wait(1);
  await snap(EV_ORGS, 'snapshot-768.md');
  await shot(EV_ORGS, 'impl-768.png');
  const scroll768 = await evaluate('() => document.documentElement.scrollWidth + "/" + document.documentElement.clientWidth');
  check('orgs', '768: без горизонтальной прокрутки', scroll768.split('/')[0].replace(/\D/g, '') <= scroll768.split('/')[1].replace(/\D/g, ''), scroll768);
  await call('browser_resize', { width: 390, height: 844 });
  await wait(1);
  s = await snap(EV_ORGS, 'snapshot-390.md');
  await shot(EV_ORGS, 'impl-390.png');
  const scroll390 = await evaluate('() => document.documentElement.scrollWidth + "/" + document.documentElement.clientWidth');
  check('orgs', '390: нижняя навигация, без горизонтальной прокрутки', /navigation "Навигация"/.test(s) && scroll390.split('/')[0].replace(/\D/g, '') <= scroll390.split('/')[1].replace(/\D/g, ''), scroll390);
  const small = await evaluate(`() => Array.from(document.querySelectorAll('#ox-main button')).filter((b) => b.getBoundingClientRect().height < 44).length`);
  check('orgs', '390: цели нажатия на странице ≥ 44 px', small === '0', `меньше 44: ${small}`);

  // Негатив: пустой список и ошибка загрузки (MSW, только mock)
  if (MODE === 'mock') {
    await call('browser_resize', { width: 1440, height: 900 });
    await scenario({ scenario: 'listPlatformTenants=empty' });
    await call('browser_navigate', { url: `${APP}/platform/tenants` });
    await wait(2);
    s = await snap(EV_ORGS, 'snapshot-empty-1440.md');
    check('orgs', 'пусто: «Организаций пока нет»', s.includes('Организаций пока нет'), '');
    await scenario({ scenario: 'listPlatformTenants=rate_limited' });
    await call('browser_navigate', { url: `${APP}/platform/tenants` });
    await wait(2);
    s = await snap(EV_ORGS, 'snapshot-error-1440.md');
    check('orgs', 'ошибка: alert «Не удалось загрузить организации: …» и «Повторить»', s.includes('alert') && s.includes('Не удалось загрузить организации') && s.includes('button "Повторить"'), '');
    await shot(EV_ORGS, 'impl-error-1440.png');
    await scenario({ scenario: null });
    await call('browser_click', { element: 'Повторить', target: ref(s, 'button', 'Повторить') });
    await wait(2);
    const back = await text('section[aria-labelledby="h-ten"] button[aria-pressed] .ox-org-name');
    check('orgs', '«Повторить» перечитывает список', back.includes('Карго Сити'), back);

    // Q-W1.25-21: свой скелетон строк списка (не скелетон оболочки), рамка по четырём строкам.
    await scenario({ scenario: 'listPlatformTenants=delay=4000, getPlatformSubscription=delay=8000, listPlatformAuditEvents=delay=8000' });
    await call('browser_navigate', { url: `${APP}/platform/tenants` });
    await wait(1.5);
    s = await snap(EV_ORGS, 'snapshot-skeleton-1440.md');
    const sk = JSON.parse(await evaluate(`() => { const e = document.querySelector('.ox-orgs-skeleton'); if (!e) return JSON.stringify(null); const rows = Array.from(e.querySelectorAll('.ox-orgs-skeleton-row')); return JSON.stringify({ role: e.getAttribute('role'), label: e.getAttribute('aria-label'), rows: rows.length, height: Math.round(e.getBoundingClientRect().height), inner: Math.round(rows.reduce((a, r) => a + r.getBoundingClientRect().height, 0)), text: e.textContent.trim(), shell: document.body.textContent.includes('Загружаем рабочее пространство') }); }`));
    check('orgs', 'Q-W1.25-21 загрузка: скелетон строк списка role=status «Загрузка», 4 строки без текста, рамка по строкам, без «Загружаем рабочее пространство…»', !!sk && sk.role === 'status' && sk.label === 'Загрузка' && sk.rows === 4 && sk.text === '' && sk.height <= sk.inner + 3 && !sk.shell, JSON.stringify(sk));
    await shot(EV_ORGS, 'impl-skeleton-1440.png');
    // Q-W1.25-23: список пришёл, подписки ещё нет — колонки строк из подписки под скелетоном (data-loading).
    await waitText('Альта Групп');
    await wait(0.5);
    s = await snap(EV_ORGS, 'snapshot-rows-loading-1440.md');
    const rl = JSON.parse(await evaluate(`() => JSON.stringify({ loading: document.querySelectorAll('.ox-org-row [data-loading="true"]').length, rows: document.querySelectorAll('.ox-org-row').length, anim: getComputedStyle(document.querySelector('.ox-org-row [data-loading="true"]') ?? document.body).animationName })`));
    check('orgs', 'Q-W1.25-23 подписка строки загружается: владелец/места, место, пробный период — data-loading (12 из 4 строк), пульс', rl.rows === 4 && rl.loading === 12 && rl.anim !== 'none', JSON.stringify(rl));
    await shot(EV_ORGS, 'impl-rows-loading-1440.png');
    await wait(6); // подписки задержаны на 8 с, browser_wait_for ждёт не дольше 5 с
    await call('browser_wait_for', { text: 'Осталось 12 дн. · до 13.10.2026' });
    const left = await evaluate(`() => String(document.querySelectorAll('.ox-org-row [data-loading]').length)`);
    check('orgs', 'Q-W1.25-23 после ответа подписок отметок загрузки в строках нет', left === '0', left);
    // Q-W1.25-20: ошибка подписок — «Подписка не загружена» в строках, «Повторить» в карточке.
    await scenario({ scenario: 'getPlatformSubscription=rate_limited' });
    await call('browser_navigate', { url: `${APP}/platform/tenants` });
    await waitText('Подписка не загружена');
    await wait(0.5);
    s = await snap(EV_ORGS, 'snapshot-sub-missing-1440.md');
    const miss = await text('.ox-org-trial');
    check('orgs', 'Q-W1.25-20 ошибка подписок: строки — «Подписка не загружена», в карточке alert и «Повторить»', miss.split(' | ').every((t) => t === 'Подписка не загружена') && s.includes('Не удалось загрузить подписку') && /alert[\s\S]*button "Повторить"/.test(s), miss);
    await shot(EV_ORGS, 'impl-sub-missing-1440.png');
    await scenario({ scenario: null });
    await call('browser_click', { element: 'Повторить', target: ref(s, 'button', 'Повторить') });
    await call('browser_wait_for', { text: 'Осталось 12 дн. · до 13.10.2026' });
    const missBack = await text('.ox-org-trial');
    check('orgs', 'Q-W1.25-20 «Повторить» карточки перечитывает подписки строк', !missBack.includes('Подписка не загружена'), missBack);
  }
  writeFileSync(join(EV_ORGS, 'console.md'), await call('browser_console_messages'), 'utf8');
  writeFileSync(join(EV_ORGS, 'network.md'), await call('browser_network_requests'), 'utf8');

  // ── platform-org-card ──
  await call('browser_resize', { width: 1440, height: 900 });
  await call('browser_navigate', { url: `${APP}/platform/tenants` });
  await wait(2);
  s = yaml(await call('browser_snapshot'));
  await call('browser_click', { element: 'Карго Сити', target: ref(s, 'button', 'Карго Сити', false) });
  await wait(1);
  s = await snap(EV_CARD, 'snapshot-cargo-1440.md');
  const search = await evaluate('() => location.search');
  check('card', 'клик «Карго Сити» → ?org=<id>, карточка «Карго Сити»', /\?org=[0-9a-f-]{36}/.test(search) && (await text('aside h2')) === 'Карго Сити', search);
  check('card', '«Карго Сити»: «Снять ограничение», без продления и «Ограничить…»', s.includes('button "Снять ограничение"') && !s.includes('button "Продлить пробный период на 14 дней"') && !s.includes('button "Ограничить новые операции"'), '');
  await shot(EV_CARD, 'impl-cargo-1440.png');
  await call('browser_navigate', { url: `${APP}/platform/tenants${search}` });
  await wait(2);
  s = yaml(await call('browser_snapshot'));
  check('card', 'прямой URL ?org= открывает ту же карточку', (await text('aside h2')) === 'Карго Сити', search);

  // «Альта» — по ?org=: на стенде она не первая (Q-W1.25-24).
  await call('browser_navigate', { url: `${APP}/platform/tenants?org=${tenantIds['Альта Групп']}` });
  await wait(2);
  s = await snap(EV_CARD, 'snapshot-alta-1440.md');
  const dl = await text('aside .ox-org-field');
  check('card', '«Альта Групп»: dl по эталону с «—» для данных этапа 4', (await text('aside h2')) === 'Альта Групп' && dl.includes('Тариф«Старт» · пробный · цены v2') && dl.includes('ОплатаПробный период') && dl.includes('Владелец—'), dl);
  if (MODE === 'stand') {
    check('card', '«Журнал действий»: заголовок и строки журнала стенда (или «Действий пока нет»)', s.includes('heading "Журнал действий" [level=3]'), await text('aside .ox-audit-text'));
  } else {
    check('card', '«Журнал действий»: строки сида', s.includes('Альта Групп: открыт пробный период на 14 дней, квота 100 ГБ') && s.includes('30.09 18:12 · Е. Лаптева') && s.includes('21.09 09:00 · Система'), '');
  }
  await shot(EV_CARD, 'impl-alta-1440.png');

  // Продлить: диалог, кнопка недоступна без причины, с причиной — тост и новый срок
  await call('browser_click', { element: 'Продлить', target: ref(s, 'button', 'Продлить пробный период на 14 дней') });
  await wait(1);
  s = await snap(EV_CARD, 'snapshot-extend-dialog-1440.md');
  check('card', 'диалог «Продлить пробный период «Альта Групп»?»: текст, «Последствия», поле «Причина»', (await dialogTitle()) === 'Продлить пробный период «Альта Групп»?' && s.includes('Продление на 14 дней.') && s.includes('Новые операции снова доступны') && s.includes('textbox "Причина"'), '');
  check('card', '«Продлить» недоступна без причины', /button "Продлить" \[disabled\]/.test(s), '');
  const focusReason = await evaluate(`() => document.activeElement?.tagName + ':' + (document.activeElement?.labels?.[0]?.textContent ?? '')`);
  check('card', 'фокус при открытии — на поле «Причина»', focusReason.includes('TEXTAREA') && focusReason.includes('Причина'), focusReason);
  await shot(EV_CARD, 'impl-extend-dialog-1440.png');
  await reason(s, 'Клиент попросил время на оплату');
  s = yaml(await call('browser_snapshot'));
  await call('browser_click', { element: 'Продлить', target: ref(s, 'button', 'Продлить') });
  await waitText('Готово · запись добавлена в журнал');
  await wait(1);
  s = await snap(EV_CARD, 'snapshot-extended-1440.md');
  const trialAlta = await evaluate(`() => document.querySelector('aside .ox-org-field dd:nth-of-type(1)') && Array.from(document.querySelectorAll('aside dt')).find((d) => d.textContent === 'Пробный период')?.nextElementSibling?.textContent`);
  check('card', 'продление: тост «Готово · запись добавлена в журнал», «Осталось 26 дн. · до 27.10.2026»', s.includes('Готово · запись добавлена в журнал') && trialAlta.includes(MODE === 'stand' ? 'Осталось' : 'Осталось 26 дн. · до 27.10.2026'), trialAlta);
  check('card', 'журнал: «Альта Групп: пробный период продлён на 14 дней», «Причина: …»', s.includes('Альта Групп: пробный период продлён на 14 дней') && s.includes('Причина: Клиент попросил время на оплату'), '');
  await shot(EV_CARD, 'impl-extended-1440.png');

  // Ограничить → Приостановлен → Снять ограничение
  await call('browser_click', { element: 'Ограничить', target: ref(s, 'button', 'Ограничить новые операции') });
  await wait(1);
  s = await snap(EV_CARD, 'snapshot-suspend-dialog-1440.md');
  check('card', 'диалог «Ограничить «Альта Групп»?»: три последствия', s.includes('Новые брони, рейсы, приглашения и загрузки закрываются') && s.includes('Начатую работу можно завершить') && s.includes('Данные не удаляются'), '');
  await reason(s, 'Нарушение условий пилота');
  s = yaml(await call('browser_snapshot'));
  await call('browser_click', { element: 'Ограничить', target: ref(s, 'button', 'Ограничить') });
  await waitText('Снять ограничение');
  s = await snap(EV_CARD, 'snapshot-suspended-1440.md');
  const chipAlta = await text('aside .ox-chip-label');
  check('card', 'после «Ограничить»: чип «Приостановлен», кнопка «Снять ограничение»', chipAlta === 'Приостановлен' && s.includes('button "Снять ограничение"'), chipAlta);
  await shot(EV_CARD, 'impl-suspended-1440.png');
  await call('browser_click', { element: 'Снять ограничение', target: ref(s, 'button', 'Снять ограничение') });
  await wait(1);
  s = yaml(await call('browser_snapshot'));
  await reason(s, 'Оплата поступила');
  s = yaml(await call('browser_snapshot'));
  const dlg = s.slice(s.lastIndexOf('- dialog'));
  await call('browser_click', { element: 'Снять ограничение', target: ref(dlg, 'button', 'Снять ограничение') });
  await waitText('Ограничить новые операции');
  const chipBack = await text('aside .ox-chip-label');
  check('card', '«Снять ограничение» → состояние подписки «Пробный период»', chipBack === 'Пробный период', chipBack);

  if (MODE === 'mock') {
    // 409 и нет связи — диалог остаётся открытым
    await scenario({ scenario: 'suspendPlatformTenant=invalid_transition', once: true });
    s = yaml(await call('browser_snapshot'));
    await call('browser_click', { element: 'Ограничить', target: ref(s, 'button', 'Ограничить новые операции') });
    await wait(1);
    s = yaml(await call('browser_snapshot'));
    await reason(s, 'Проверка конфликта');
    s = yaml(await call('browser_snapshot'));
    await call('browser_click', { element: 'Ограничить', target: ref(s, 'button', 'Ограничить') });
    await wait(1);
    s = await snap(EV_CARD, 'snapshot-409-1440.md');
    check('card', '409: тост «Статус уже изменился. Обновите данные и повторите.», диалог открыт', s.includes('Статус уже изменился. Обновите данные и повторите.') && (await dialogTitle()) === 'Ограничить «Альта Групп»?', '');
    await shot(EV_CARD, 'impl-409-1440.png');
    await call('browser_press_key', { key: 'Escape' });
    await wait(1);
    const focused = await evaluate(`() => document.activeElement?.textContent?.trim()`);
    s = yaml(await call('browser_snapshot'));
    check('card', 'Escape закрывает диалог, фокус — на «Ограничить новые операции»', (await dialogTitle()) === '' && focused.includes('Ограничить новые операции'), focused);
    await scenario({ scenario: 'extendPlatformTrial=offline', once: true });
    await call('browser_click', { element: 'Продлить', target: ref(s, 'button', 'Продлить пробный период на 14 дней') });
    await wait(1);
    s = yaml(await call('browser_snapshot'));
    await reason(s, 'Проверка без связи');
    s = yaml(await call('browser_snapshot'));
    await call('browser_click', { element: 'Продлить', target: ref(s, 'button', 'Продлить') });
    await wait(1);
    s = await snap(EV_CARD, 'snapshot-offline-1440.md');
    check('card', 'нет связи: тост «Нет связи с сервером. Операция не выполнена.», диалог открыт', s.includes('Нет связи с сервером. Операция не выполнена.') && (await dialogTitle()).startsWith('Продлить пробный период'), '');
    // Q-W1.25-22: во время запроса кнопка действия — loading (aria-busy, «Выполняем…»), фокус в диалоге на ней.
    // browser_click MCP ждёт завершения запросов, начатых действием, — состояние «во время запроса» снимается
    // внутри одного browser_evaluate: фокус и нажатие кнопки, как у пользователя, и чтение через 800 мс.
    await scenario({ scenario: 'extendPlatformTrial=delay=10000', once: true });
    const busy = JSON.parse(await evaluate(`async () => {
      const d0 = document.querySelector('[role=dialog]');
      const btn = Array.from(d0.querySelectorAll('button')).find((b) => b.textContent.trim().endsWith('Продлить'));
      btn.focus();
      btn.click();
      await new Promise((r) => setTimeout(r, 800));
      const a = document.activeElement;
      const d = document.querySelector('[role=dialog]');
      return JSON.stringify({ tag: a?.tagName, busy: a?.getAttribute('aria-busy'), disabled: a?.getAttribute('aria-disabled'), text: a?.textContent?.trim(), inDialog: !!d && d.contains(a), field: d?.querySelector('textarea')?.disabled, cancel: Array.from(d?.querySelectorAll('button') ?? []).find((b) => b.textContent.trim() === 'Отмена')?.disabled });
    }`));
    s = await snap(EV_CARD, 'snapshot-busy-1440.md');
    check('card', 'Q-W1.25-22 во время запроса: фокус на кнопке действия в диалоге, aria-busy, aria-disabled, «Выполняем…», поле и «Отмена» недоступны', busy.inDialog && busy.busy === 'true' && busy.disabled === 'true' && busy.text.includes('Выполняем') && busy.field === true && busy.cancel === true, JSON.stringify(busy));
    await shot(EV_CARD, 'impl-busy-1440.png');
    // Ответ через 10 с; тост к этому моменту мог уже скрыться — итог по диалогу и сроку карточки.
    let closed = false;
    for (let i = 0; i < 15 && !closed; i++) {
      await wait(1);
      closed = (await dialogTitle()) === '';
    }
    const trialAfter = await evaluate(`() => Array.from(document.querySelectorAll('aside dt')).find((d) => d.textContent === 'Пробный период')?.nextElementSibling?.textContent ?? ''`);
    check('card', 'Q-W1.25-22 после ответа диалог закрыт, срок продлён ещё на 14 дней (после 27.10.2026)', closed && !trialAfter.includes('27.10.2026') && trialAfter.startsWith('Осталось'), trialAfter);
  }

  // 390: карточка под списком, диалог снизу
  await call('browser_resize', { width: 390, height: 844 });
  await call('browser_navigate', { url: `${APP}/platform/tenants` });
  await wait(2);
  s = yaml(await call('browser_snapshot'));
  await call('browser_click', { element: 'Продлить', target: ref(s, 'button', 'Продлить пробный период на 14 дней') });
  await wait(1);
  await snap(EV_CARD, 'snapshot-dialog-390.md');
  const bottom = await evaluate(`() => { const r = document.querySelector('[role=dialog]').getBoundingClientRect(); return Math.round(r.bottom) + '/' + innerHeight; }`);
  check('card', '390: диалог снизу (лист)', bottom.replace(/"/g, '').split('/')[0] === bottom.replace(/"/g, '').split('/')[1], bottom);
  await shot(EV_CARD, 'impl-dialog-390.png');
  await call('browser_press_key', { key: 'Escape' });
  writeFileSync(join(EV_CARD, 'console.md'), await call('browser_console_messages'), 'utf8');
  writeFileSync(join(EV_CARD, 'network.md'), await call('browser_network_requests'), 'utf8');

  // ── эталон design-stage-1: оператор, «Организации-клиенты» и диалог продления ──
  if (MODE === 'mock') {
    await call('browser_resize', { width: 1440, height: 900 });
    await call('browser_navigate', { url: REF });
    await wait(4);
    s = yaml(await call('browser_snapshot'));
    await call('browser_select_option', { element: 'Персонаж', target: ref(s, 'combobox', 'Персонаж'), values: ['operator'] });
    await wait(2);
    s = await snap(EV_ORGS, 'ref-snapshot-1440.md');
    check('orgs', 'эталон: «Организации-клиенты», четыре строки', s.includes('heading "Организации-клиенты" [level=1]') && s.includes('Карго Сити'), '');
    await shot(EV_ORGS, 'ref-1440.png');
    await call('browser_click', { element: 'Продлить', target: ref(s, 'button', 'Продлить пробный период на 14 дней') });
    await wait(1);
    await snap(EV_CARD, 'ref-snapshot-extend-dialog-1440.md');
    await shot(EV_CARD, 'ref-extend-dialog-1440.png');
    await call('browser_press_key', { key: 'Escape' });
    await call('browser_resize', { width: 390, height: 844 });
    await wait(1);
    await shot(EV_ORGS, 'ref-390.png');
  }
} catch (e) {
  console.error(e);
  checks.card.push(`| — | прерывание | FAIL | ${String(e.message).slice(0, 200)} |`);
} finally {
  writeFileSync(join(EV_ORGS, 'mcp-log.md'), log.join('\n'), 'utf8');
  const head = (k) => `# W1.25 · проходка Playwright MCP ${k} (${MODE}, Vite 5213${MODE === 'mock' ? ', эталон 4113 design-stage-1' : ', стенд ortus-s13'})\n\n| # | Проверка | Итог | Детали |\n|---|---|---|---|\n`;
  writeFileSync(join(EV_ORGS, 'checks.md'), head('platform-orgs') + checks.orgs.join('\n') + '\n', 'utf8');
  writeFileSync(join(EV_CARD, 'checks.md'), head('platform-org-card') + checks.card.join('\n') + '\n', 'utf8');
  console.log([...checks.orgs, ...checks.card].join('\n'));
  child.kill();
}
