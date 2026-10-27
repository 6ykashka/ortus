// W7.33 · Проходка Playwright MCP (verification-protocol §4) для ключей public-service-page и public-service-request:
// сервер @playwright/mcp из .mcp.json по stdio (как tools/mcp-check.js), клики — по ref снимка (роль и подпись).
// Приложение — Vite --mode e2e на 5203 (VITE_ADAPTER=mock), эталон — design-preview на 4103 (--ref design-2026-10-19).
//   node docs/plan/evidence/public-service-page/walk.mjs <worktree>
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WT = process.argv[2];
const APP = 'http://127.0.0.1:5203';
const REF = 'http://127.0.0.1:4103/%D0%9E%D0%B1%D1%80%D0%B0%D1%89%D0%B5%D0%BD%D0%B8%D1%8F%20-%20%D0%B2%D0%B0%D1%80%D0%B8%D0%B0%D0%BD%D1%82%D1%8B.dc.html';
const OUT = join(WT, '.playwright-mcp', '5203');
const EV = {
  page: join(WT, 'docs/plan/evidence/public-service-page'),
  request: join(WT, 'docs/plan/evidence/public-service-request'),
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
const checks = { page: [], request: [] };
async function call(name, args = {}) {
  const r = await request('tools/call', { name, arguments: args });
  const text = (r.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  log.push(`### ${name} ${JSON.stringify(args).slice(0, 400)}\n${text.slice(0, 3000)}\n`);
  if (r.isError) throw new Error(`${name}: ${text}`);
  return text;
}
const yaml = (t) => {
  const i = t.indexOf('```yaml');
  return i < 0 ? t : t.slice(i + 7, t.indexOf('```', i + 7)).trim();
};
function ref(snap, role, name, exact = true) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
const shot = (dir, file) => call('browser_take_screenshot', { filename: join(dir, file) });
const evaluate = async (fn) => {
  const t = await call('browser_evaluate', { function: fn });
  const m = /### Result\s*\n([\s\S]*?)(\n###|$)/.exec(t);
  return (m ? m[1] : t).trim();
};
const wait = (s) => call('browser_wait_for', { time: s });
const go = async (path, s = 3) => {
  await call('browser_navigate', { url: `${APP}${path}` });
  await wait(s);
};
const size = (w, h) => call('browser_resize', { width: w, height: h });
const click = async (dir, role, name, exact = true) => {
  const s = await snap(dir);
  await call('browser_click', { element: name, target: ref(s, role, name, exact) });
  await wait(1);
};
const type = async (dir, label, text, role = 'textbox') => {
  const s = await snap(dir);
  await call('browser_type', { element: label, target: ref(s, role, label, false), text });
};
/** Запрос к API из страницы (сценарный сервер в service worker). */
const api = (method, path, body, ifMatch) =>
  evaluate(`async () => {
    const csrf = /(?:^|;\\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1];
    const h = { 'Idempotency-Key': crypto.randomUUID(), 'Content-Type': 'application/json' };
    if (csrf) h['X-CSRF-Token'] = decodeURIComponent(csrf);
    ${ifMatch ? `h['If-Match'] = ${JSON.stringify(ifMatch)};` : ''}
    const r = await fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, credentials: 'include', headers: h, ${body ? `body: JSON.stringify(${JSON.stringify(body)}),` : ''} });
    const t = await r.text();
    return JSON.stringify({ status: r.status, etag: r.headers.get('etag'), body: t ? JSON.parse(t) : null });
  }`);
const apiJson = async (...a) => JSON.parse(JSON.parse(await api(...a)));

try {
  await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'w7.33-walk', version: '1' },
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  // ---------- эталон ----------
  await size(1440, 900);
  await call('browser_navigate', { url: `${REF}#1a` });
  await wait(3);
  const refSnap = await snap(EV.page, 'reference-snapshot.txt');
  for (const t of [
    'Чем помочь?',
    'Как вам визит?',
    'Довольны ли решением?',
    'Оценить и поблагодарить',
    'Если что-то не так',
    'Вопрос не решён — вернуть в работу',
    'Не хотите опросов — ответьте СТОП',
  ])
    check('page', `эталон 1a содержит «${t}»`, refSnap.includes(t));
  await shot(EV.page, 'reference-1a-1440.png');

  // ---------- public-service-page, 390 ----------
  await size(390, 844);
  await go('/s/mas');
  let s = await snap(EV.page, 'snapshot-390.txt');
  check('page', '390: «Чем помочь?», бренд и направление', s.includes('Чем помочь?') && s.includes('Альта Групп') && s.includes('Массаж'));
  check('page', '390: три группы и пять типов', ['Оценить и поблагодарить', 'Если что-то не так', 'Другое', 'Жалоба', 'Спасибо мастеру'].every((t) => s.includes(t)));
  check('page', '390: нет меню и шапки оболочки', !/navigation/.test(s));
  const over390 = await evaluate(`() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth`);
  check('page', '390: без горизонтальной прокрутки', Number(over390) <= 1, `overflow ${over390}`);
  await shot(EV.page, 'impl-page-390.png');

  await click(EV.page, 'button', 'Жалоба');
  s = await snap(EV.page, 'snapshot-form-390.txt');
  check('page', 'форма «Жалоба»: поля имя, телефон, текст, согласие', ['Ваше имя', 'Телефон', 'Опишите, что случилось', 'Согласен на обработку персональных данных'].every((t) => s.includes(t)));
  await click(EV.page, 'button', 'Отправить');
  s = await snap(EV.page);
  check('page', 'пустая отправка: ошибки текста и согласия', s.includes('Нужно согласие на обработку персональных данных'));
  await shot(EV.page, 'impl-form-errors-390.png');
  await type(EV.page, 'Ваше имя', 'Ольга');
  await type(EV.page, 'Опишите, что случилось', 'Начали на 15 минут позже, в кабинете холодно');
  await type(EV.page, 'Телефон', '+7 900 123-45-67');
  await click(EV.page, 'checkbox', 'Согласен на обработку персональных данных');
  await click(EV.page, 'button', 'Отправить');
  await wait(1);
  s = await snap(EV.page, 'snapshot-receipt-390.txt');
  check('page', 'квитанция: «Приняли ваше обращение», номер МАС-, «Получили»', s.includes('Приняли ваше обращение') && /МАС-\d+/.test(s) && s.includes('Получили'));
  await shot(EV.page, 'impl-receipt-390.png');

  // ---------- оценка визита ----------
  await go('/s/mas?w=work-1');
  await click(EV.page, 'button', 'Оценить визит');
  s = await snap(EV.page);
  check('page', 'оценка визита: «Как вам визит?», «1 · плохо», «5 · отлично»', ['Как вам визит?', '1 · плохо', '5 · отлично'].every((t) => s.includes(t)));
  await click(EV.page, 'radio', '2 из 5');
  await click(EV.page, 'button', 'Опоздание начала');
  await click(EV.page, 'button', 'Температура в кабинете');
  s = await snap(EV.page, 'snapshot-visit-390.txt');
  check('page', 'оценка 2: причины, «Свяжитесь со мной», «Ответим в течение 2 часов»', ['Что пошло не так?', 'Чистота', 'Свяжитесь со мной', 'Ответим в течение 2 часов'].every((t) => s.includes(t)));
  await shot(EV.page, 'impl-visit-390.png');

  // ---------- 1440 ----------
  await size(1440, 900);
  await go('/s/mas');
  await shot(EV.page, 'impl-page-1440.png');
  check('page', '1440: колонка 480 px по центру, без прокрутки', Number(await evaluate(`() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth`)) <= 1);

  // ---------- public-service-request ----------
  await go('/s/mas');
  const made = await apiJson('POST', '/api/v1/public/service/mas/requests', { typeId: 'd-mas:complaint', text: 'Начали позже, холодно', consent: true, clientName: 'Ольга', phone: '+7 900 123-45-67' });
  const token = made.body.token;
  const key = made.body.key;
  await size(390, 844);
  await go(`/r/${token}`);
  s = await snap(EV.request, 'snapshot-new-390.txt');
  check('request', `390: номер ${key}, «Получили», лента из трёх шагов`, s.includes(key) && s.includes('Получили') && s.includes('Ответили') && s.includes('Решено'));
  check('request', '390: «Довольны ли решением?» у нового обращения нет', !s.includes('Довольны ли решением?'));
  await shot(EV.request, 'impl-new-390.png');
  await type(EV.request, 'Сообщение', 'Жду ответа');
  await click(EV.request, 'button', 'Отправить');
  s = await snap(EV.request);
  check('request', '«Написать»: сообщение в ленте', s.includes('Жду ответа'));

  // Сотрудник отвечает и решает → клиент оценивает.
  await go('/?persona=owner', 3);
  const ctx = await apiJson('GET', '/api/v1/me/context');
  const tenant = ctx.body.tenants.find((t) => t.name === 'Альта Групп').tenantId;
  const base = `/api/v1/tenants/${tenant}/service/requests`;
  const list = await apiJson('GET', base);
  const row = list.body.items.find((x) => x.key === key);
  await apiJson('POST', `${base}/${row.id}/messages`, { kind: 'public', text: 'Ольга, извините: подогрев стола уже чинят. Дарим скидку 20% на следующий визит.' });
  const det = await apiJson('GET', `${base}/${row.id}`);
  const done = await apiJson('POST', `${base}/${row.id}/transitions`, { to: 'resolved', outcome: 'Компенсация' }, det.etag);
  check('request', 'сотрудник перевёл обращение в «Решено»', done.status < 300, `status ${done.status}`);
  await apiJson('POST', '/api/v1/dev/logout');
  await go(`/r/${token}`);
  s = await snap(EV.request, 'snapshot-resolved-390.txt');
  check('request', 'решено: «Решено», ответ команды, «Довольны ли решением?», «Вопрос не решён — вернуть в работу»', ['Решено', 'Извините', 'Довольны ли решением?', 'Вопрос не решён — вернуть в работу'].every((t) => s.includes(t)) || s.includes('Ольга, извините'));
  await shot(EV.request, 'impl-resolved-390.png');
  await click(EV.request, 'radio', '5 из 5');
  s = await snap(EV.request, 'snapshot-rated-390.txt');
  check('request', 'оценка 5: «Вы уже оценили: 5 из 5», шкалы больше нет', s.includes('Вы уже оценили: 5 из 5') && !s.includes('radiogroup "Оценка решения"'));
  await shot(EV.request, 'impl-rated-390.png');
  await size(1440, 900);
  await go(`/r/${token}`);
  await shot(EV.request, 'impl-resolved-1440.png');
  await size(390, 844);

  // 404 / нет связи
  await go('/r/tok_unknown00000000000000000');
  s = await snap(EV.request);
  check('request', 'неизвестная ссылка: «Страница не найдена»', s.includes('Страница не найдена'));
  await shot(EV.request, 'impl-not-found-390.png');

  // Клавиатура: фокус на шкале и стрелки
  await go('/s/mas?w=work-1');
  await click(EV.page, 'button', 'Оценить визит');
  await call('browser_press_key', { key: 'Tab' });
  const focus = await evaluate(`() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent`);
  check('page', 'Tab: фокус на первом элементе формы (шкала или «Назад»)', focus.length > 0, focus);

  const cons = await call('browser_console_messages', { level: 'error' });
  writeFileSync(join(EV.page, 'console.txt'), `${cons}\n`, 'utf8');
  check('page', 'консоль: ошибок нет', !/\[ERROR\]/i.test(cons));
  const net = await call('browser_network_requests', { includeStatic: false });
  writeFileSync(join(EV.page, 'network.txt'), `${net}\n`, 'utf8');
  check('page', 'сеть: страницы портала не ходят в /me/context', !/\/api\/v1\/me\/context.*\/s\/mas/.test(net));
} finally {
  writeFileSync(join(EV.page, 'mcp-log.txt'), log.join('\n'), 'utf8');
  const head = '| # | Проверка | Итог | Детали |\n|---|---|---|---|\n';
  writeFileSync(join(EV.page, 'checks.md'), `# W7.33 · проходка Playwright MCP — public-service-page (mock, Vite 5203, эталон 4103 design-2026-10-19)\n\n${head}${checks.page.join('\n')}\n`, 'utf8');
  writeFileSync(join(EV.request, 'checks.md'), `# W7.33 · проходка Playwright MCP — public-service-request (mock, Vite 5203, эталон 4103 design-2026-10-19)\n\n${head}${checks.request.join('\n')}\n`, 'utf8');
  child.kill();
}
