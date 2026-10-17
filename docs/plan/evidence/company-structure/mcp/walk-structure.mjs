// Проходка Playwright MCP страницы `company-structure` «Структура» (verification-protocol.md §4), режим mock.
// Запуск: W154_ROOT=<корень worktree> PORT=5202 node docs/plan/evidence/company-structure/mcp/walk-structure.mjs
// Приложение — Vite `--mode e2e` на 127.0.0.1:5202 (VITE_ADAPTER=mock). Клики — по ref снимка, найденным по
// роли и подписи (не по координатам). Готовность дерева — подпись вида «Фирма» (названия узлов есть и в скрытых
// опциях области шапки).
import { evidence, refOf, snapshotOf, startMcp } from './lib.mjs';

const APP = `http://127.0.0.1:${process.env.PORT ?? '5202'}`;
const ALTA = 'f04f636e-b66d-509e-ae10-9c27a18e3baa';
const mcp = startMcp();
const ev = evidence('company-structure');
const check = (ok, what) => ev.step(`${ok ? 'ok' : 'FAIL'} — ${what}`);
const snap = async () => snapshotOf(await mcp.call('browser_snapshot'));
const wait = (text) => mcp.call('browser_wait_for', { text });
const gone = (textGone) => mcp.call('browser_wait_for', { textGone });
const evaluate = (fn) => mcp.call('browser_evaluate', { function: fn });
const has = (s, t) => s.includes(t);
const click = async (role, name, s, n = 0) =>
  mcp.call('browser_click', {
    element: `${role} «${name}»`,
    target: refOf(s ?? (await snap()), role, name, n),
  });
const type = async (name, text, s) =>
  mcp.call('browser_type', {
    element: `textbox «${name}»`,
    target: refOf(s ?? (await snap()), 'textbox', name),
    text,
  });
const select = async (name, label, s) =>
  mcp.call('browser_select_option', {
    element: `combobox «${name}»`,
    target: refOf(s ?? (await snap()), 'combobox', name),
    values: [label],
  });
/** Запрос из страницы с cookie-сессией, CSRF и Idempotency-Key. */
const api = (method, path, body) =>
  evaluate(`async () => {
    const csrf = /(?:^|;\\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1];
    const headers = { 'X-CSRF-Token': decodeURIComponent(csrf ?? ''), 'Idempotency-Key': crypto.randomUUID() };
    if (${JSON.stringify(body)} !== null) headers['Content-Type'] = 'application/json';
    const r = await fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, credentials: 'include', headers,
      body: ${JSON.stringify(body)} === null ? undefined : JSON.stringify(${JSON.stringify(body)}) });
    return { status: r.status, body: await r.text() };
  }`);
/** Ответ browser_evaluate: значение из секции «### Result». */
const result = (text) => JSON.parse(text.split('### Result')[1].split('\n### ')[0].trim());
const list = async (what) =>
  JSON.parse(result(await api('GET', `/api/v1/tenants/${ALTA}/${what}?limit=200`, null)).body).items;
const dev = (body) => api('POST', '/api/v1/dev/scenario', body);
const open = async (persona = 'owner') => {
  await mcp.call('browser_navigate', { url: `${APP}/t/${ALTA}/structure?persona=${persona}` });
};
const scrollFits = async () => {
  const w = await evaluate(
    `() => { const m = document.querySelector('#ox-main'); const d = document.scrollingElement; return [m.scrollWidth <= m.clientWidth + 1, d.scrollWidth <= d.clientWidth + 1].join(','); }`,
  );
  return w.includes('true,true');
};

try {
  ev.step(`инструменты MCP: ${(await mcp.init()).length}`);
  await mcp.call('browser_resize', { width: 1440, height: 900 });

  // 1. Меню «Компания» → «Структура».
  await mcp.call('browser_navigate', { url: `${APP}/t/${ALTA}/home?persona=owner` });
  await wait('Главная');
  await click('button', 'Структура');
  await wait('Фирма');
  let s = await snap();
  ev.save('snapshot-owner-1440.md', s);
  check(has(s, 'heading "Структура" [level=1]'), 'меню «Компания» → «Структура»: h1 «Структура»');
  check(has(s, 'Альта Групп / Компания'), 'крошка «Альта Групп / Компания»');
  check(has(s, 'list "Структура организации"'), 'дерево — список «Структура организации»');
  check(
    has(s, 'Москва') && has(s, 'Самара') && has(s, 'Санкт-Петербург') && has(s, 'Север Логистик'),
    'три региона сида и фирмы под ними',
  );
  check(
    (has(s, 'button "Добавить регион"') || /- button \[ref=\w+\][^\n]*\n(?:[^\n]*\n){0,4}?\s*- text: Добавить регион\n/.test(s)) && has(s, 'button "Перенести «Север Логистик»"'),
    'команды владельца: «Добавить регион», «Добавить/Переименовать/Перенести «…»»',
  );
  await ev.shot(mcp, '1440.png', true);

  // 2. Создание: регион → фирма → подразделение.
  await click('button', 'Добавить регион', s);
  await wait('Новое подразделение');
  s = await snap();
  check(has(s, 'Где: верхний уровень структуры'), 'диалог «Новое подразделение»: верхний уровень');
  await ev.shot(mcp, 'dialogs/create-1440.png');
  await type('Название', 'Казань', s);
  await click('button', 'Добавить');
  await wait('Добавлено: «Казань»');
  check(true, 'тост «Добавлено: «Казань»»');
  await click('button', 'Добавить в «Казань»');
  await wait('Где: Казань');
  s = await snap();
  check(/combobox "Вид"[\s\S]*?option "Фирма" \[selected\]/.test(s), 'под регионом вид по умолчанию — «Фирма»');
  await type('Название', 'Кама Логистик', s);
  await click('button', 'Добавить');
  await wait('Добавлено: «Кама Логистик»');
  await click('button', 'Добавить в «Кама Логистик»');
  await wait('Где: Казань / Кама Логистик');
  s = await snap();
  check(/option "Подразделение" \[selected\]/.test(s), 'под фирмой вид по умолчанию — «Подразделение»');
  await type('Название', 'Склад Кама', s);
  await click('button', 'Добавить');
  await wait('Добавлено: «Склад Кама»');
  s = await snap();
  check(has(s, 'Склад Кама') && has(s, 'button "Перенести «Склад Кама»"'), 'регион, фирма и подразделение в дереве');
  await ev.shot(mcp, 'states/created-1440.png', true);

  // 3. 422: занятое название.
  await click('button', 'Добавить регион', s);
  await wait('Новое подразделение');
  await type('Название', 'Москва');
  await click('button', 'Добавить');
  await wait('Такое название уже есть');
  s = await snap();
  check(has(s, 'Такое название уже есть') && has(s, 'dialog'), '422: «Такое название уже есть» под полем, диалог открыт');
  await ev.shot(mcp, 'dialogs/create-422-1440.png');
  await mcp.call('browser_press_key', { key: 'Escape' });
  await gone('Новое подразделение');
  check(true, 'Escape закрывает диалог');

  // 4. Переименование.
  await click('button', 'Переименовать «Юг Транс»');
  await wait('Переименовать «Юг Транс»');
  s = await snap();
  const name = refOf(s, 'textbox', 'Название');
  await mcp.call('browser_type', { element: 'textbox «Название»', target: name, text: 'Юг Транс Плюс' });
  await click('button', 'Сохранить');
  await wait('Переименовано: «Юг Транс Плюс»');
  check(true, 'переименование: тост «Переименовано: «Юг Транс Плюс»»');

  // 5. Перенос с влиянием: у Ильина роль на «Самару» с поддеревом.
  const units = await list('org-units');
  const members = await list('members');
  const roles = await list('roles');
  const grant = await api('POST', `/api/v1/tenants/${ALTA}/assignments`, {
    principalType: 'member',
    principalId: members.find((m) => m.displayName === 'Сергей Ильин').id,
    roleId: roles.find((r) => r.name === 'Менеджер логистики').id,
    scope: { kind: 'org_unit', resourceIds: [units.find((u) => u.name === 'Самара').id], includeDescendants: true },
  });
  check(grant.includes('201'), 'назначение Ильина «Менеджер логистики» на «Самару» (createAssignment 201)');
  await open();
  await wait('Фирма');
  await click('button', 'Перенести «Юг Транс Плюс»');
  await wait('Куда перенести');
  await select('Куда перенести', 'Самара');
  await wait('Получат доступ');
  s = await snap();
  ev.save('snapshot-move-impact.md', s);
  check(has(s, 'region "Влияние на доступ"'), 'предпросмотр — область «Влияние на доступ»');
  check(has(s, 'Вложенных подразделений: 0') && has(s, 'Сотрудников в переносимой части'), 'счётчики переноса');
  check(has(s, 'Сергей Ильин · Менеджер логистики'), '«Получат доступ»: «Сергей Ильин · Менеджер логистики»');
  await ev.shot(mcp, 'dialogs/move-impact-1440.png');
  await click('button', 'Перенести', s);
  await wait('Перенесено: «Юг Транс Плюс»');
  check(true, 'перенос: тост «Перенесено: «Юг Транс Плюс»»');

  // 6. Перенос без влияния.
  await click('button', 'Перенести «Восток Карго»');
  await wait('Куда перенести');
  await select('Куда перенести', 'Санкт-Петербург');
  await wait('Доступ ни у кого не изменится.');
  check(true, 'без влияния: «Доступ ни у кого не изменится.»');
  await ev.shot(mcp, 'dialogs/move-none-1440.png');
  await click('button', 'Отмена');
  await gone('Куда перенести');

  // 7. Нет связи при создании, затем повтор.
  await dev({ scenario: 'createOrgUnit=offline', once: true });
  await click('button', 'Добавить регион');
  await wait('Новое подразделение');
  await type('Название', 'Тверь');
  await click('button', 'Добавить');
  await wait('Нет связи с сервером. Операция не выполнена.');
  s = await snap();
  check(has(s, 'dialog'), 'нет связи: тост «Нет связи с сервером. Операция не выполнена.», диалог открыт');
  await ev.shot(mcp, 'states/offline-1440.png');
  await click('button', 'Добавить', s);
  await wait('Добавлено: «Тверь»');
  check(true, 'повтор после «нет связи»: «Добавлено: «Тверь»»');

  // 8. Ошибка, пусто, только чтение, гейт.
  await dev({ scenario: 'listOrgUnits=rate_limited' });
  await open();
  await wait('Не удалось загрузить структуру');
  s = await snap();
  check(has(s, 'Не удалось загрузить структуру: Слишком много запросов. Подождите и повторите.') && has(s, 'button "Повторить"'), 'ошибка listOrgUnits: alert и «Повторить»');
  await ev.shot(mcp, 'states/error-1440.png');
  await dev({ scenario: null });
  await click('button', 'Повторить', s);
  await wait('Фирма');
  check(true, '«Повторить» — дерево загружено');
  await dev({ scenario: 'listOrgUnits=empty' });
  await open();
  await wait('Структура пока пуста');
  check(true, 'пусто: «Структура пока пуста»');
  await ev.shot(mcp, 'states/empty-1440.png');
  await dev({ reset: true, preset: 'trial-ended' });
  await open();
  await wait('Фирма');
  s = await snap();
  check(has(s, 'Организация в режиме чтения: новые операции недоступны. Чтение и выгрузка доступны.'), 'только чтение: текст словаря tenant_read_only');
  check(/- button[^\n]*\[disabled\][^\n]*\n(?:[^\n]*\n){0,4}?\s*- text: Добавить регион\n/.test(s) || /button "Добавить регион" \[disabled\]/.test(s), 'только чтение: «Добавить регион» недоступна');
  await ev.shot(mcp, 'states/read-only-1440.png');
  await dev({ reset: true });
  await open('manager');
  await wait('Нет права');
  s = await snap();
  ev.save('snapshot-manager.md', s);
  check(has(s, 'Нет доступа к разделу «Структура»') && !has(s, 'Структура организации'), 'логист без org_units.read: гейт «Нет доступа к разделу «Структура»»');
  await ev.shot(mcp, 'states/gate-manager-1440.png');

  // 9. 390 и 768.
  await open();
  await wait('Фирма');
  await mcp.call('browser_resize', { width: 390, height: 844 });
  s = await snap();
  ev.save('snapshot-owner-390.md', s);
  check(has(s, 'navigation "Навигация"'), '390: нижняя навигация');
  check(await scrollFits(), '390: без горизонтальной прокрутки');
  await ev.shot(mcp, '390.png', true);
  await click('button', 'Перенести «Север Логистик»', s);
  await wait('Куда перенести');
  await select('Куда перенести', 'Самара');
  await wait('Доступ ни у кого не изменится.');
  check(await scrollFits(), '390: диалог переноса листом снизу, без горизонтальной прокрутки');
  await ev.shot(mcp, 'dialogs/move-390.png');
  await mcp.call('browser_press_key', { key: 'Escape' });
  await mcp.call('browser_resize', { width: 768, height: 1024 });
  s = await snap();
  check(await scrollFits(), '768: без горизонтальной прокрутки');
  await ev.shot(mcp, '768.png', true);

  ev.save('console.txt', await mcp.call('browser_console_messages', { level: 'warning', all: true }));
  const net = await mcp.call('browser_network_requests', { static: false });
  ev.save('network.txt', net);
  ev.step(`сеть: хосты ${[...new Set([...net.matchAll(/https?:\/\/([^/\s\]]+)/g)].map((m) => m[1]))].join(', ')}`);
} catch (e) {
  ev.step(`ОШИБКА: ${e.message}`);
} finally {
  ev.save('walk-log.txt', ev.log.join('\n') + '\n');
  mcp.close();
}
