// Проходка Playwright MCP журни W2.32 (verification-protocol.md §4): страницы `driver-today` «Моя смена» (телефон 390,
// затем 768 и 1440) и `logistics-review` «Приёмка смен» (менеджер 1440, затем 390 и 768) по пути смены водителя:
// бронь → осмотр с пятью фото → выезд → расход → «Завершить рейс» → осмотр при сдаче → сдача → приёмка → «Смена
// принята»; негатив — конфликт брони (mock: сценарий сервера, стенд — пропуск), без начислений у водителя.
//   W232_ROOT=<корень worktree> PORT=6101 MODE=mock APP=http://127.0.0.1:6101 PHOTO=<jpeg> node …/walk.mjs
//   MODE=stand APP=http://127.0.0.1:5201 — стенд слота (Vite --mode e2e, адаптер http, cmd/api 8101).
// Клики — по ref снимка дерева доступности (роль и подпись); фото — browser_file_upload в выбор файла слота.
import { evidence, refOf, snapshotOf, startMcp } from './lib.mjs';

const MODE = process.env.MODE ?? 'mock';
const APP = process.env.APP ?? 'http://127.0.0.1:6101';
const PHOTO = process.env.PHOTO;
const sub = MODE === 'stand' ? 'journey/stand' : 'journey';
const mcp = startMcp();
const evD = evidence('driver-today', sub);
const evR = evidence('logistics-review', sub);
const all = [];
const check = (ev, ok, what) => {
  const line = `${ok ? 'ok' : 'FAIL'} — ${what}`;
  all.push(line);
  ev.step(line);
};
const snap = async () => snapshotOf(await mcp.call('browser_snapshot'));
/** Ждать текст на странице до `sec` секунд (снимок дерева раз в секунду; первая сборка Vite и стенд — дольше 5 с). */
async function wait(text, sec = 45) {
  for (let i = 0; i < sec; i++) {
    const t = await mcp.call('browser_snapshot');
    if (t.includes(text)) return t;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`нет «${text}» за ${sec} с`);
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = (fn) => mcp.call('browser_evaluate', { function: fn });
const result = (text) => JSON.parse(text.split('### Result')[1].split('\n### ')[0].trim());
const has = (s, t) => s.includes(t);
const click = async (role, name, o = {}) =>
  mcp.call('browser_click', {
    element: `${role} «${name}»`,
    target: refOf(o.s ?? (await snap()), role, name, o.n ?? 0, o.prefix ?? false),
  });
const type = async (role, name, text, prefix = false) =>
  mcp.call('browser_type', { element: `${role} «${name}»`, target: refOf(await snap(), role, name, 0, prefix), text });
const go = (path, persona) =>
  mcp.call('browser_navigate', { url: `${APP}${path}${persona ? `${path.includes('?') ? '&' : '?'}persona=${persona}` : ''}` });

/** Запрос из страницы с cookie-сессией, CSRF и Idempotency-Key; If-Match — по желанию. */
const API_FN = `async (method, path, body, ifMatch) => {
  const csrf = /(?:^|;\\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1];
  const headers = {};
  if (method !== 'GET') { headers['X-CSRF-Token'] = decodeURIComponent(csrf ?? ''); headers['Idempotency-Key'] = crypto.randomUUID(); }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (ifMatch) headers['If-Match'] = ifMatch;
  const r = await fetch(path, { method, credentials: 'include', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  return { status: r.status, etag: r.headers.get('etag'), body: t ? JSON.parse(t) : null };
}`;
const api = async (method, path, body, ifMatch) =>
  result(
    await evaluate(
      `async () => (${API_FN})(${JSON.stringify(method)}, ${JSON.stringify(path)}, ${JSON.stringify(body)}, ${JSON.stringify(ifMatch)})`,
    ),
  );

/** Фото слота: клик по слоту → выбор файла → browser_file_upload. */
async function photo(prefix) {
  await click('button', prefix, { prefix: true });
  await mcp.call('browser_file_upload', { paths: [PHOTO] });
  await pause(600);
}

async function fivePhotos() {
  for (const side of ['Спереди: ', 'Сзади: ', 'Слева: ', 'Справа: ', 'Одометр: ']) await photo(side);
  await wait('Фото · 5 из 5', 90);
  if (MODE === 'mock') await pause(1500);
  for (let i = 0; i < 90; i++) {
    const s = await snap();
    if ((s.match(/Загружено/g) ?? []).length >= 5) return;
    if (MODE === 'mock') await api('POST', '/api/v1/dev/scenario', { scanFiles: true });
    await pause(1000);
  }
}

/** Пробег, «½», все пункты чек-листа без отметки. */
async function inspection(odo) {
  await type('textbox', 'Пробег по одометру, км', odo, true);
  await click('button', '½');
  const s = await snap();
  const lines = s.split('\n');
  const from = lines.findIndex((l) => l.includes('Чек-лист'));
  for (const l of lines.slice(from)) {
    const m = /- checkbox "([^"]+)"(?! \[checked\])[^\n]*\[ref=([a-z0-9]+)\]/.exec(l);
    if (m && !m[1].startsWith('Критический')) await mcp.call('browser_click', { element: `checkbox «${m[1]}»`, target: m[2] });
  }
}

const noScroll = async () =>
  (
    await evaluate(
      `() => { const m = document.querySelector('#ox-main'); const d = document.scrollingElement; return [!m || m.scrollWidth <= m.clientWidth + 1, d.scrollWidth <= d.clientWidth + 1].join(','); }`,
    )
  ).includes('true,true');

let ALTA = '';
let TRIP = 'Р-208';
let ODO = 84370;

/** mock: свежий сценарный сервер, пресет logistics-ready, ручной режим хранилища (Q-W2.53-7). */
async function freshMock() {
  await go('/', 'owner');
  await wait('Главная');
  await api('POST', '/api/v1/dev/scenario', { reset: true });
  await go('/', 'owner');
  await wait('Главная');
  ALTA = (await api('GET', '/api/v1/me/context')).body.tenants.find((t) => t.name === 'Альта Групп').tenantId;
  await api('POST', '/api/v1/dev/scenario', { preset: 'logistics-ready' });
  await evaluate(`() => sessionStorage.setItem('ortus:msw:storage', 'on')`);
}

/** stand: «Логистика» подключена (базовый сид), Котова — менеджер «Север Логистик», свой рейс Васильева. */
async function freshStand() {
  await go('/', 'owner');
  await wait('Главная');
  ALTA = (await api('GET', '/api/v1/me/context')).body.tenants.find((t) => t.name === 'Альта Групп').tenantId;
  const T = `/api/v1/tenants/${ALTA}`;
  const units = (await api('GET', `${T}/org-units?limit=200`)).body.items;
  const sever = units.find((u) => u.name === 'Север Логистик').id;
  const members = (await api('GET', `${T}/members?limit=200`)).body.items;
  const kotova = members.find((m) => m.email === 'm.kotova@alta.example').id;
  const vasiliev = members.find((m) => m.email === 'i.vasiliev@alta.example').id;
  const role = (await api('GET', `${T}/roles?limit=200`)).body.items.find((r) => r.name === 'Менеджер логистики').id;
  const has = (await api('GET', `${T}/assignments?limit=200`)).body.items.some((a) => a.principalId === kotova && a.roleId === role);
  if (!has) {
    await api('POST', `${T}/assignments`, {
      principalType: 'member',
      principalId: kotova,
      roleId: role,
      scope: { kind: 'org_unit', resourceIds: [sever], includeDescendants: true },
    });
  }
  const gazel = (await api('GET', `${T}/fleet/vehicles?limit=200`)).body.items.find((v) => v.displayName === 'ГАЗель Next');
  ODO = Number(gazel.odometerKm);
  // Рейс проходки — только если у Васильева нет незавершённого (экран показывает первый незавершённый по окну).
  const open = (await api('GET', `${T}/fleet/trip-plans?limit=200`)).body.items.filter((p) => p.driverMemberId === vasiliev && !['accepted', 'cancelled'].includes(p.state));
  if (open.length) return;
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  for (let k = 0; k < 24; k++) {
    const start = Math.ceil((Date.now() + 10 * 60_000 + k * 2 * 3_600_000) / 60_000) * 60_000;
    const w = { startsAt: iso(start), endsAt: iso(start + 2 * 3_600_000), timeZone: 'Europe/Moscow' };
    const r = await api('POST', `${T}/fleet/trip-plans`, {
      orgUnitId: sever,
      title: 'Проходка MCP W2.32',
      plannedWindow: w,
      distanceKm: '46',
      cargo: { description: 'Сухой груз · 14 паллет-мест', weightKg: '1100', volumeM3: '12', lengthM: '3' },
      stops: [
        { sequence: 1, op: 'load', address: 'Склад № 1, Лобня', weightKg: '1100', volumeM3: '12', plannedAt: w.startsAt },
        { sequence: 2, op: 'unload', address: 'Химки, ул. Заводская, 8', weightKg: '1100', volumeM3: '12', plannedAt: iso(start + 40 * 60_000) },
      ],
      driverMemberId: vasiliev,
    });
    if (r.status === 201) {
      TRIP = r.body.number;
      return;
    }
  }
  throw new Error('нет окна для рейса проходки');
}

try {
  const tools = await mcp.init();
  evD.step(`инструменты MCP: ${tools.length} (${MODE}, ${APP})`);
  await mcp.call('browser_resize', { width: 390, height: 844 });
  if (MODE === 'mock') await freshMock();
  else await freshStand();

  // ── «Моя смена», телефон 390: шаги по состоянию смены (проходку можно повторить на том же стенде) ──
  await go(`/t/${ALTA}/today`, 'driver');
  await wait('Моя смена');
  await pause(1500);
  let s = await snap();
  TRIP = /(Р-\d+) · /.exec(s)?.[1] ?? TRIP;
  check(evD, has(s, 'heading "Моя смена" [level=1]'), 'h1 «Моя смена»');
  check(evD, has(s, 'list "Этапы смены"'), 'этапы смены «Машина · Осмотр · Рейс · Сдача · Приёмка»');
  check(evD, has(s, `${TRIP} · `), `карточка рейса ${TRIP}`);
  check(evD, await noScroll(), '390: без горизонтальной прокрутки');

  if (has(s, 'heading "Выберите машину" [level=2]')) {
    evD.save('snapshot-choose-390.md', s);
    check(evD, has(s, 'Подходит рейсу: масса, объём, длина и температура'), 'ГАЗель — «Подходит рейсу…»');
    check(evD, has(s, 'Не подходит рейсу'), 'несовместимые машины — «Не подходит рейсу» с причиной');
    await evD.shot(mcp, 'choose-390.png');
    await click('button', 'Забронировать');
    await wait('Бронь подтверждена сервером');
    check(evD, true, 'бронь: «Бронь подтверждена сервером. Начните осмотр»');
    await wait('Осмотр перед выездом');
    s = await snap();
  }
  if (has(s, 'heading "Осмотр перед выездом"')) {
    evD.save('snapshot-inspection-390.md', s);
    check(evD, has(s, 'Фото · 0 из 5'), '«Фото · 0 из 5», пять слотов');
    check(evD, has(s, 'Осталось:'), 'панель «Осталось: …», выезд недоступен');
    await evD.shot(mcp, 'inspection-390.png');
    await fivePhotos();
    await inspection(String(ODO + 130));
    s = await snap();
    check(evD, !has(s, 'Осталось:'), 'пять фото, пробег, ½, чек-лист — «Осталось» нет');
    await evD.shot(mcp, 'inspection-ready-390.png');
    await click('button', 'Выехать на маршрут');
    await wait('Выезд подтверждён сервером');
    await wait('Отмечено 0 из');
    s = await snap();
  }
  if (has(s, 'heading "Маршрут" [level=2]')) {
    evD.save('snapshot-route-390.md', s);
    check(evD, true, 'выезд: «Маршрут», «Отмечено 0 из N», «Добавить расход», «Завершить рейс»');
    await evD.shot(mcp, 'route-390.png');
    if (!has(s, 'Топливо ·')) {
      await click('button', 'Добавить расход');
      await type('textbox', 'Сумма, ₽', '2500', true);
      await photo('Чек: ');
      for (let i = 0; i < 90; i++) {
        const r = await evaluate(`() => document.querySelector('.ox-dr-receipt')?.textContent ?? ''`);
        if (r.includes('Загружено')) break;
        if (MODE === 'mock') await api('POST', '/api/v1/dev/scenario', { scanFiles: true });
        await pause(1000);
      }
      await type('textbox', 'Сумма, ₽', '2500', true);
      await type('textbox', 'Литры', '40', true);
      evD.save('snapshot-expense-form-390.md', await snap());
      await click('button', 'Сохранить расход');
      await wait('Принято сервером');
      s = await snap();
      check(evD, /Топливо · 2.500 ₽/.test(s), 'расход «Топливо · 2 500 ₽», «Принято сервером»');
      await evD.shot(mcp, 'expense-390.png');
    }
    await click('button', 'Завершить рейс');
    await wait('Внимание');
    s = await snap();
    evD.save('snapshot-finish-dialog-390.md', s);
    check(evD, has(s, `heading "Завершить рейс ${TRIP}?"`) && has(s, 'Внимание'), `диалог «Завершить рейс ${TRIP}?», «Внимание»`);
    await evD.shot(mcp, 'finish-dialog-390.png');
    const lines = s.split('\n');
    const d = lines.findIndex((l) => l.includes('- dialog'));
    await click('button', 'Завершить рейс', { s: lines.slice(d).join('\n') });
    await wait('Осмотр при сдаче');
    s = await snap();
  }
  if (has(s, 'heading "Осмотр при сдаче"')) {
    evD.save('snapshot-return-390.md', s);
    await evD.shot(mcp, 'return-390.png');
    await fivePhotos();
    await inspection(String(ODO + 190));
    await click('button', 'Сдать машину');
    await wait('Ожидает приёмки менеджером');
  }
  s = await snap();
  evD.save('snapshot-submitted-390.md', s);
  check(evD, has(s, 'Ожидает приёмки менеджером') && has(s, 'Пройдено'), 'сдача: «Ожидает приёмки менеджером», «Пройдено»');
  check(evD, !has(s, 'Начислен'), 'водителю начислений нет (AC-05)');
  await evD.shot(mcp, '390.png');
  await mcp.call('browser_resize', { width: 768, height: 1024 });
  await pause(800);
  evD.save('snapshot-submitted-768.md', await snap());
  check(evD, await noScroll(), '768: без горизонтальной прокрутки');
  await evD.shot(mcp, '768.png');
  await mcp.call('browser_resize', { width: 1440, height: 900 });
  await pause(800);
  evD.save('snapshot-submitted-1440.md', await snap());
  await evD.shot(mcp, '1440.png');

  // ── «Приёмка смен», менеджер 1440 ──
  await go(`/t/${ALTA}/review`, 'manager');
  await wait('Приёмка смен');
  await wait('Ожидает приёмки');
  s = await snap();
  evR.save('snapshot-review-1440.md', s);
  check(evR, has(s, 'heading "Приёмка смен" [level=1]'), 'h1 «Приёмка смен»');
  check(evR, has(s, `${TRIP} · Илья Васильев`), `очередь «${TRIP} · Илья Васильев», «Ожидает приёмки»`);
  check(evR, has(s, 'Топливо'), 'расход «Топливо» в карточке смены');
  await evR.shot(mcp, 'review-1440.png');
  const q = s.split('\n').find((l) => l.includes(`${TRIP} · Илья Васильев`) && l.includes('[ref='));
  if (q) await mcp.call('browser_click', { element: 'смена', target: /\[ref=([a-z0-9]+)\]/.exec(q)[1] });
  await pause(800);
  await click('button', 'Принять смену');
  await wait('Что произойдёт');
  s = await snap();
  evR.save('snapshot-accept-dialog-1440.md', s);
  check(evR, has(s, `Принять смену ${TRIP}?`), `диалог «Принять смену ${TRIP}?», «Что произойдёт»`);
  check(evR, has(s, 'Машина вернётся в пул свободных'), '«Машина вернётся в пул свободных»');
  await evR.shot(mcp, 'accept-dialog-1440.png');
  const dl = s.split('\n');
  const di = dl.findIndex((l) => l.includes('dialog'));
  await click('button', 'Принять смену', { s: dl.slice(di).join('\n') });
  await wait('Смена принята. Машина вернулась в пул');
  check(evR, true, 'тост «Смена принята. Машина вернулась в пул»');
  await pause(800);
  s = await snap();
  evR.save('snapshot-accepted-1440.md', s);
  check(evR, has(s, 'Смена принята в'), '«Смена принята в ЧЧ:ММ. Машина вернулась в пул свободных.»');
  await evR.shot(mcp, '1440.png');
  await mcp.call('browser_resize', { width: 768, height: 1024 });
  await pause(800);
  evR.save('snapshot-accepted-768.md', await snap());
  check(evR, await noScroll(), '768: без горизонтальной прокрутки');
  await evR.shot(mcp, '768.png');
  await mcp.call('browser_resize', { width: 390, height: 844 });
  await pause(800);
  s = await snap();
  evR.save('snapshot-accepted-390.md', s);
  check(evR, has(s, 'navigation "Навигация"'), '390: нижняя навигация');
  check(evR, await noScroll(), '390: без горизонтальной прокрутки');
  await evR.shot(mcp, '390.png');

  // ── Водитель: «Смена принята», без начислений ──
  await go(`/t/${ALTA}/today`, 'driver');
  await wait('Смена принята');
  s = await snap();
  evD.save('snapshot-accepted-390.md', s);
  check(evD, has(s, 'heading "Смена принята"'), '«Смена принята» у водителя');
  check(evD, !has(s, 'Начислен'), 'водителю начислений нет после приёмки (AC-05)');
  await evD.shot(mcp, 'accepted-390.png');

  // ── Негатив: конфликт брони (mock — сценарий сервера, флажок эталона «Конфликт брони») ──
  if (MODE === 'mock') {
    await freshMock();
    await api('POST', '/api/v1/dev/scenario', { scenario: 'reserveVehicle=reservation_overlap' });
    await go(`/t/${ALTA}/today`, 'driver');
    await wait('Выберите машину');
    await click('button', 'Забронировать');
    await wait('Конфликт брони');
    s = await snap();
    evD.save('snapshot-conflict-390.md', s);
    check(evD, has(s, 'Обновить список'), '«Конфликт брони» и «Обновить список»');
    await evD.shot(mcp, 'conflict-390.png');
    await api('POST', '/api/v1/dev/scenario', { scenario: null });
  }

  evD.save('console.txt', await mcp.call('browser_console_messages'));
  // Запросы антивируса хоста (gc.kis…kaspersky-labs.com: id установки, копия адреса) — шум хоста, не evidence.
  const net = String(await mcp.call('browser_network_requests'));
  evD.save('network.txt', net.split('\n').filter((l) => !/kaspersky-labs\.com/.test(l)).join('\n'));
} catch (e) {
  check(evD, false, e.message.split('\n').slice(0, 4).join(' '));
} finally {
  evD.save('walk-log.txt', all.join('\n') + '\n');
  evR.save('walk-log.txt', evR.log.join('\n') + '\n');
  mcp.close();
}
