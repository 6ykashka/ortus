// W1.23 · Проходка Playwright MCP (verification-protocol §4) страниц company-users, company-roles, people-dialogs:
// сервер @playwright/mcp из .mcp.json по stdio (как tools/mcp-check.js), клики — по ref снимка, найденному по
// роли и подписи. Приложение — Vite `--mode e2e` (mock) на 5211, эталон — design-preview на 4111 (design-stage-1).
//   node docs/plan/evidence/company-users/w1.23/walk.mjs <корень worktree>
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WT = process.argv[2];
const APP = 'http://127.0.0.1:5211';
const REF = 'http://127.0.0.1:4111/%D0%9E%D1%80%D1%82%D1%83%D1%81%20CRM.dc.html';
const OUT = join(WT, '.playwright-mcp', '5211');
const EV = {
  users: join(WT, 'docs/plan/evidence/company-users/w1.23'),
  roles: join(WT, 'docs/plan/evidence/company-roles/w1.23'),
  dialogs: join(WT, 'docs/plan/evidence/people-dialogs/w1.23'),
};
for (const d of [OUT, ...Object.values(EV)]) mkdirSync(d, { recursive: true });

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
const checks = { users: [], roles: [], dialogs: [] };
async function call(name, args = {}) {
  const r = await request('tools/call', { name, arguments: args });
  const text = (r.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  log.push(`### ${name} ${JSON.stringify(args)}\n${text.slice(0, 4000)}\n`);
  if (r.isError) throw new Error(`${name}: ${text.slice(0, 500)}`);
  return text;
}
const yaml = (t) => {
  const i = t.indexOf('```yaml');
  if (i < 0) return t;
  return t.slice(i + 7, t.indexOf('```', i + 7)).trim();
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** ref первого элемента роли с подписью (начало подписи при exact=false) после текста `after`. */
function ref(snap, role, name, { exact = true, after } = {}) {
  const from = after ? snap.indexOf(after) : 0;
  if (from < 0) throw new Error(`нет «${after}» в снимке`);
  const re = new RegExp(`- '?${role} "${esc(name)}${exact ? '' : '[^"]*'}"[^\\n]*\\[ref=([a-z0-9]+)\\]`);
  const m = re.exec(snap.slice(from));
  if (!m) throw new Error(`нет ${role} "${name}" в снимке`);
  return m[1];
}
const check = (page, name, ok, detail = '') => {
  checks[page].push(`| ${checks[page].length + 1} | ${name} | ${ok ? 'ok' : 'FAIL'} | ${String(detail).replace(/\|/g, '/').slice(0, 160)} |`);
  if (!ok) console.error(`FAIL ${page}: ${name} ${detail}`);
};
const snap = async (dir, file) => {
  const t = yaml(await call('browser_snapshot'));
  if (file) writeFileSync(join(dir, file), `\`\`\`yaml\n${t}\n\`\`\`\n`, 'utf8');
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
const click = (s, role, name, o) => call('browser_click', { element: name, target: ref(s, role, name, o) });
const scenario = (body) =>
  evaluate(`async () => {
    const csrf = /(?:^|;\\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1];
    const r = await fetch('/api/v1/dev/scenario', { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf ?? ''), 'Idempotency-Key': crypto.randomUUID() },
      body: ${JSON.stringify(JSON.stringify(body))} });
    return r.status;
  }`);
const toastText = () => evaluate(`() => document.querySelector('.ox-toast-text')?.textContent ?? ''`);

let alta = '';
const users = async (q = '') => {
  await call('browser_navigate', { url: `${APP}/t/${alta}/users${q}` });
  await wait(2);
};

try {
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'w1.23', version: '1' } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  // ── company-users ──
  await call('browser_resize', { width: 1440, height: 900 });
  await call('browser_navigate', { url: `${APP}/?persona=owner` });
  await wait(3);
  alta = (await evaluate(`() => location.pathname.split('/')[2]`)).replace(/"/g, '');
  let s = await snap(EV.users);
  await click(s, 'button', 'Пользователи и роли');
  await wait(2);
  s = await snap(EV.users, 'snapshot-people-1440.md');
  check('users', 'из меню: h1 «Пользователи и роли», tablist «Разделы доступа», крошка', s.includes('heading "Пользователи и роли"') && s.includes('tablist "Разделы доступа"') && s.includes('Альта Групп / Компания и доступ'));
  check('users', '«10 участников · без роли: 3 · мест занято 9 из 10», «Пригласить», список «Участники»', s.includes('10 участников · без роли: 3 · мест занято 9 из 10') && s.includes('button "Пригласить"') && s.includes('list "Участники"'));
  check('users', 'Васильев: «через группу «Водители Север»», функция «Водитель»', s.includes('через группу «Водители Север»') && s.includes('Функция «Водитель»: начисления недоступны через любую роль'));
  await shot(EV.users, 'impl-people-1440.png');
  await click(s, 'tab', 'Группы', { exact: false });
  await wait(1);
  s = await snap(EV.users, 'snapshot-groups-1440.md');
  check('users', '«Группы»: «Диспетчеры Север», «Водители Север», «Создать группу»', s.includes('Диспетчеры Север') && s.includes('2 участника: Илья Васильев, Кирилл Громов') && s.includes('button "Создать группу"'));
  await shot(EV.users, 'impl-groups-1440.png');
  await click(s, 'tab', 'Проверка доступа');
  await wait(2);
  s = await snap(EV.users, 'snapshot-check-1440.md');
  check('users', '«Проверка доступа»: «Марина Котова не может: просматривать машины», «Модуль: Логистика.»', s.includes('Марина Котова не может: просматривать машины') && s.includes('Модуль: Логистика.'));
  await shot(EV.users, 'impl-check-1440.png');
  await click(s, 'button', 'Почему доступно');
  await wait(1);
  s = await snap(EV.users, 'snapshot-explain-1440.md');
  check('users', '«Почему доступно»: диалог, «Проверки по порядку», «Подключение модуля — не пройдена · решающая проверка»', s.includes('heading "Почему доступно"') && s.includes('Проверки по порядку') && s.includes('решающая проверка'));
  await shot(EV.users, 'impl-explain-1440.png');
  await call('browser_press_key', { key: 'Escape' });
  await wait(1);
  s = await snap(EV.users);
  check('users', 'Escape закрывает «Почему доступно»', !s.includes('heading "Почему доступно"'));
  await click(s, 'button', 'Начисления водителю');
  await wait(2);
  s = await snap(EV.users);
  check('users', 'пресет «Начисления водителю» без «Логистики»: «Модуль не подключён» (порядок x-authorization-order)', s.includes('Илья Васильев не может: видеть начисления') && s.includes('Модуль не подключён'));

  // карточка: Заблокировать / Разблокировать
  await users();
  s = await snap(EV.users);
  await click(s, 'button', 'Тимур Ахмедов');
  await wait(1);
  s = await snap(EV.users, 'snapshot-card-1440.md');
  check('users', 'карточка «Тимур Ахмедов»: почта, функции «Водитель», «Заблокировать»', s.includes('heading "Тимур Ахмедов" [level=2]') && s.includes('t.akhmedov@alta.example') && s.includes('button "Заблокировать"'));
  await shot(EV.users, 'impl-card-1440.png');
  await click(s, 'button', 'Заблокировать');
  await wait(2);
  check('users', 'тост «Сотрудник заблокирован: вход и новые операции закрыты»', (await toastText()).includes('Сотрудник заблокирован'));
  s = await snap(EV.users);
  check('users', 'чип «Заблокирован», кнопка «Разблокировать»', s.includes('Заблокирован') && s.includes('button "Разблокировать"'));
  await click(s, 'button', 'Разблокировать');
  await wait(2);
  check('users', 'тост «Сотрудник снова может входить»', (await toastText()).includes('снова может входить'));
  await call('browser_press_key', { key: 'Escape' });

  // негативные: ошибка загрузки, нет права
  await scenario({ scenario: 'listMembers=rate_limited', once: true });
  await users();
  s = await snap(EV.users, 'snapshot-load-error-1440.md');
  check('users', 'ошибка загрузки: «Не удалось загрузить список. Слишком много запросов…», «Повторить»', s.includes('Не удалось загрузить список') && s.includes('button "Повторить"'));
  await click(s, 'button', 'Повторить');
  await wait(2);
  s = await snap(EV.users);
  check('users', '«Повторить» загружает список', s.includes('list "Участники"'));
  // Сценарий once на GET не сохраняется в снимок состояния MSW (sessionStorage) — снять явно до перезагрузок.
  await scenario({ scenario: null });
  await call('browser_navigate', { url: `${APP}/t/${alta}/users?persona=manager` });
  await wait(3);
  s = await snap(EV.users, 'snapshot-manager-gate-1440.md');
  check('users', 'логист: гейт «Нет доступа к разделу «Пользователи и роли»»', s.includes('Нет доступа к разделу «Пользователи и роли»'));
  await call('browser_navigate', { url: `${APP}/t/${alta}/users?persona=owner` });
  await wait(3);
  for (const [w, h] of [[768, 1024], [390, 844]]) {
    await call('browser_resize', { width: w, height: h });
    await wait(1);
    s = await snap(EV.users, `snapshot-people-${w}.md`);
    const scroll = await evaluate(`() => document.scrollingElement.scrollWidth <= window.innerWidth`);
    check('users', `${w}: список, без горизонтальной прокрутки${w < 640 ? ', нижняя навигация «Люди»' : ''}`, s.includes('list "Участники"') && scroll.includes('true') && (w >= 640 || s.includes('navigation "Навигация"')), scroll);
    await shot(EV.users, `impl-people-${w}.png`);
  }
  await call('browser_resize', { width: 1440, height: 900 });
  writeFileSync(join(EV.users, 'console.md'), await call('browser_console_messages'), 'utf8');
  writeFileSync(join(EV.users, 'network.md'), await call('browser_network_requests'), 'utf8');

  // ── company-roles ──
  await users('?tab=roles');
  s = await snap(EV.roles, 'snapshot-roles-1440.md');
  check('roles', 'список ролей: «Менеджер логистики» выбрана, «Владелец бизнеса» «Системная»', /button "Менеджер логистики ?Шаблон[^"]*" \[pressed\]/.test(s) && /button "Владелец бизнеса ?Системная/.test(s), '');
  check('roles', 'редактор: «Название роли», switch «Доступ роли к модулю Логистика» отмечен и выключен, «Финансовые разрешения»', s.includes('textbox "Название роли"') && /switch "Доступ роли к модулю Логистика" \[checked\] \[disabled\]/.test(s) && s.includes('Финансовые разрешения'));
  check('roles', '«Итоговые права роли»: fleet.trips.review, «Роль пока никому не назначена»', s.includes('Итоговые права роли') && s.includes('fleet.trips.review') && s.includes('Роль пока никому не назначена'));
  await shot(EV.roles, 'impl-roles-1440.png');
  await click(s, 'switch', 'Доступ роли к модулю Задачи');
  await wait(1);
  s = await snap(EV.roles);
  check('roles', 'выключение «Задачи»: «Есть несохранённые изменения», «Сохранить роль» активна', s.includes('Есть несохранённые изменения') && /button "Сохранить роль"(?! \[disabled\])/.test(s));
  await click(s, 'button', 'Отменить');
  await wait(1);
  s = await snap(EV.roles);
  check('roles', '«Отменить» возвращает роль', !s.includes('Есть несохранённые изменения'));
  await click(s, 'button', 'Прораб', { exact: false });
  await wait(1);
  s = await snap(EV.roles);
  await call('browser_type', { element: 'Название роли', target: ref(s, 'textbox', 'Название роли'), text: 'Прораб участка' });
  await wait(1);
  s = await snap(EV.roles);
  await click(s, 'button', 'Сохранить роль');
  await wait(2);
  check('roles', 'сохранение: тост «Роль «Прораб участка» сохранена»', (await toastText()).includes('Роль «Прораб участка» сохранена'), await toastText());
  s = await snap(EV.roles);
  await click(s, 'button', 'Водитель', { exact: false });
  await wait(1);
  s = await snap(EV.roles, 'snapshot-role-driver-1440.md');
  check('roles', '«Водитель»: блок функции, «Роль с функцией «Водитель» не может содержать начисления»', s.includes('Профессиональная функция «Водитель»') && s.includes('не может содержать начисления'));
  await shot(EV.roles, 'impl-role-driver-1440.png');
  await scenario({ scenario: 'updateRole=revision_mismatch', once: true });
  s = await snap(EV.roles);
  await click(s, 'switch', 'Доступ роли к модулю Задачи');
  s = await snap(EV.roles);
  await click(s, 'button', 'Сохранить роль');
  await wait(2);
  check('roles', 'конфликт ревизии: тост «Данные изменились. Обновите и повторите правку.»', (await toastText()).includes('Данные изменились'), await toastText());
  for (const [w, h] of [[768, 1024], [390, 844]]) {
    await call('browser_resize', { width: w, height: h });
    await users('?tab=roles');
    s = await snap(EV.roles, `snapshot-roles-${w}.md`);
    const scroll = await evaluate(`() => document.scrollingElement.scrollWidth <= window.innerWidth`);
    check('roles', `${w}: редактор и список, без горизонтальной прокрутки`, s.includes('textbox "Название роли"') && scroll.includes('true'), scroll);
    await shot(EV.roles, `impl-roles-${w}.png`);
  }
  await call('browser_resize', { width: 1440, height: 900 });
  writeFileSync(join(EV.roles, 'console.md'), await call('browser_console_messages'), 'utf8');
  writeFileSync(join(EV.roles, 'network.md'), await call('browser_network_requests'), 'utf8');

  // ── people-dialogs ──
  await users();
  s = await snap(EV.dialogs);
  await click(s, 'button', 'Назначить роль', { after: 'Марина Котова' });
  await wait(1);
  s = await snap(EV.dialogs, 'snapshot-assign-1440.md');
  check('dialogs', '«Назначить роль»: «Марина Котова · m.kotova@alta.example», «Фирма» нажата, итог', s.includes('heading "Назначить роль"') && s.includes('Марина Котова · m.kotova@alta.example') && /button "Фирма" \[pressed\]/.test(s) && s.includes('Роль не выбрана · Москва / Север Логистик'));
  await shot(EV.dialogs, 'impl-assign-1440.png');
  await click(s, 'button', 'Назначить');
  await wait(1);
  s = await snap(EV.dialogs);
  check('dialogs', 'без роли — alert «Выберите роль»', /alert[^\n]*\n?[^\n]*Выберите роль/.test(s) || s.includes('Выберите роль'));
  await call('browser_select_option', { element: 'Роль', target: ref(s, 'combobox', 'Роль', { exact: false }), values: ['Менеджер логистики'] });
  await wait(1);
  s = await snap(EV.dialogs);
  check('dialogs', 'итог: «Отраслевые модули: Логистика (модуль не подключён)»', s.includes('Отраслевые модули: Логистика (модуль не подключён)'));
  await click(s, 'button', 'Назначить');
  await wait(2);
  check('dialogs', 'тост «Роль «Менеджер логистики» назначена»', (await toastText()).includes('Роль «Менеджер логистики» назначена'), await toastText());
  s = await snap(EV.dialogs);
  await click(s, 'button', 'Назначить роль', { after: 'Илья Васильев' });
  await wait(1);
  s = await snap(EV.dialogs);
  await call('browser_select_option', { element: 'Роль', target: ref(s, 'combobox', 'Роль', { exact: false }), values: ['Менеджер логистики'] });
  await wait(1);
  s = await snap(EV.dialogs);
  await click(s, 'button', 'Назначить');
  await wait(2);
  s = await snap(EV.dialogs, 'snapshot-assign-sod-1440.md');
  check('dialogs', 'SoD: alert «Функция «Водитель» несовместима с правом на начисления (правило MVP).»', s.includes('Функция «Водитель» несовместима с правом на начисления (правило MVP).'));
  await shot(EV.dialogs, 'impl-assign-sod-1440.png');
  await click(s, 'button', 'Отмена', { after: 'heading "Назначить роль"' });
  await wait(1);
  s = await snap(EV.dialogs);
  await click(s, 'button', 'Пригласить');
  await wait(1);
  s = await snap(EV.dialogs, 'snapshot-invite-1440.md');
  check('dialogs', '«Пригласить участника»: места «Свободно мест: 1 из 10 — это последнее…», «Область» выключена', s.includes('Свободно мест: 1 из 10 — это последнее') && /combobox "Область[^"]*" \[disabled\]/.test(s));
  await shot(EV.dialogs, 'impl-invite-1440.png');
  await click(s, 'button', 'Пригласить', { after: 'heading "Пригласить участника"' });
  await wait(1);
  s = await snap(EV.dialogs);
  check('dialogs', 'ошибки полей «Укажите имя», «Укажите адрес»', s.includes('Укажите имя') && s.includes('Укажите адрес'));
  await call('browser_type', { element: 'Имя и фамилия', target: ref(s, 'textbox', 'Имя и фамилия', { exact: false }), text: 'Пётр Новый' });
  s = await snap(EV.dialogs);
  await call('browser_type', { element: 'Электронная почта', target: ref(s, 'textbox', 'Электронная почта', { exact: false }), text: 'p.novy@alta.example' });
  s = await snap(EV.dialogs);
  await click(s, 'button', 'Пригласить', { after: 'heading "Пригласить участника"' });
  await wait(2);
  check('dialogs', 'тост «Приглашение отправлено: p.novy@alta.example»', (await toastText()).includes('Приглашение отправлено: p.novy@alta.example'), await toastText());
  s = await snap(EV.dialogs);
  await click(s, 'button', 'Пригласить');
  await wait(1);
  s = await snap(EV.dialogs, 'snapshot-invite-full-1440.md');
  check('dialogs', '10 из 10: «Все места тарифа заняты.», «Подписка и места»', s.includes('Все места тарифа заняты.') && s.includes('button "Подписка и места"'));
  await shot(EV.dialogs, 'impl-invite-full-1440.png');
  await call('browser_press_key', { key: 'Escape' });
  await users('?tab=roles');
  s = await snap(EV.dialogs);
  await click(s, 'button', 'Создать роль');
  await wait(1);
  s = await snap(EV.dialogs, 'snapshot-create-role-1440.md');
  check('dialogs', '«Создать роль»: radiogroup «Основа роли», «Пустая роль» выбрана', s.includes('radiogroup "Основа роли"') && /radio "Пустая роль[^"]*" \[checked\]/.test(s));
  await shot(EV.dialogs, 'impl-create-role-1440.png');
  await call('browser_type', { element: 'Название', target: ref(s, 'textbox', 'Название', { exact: false, after: 'heading "Создать роль"' }), text: 'Диспетчер' });
  s = await snap(EV.dialogs);
  await click(s, 'radio', 'Из шаблона', { exact: false, after: 'heading "Создать роль"' });
  await wait(1);
  s = await snap(EV.dialogs);
  await click(s, 'button', 'Создать и настроить', { after: 'heading "Создать роль"' });
  await wait(2);
  check('dialogs', 'тост «Роль создана», выбрана «Диспетчер» «Своя»', (await toastText()).includes('Роль создана'));
  s = await snap(EV.dialogs);
  check('dialogs', 'роль «Диспетчер» нажата', /button "Диспетчер ?Своя[^"]*" \[pressed\]/.test(s));
  // передача владения
  await users();
  s = await snap(EV.dialogs);
  await click(s, 'button', 'Марина Котова');
  await wait(1);
  s = await snap(EV.dialogs);
  await click(s, 'button', 'Передать владение');
  await wait(1);
  s = await snap(EV.dialogs, 'snapshot-transfer-1440.md');
  check('dialogs', '«Передать владение»: «Остаться совладельцем» отмечено', s.includes('heading "Передать владение"') && /checkbox "Остаться совладельцем[^"]*" \[checked\]/.test(s));
  await shot(EV.dialogs, 'impl-transfer-1440.png');
  await call('browser_type', { element: 'Почта получателя', target: ref(s, 'textbox', 'Почта получателя', { exact: false }), text: 'm.kotova@alta.example' });
  s = await snap(EV.dialogs);
  await call('browser_type', { element: 'Причина', target: ref(s, 'textbox', 'Причина', { exact: false }), text: 'Расширяем управление' });
  s = await snap(EV.dialogs);
  await click(s, 'button', 'Передать владение', { after: 'heading "Передать владение"' });
  await wait(2);
  check('dialogs', 'тост «Владение передано: Марина Котова»', (await toastText()).includes('Владение передано: Марина Котова'), await toastText());
  await call('browser_press_key', { key: 'Escape' });
  // группа
  await users('?tab=groups');
  s = await snap(EV.dialogs);
  await click(s, 'button', 'Создать группу');
  await wait(1);
  s = await snap(EV.dialogs, 'snapshot-group-1440.md');
  await call('browser_type', { element: 'Название группы', target: ref(s, 'textbox', 'Название группы'), text: 'Логисты Самара' });
  s = await snap(EV.dialogs);
  await click(s, 'checkbox', 'Вера Котельникова');
  s = await snap(EV.dialogs);
  await shot(EV.dialogs, 'impl-group-1440.png');
  await click(s, 'button', 'Создать группу', { after: 'heading "Создать группу"' });
  await wait(2);
  check('dialogs', 'тост «Группа «Логисты Самара» создана»', (await toastText()).includes('Группа «Логисты Самара» создана'), await toastText());
  // 390: лист снизу
  await call('browser_resize', { width: 390, height: 844 });
  await users();
  s = await snap(EV.dialogs);
  await click(s, 'button', 'Назначить роль', { after: 'Тимур Ахмедов' });
  await wait(1);
  const sheet = await evaluate(`() => { const r = document.querySelector('section[aria-modal]').getBoundingClientRect(); return Math.round(r.bottom) + '/' + innerHeight + ' ' + Math.round(r.width) + '/' + innerWidth; }`);
  check('dialogs', '390: «Назначить роль» листом снизу во всю ширину', /(\d+)\/\1 (\d+)\/\2/.test(sheet.replace(/"/g, '')), sheet);
  await snap(EV.dialogs, 'snapshot-assign-390.md');
  await shot(EV.dialogs, 'impl-assign-390.png');
  await call('browser_press_key', { key: 'Escape' });
  await call('browser_resize', { width: 768, height: 1024 });
  s = await snap(EV.dialogs);
  await click(s, 'button', 'Пригласить');
  await wait(1);
  await snap(EV.dialogs, 'snapshot-invite-768.md');
  await shot(EV.dialogs, 'impl-invite-768.png');
  await call('browser_resize', { width: 1440, height: 900 });
  writeFileSync(join(EV.dialogs, 'console.md'), await call('browser_console_messages'), 'utf8');
  writeFileSync(join(EV.dialogs, 'network.md'), await call('browser_network_requests'), 'utf8');

  // ── эталон design-stage-1: владелец «Альты» ──
  await call('browser_navigate', { url: REF });
  await wait(4);
  s = yaml(await call('browser_snapshot'));
  await call('browser_select_option', { element: 'Персонаж', target: ref(s, 'combobox', 'Персонаж'), values: ['owner'] });
  await wait(2);
  s = yaml(await call('browser_snapshot'));
  await click(s, 'button', 'Пользователи и роли');
  await wait(2);
  await snap(EV.users, 'ref-snapshot-people-1440.md');
  await shot(EV.users, 'ref-people-1440.png');
  s = yaml(await call('browser_snapshot'));
  await click(s, 'tab', 'Роли', { exact: false });
  await wait(1);
  await snap(EV.roles, 'ref-snapshot-roles-1440.md');
  await shot(EV.roles, 'ref-roles-1440.png');
  s = yaml(await call('browser_snapshot'));
  await click(s, 'button', 'Создать роль');
  await wait(1);
  await shot(EV.dialogs, 'ref-create-role-1440.png');
  await call('browser_press_key', { key: 'Escape' });
  s = yaml(await call('browser_snapshot'));
  await click(s, 'tab', 'Люди', { exact: false });
  await wait(1);
  s = yaml(await call('browser_snapshot'));
  await click(s, 'button', 'Назначить роль', { after: 'Тимур Ахмедов' });
  await wait(1);
  await snap(EV.dialogs, 'ref-snapshot-assign-1440.md');
  await shot(EV.dialogs, 'ref-assign-1440.png');
  await call('browser_press_key', { key: 'Escape' });
  s = yaml(await call('browser_snapshot'));
  await click(s, 'button', 'Пригласить');
  await wait(1);
  await shot(EV.dialogs, 'ref-invite-1440.png');
} catch (e) {
  console.error(e);
  checks.users.push(`| — | прерывание | FAIL | ${String(e.message).slice(0, 200)} |`);
} finally {
  writeFileSync(join(EV.users, 'mcp-log.md'), log.join('\n'), 'utf8');
  for (const [k, dir] of Object.entries(EV)) {
    writeFileSync(
      join(dir, 'checks.md'),
      `# W1.23 · проходка Playwright MCP — ${k} (mock, Vite 5211, эталон 4111 design-stage-1)\n\n| # | Проверка | Итог | Детали |\n|---|---|---|---|\n${checks[k].join('\n')}\n`,
      'utf8',
    );
  }
  console.log(Object.entries(checks).map(([k, v]) => `## ${k}\n${v.join('\n')}`).join('\n'));
  child.kill();
}
