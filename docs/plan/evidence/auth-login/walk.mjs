// W1.22 · Проходка Playwright MCP (verification-protocol §4) для ключей auth-login, auth-invitation, inbox: сервер
// @playwright/mcp из .mcp.json по stdio (как tools/mcp-check.js), клики — по ref снимка, найденному по роли и подписи.
// Приложение — Vite --mode e2e на 5210 (VITE_ADAPTER=mock), эталон — design-preview на 4110 (--ref design-stage-1).
// BFF и провайдер входа в режиме mock имитирует browser_run_code_unsafe (page.route: startLogin → 302 на returnTo с
// dev-входом ?persona=), как фикстура e2e fakeIdp: service worker MSW навигацию не перехватывает.
//   node docs/plan/evidence/auth-login/walk.mjs <worktree>
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WT = process.argv[2];
const APP = 'http://127.0.0.1:5210';
const REF = 'http://127.0.0.1:4110/%D0%9E%D1%80%D1%82%D1%83%D1%81%20CRM.dc.html';
const OUT = join(WT, '.playwright-mcp', '5210');
const EV = {
  login: join(WT, 'docs/plan/evidence/auth-login'),
  invitation: join(WT, 'docs/plan/evidence/auth-invitation'),
  inbox: join(WT, 'docs/plan/evidence/inbox'),
};
for (const d of [OUT, ...Object.values(EV)]) mkdirSync(d, { recursive: true });

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
const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
const request = (method, params) => {
  const i = id++;
  send({ jsonrpc: '2.0', id: i, method, params });
  return new Promise((res, rej) => pending.set(i, { res, rej }));
};
const log = [];
const checks = { login: [], invitation: [], inbox: [] };
async function call(name, args = {}) {
  const r = await request('tools/call', { name, arguments: args });
  const text = (r.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  log.push(`### ${name} ${JSON.stringify(args).slice(0, 400)}\n${text.slice(0, 4000)}\n`);
  if (r.isError) throw new Error(`${name}: ${text}`);
  return text;
}
const yaml = (t) => {
  const i = t.indexOf('```yaml');
  return i < 0 ? t : t.slice(i + 7, t.indexOf('```', i + 7)).trim();
};
function ref(snap, role, name, exact = true) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Имена с двоеточием YAML снимка берёт в кавычки: `- 'button "Уведомления: 2 новых" [ref=…]'`.
  const re = new RegExp(`- '?${role} "${esc}${exact ? '' : '[^"]*'}"[^\\n]*\\[ref=([a-z0-9]+)\\]`);
  const m = re.exec(snap);
  if (!m) throw new Error(`нет ${role} "${name}" в снимке`);
  return m[1];
}
const check = (key, name, ok, detail = '') => {
  checks[key].push(
    `| ${checks[key].length + 1} | ${name} | ${ok ? 'ok' : 'FAIL'} | ${String(detail).replace(/\|/g, '/').replace(/\n/g, ' ')} |`,
  );
  if (!ok) console.error(`FAIL [${key}]: ${name} ${detail}`);
};
const snap = async (dir, file) => {
  const t = yaml(await call('browser_snapshot'));
  if (file) writeFileSync(join(dir, file), `${t}\n`, 'utf8');
  return t;
};
const shot = async (dir, file) => {
  // Относительное имя сервер пишет от рабочего каталога процесса — путь задаётся абсолютным.
  await call('browser_take_screenshot', { filename: join(dir, file) });
};
const evaluate = async (fn) => {
  const t = await call('browser_evaluate', { function: fn });
  const m = /### Result\s*\n([\s\S]*?)(\n###|$)/.exec(t);
  return (m ? m[1] : t).trim();
};
const wait = (s) => call('browser_wait_for', { time: s });
const go = async (path, s = 2) => {
  await call('browser_navigate', { url: `${APP}${path}` });
  await wait(s);
};
const size = (w, h) => call('browser_resize', { width: w, height: h });
/** Имитация BFF и провайдера входа: startLogin → 302 на returnTo с ?persona=. */
const fakeIdp = (persona) =>
  call('browser_run_code_unsafe', {
    code: `async (page) => {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.route('**/api/v1/auth/login**', async (route) => {
        // В песочнице run_code нет URL: путь возврата разбирается строкой.
        const m = /[?&]returnTo=([^&#]*)/.exec(route.request().url());
        const back = m ? decodeURIComponent(m[1]) : '/';
        const location = back + (back.includes('?') ? '&' : '?') + 'persona=' + encodeURIComponent(${JSON.stringify(persona)});
        await route.fulfill({ status: 302, headers: { Location: location } });
      });
    }`,
  });
const devScenario = (body) =>
  evaluate(`async () => {
    const csrf = /(?:^|;\\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1];
    const r = await fetch('/api/v1/dev/scenario', { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf ?? '') },
      body: ${JSON.stringify(JSON.stringify(body))} });
    return r.status;
  }`);
const signOut = () =>
  evaluate(`() => { for (const n of ['ortus_sid', 'ortus_csrf']) document.cookie = n + '=; Max-Age=0; Path=/'; return 'ok'; }`);
const overflow = () =>
  evaluate('() => document.documentElement.scrollWidth - document.documentElement.clientWidth');
const apiCalls = (net) =>
  net
    .split('\n')
    .filter((l) => l.includes('/api/'))
    .map((l) => l.trim());

try {
  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'w1.22', version: '1' },
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  // ── auth-login ──
  await size(1440, 900);
  await go('/auth/login');
  let s = await snap(EV.login, 'snapshot.txt');
  check('login', '1440: заголовок «Вход», «Войти», без шапки и меню', s.includes('heading "Вход"') && s.includes('button "Войти"') && !s.includes('banner'), '');
  let net = await call('browser_network_requests');
  check('login', 'на загрузке нет запросов к /api/', apiCalls(net).length === 0, apiCalls(net).join('; '));
  await shot(EV.login, '1440.png');
  await go('/auth/login?next=%2Fplatform%2Ftenants');
  s = await snap(EV.login, 'snapshot-operator-1440.txt');
  check('login', 'next=/platform/tenants — «Вход в управление платформой…»', s.includes('Вход в управление платформой. Отдельный вход · без доступа к данным клиентов.'), '');
  await go('/auth/login?error=session_expired');
  s = await snap(EV.login, 'snapshot-session-expired-1440.txt');
  // Без ?next= экран не обещает вернуть на прежнюю страницу (возврат 1): «Сессия истекла. Войдите снова.»
  check('login', '?error=session_expired — «Нужен вход», «Сессия истекла. Войдите снова.» без обещания возврата', s.includes('Нужен вход') && s.includes('Сессия истекла. Войдите снова.') && !s.includes('этот экран'), '');
  await shot(EV.login, 'impl-session-expired-1440.png');
  await go('/auth/login?error=forbidden_action');
  s = await snap(EV.login, 'snapshot-forbidden-1440.txt');
  check('login', '?error=forbidden_action — «Вход не выполнен», alert', s.includes('alert') && s.includes('Вход не выполнен'), '');
  // Основной сценарий: «Войти» → BFF/провайдер (имитация) → returnTo с сессией → оболочка «Альты».
  await fakeIdp('owner');
  await go('/auth/login');
  s = await snap();
  await call('browser_click', { element: 'Войти', target: ref(s, 'button', 'Войти') });
  await wait(3);
  const after = await evaluate('() => location.pathname');
  s = await snap(EV.login, 'snapshot-after-login-1440.txt');
  check('login', '«Войти» → startLogin → оболочка «Альта Групп» на /t/<id>/home', /\/t\/[0-9a-f-]{36}\/home/.test(after) && s.includes('Альта Групп'), after);
  await shot(EV.login, 'impl-after-login-1440.png');
  await call('browser_run_code_unsafe', { code: `async (page) => { await page.unrouteAll({ behavior: 'ignoreErrors' }); }` });
  // Tab → «Войти», кольцо фокуса
  await signOut();
  await go('/auth/login');
  await call('browser_press_key', { key: 'Tab' });
  const focus = await evaluate(`() => document.activeElement?.textContent + ' / ' + getComputedStyle(document.activeElement).outlineStyle`);
  check('login', 'Tab → «Войти», кольцо фокуса видно', focus.includes('Войти') && !focus.includes('none'), focus);
  for (const [w, h] of [
    [768, 1024],
    [390, 844],
  ]) {
    await size(w, h);
    await go('/auth/login?error=session_expired');
    await snap(EV.login, `snapshot-${w}.txt`);
    const ox = await overflow();
    const btn = await evaluate(`() => Math.round([...document.querySelectorAll('button')].find((b) => b.textContent.includes('Войти')).getBoundingClientRect().height)`);
    check('login', `${w}: без горизонтальной прокрутки, «Войти» ≥ 44 px`, Number(ox) <= 0 && Number(btn) >= 44, `overflow ${ox}, кнопка ${btn} px`);
    await shot(EV.login, `${w}.png`);
  }
  writeFileSync(join(EV.login, 'console.txt'), await call('browser_console_messages'), 'utf8');
  writeFileSync(join(EV.login, 'network.txt'), await call('browser_network_requests'), 'utf8');

  // ── auth-invitation ──
  await size(1440, 900);
  await go('/auth/login');
  await devScenario({ reset: true });
  const token = (
    await evaluate(`async () => (await (await fetch('/api/v1/dev/scenario')).json()).invitations.find((i) => i.email === 'o.petrova@alta.example').token`)
  ).replace(/"/g, '');
  await signOut();
  await go(`/auth/invitation#token=${token}`);
  s = await snap(EV.invitation, 'snapshot.txt');
  const url = await evaluate('() => location.pathname + location.hash');
  check('invitation', 'ссылка без входа: «Приглашение в «Альта Групп»», маска почты, срок, «Войти и принять»', s.includes('heading "Приглашение в «Альта Групп»"') && s.includes('o•••••@alta.example') && s.includes('button "Войти и принять"'), '');
  check('invitation', 'фрагмент #token= убран из адреса', url.replace(/"/g, '') === '/auth/invitation', url);
  net = await call('browser_network_requests');
  check('invitation', 'токен не в URL запросов', !net.includes(token), '');
  await shot(EV.invitation, '1440.png');
  await fakeIdp('acc-6');
  s = await snap();
  await call('browser_click', { element: 'Войти и принять', target: ref(s, 'button', 'Войти и принять') });
  await wait(3);
  s = await snap(EV.invitation, 'snapshot-signed-in-1440.txt');
  check('invitation', 'возврат после входа: «Вы вошли как Олеся Петрова.», «Принять приглашение»', s.includes('Вы вошли как Олеся Петрова.') && s.includes('button "Принять приглашение"'), '');
  await shot(EV.invitation, 'impl-signed-in-1440.png');
  await call('browser_click', { element: 'Принять приглашение', target: ref(s, 'button', 'Принять приглашение') });
  await wait(3);
  s = await snap(EV.invitation, 'snapshot-accepted-1440.txt');
  const path = await evaluate('() => location.pathname');
  check('invitation', 'принято: оболочка «Альта Групп», тост «Вы присоединились к «Альта Групп»»', /\/t\/[0-9a-f-]{36}\//.test(path) && s.includes('Альта Групп') && s.includes('Вы присоединились к «Альта Групп»'), path);
  await shot(EV.invitation, 'impl-accepted-1440.png');
  await go(`/auth/invitation#token=${token}`);
  s = await snap(EV.invitation, 'snapshot-already-accepted-1440.txt');
  check('invitation', 'ссылка повторно — «Приглашение уже принято»', s.includes('Приглашение уже принято'), '');
  await call('browser_run_code_unsafe', { code: `async (page) => { await page.unrouteAll({ behavior: 'ignoreErrors' }); }` });
  // Другой аккаунт
  await devScenario({ reset: true });
  await go(`/auth/invitation?persona=owner%40t-lotos#token=${token}`, 3);
  s = await snap();
  await call('browser_click', { element: 'Принять приглашение', target: ref(s, 'button', 'Принять приглашение') });
  await wait(2);
  s = await snap(EV.invitation, 'snapshot-mismatch-1440.txt');
  check('invitation', 'другой аккаунт: «Приглашение для другого адреса», «Войти под другим аккаунтом»', s.includes('Приглашение для другого адреса') && s.includes('Войти под другим аккаунтом'), '');
  await shot(EV.invitation, 'impl-mismatch-1440.png');
  // Истекло
  await devScenario({ reset: true, now: '2026-10-09T00:00:00Z' });
  await go('/auth/login', 1); // новая загрузка документа: смена только фрагмента не перезагружает страницу
  await go(`/auth/invitation#token=${token}`);
  s = await snap(EV.invitation, 'snapshot-expired-1440.txt');
  check('invitation', 'истекло: «Срок приглашения истёк», «Перейти ко входу»', s.includes('Срок приглашения истёк') && s.includes('link "Перейти ко входу"'), '');
  await shot(EV.invitation, 'impl-expired-1440.png');
  await devScenario({ reset: true, now: '2026-10-01T07:30:00Z' });
  // Не найдено
  await go(`/auth/invitation#token=${'Z'.repeat(43)}`);
  s = await snap(EV.invitation, 'snapshot-not-found-1440.txt');
  check('invitation', 'неизвестный токен — «Приглашение не найдено»', s.includes('Приглашение не найдено'), '');
  // Возврат 16.10 №1: 409 при принятии, 401 при принятии, отозвано, фокус после «Повторить».
  await devScenario({ reset: true });
  await go('/auth/login', 1);
  await go(`/auth/invitation?persona=acc-6#token=${token}`, 3);
  await devScenario({ scenario: 'acceptInvitation=invalid_transition', once: true });
  s = await snap();
  await call('browser_click', { element: 'Принять приглашение', target: ref(s, 'button', 'Принять приглашение') });
  await wait(2);
  s = await snap(EV.invitation, 'snapshot-invalid-transition-1440.txt');
  check('invitation', '409 invalid_transition: «Приглашение не принято», «Приглашение уже принято или отозвано»', s.includes('Приглашение не принято') && s.includes('Приглашение уже принято или отозвано'), '');
  await devScenario({ reset: true });
  await go('/auth/login', 1);
  await go(`/auth/invitation?persona=acc-6#token=${token}`, 3);
  s = await snap();
  check('invitation', 'вошла приглашённая: «Вы вошли как Олеся Петрова.»', s.includes('Вы вошли как Олеся Петрова.'), '');
  await devScenario({ scenario: 'session_expired' });
  await call('browser_click', { element: 'Принять приглашение', target: ref(s, 'button', 'Принять приглашение') });
  await wait(2);
  s = await snap(EV.invitation, 'snapshot-session-lost-1440.txt');
  check('invitation', '401 session_expired при принятии: только «Войти и принять», без «Вы вошли как» и «Принять приглашение»', s.includes('button "Войти и принять"') && !s.includes('Вы вошли как') && !s.includes('button "Принять приглашение"') && !s.includes('Войти под другим аккаунтом'), '');
  await shot(EV.invitation, 'impl-session-lost-1440.png');
  await devScenario({ scenario: null });
  await signOut();
  // Отозвано: правка состояния сценарного сервера вкладки init-скриптом до старта MSW (как e2e setSeedInvitationsStatus).
  await call('browser_run_code_unsafe', {
    code: `async (page) => {
      await page.addInitScript({ content: "(() => { const k = 'ortus:msw:state', d = 'walk:revoked'; const raw = sessionStorage.getItem(k); if (sessionStorage.getItem(d) || !raw) return; const s = JSON.parse(raw); for (const o of Object.values(s.orgs)) for (const i of o.invitations) i.status = 'revoked'; sessionStorage.setItem(k, JSON.stringify(s)); sessionStorage.setItem(d, '1'); })();" });
    }`,
  });
  await go('/auth/login', 1);
  await go(`/auth/invitation#token=${token}`);
  s = await snap(EV.invitation, 'snapshot-revoked-1440.txt');
  const kept = await evaluate(`() => String(sessionStorage.getItem('ortus:invitation-token'))`);
  check('invitation', 'отозвано: «Приглашение отозвано», «Перейти ко входу», кнопок принятия нет, токен забыт', s.includes('heading "Приглашение отозвано"') && s.includes('link "Перейти ко входу"') && !s.includes('Войти и принять') && kept.includes('null'), kept);
  await shot(EV.invitation, 'impl-revoked-1440.png');
  await devScenario({ reset: true });
  await devScenario({ scenario: 'inspectInvitation=rate_limited', once: true });
  await go('/auth/login', 1);
  await go(`/auth/invitation#token=${token}`);
  s = await snap();
  check('invitation', 'сбой проверки: «Не удалось проверить приглашение», «Повторить»', s.includes('Не удалось проверить приглашение') && s.includes('button "Повторить"'), '');
  await call('browser_click', { element: 'Повторить', target: ref(s, 'button', 'Повторить') });
  await wait(2);
  const focused = await evaluate(`() => document.activeElement.tagName + ' ' + document.activeElement.textContent`);
  check('invitation', '«Повторить» → приглашение, фокус на h1 «Приглашение в «Альта Групп»»', focused.includes('H1 Приглашение в «Альта Групп»'), focused);
  // 768 / 390 — ссылка без входа
  await signOut();
  for (const [w, h] of [
    [768, 1024],
    [390, 844],
  ]) {
    await size(w, h);
    await go(`/auth/invitation#token=${token}`);
    await snap(EV.invitation, `snapshot-${w}.txt`);
    const ox = await overflow();
    check('invitation', `${w}: без горизонтальной прокрутки`, Number(ox) <= 0, `overflow ${ox}`);
    await shot(EV.invitation, `${w}.png`);
  }
  // 390: сбой /me/context — «Повторить» баннера ≥ 44 px.
  await devScenario({ scenario: 'getMyContext=offline', once: true });
  await go('/auth/login', 1);
  await go(`/auth/invitation#token=${token}`);
  s = await snap(EV.invitation, 'snapshot-me-error-390.txt');
  const retryH = await evaluate(`() => Math.round(document.querySelector('[role=alert] button').getBoundingClientRect().height)`);
  check('invitation', '390: «Не удалось проверить вход», «Повторить» баннера ≥ 44 px', s.includes('Не удалось проверить вход') && Number(retryH) >= 44, `${retryH} px`);
  await shot(EV.invitation, 'impl-me-error-390.png');
  writeFileSync(join(EV.invitation, 'console.txt'), await call('browser_console_messages'), 'utf8');
  writeFileSync(join(EV.invitation, 'network.txt'), await call('browser_network_requests'), 'utf8');

  // ── inbox ──
  await size(1440, 900);
  await go('/?persona=owner', 3);
  await devScenario({ reset: true });
  await go('/?persona=owner', 3);
  s = await snap();
  await call('browser_click', { element: 'Уведомления', target: ref(s, 'button', 'Уведомления: 2 новых') });
  await wait(2);
  s = await snap(EV.inbox, 'snapshot.txt');
  check('inbox', 'владелец: «Уведомления: 2 новых», поповер «Уведомления», «Прочитать все», 3 события', s.includes('dialog "Уведомления"') && s.includes('button "Прочитать все"') && s.includes('link "Новое: Олеся Петрова приняла приглашение"') && s.includes('link "Подключён модуль «Салон и SPA»"'), '');
  await shot(EV.inbox, '1440.png');
  await call('browser_click', { element: 'событие', target: ref(s, 'link', 'Новое: Олеся Петрова приняла приглашение') });
  await wait(2);
  s = await snap(EV.inbox, 'snapshot-opened-record-1440.txt');
  const rec = await evaluate('() => location.pathname');
  check('inbox', 'переход к записи: «Пользователи и роли», счётчик 1', rec.includes('/users') && s.includes('Уведомления: 1 новых'), rec);
  await call('browser_click', { element: 'Уведомления', target: ref(s, 'button', 'Уведомления: 1 новых') });
  await wait(2);
  s = await snap();
  await call('browser_click', { element: 'Прочитать все', target: ref(s, 'button', 'Прочитать все') });
  await wait(2);
  s = await snap(EV.inbox, 'snapshot-read-all-1440.txt');
  check('inbox', '«Прочитать все» — колокол «Уведомления» без счётчика', s.includes('button "Уведомления"') && !s.includes('новых'), '');
  await shot(EV.inbox, 'impl-read-all-1440.png');
  await call('browser_press_key', { key: 'Escape' });
  // Сбой ленты и «Повторить»
  await devScenario({ scenario: 'listMyNotifications=rate_limited' });
  await go('/', 3);
  s = await snap();
  await call('browser_click', { element: 'Уведомления', target: ref(s, 'button', 'Уведомления', false) });
  await wait(2);
  s = await snap(EV.inbox, 'snapshot-error-1440.txt');
  check('inbox', 'сбой ленты: «Не удалось загрузить уведомления.», «Повторить»', s.includes('Не удалось загрузить уведомления.') && s.includes('button "Повторить"'), '');
  await shot(EV.inbox, 'impl-error-1440.png');
  await devScenario({ scenario: null });
  await call('browser_click', { element: 'Повторить', target: ref(s, 'button', 'Повторить') });
  await wait(2);
  s = await snap();
  check('inbox', '«Повторить» — события снова видны', s.includes('Олеся Петрова приняла приглашение'), '');
  // Пусто — водитель
  await go('/?persona=driver', 3);
  s = await snap();
  await call('browser_click', { element: 'Уведомления', target: ref(s, 'button', 'Уведомления') });
  await wait(2);
  s = await snap(EV.inbox, 'snapshot-empty-1440.txt');
  check('inbox', 'водитель: «Новых событий нет»', s.includes('Новых событий нет'), '');
  await shot(EV.inbox, 'impl-empty-1440.png');
  // «Показать ещё»: ещё 15 прочитанных событий владельца «Альты» (18 — две страницы по 12), правка состояния вкладки.
  await devScenario({ reset: true });
  await call('browser_run_code_unsafe', {
    code: `async (page) => {
      await page.addInitScript({ content: "(() => { const k = 'ortus:msw:state', d = 'walk:inbox-more'; const raw = sessionStorage.getItem(k); if (sessionStorage.getItem(d) || !raw) return; const s = JSON.parse(raw); const owner = s.accounts.find((a) => a.proto === 'acc-1'); const org = Object.values(s.orgs).find((o) => o.notifications.some((n) => n.accountId === owner.id)); for (let i = 0; i < 15; i += 1) org.notifications.push({ accountId: owner.id, id: '00000000-0000-4000-8000-0000000000' + String(i).padStart(2, '0'), kind: 'members.member.updated', severity: 'info', title: 'Событие ' + (i + 1), createdAt: '2026-09-2' + Math.floor(i / 10) + 'T0' + (i % 10) + ':00:00Z', readAt: '2026-09-29T00:00:00Z' }); sessionStorage.setItem(k, JSON.stringify(s)); sessionStorage.setItem(d, '1'); })();" });
    }`,
  });
  await go('/?persona=owner', 3);
  s = await snap();
  await call('browser_click', { element: 'Уведомления', target: ref(s, 'button', 'Уведомления', false) });
  await wait(2);
  const rows = () => evaluate(`() => document.querySelectorAll('[role=dialog] .ox-inbox-item').length`);
  s = await snap();
  const first = await rows();
  check('inbox', '18 событий: первая страница 12 строк и «Показать ещё»', Number(first) === 12 && s.includes('button "Показать ещё"'), `${first} строк`);
  await call('browser_click', { element: 'Показать ещё', target: ref(s, 'button', 'Показать ещё') });
  await wait(2);
  s = await snap(EV.inbox, 'snapshot-more-1440.txt');
  const all = await rows();
  check('inbox', '«Показать ещё» → 18 строк, кнопка исчезла', Number(all) === 18 && !s.includes('Показать ещё'), `${all} строк`);
  await shot(EV.inbox, 'impl-more-1440.png');
  const notes = await evaluate(`() => document.querySelectorAll('.ox-inbox-note').length`);
  check('inbox', 'строка события — заголовок и время, без body (эталон :129–132)', Number(notes) === 0, `${notes}`);
  await call('browser_press_key', { key: 'Escape' });
  // 768 / 390 — панель владельца
  await devScenario({ reset: true });
  for (const [w, h] of [
    [768, 1024],
    [390, 844],
  ]) {
    await size(w, h);
    await go('/?persona=owner', 3);
    s = await snap();
    await call('browser_click', { element: 'Уведомления', target: ref(s, 'button', 'Уведомления', false) });
    await wait(2);
    await snap(EV.inbox, `snapshot-${w}.txt`);
    const box = await evaluate(`() => { const r = document.querySelector('[role=dialog][aria-label="Уведомления"]').getBoundingClientRect(); return Math.round(r.left) + '…' + Math.round(r.right) + ' из ' + innerWidth; }`);
    const ox = await overflow();
    check('inbox', `${w}: панель в экране, без горизонтальной прокрутки`, Number(ox) <= 0, `${box}, overflow ${ox}`);
    await shot(EV.inbox, `${w}.png`);
  }
  writeFileSync(join(EV.inbox, 'console.txt'), await call('browser_console_messages'), 'utf8');
  writeFileSync(join(EV.inbox, 'network.txt'), await call('browser_network_requests'), 'utf8');
  // Эталон: поповер «Уведомления» владельца (design-stage-1, без событий)
  await size(1440, 900);
  await call('browser_navigate', { url: REF });
  await wait(4);
  s = await snap();
  const bell = /- button "(Уведомления[^"]*)"/.exec(s)?.[1] ?? 'Уведомления';
  await call('browser_click', { element: 'Уведомления', target: ref(s, 'button', bell) });
  await wait(1);
  s = await snap(EV.inbox, 'ref-snapshot-owner-1440.txt');
  check('inbox', 'эталон: поповер «Уведомления», «Прочитать все» (подписи совпадают)', s.includes('dialog "Уведомления"') && s.includes('button "Прочитать все"'), bell);
  await shot(EV.inbox, 'ref-owner-1440.png');
} catch (e) {
  console.error(e);
  checks.inbox.push(`| — | прерывание | FAIL | ${String(e.message).slice(0, 300)} |`);
} finally {
  writeFileSync(join(EV.login, 'mcp-log.txt'), log.join('\n'), 'utf8');
  const head = '| # | Проверка | Итог | Детали |\n|---|---|---|---|\n';
  for (const [k, dir] of Object.entries(EV)) {
    writeFileSync(join(dir, 'checks.md'), `# W1.22 · проходка Playwright MCP — ${k} (mock, Vite 5210, эталон 4110 design-stage-1)\n\n${head}${checks[k].join('\n')}\n`, 'utf8');
    console.log(`${k}:\n${checks[k].join('\n')}`);
  }
  child.kill();
}
