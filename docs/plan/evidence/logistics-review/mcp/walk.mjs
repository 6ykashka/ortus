// Проходка Playwright MCP страниц W2.21 (verification-protocol.md §4), режим mock: `logistics-review` «Приёмка смен»
// (+ диалог `modal-accept-shift`), `logistics-defects` «Очередь блокирующих дефектов», `logistics-earnings»
// «Начисления водителям». Запуск: W221_ROOT=<корень worktree> PORT=5208 node docs/plan/evidence/logistics-review/mcp/walk.mjs
// Приложение — Vite `--mode e2e` на 127.0.0.1:5208 (VITE_ADAPTER=mock); эталон — mcp/walk-reference.mjs.
// Смену водителя готовит API из сессии водителя (как e2e/logistics-review.helpers.ts), решения — клики по ref снимка.
import { evidence, refOf, snapshotOf, startMcp } from './lib.mjs';

const APP = `http://127.0.0.1:${process.env.PORT ?? '5208'}`;
const mcp = startMcp();
const evR = evidence('logistics-review');
const evD = evidence('logistics-defects');
const evE = evidence('logistics-earnings');
const all = [];
const check = (ev, ok, what) => {
  const line = `${ok ? 'ok' : 'FAIL'} — ${what}`;
  all.push(line);
  ev.step(line);
};
const snap = async () => snapshotOf(await mcp.call('browser_snapshot'));
const wait = (text) => mcp.call('browser_wait_for', { text });
const evaluate = (fn) => mcp.call('browser_evaluate', { function: fn });
const result = (text) => JSON.parse(text.split('### Result')[1].split('\n### ')[0].trim());
const has = (s, t) => s.includes(t);
const click = async (role, name, s, n = 0) =>
  mcp.call('browser_click', {
    element: `${role} «${name}»`,
    target: refOf(s ?? (await snap()), role, name, n),
  });
const type = async (role, name, text, s) =>
  mcp.call('browser_type', {
    element: `${role} «${name}»`,
    target: refOf(s ?? (await snap()), role, name),
    text,
  });

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
const api = async (method, path, body) =>
  result(
    await evaluate(
      `async () => (${API_FN})(${JSON.stringify(method)}, ${JSON.stringify(path)}, ${JSON.stringify(body)})`,
    ),
  );
const dev = (body) => api('POST', '/api/v1/dev/scenario', body);

/** Смена Р-208 водителем (сессия водителя): бронь, осмотр выезда с 5 фото, старт, финиш, расход, сдача. */
const SHIFT_FN = `async (tenant, o) => {
  const api = ${API_FN};
  const T = '/api/v1/tenants/' + tenant;
  const SHA = 'a3f1c9e2b7d4058e6c1f2a9b3d7e4c5f8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d';
  const NOW = '2026-10-01T07:30:00Z';
  const ROLES = ['front', 'rear', 'left', 'right', 'odometer'];
  const plans = (await api('GET', T + '/fleet/trip-plans?limit=200')).body.items;
  const trip = plans.find((x) => x.number === 'Р-208');
  const gazel = (await api('GET', T + '/fleet/vehicles?limit=200')).body.items.find((v) => v.displayName === 'ГАЗель Next');
  const files = async (n, purpose, owner) => {
    const ids = [];
    for (let i = 0; i < n; i++) {
      const t = (await api('POST', T + '/files/uploads', { fileName: purpose + (i + 1) + '.jpg', contentType: 'image/jpeg', sizeBytes: 245760, sha256: SHA, purpose, owner: { moduleKey: 'fleet', ...owner } })).body;
      await api('POST', T + '/files/uploads/' + t.uploadId + '/complete', { sha256: SHA });
      ids.push(t.fileId);
    }
    await api('POST', '/api/v1/dev/scenario', { scanFiles: true });
    return ids;
  };
  const inspect = async (kind, extra, owner, odo) => {
    const list = (await api('GET', T + '/fleet/inspection-checklist?vehicleId=' + gazel.id + '&kind=' + kind)).body;
    const ids = await files(5, 'inspection', owner);
    const r = await api('POST', T + '/fleet/inspections', { checklistVersionId: list.versionId, vehicleId: gazel.id, kind, odometerKm: odo, fuelPercent: 50,
      checks: list.items.map((i) => ({ key: i.key, result: 'pass' })), photos: ROLES.map((role, i) => ({ role, fileId: ids[i], capturedAt: NOW })), capturedAt: NOW, ...extra });
    return r.body.id;
  };
  const etag = async () => (await api('GET', T + '/fleet/trip-plans/' + trip.id)).etag;
  if (o.resubmit) {
    const ret = await inspect('return', { tripId: trip.id, comment: 'Фото слева переснял' }, { entityType: 'trip', entityId: trip.id }, '84560');
    const r = await api('PATCH', T + '/fleet/trips/' + trip.id, { action: 'return', returnInspectionId: ret }, await etag());
    return { tripId: trip.id, status: r.status };
  }
  const res = (await api('POST', T + '/fleet/reservations', { vehicleId: gazel.id, driverMemberId: trip.driverMemberId, window: trip.plannedWindow, tripId: trip.id })).body;
  const dep = await inspect('departure', { reservationId: res.id, ...(o.defect ? { defects: [{ zone: 'Стёкла', description: 'Скол', severity: 'blocking' }] } : {}) },
    { entityType: 'reservation', entityId: res.id }, '84500');
  if (o.defect) return { tripId: trip.id };
  await api('POST', T + '/fleet/trips', { reservationId: res.id, departureInspectionId: dep });
  await api('POST', T + '/fleet/trips/' + trip.id + '/route-completion', undefined, await etag());
  const [receipt] = await files(1, 'expense_receipt', { entityType: 'trip', entityId: trip.id });
  await api('POST', T + '/fleet/trips/' + trip.id + '/expenses', { kind: 'fuel', occurredAt: NOW, amount: { amountMinor: 250000, currency: 'RUB' }, quantity: '40', receiptFileIds: [receipt], comment: 'АЗС на Ленинградском шоссе' });
  const ret = await inspect('return', { tripId: trip.id, comment: 'Замечаний нет' }, { entityType: 'trip', entityId: trip.id }, '84560');
  const r = await api('PATCH', T + '/fleet/trips/' + trip.id, { action: 'return', returnInspectionId: ret }, await etag());
  return { tripId: trip.id, status: r.status };
}`;

let ALTA = '';
const go = (path, persona) =>
  mcp.call('browser_navigate', { url: `${APP}${path}${persona ? `?persona=${persona}` : ''}` });
/** Свежее состояние сценарного сервера, пресет logistics-ready (сессия владельца). */
const fresh = async () => {
  await go('/', 'owner');
  await wait('Главная');
  await dev({ reset: true });
  await go('/', 'owner');
  await wait('Главная');
  const me = await api('GET', '/api/v1/me/context');
  ALTA = me.body.tenants.find((t) => t.name === 'Альта Групп').tenantId;
  await dev({ preset: 'logistics-ready' });
};
const shift = async (o = {}) => {
  await go(`/t/${ALTA}/today`, 'driver');
  await wait('Сегодня');
  return result(await evaluate(`async () => (${SHIFT_FN})(${JSON.stringify(ALTA)}, ${JSON.stringify(o)})`));
};
const scrollFits = async () => {
  const w = await evaluate(
    `() => { const m = document.querySelector('#ox-main'); const d = document.scrollingElement; return [m.scrollWidth <= m.clientWidth + 1, d.scrollWidth <= d.clientWidth + 1].join(','); }`,
  );
  return w.includes('true,true');
};

try {
  const tools = await mcp.init();
  evR.step(`инструменты MCP: ${tools.length}`);
  await mcp.call('browser_resize', { width: 1440, height: 900 });

  // ── «Приёмка смен» ──
  await fresh();
  await go(`/t/${ALTA}/home`, 'manager');
  await wait('Главная');
  await click('button', 'Приёмка смен');
  await wait('Нет смен на проверке');
  let s = await snap();
  evR.save('snapshot-empty-1440.md', s);
  check(evR, has(s, 'heading "Приёмка смен" [level=1]'), 'меню «Логистика» → «Приёмка смен»: h1');
  check(evR, has(s, 'Север Логистик'), 'крошка — подразделение области логиста');
  check(evR, has(s, 'Фото до и после, пробег, дефекты и расходы.'), 'пояснение эталона');
  check(
    evR,
    has(s, 'Нет смен на проверке') && has(s, 'Когда водитель сдаст машину, смена появится здесь.'),
    'пусто: «Нет смен на проверке» и подсказка (п. 41)',
  );
  check(evR, has(s, 'navigation "Связанные разделы"'), 'входы «Очередь дефектов» и «Начисления»');
  await evR.shot(mcp, 'states/empty-1440.png');

  const sh = await shift();
  check(evR, sh.status === 200, `водитель сдал смену Р-208 через API (returnTrip ${sh.status})`);
  await go(`/t/${ALTA}/review`, 'manager');
  await wait('Р-208 · Северный маршрут');
  await wait('Итого заявлено');
  s = await snap();
  evR.save('snapshot-shift-1440.md', s);
  check(evR, /button "Р-208 · Илья Васильев[^"]*" \[pressed\]/.test(s), 'очередь: «Р-208 · Илья Васильев» выбрана (aria-pressed)');
  check(evR, has(s, 'ГАЗель Next · А 412 МР 77') && has(s, 'Ожидает приёмки'), 'sub очереди и чип «Ожидает приёмки» (п. 42)');
  check(evR, has(s, 'Илья Васильев · ГАЗель Next А 412 МР 77'), 'sub карточки «{водитель} · {модель} {номер}»');
  check(evR, has(s, '84 500 км') && has(s, '84 560 км') && has(s, '60 км') && has(s, '½ → ½'), 'статистика: 84 500 → 84 560 км, пройдено 60 км, ½ → ½');
  check(evR, has(s, 'heading "Фото до и после" [level=3]') && has(s, 'Перед выездом') && has(s, 'Одометр'), '«Фото до и после»: пять ракурсов');
  check(evR, has(s, 'Осмотр при сдаче: чек-лист заполнен') && has(s, 'Дефекты не отмечены') && has(s, 'Замечаний нет'), 'осмотры, «Дефекты не отмечены», комментарий водителя');
  check(evR, has(s, 'Топливо · 40 л') && has(s, '01.10.2026 · АЗС на Ленинградском шоссе · чек приложен') && has(s, '2 500 ₽'), 'расход «Топливо · 40 л», meta и сумма; «Итого заявлено»');
  await evR.shot(mcp, '1440.png', true);

  // Доработка: проверки эталона, тост, итог.
  await click('button', 'Вернуть на доработку', s);
  await wait('Опишите, что нужно исправить');
  check(evR, true, '«Вернуть на доработку» без замечаний — «Опишите, что нужно исправить»');
  await type('textbox', 'Замечания для водителя', 'Переснимите фото слева — не виден бампер');
  await click('button', 'Вернуть на доработку');
  await wait('Отметьте хотя бы один раздел для доработки');
  check(evR, true, 'без разделов — «Отметьте хотя бы один раздел для доработки»');
  await evR.shot(mcp, 'states/rework-errors-1440.png');
  await click('checkbox', 'Фото при сдаче');
  await click('button', 'Вернуть на доработку');
  await wait('Смена возвращена водителю на доработку');
  s = await snap();
  check(evR, has(s, 'Возвращено водителю: «Переснимите фото слева — не виден бампер». Исправить: Фото при сдаче.') && has(s, 'На доработке'), 'тост, итог role=status и чип «На доработке» (п. 44)');
  await evR.shot(mcp, 'states/rework-1440.png');

  // Повторная сдача водителем, приёмка через диалог.
  const again = await shift({ resubmit: true });
  check(evR, again.status === 200, `водитель сдал смену повторно (returnTrip ${again.status})`);
  await go(`/t/${ALTA}/review`, 'manager');
  await wait('Фото слева переснял');
  s = await snap();
  await click('button', 'Принять смену', s);
  await wait('Что произойдёт');
  s = await snap();
  evR.save('snapshot-accept-dialog.md', s);
  check(evR, has(s, 'Принять смену Р-208?') && has(s, 'Осмотр, пробег и расходы будут подтверждены.'), 'диалог «Принять смену Р-208?» (modal-accept-shift)');
  check(evR, has(s, 'Машина вернётся в пул свободных') && has(s, 'Расходы станут принятыми; кассовые операции создаются отдельно') && has(s, 'Будет создано начисление водителю.'), '«Что произойдёт» — три строки эталона');
  await evR.shot(mcp, 'dialogs/accept-1440.png');
  await mcp.call('browser_press_key', { key: 'Escape' });
  s = await snap();
  check(evR, !has(s, 'Что произойдёт'), 'Escape закрывает диалог');
  await click('button', 'Принять смену', s);
  await wait('Что произойдёт');
  s = await snap();
  await click('button', 'Принять смену', s, 1);
  await wait('Смена принята. Машина вернулась в пул');
  await wait('Начисление водителю за рейс');
  s = await snap();
  check(evR, /Смена принята в \d\d:\d\d\. Машина вернулась в пул свободных\./.test(s) && has(s, 'Принят'), 'тост, итог «Смена принята в …», чип «Принят» (п. 46)');
  check(evR, has(s, '4 500 ₽'), 'начисление «4 500 ₽» менеджеру с правом начислений (п. 43)');
  await evR.shot(mcp, 'states/accepted-1440.png', true);
  const v = await api('GET', `/api/v1/tenants/${ALTA}/fleet/vehicles?limit=200`);
  const gz = v.body.items.find((x) => x.displayName === 'ГАЗель Next');
  check(evR, gz.status === 'available' && gz.odometerKm === '84560', 'ГАЗель свободна, пробег 84 560 км');

  // Начисления владельцу: строка, правка.
  await go(`/t/${ALTA}/earnings`, 'owner');
  await wait('Р-208 · Северный маршрут');
  s = await snap();
  evE.save('snapshot-owner-1440.md', s);
  check(evE, has(s, 'heading "Начисления водителям" [level=1]') && has(s, 'Альта Групп · все подразделения'), '«Начисления водителям»: h1 и крошка владельца');
  check(evE, has(s, 'Илья Васильев') && has(s, '4 500 ₽') && /Изменено 01\.10\.2026 в \d\d:\d\d · Марина Котова/.test(s), 'строка: рейс, водитель, сумма, кто и когда');
  check(evE, has(s, 'Итого: 4 500 ₽'), 'итог');
  await evE.shot(mcp, '1440.png');
  await click('button', 'Изменить начисление по рейсу Р-208', s);
  await wait('Как рассчитано');
  s = await snap();
  await mcp.call('browser_type', { element: 'Сумма', target: refOf(s, 'textbox', 'Сумма, ₽'), text: '0' });
  await click('button', 'Сохранить');
  await wait('Сумма должна быть больше нуля');
  check(evE, true, 'правка: 0 — «Сумма должна быть больше нуля»');
  await evE.shot(mcp, 'dialogs/edit-error-1440.png');
  s = await snap();
  await mcp.call('browser_type', { element: 'Сумма', target: refOf(s, 'textbox', 'Сумма, ₽'), text: '5000' });
  await type('textbox', 'Как рассчитано', 'Доплата за выходной');
  await click('button', 'Сохранить');
  await wait('Начисление по рейсу Р-208 изменено');
  s = await snap();
  check(evE, has(s, '5 000 ₽') && has(s, 'Доплата за выходной'), 'тост, новая сумма и примечание');
  await evE.shot(mcp, 'states/edited-1440.png');
  await go(`/t/${ALTA}/earnings`, 'driver');
  await wait('Нет роли с доступом');
  s = await snap();
  check(evE, !has(s, '5 000 ₽'), 'водитель: гейт, сумм нет (D-10)');
  await evE.shot(mcp, 'states/gate-driver-1440.png');

  // ── Критический дефект: «Приёмка смен» и очередь ──
  await fresh();
  await shift({ defect: true });
  await go(`/t/${ALTA}/review`, 'manager');
  await wait('Критический дефект · ГАЗель Next А 412 МР 77');
  s = await snap();
  evR.save('snapshot-defect-1440.md', s);
  check(evR, has(s, 'Стёкла') && has(s, 'Скол') && has(s, 'Дефект на проверке'), 'карточка дефекта role=alert первой в очереди (п. 47)');
  await evR.shot(mcp, 'states/defect-1440.png');
  await click('button', 'Очередь дефектов', s);
  await wait('Стёкла: Скол');
  s = await snap();
  evD.save('snapshot-manager-1440.md', s);
  check(evD, has(s, 'heading "Очередь блокирующих дефектов" [level=1]') && has(s, 'tablist "Дефекты"'), 'вход со «Приёмки смен»: h1, вкладки');
  check(evD, has(s, 'Рейс Р-208 · Илья Васильев') && has(s, 'ГАЗель Next · А 412 МР 77') && has(s, 'Отмечен при осмотре перед выездом 01.10.2026 в'), 'карточка: рейс, машина, время');
  await evD.shot(mcp, '1440.png');
  await type('textbox', 'Комментарий к решению', 'Скол вне зоны обзора водителя', s);
  await click('button', 'Дефект некритичный — разрешить выезд');
  await wait('Выезд разрешён');
  await wait('Блокирующих дефектов нет');
  check(evD, true, '«разрешить выезд» — тост, очередь пуста');
  await evD.shot(mcp, 'states/empty-1440.png');
  await click('tab', 'Решённые 1');
  await wait('Скол вне зоны обзора водителя');
  s = await snap();
  check(evD, has(s, 'Выезд разрешён') && has(s, 'Решение 01.10.2026 в'), '«Решённые»: чип, время, комментарий');
  await evD.shot(mcp, 'states/decided-1440.png');

  // ── Ошибки, нет связи, гейт ──
  await dev({ scenario: 'listTripPlans=rate_limited' });
  await go(`/t/${ALTA}/review`, 'manager');
  await wait('Не удалось загрузить смены: Слишком много запросов. Подождите и повторите.');
  check(evR, true, 'ошибка listTripPlans — текст и «Повторить»');
  await evR.shot(mcp, 'states/error-1440.png');
  await dev({ scenario: null });
  await click('button', 'Повторить');
  await wait('Нет смен на проверке');
  check(evR, true, '«Повторить» — экран загрузился');
  await go(`/t/${ALTA}/review`, 'driver');
  await wait('Нет права на приёмку смен');
  check(evR, true, 'водитель: гейт «Нет права на приёмку смен»');
  await evR.shot(mcp, 'states/gate-driver-1440.png');

  // Нет связи при приёмке и 390 / 768.
  await fresh();
  await shift();
  await dev({ scenario: 'reviewTrip=offline' });
  await go(`/t/${ALTA}/review`, 'manager');
  await wait('Итого заявлено');
  await click('button', 'Принять смену');
  await wait('Что произойдёт');
  s = await snap();
  await click('button', 'Принять смену', s, 1);
  await wait('Нет связи с сервером. Операция не выполнена.');
  s = await snap();
  check(evR, has(s, 'Ожидает приёмки'), 'нет связи: тост, смена остаётся «Ожидает приёмки»');
  await evR.shot(mcp, 'states/offline-1440.png');
  await dev({ scenario: null });

  await mcp.call('browser_resize', { width: 390, height: 844 });
  await go(`/t/${ALTA}/review`, 'manager');
  await wait('Итого заявлено');
  s = await snap();
  evR.save('snapshot-shift-390.md', s);
  check(evR, has(s, 'navigation "Навигация"'), '390: нижняя навигация');
  check(evR, await scrollFits(), '390: без горизонтальной прокрутки');
  await evR.shot(mcp, '390.png', true);
  await go(`/t/${ALTA}/defects`, 'manager');
  await wait('Блокирующих дефектов нет');
  check(evD, await scrollFits(), '390: очередь без горизонтальной прокрутки');
  await evD.shot(mcp, '390.png');
  await go(`/t/${ALTA}/earnings`, 'owner');
  await wait('Начислений пока нет');
  check(evE, await scrollFits(), '390: начисления без горизонтальной прокрутки');
  await evE.shot(mcp, '390.png');
  await mcp.call('browser_resize', { width: 768, height: 1024 });
  await go(`/t/${ALTA}/review`, 'manager');
  await wait('Итого заявлено');
  check(evR, await scrollFits(), '768: без горизонтальной прокрутки');
  await evR.shot(mcp, '768.png', true);

  // Консоль и сеть.
  evR.save('console.txt', await mcp.call('browser_console_messages', {}));
  evR.save('network.txt', await mcp.call('browser_network_requests', {}));

  // Эталон design-stage-2 снимает отдельная проходка mcp/walk-reference.mjs («Путь проверки» эталона).
} catch (e) {
  all.push(`FAIL — прервано: ${e.message}`);
  evR.step(`FAIL — прервано: ${e.message}`);
} finally {
  evR.save('walk-log.txt', all.join('\n') + '\n');
  mcp.close();
}
