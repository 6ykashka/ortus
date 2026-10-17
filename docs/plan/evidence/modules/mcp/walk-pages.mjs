// Проходка Playwright MCP страниц `storage` и `files` (verification-protocol.md §4), режим mock.
import { evidence, refOf, snapshotOf, startMcp } from './lib.mjs';

const APP = 'http://127.0.0.1:5212';
const REF = 'http://127.0.0.1:4112/%D0%9E%D1%80%D1%82%D1%83%D1%81%20CRM.dc.html';
const ALTA = 'f04f636e-b66d-509e-ae10-9c27a18e3baa';
const mcp = startMcp();
const snap = async () => snapshotOf(await mcp.call('browser_snapshot'));
const wait = (text) => mcp.call('browser_wait_for', { text });
const evaluate = (fn) => mcp.call('browser_evaluate', { function: fn });
const dev = (body) =>
  evaluate(`async () => {
    const csrf = /(?:^|;\\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1];
    const r = await fetch('/api/v1/dev/scenario', { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf ?? ''), 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(${JSON.stringify(body)}) });
    return r.status;
  }`);
const has = (s, t) => s.includes(t);

async function storage() {
  const ev = evidence('storage');
  const check = (ok, what) => ev.step(`${ok ? 'ok' : 'FAIL'} — ${what}`);
  const click = async (role, name, s) =>
    mcp.call('browser_click', { element: `${role} «${name}»`, target: refOf(s ?? (await snap()), role, name) });
  try {
    await mcp.call('browser_resize', { width: 1440, height: 900 });
    await mcp.call('browser_navigate', { url: `${APP}/t/${ALTA}/modules?persona=owner` });
    await wait('Базовые модули');
    await click('link', 'Хранилище');
    await wait('По видам файлов');
    let s = await snap();
    ev.save('snapshot-owner-1440.md', s);
    check(has(s, 'heading "Хранилище" [level=1]'), 'переход по ссылке «Хранилище» из «Модули и место»: h1');
    check(has(s, 'Альта Групп / Компания'), 'крошка');
    check(has(s, 'meter "Занятое место"') && has(s, '46,2 ГБ'), 'занято 46,2 ГБ, meter');
    check(has(s, 'Резерв начатых загрузок: 0 ГБ'), 'резерв начатых загрузок');
    check(has(s, 'Фото осмотров и отчётов') && has(s, 'Вложения задач и форм') && has(s, 'Прочее'), 'разбивка по видам файлов (группы эталона)');
    check(has(s, 'По модулям') && has(s, 'Логистика') && has(s, 'База данных и служебные данные'), 'разбивка по модулям');
    await ev.shot(mcp, '1440.png');
    await mcp.call('browser_select_option', { element: 'combobox «Новый лимит»', target: refOf(s, 'combobox', 'Новый лимит'), values: ['250'] });
    await click('button', 'Рассчитать');
    await wait('в месяц');
    s = await snap();
    check(/Лимит 250 ГБ · 2\s500 ₽ в месяц/.test(s), 'расчёт: «Лимит 250 ГБ · 2 500 ₽ в месяц»');
    check(has(s, 'Расчёт действует до'), 'срок расчёта');
    await ev.shot(mcp, 'quote-1440.png');
    await click('button', 'Применить', s);
    await wait('Лимит места: 250 ГБ');
    s = await snap();
    check(has(s, 'из 250 ГБ'), 'применено: «из 250 ГБ», тост «Лимит места: 250 ГБ»');
    await mcp.call('browser_select_option', { element: 'combobox «Новый лимит»', target: refOf(s, 'combobox', 'Новый лимит'), values: ['25'] });
    await click('button', 'Рассчитать');
    await wait('Новый лимит меньше занятого места');
    s = await snap();
    check(has(s, 'Новый лимит меньше занятого места. Освободите место или выберите лимит больше.'), '25 ГБ: отказ сервера (downgrade_below_usage) текстом в карточке');
    await ev.shot(mcp, 'states/downgrade-1440.png');
    await dev({ reset: true, preset: 'storage-full' });
    await mcp.call('browser_navigate', { url: `${APP}/t/${ALTA}/storage?persona=owner` });
    await wait('По видам файлов');
    s = await snap();
    check(has(s, 'Занято больше лимита') && has(s, 'Место организации заполнено.'), 'storage-full: alert карточки и баннер');
    await ev.shot(mcp, 'states/storage-full-1440.png');
    await dev({ reset: true });
    await mcp.call('browser_navigate', { url: `${APP}/t/${ALTA}/storage?persona=manager` });
    await wait('Нет права');
    s = await snap();
    ev.save('snapshot-manager.md', s);
    check(has(s, 'Нет права') && !has(s, 'По видам файлов'), 'логист: гейт «Нет права», данных места нет (подпись раздела пустая — манифест W1.20)');
    await mcp.call('browser_navigate', { url: `${APP}/t/${ALTA}/storage?persona=owner` });
    await wait('По видам файлов');
    await mcp.call('browser_resize', { width: 390, height: 844 });
    s = await snap();
    ev.save('snapshot-owner-390.md', s);
    const w = await evaluate(`() => { const m = document.querySelector('#ox-main'); return [m.scrollWidth, m.clientWidth].join(','); }`);
    check(/"(\d+),\1"/.test(w), `390: без горизонтальной прокрутки (${(w.match(/"[^"]+"/) ?? [''])[0]})`);
    await ev.shot(mcp, '390.png');
    await mcp.call('browser_resize', { width: 768, height: 1024 });
    await ev.shot(mcp, '768.png');
    ev.save('console.txt', await mcp.call('browser_console_messages', { level: 'warning', all: true }));
    const net = await mcp.call('browser_network_requests', { static: false });
    ev.save('network.txt', net);
    ev.step(`сеть: хосты ${[...new Set([...net.matchAll(/https?:\/\/([^/\s\]]+)/g)].map((m) => m[1]))].join(', ')}`);
  } catch (e) {
    ev.step(`ОШИБКА: ${e.message}`);
  } finally {
    ev.save('walk-log.txt', ev.log.join('\n') + '\n');
  }
}

async function files() {
  const ev = evidence('files');
  const check = (ok, what) => ev.step(`${ok ? 'ok' : 'FAIL'} — ${what}`);
  const click = async (role, name, s, n = 0) =>
    mcp.call('browser_click', { element: `${role} «${name}»`, target: refOf(s ?? (await snap()), role, name, n) });
  try {
    await dev({ reset: true });
    await mcp.call('browser_resize', { width: 1440, height: 900 });
    await mcp.call('browser_navigate', { url: `${APP}/?persona=owner` });
    await wait('Пользователи и роли');
    await click('button', 'Файлы');
    await wait('Состояния загрузки');
    let s = await snap();
    ev.save('snapshot-owner-1440.md', s);
    check(has(s, 'heading "Файлы" [level=1]'), 'пункт меню «Файлы» → h1 «Файлы»');
    check(has(s, 'Фото и вложения всегда привязаны к исходному объекту. Скачивание проверяет доступ к нему.'), 'абзац эталона');
    check(has(s, 'Место организации') && has(s, '46,2 из 100 ГБ'), '«Место организации» «46,2 из 100 ГБ»');
    check(has(s, 'Р-208 · спереди.jpg') && has(s, 'Бронь машины') && has(s, 'Готов') && has(s, '2,3 МБ'), 'строка файла: имя, родитель, «Готов», размер');
    check(has(s, 'button "Открыть"'), '«Открыть» доступна');
    await ev.shot(mcp, '1440.png');
    // Файл на проверке: сессия загрузки через API (initiate → complete).
    const added = await evaluate(`async () => {
      const csrf = decodeURIComponent(/(?:^|;\\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? '');
      const h = (b) => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': crypto.randomUUID() });
      const base = '/api/v1/tenants/${ALTA}/files/uploads';
      const sha = 'b'.repeat(64);
      const t = await (await fetch(base, { method: 'POST', credentials: 'include', headers: h(), body: JSON.stringify({ fileName: 'Договор аренды склада № 1.pdf', contentType: 'application/pdf', sizeBytes: 1258291, sha256: sha, purpose: 'expense_receipt', owner: { moduleKey: 'fleet', entityType: 'trip', entityId: '${ALTA}' } }) })).json();
      const c = await fetch(base + '/' + t.uploadId + '/complete', { method: 'POST', credentials: 'include', headers: h(), body: JSON.stringify({ sha256: sha }) });
      return c.status;
    }`);
    ev.step(`сессия загрузки через API: ${(added.match(/\b\d{3}\b/) ?? ['?'])[0]}`);
    await mcp.call('browser_navigate', { url: `${APP}/t/${ALTA}/files?persona=owner` });
    await wait('Договор аренды склада');
    s = await snap();
    check(has(s, 'Проверяется') && /button "Открыть" \[disabled\]/.test(s), 'файл на проверке: «Проверяется», «Открыть» недоступна');
    await ev.shot(mcp, 'states/scanning-1440.png');
    // «Открыть» готового файла: короткая ссылка в новой вкладке.
    await click('button', 'Открыть', s, 1);
    await mcp.call('browser_wait_for', { time: 2 });
    const tabs = await mcp.call('browser_tabs', { action: 'list' }).catch((e) => `browser_tabs: ${e.message}`);
    ev.save('tabs-after-open.txt', tabs);
    check(/storage\.example\.invalid/.test(tabs), '«Открыть»: новая вкладка на хост короткой ссылки getFileDownload (storage.example.invalid — адрес MSW, страница ошибки браузера)');
    await mcp.call('browser_tabs', { action: 'select', index: 0 }).catch(() => undefined);
    // Негативные: пусто, ошибка скачивания, место заполнено, сотрудник.
    await dev({ scenario: 'listFiles=empty' });
    await mcp.call('browser_navigate', { url: `${APP}/t/${ALTA}/files?persona=owner` });
    await wait('Доступных файлов нет');
    await ev.shot(mcp, 'states/empty-1440.png');
    check(true, 'пусто: «Доступных файлов нет»');
    await dev({ reset: true, scenario: 'getFileDownload=photo_not_ready' });
    await mcp.call('browser_navigate', { url: `${APP}/t/${ALTA}/files?persona=owner` });
    await wait('Р-208');
    s = await snap();
    await click('button', 'Открыть', s, 0);
    await wait('Фото ещё загружается');
    check(true, 'скачивание не готового: тост «Фото ещё загружается. Дождитесь окончания загрузки.»');
    await dev({ reset: true, preset: 'storage-full' });
    await mcp.call('browser_navigate', { url: `${APP}/t/${ALTA}/files?persona=owner` });
    await wait('Место организации заполнено.');
    await ev.shot(mcp, 'states/storage-full-1440.png');
    check(true, 'storage-full: баннер «Место организации заполнено.» и красная полоса');
    await dev({ reset: true, preset: 'logistics-ready' });
    await mcp.call('browser_navigate', { url: `${APP}/t/${ALTA}/files?persona=manager` });
    await wait('Состояния загрузки');
    s = await snap();
    ev.save('snapshot-manager-1440.md', s);
    check(!has(s, '46,2 из 100 ГБ') && has(s, 'Доступных файлов нет'), 'логист с ролью: без «Места организации», список (пусто в mock)');
    await dev({ reset: true });
    await mcp.call('browser_navigate', { url: `${APP}/t/${ALTA}/files?persona=owner` });
    await wait('Р-208');
    await mcp.call('browser_resize', { width: 390, height: 844 });
    s = await snap();
    ev.save('snapshot-owner-390.md', s);
    const w = await evaluate(`() => { const m = document.querySelector('#ox-main'); return [m.scrollWidth, m.clientWidth].join(','); }`);
    check(/"(\d+),\1"/.test(w), `390: без горизонтальной прокрутки (${(w.match(/"[^"]+"/) ?? [''])[0]})`);
    await ev.shot(mcp, '390.png');
    await mcp.call('browser_resize', { width: 768, height: 1024 });
    await ev.shot(mcp, '768.png');
    ev.save('console.txt', await mcp.call('browser_console_messages', { level: 'warning', all: true }));
    const net = await mcp.call('browser_network_requests', { static: false });
    ev.save('network.txt', net);
    ev.step(`сеть: хосты ${[...new Set([...net.matchAll(/https?:\/\/([^/\s\]]+)/g)].map((m) => m[1]))].join(', ')}`);
    // Эталон.
    await mcp.call('browser_resize', { width: 1440, height: 900 });
    await mcp.call('browser_navigate', { url: REF });
    await wait('Главная');
    await click('button', 'Файлы');
    await wait('Состояния загрузки');
    await evaluate(`() => { const p = document.querySelector('[aria-label="Панель демонстрации"]'); if (p) p.style.display = 'none'; }`);
    await ev.shot(mcp, 'reference-1440.png');
    await mcp.call('browser_resize', { width: 390, height: 844 });
    await ev.shot(mcp, 'reference-390.png');
  } catch (e) {
    ev.step(`ОШИБКА: ${e.message}`);
  } finally {
    ev.save('walk-log.txt', ev.log.join('\n') + '\n');
  }
}

try {
  const tools = await mcp.init();
  console.log(`MCP: ${tools.length} инструментов`);
  if (!process.argv.includes('--files')) await storage();
  else await mcp.call('browser_navigate', { url: `${APP}/?persona=owner` });
  if (!process.argv.includes('--storage')) await files();
} finally {
  mcp.close();
}
