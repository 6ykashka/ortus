// Проходка Playwright MCP страницы `modules` «Модули и место» (verification-protocol.md §4), режим mock.
import { evidence, refOf, snapshotOf, startMcp } from './lib.mjs';

const APP = 'http://127.0.0.1:5212';
const REF = 'http://127.0.0.1:4112/%D0%9E%D1%80%D1%82%D1%83%D1%81%20CRM.dc.html';
const ALTA = 'f04f636e-b66d-509e-ae10-9c27a18e3baa';
const ev = evidence('modules');
const mcp = startMcp();

const snap = async () => snapshotOf(await mcp.call('browser_snapshot'));
const click = async (role, name, n = 0, s) => {
  const tree = s ?? (await snap());
  await mcp.call('browser_click', { element: `${role} «${name}»`, target: refOf(tree, role, name, n) });
};
const has = (tree, text) => tree.includes(text);
const wait = (text) => mcp.call('browser_wait_for', { text });
const check = (ok, what) => ev.step(`${ok ? 'ok' : 'FAIL'} — ${what}`);
const evaluate = (fn) => mcp.call('browser_evaluate', { function: fn });
const dev = (body) =>
  evaluate(`async () => {
    const csrf = /(?:^|;\\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1];
    const r = await fetch('/api/v1/dev/scenario', { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf ?? ''), 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(${JSON.stringify(body)}) });
    return r.status;
  }`);

try {
  const tools = await mcp.init();
  ev.step(`MCP: инструментов ${tools.length}; ${['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_resize', 'browser_take_screenshot', 'browser_console_messages', 'browser_network_requests'].every((t) => tools.includes(t)) ? 'нужные есть' : 'НЕТ НУЖНЫХ'}`);
  await mcp.call('browser_resize', { width: 1440, height: 900 });
  // 1. Вход владельца, переход по меню.
  await mcp.call('browser_navigate', { url: `${APP}/?persona=owner` });
  await wait('Пользователи и роли');
  let s = await snap();
  await click('button', 'Модули и место', 0, s);
  await wait('Роли с правами модуля');
  s = await snap();
  ev.save('snapshot-owner-1440.md', s);
  check(has(s, 'heading "Модули и место" [level=1]'), '1440: h1 «Модули и место» по пункту меню');
  check(has(s, 'Альта Групп / Компания'), 'крошка «Альта Групп / Компания»');
  check(/Осталось \d+ д[а-я]+ · до 13\.10\.2026/.test(s) && has(s, 'Пробный период'), 'карточка пробного периода (часы MCP — системные 16.10: «Осталось 0 дней»; e2e — 01.10, «12 дней»)');
  check(!has(s, 'Демо: завершить пробный период'), 'без «Демо: …» (PD-54)');
  check(has(s, 'heading "Логистика" [level=3]') && has(s, 'heading "Салон и SPA" [level=3]') && has(s, 'heading "Ремонт и стройка" [level=3]'), 'три отраслевых модуля');
  check(has(s, 'Роли с правами модуля есть у: 1 сотрудник. Они заработают после подключения'), 'строка о ролях «Логистики»');
  check(has(s, 'meter "Занятое место"'), 'meter «Занятое место»');
  check(has(s, 'combobox "Лимит места"'), 'select «Лимит места»');
  check(has(s, 'link "Хранилище"'), 'ссылка «Хранилище» (no-reference)');
  await ev.shot(mcp, '1440.png');
  // 2. Подключение «Логистики».
  await click('button', 'Подключить', 0, s);
  s = await snap();
  ev.save('snapshot-dialog-connect.md', s);
  check(has(s, 'heading "Подключить «Логистика»?" [level=2]'), 'диалог «Подключить «Логистика»?»');
  check(has(s, 'Календарь — уже включён') && has(s, 'Шаблоны ролей: Менеджер логистики, Водитель.'), 'разделы диалога подключения');
  await ev.shot(mcp, 'dialog-connect-1440.png');
  const inDialog = s.slice(s.indexOf('- dialog'));
  await click('button', 'Подключить', 0, inDialog);
  s = await snap();
  check(has(s, 'Модуль «Логистика» подключён'), 'тост «Модуль «Логистика» подключён»');
  check(has(s, 'button "Рабочее место логиста"'), 'в меню — группа «Логистика»');
  check(has(s, 'button "Назначить роли"'), '«Назначить роли»');
  // 3. Отключение «Логистики».
  await click('button', 'Отключить', 0, s);
  s = await snap();
  ev.save('snapshot-dialog-disconnect.md', s);
  check(has(s, 'heading "Отключить «Логистика»?" [level=2]') && has(s, 'Активных процессов нет'), 'диалог отключения: «Затронет сейчас» — «Активных процессов нет»');
  check(has(s, 'Новые брони, рейсы и осмотры будут закрыты') && has(s, 'Начатые смены можно безопасно завершить и принять'), 'тексты модуля «Логистика»');
  check(/button "Отключить модуль" \[disabled\]/.test(s), '«Отключить модуль» недоступна до флажка');
  await ev.shot(mcp, 'dialog-disconnect-1440.png');
  await click('checkbox', 'Понимаю последствия для текущей работы', 0, s);
  s = await snap();
  await click('button', 'Отключить модуль', 0, s);
  s = await snap();
  check(has(s, 'Модуль отключён. История доступна для чтения'), 'тост отключения');
  check(has(s, 'Отключены · только чтение'), 'меню: «Отключены · только чтение» (D-23)');
  // 4. Лимит 25 ГБ — отказ сервера.
  await mcp.call('browser_select_option', { element: 'combobox «Лимит места»', target: refOf(s, 'combobox', 'Лимит места'), values: ['25'] });
  s = await snap();
  await click('button', 'Изменить лимит', 0, s);
  s = await snap();
  check(has(s, 'heading "Новый лимит меньше занятого места" [level=2]') && has(s, 'Занято 46,2 ГБ, новый лимит 25 ГБ. Не хватает 21,2 ГБ.'), 'диалог «Новый лимит меньше занятого места»');
  await ev.shot(mcp, 'dialog-quota-below-1440.png');
  await click('checkbox', 'Понимаю: новые загрузки будут недоступны', 0, s);
  s = await snap();
  await click('button', 'Всё равно применить', 0, s);
  s = await snap();
  check(has(s, 'Новый лимит меньше занятого места. Освободите место или выберите лимит больше.'), '409 downgrade_below_usage — тост, диалог открыт (Q-W1.24-2)');
  await mcp.call('browser_press_key', { key: 'Escape' });
  s = await snap();
  check(!has(s, 'heading "Новый лимит меньше занятого места" [level=2]'), 'Escape закрывает диалог');
  // 5. Лимит 250 ГБ.
  await mcp.call('browser_select_option', { element: 'combobox «Лимит места»', target: refOf(s, 'combobox', 'Лимит места'), values: ['250'] });
  s = await snap();
  await click('button', 'Изменить лимит', 0, s);
  s = await snap();
  await click('button', 'Изменить', 0, s.slice(s.indexOf('- dialog')));
  s = await snap();
  check(has(s, 'Лимит места: 250 ГБ') && has(s, 'из 250 ГБ'), 'лимит 250 ГБ: тост и карточка');
  // 6. Негативные: организация ограничена, место заполнено, нет связи.
  await dev({ reset: true, preset: 'trial-ended' });
  await mcp.call('browser_navigate', { url: `${APP}/t/${ALTA}/modules?persona=owner` });
  await wait('Базовые модули');
  s = await snap();
  ev.save('snapshot-trial-ended.md', s);
  check(has(s, 'Пробный период завершён') && has(s, 'Ограничен'), 'trial-ended: «Пробный период завершён», «Ограничен»');
  check(/button "Подключить" \[disabled\]/.test(s), 'trial-ended: «Подключить» недоступна');
  await ev.shot(mcp, 'states/trial-ended-1440.png');
  await dev({ reset: true, preset: 'storage-full' });
  await mcp.call('browser_navigate', { url: `${APP}/t/${ALTA}/modules?persona=owner` });
  await wait('Базовые модули');
  s = await snap();
  check(has(s, 'Место организации заполнено.') && has(s, 'Занято больше лимита на'), 'storage-full: баннер и alert карточки');
  await ev.shot(mcp, 'states/storage-full-1440.png');
  await dev({ reset: true, scenario: 'setModuleInstallation=offline' });
  await mcp.call('browser_navigate', { url: `${APP}/t/${ALTA}/modules?persona=owner` });
  await wait('Базовые модули');
  s = await snap();
  await click('button', 'Подключить', 0, s);
  s = await snap();
  await click('button', 'Подключить', 0, s.slice(s.indexOf('- dialog')));
  s = await snap();
  check(has(s, 'Нет связи с сервером. Операция не выполнена.') && has(s, 'heading "Подключить «Логистика»?" [level=2]'), 'нет связи: тост, диалог открыт');
  await dev({ reset: true, scenario: null });
  // 7. Сотрудник по прямому URL.
  await mcp.call('browser_navigate', { url: `${APP}/t/${ALTA}/modules?persona=manager` });
  await wait('Нет доступа');
  s = await snap();
  check(has(s, 'Нет доступа к разделу «Модули и место»'), 'логист: гейт «Нет доступа к разделу «Модули и место»»');
  // 8. Ширины 390 и 768.
  await mcp.call('browser_navigate', { url: `${APP}/t/${ALTA}/modules?persona=owner` });
  await wait('Базовые модули');
  await mcp.call('browser_resize', { width: 390, height: 844 });
  s = await snap();
  ev.save('snapshot-owner-390.md', s);
  check(has(s, 'navigation "Навигация"') && has(s, 'button "Модули"'), '390: нижняя навигация «Модули»');
  const scroll = await evaluate(`() => { const m = document.querySelector('#ox-main'); return [m.scrollWidth, m.clientWidth, document.documentElement.scrollWidth, innerWidth].join(','); }`);
  ev.step(`390: ширины (main scroll/client, doc/inner): ${scroll.split('\n').find((l) => /\d+,\d+/.test(l)) ?? scroll.slice(0, 80)}`);
  await ev.shot(mcp, '390.png');
  await click('button', 'Отключить', 0, s);
  await ev.shot(mcp, 'dialog-disconnect-390.png');
  await mcp.call('browser_press_key', { key: 'Escape' });
  await mcp.call('browser_resize', { width: 768, height: 1024 });
  s = await snap();
  ev.save('snapshot-owner-768.md', s);
  check(has(s, 'heading "Модули и место" [level=1]'), '768: рейл и страница');
  await ev.shot(mcp, '768.png');
  // 9. Консоль и сеть.
  const consoleText = await mcp.call('browser_console_messages', { level: 'warning', all: true });
  ev.save('console.txt', consoleText);
  const net = await mcp.call('browser_network_requests', { static: false });
  ev.save('network.txt', net);
  const hosts = [...new Set([...net.matchAll(/https?:\/\/([^/\s\]]+)/g)].map((m) => m[1]))];
  ev.step(`сеть: хосты ${hosts.join(', ')}`);
  ev.step(`консоль: ${(consoleText.match(/\[(ERROR|WARNING)\]/gi) ?? []).length} ошибок и предупреждений`);
  // 10. Эталон.
  await mcp.call('browser_resize', { width: 1440, height: 900 });
  await mcp.call('browser_navigate', { url: REF });
  await wait('Главная');
  s = await snap();
  await click('button', 'Модули и место', 0, s);
  await wait('Базовые модули');
  await evaluate(`() => { const p = document.querySelector('[aria-label="Панель демонстрации"]'); if (p) p.style.display = 'none'; }`);
  await ev.shot(mcp, 'reference-1440.png');
  await mcp.call('browser_resize', { width: 390, height: 844 });
  await ev.shot(mcp, 'reference-390.png');
} catch (e) {
  ev.step(`ОШИБКА: ${e.message}`);
} finally {
  ev.save('walk-log.txt', ev.log.join('\n') + '\n');
  mcp.close();
}
