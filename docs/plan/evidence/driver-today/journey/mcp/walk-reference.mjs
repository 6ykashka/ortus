// Снимки эталона design-stage-2 для сверки журни W2.32 (verification-protocol.md §4 п. 6): «Ортус CRM.dc.html» на
// 127.0.0.1:4101 (design-preview --offline --ref design-stage-2). Персонаж и ширина — панель «Демо-режим» эталона.
// «Путь проверки» эталона: владелец подключает «Логистику», водитель на 390 проходит смену в интерфейсе (бронь, осмотр с
// демо-фото, выезд, расход, завершение, сдача), владелец на 1440 открывает «Приёмку смен» и принимает смену.
//   W232_ROOT=<корень> PORT=6101 REF_PORT=4101 node docs/plan/evidence/driver-today/journey/mcp/walk-reference.mjs
import { evidence, refOf, snapshotOf, startMcp } from './lib.mjs';

const REF = `http://127.0.0.1:${process.env.REF_PORT ?? '4101'}/${encodeURIComponent('Ортус CRM.dc.html')}`;
const mcp = startMcp();
const evD = evidence('driver-today', 'journey/reference');
const evR = evidence('logistics-review', 'journey/reference');
const log = [];
const step = (t) => {
  log.push(t);
  console.log(t);
};
const snap = async () => snapshotOf(await mcp.call('browser_snapshot'));
const wait = (text) => mcp.call('browser_wait_for', { text });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
/** ref первой строки `role "name…"` после строки-якоря. */
function refAfter(s, anchor, role, name) {
  const lines = s.split('\n');
  const i = lines.findIndex((l) => l.includes(anchor));
  if (i < 0) throw new Error(`нет якоря «${anchor}»`);
  for (const l of lines.slice(i)) {
    const m = new RegExp(`- '?${role} "${name}[^"]*"[^\\n]*\\[ref=([a-z0-9]+)\\]`).exec(l);
    if (m) return m[1];
  }
  throw new Error(`нет ${role} «${name}» после «${anchor}»`);
}
const clickRef = (target, element) => mcp.call('browser_click', { element, target });
const click = async (role, name, n = 0) => clickRef(refOf(await snap(), role, name, n), `${role} «${name}»`);
const pick = async (combo, label) =>
  mcp.call('browser_select_option', { element: combo, target: refOf(await snap(), 'combobox', combo), values: [label] });
async function clickWhile(role, name, max) {
  let n = 0;
  for (; n < max; n++) {
    try {
      await clickRef(refOf(await snap(), role, name), `${role} «${name}»`);
      await pause(400);
    } catch {
      break;
    }
  }
  return n;
}

/** Осмотр в интерфейсе эталона: пять демо-фото, пробег, топливо «½», пункты чек-листа. */
async function inspect(odo) {
  step(`ok — эталон: демо-фото ${await clickWhile('button', 'Демо: добавить фото', 5)}`);
  await pause(2500);
  let s = await snap();
  await mcp.call('browser_type', {
    element: 'Пробег',
    target: refAfter(s, 'Пробег по одометру', 'textbox', 'Пробег по одометру, км'),
    text: odo,
  });
  await click('button', '½');
  s = await snap();
  const lines = s.split('\n');
  const from = lines.findIndex((l) => l.includes('group "Чек-лист"'));
  const to = lines.findIndex((l, i) => i > from && l.includes('Дефекты'));
  const boxes = lines
    .slice(from, to)
    .map((l) => /- checkbox "([^"]+)"(?! \[checked\])[^\n]*\[ref=([a-z0-9]+)\]/.exec(l))
    .filter(Boolean);
  for (const [, name, r] of boxes) await clickRef(r, `checkbox «${name}»`);
}

try {
  await mcp.init();
  await mcp.call('browser_resize', { width: 1440, height: 900 });
  await mcp.call('browser_navigate', { url: REF });
  await wait('Персонаж');
  await pick('Ширина', '1440 · компьютер');
  await pause(1500);
  // Владелец подключает «Логистику» («Путь проверки», шаг 1).
  await click('button', 'Модули и место');
  await wait('Логистика');
  let s = await snap();
  await clickRef(refAfter(s, 'heading "Логистика"', 'button', 'Подключить'), 'Подключить «Логистика»');
  await wait('Подключить «Логистика»?');
  s = await snap();
  const dlg = s.split('\n').findIndex((l) => l.includes('dialog'));
  await clickRef(refAfter(s.split('\n').slice(dlg).join('\n'), 'dialog', 'button', 'Подключить'), 'Подключить');
  await pause(800);
  step('ok — эталон: «Логистика» подключена');

  // Водитель на 390: бронь, осмотр, выезд, расход, завершение, сдача.
  await pick('Персонаж', 'Водитель · Илья Васильев');
  await pause(1200);
  await pick('Ширина', '390 · телефон');
  await pause(1500);
  await wait('Моя смена');
  s = await snap();
  evD.save('snapshot-choose-390.md', s);
  await evD.shot(mcp, 'choose-390.png');
  await clickRef(refAfter(s, 'ГАЗель Next', 'button', 'Забронировать'), 'Забронировать ГАЗель');
  await pause(1000);
  try {
    await clickRef(refOf(await snap(), 'button', 'Подтвердить бронь'), 'Подтвердить бронь');
    await pause(1200);
  } catch {
    // бронь без подтверждения
  }
  await wait('Осмотр перед выездом');
  await evD.shot(mcp, 'inspection-390.png');
  await inspect('84500');
  evD.save('snapshot-inspection-ready-390.md', await snap());
  await evD.shot(mcp, 'inspection-ready-390.png');
  await click('button', 'Выехать на маршрут');
  await wait('Завершить рейс');
  evD.save('snapshot-route-390.md', await snap());
  await evD.shot(mcp, 'route-390.png');
  step('ok — эталон: выезд, «Маршрут»');
  await click('button', 'Добавить расход');
  await pause(800);
  s = await snap();
  await mcp.call('browser_type', { element: 'Сумма', target: refAfter(s, 'Сумма, ₽', 'textbox', 'Сумма'), text: '2500' });
  await click('button', 'Демо-фото чека');
  await pause(2500);
  await click('button', 'Сохранить расход');
  await wait('Расход принят сервером');
  await evD.shot(mcp, 'expense-390.png');
  step('ok — эталон: расход «Топливо» 2 500 ₽');
  await click('button', 'Завершить рейс');
  await pause(800);
  s = await snap();
  evD.save('snapshot-finish-dialog-390.md', s);
  await evD.shot(mcp, 'finish-dialog-390.png');
  const d2 = s.split('\n').findIndex((l) => l.includes('dialog'));
  await clickRef(refAfter(s.split('\n').slice(d2).join('\n'), 'dialog', 'button', 'Завершить рейс'), 'Завершить рейс');
  await wait('Осмотр при сдаче');
  await inspect('84560');
  await click('button', 'Сдать машину');
  await wait('Ожидает приёмки менеджером');
  evD.save('snapshot-submitted-390.md', await snap());
  await evD.shot(mcp, '390.png');
  await pick('Ширина', '1440 · компьютер');
  await pause(1500);
  await evD.shot(mcp, '1440.png');
  step('ok — эталон: сдача, «Ожидает приёмки менеджером» (390, 1440)');

  // Логист: «Приёмка смен», диалог, приёмка.
  await pick('Персонаж', 'Владелец · Дарья Зимина');
  await pause(1500);
  s = await snap();
  await clickRef(refAfter(s, 'navigation "Основная навигация"', 'button', 'Приёмка смен'), 'Приёмка смен');
  await wait('Итого заявлено');
  evR.save('snapshot-review-1440.md', await snap());
  await evR.shot(mcp, 'review-1440.png');
  await click('button', 'Принять смену');
  await wait('Что произойдёт');
  evR.save('snapshot-accept-dialog-1440.md', await snap());
  await evR.shot(mcp, 'accept-dialog-1440.png');
  s = await snap();
  const d3 = s.split('\n').findIndex((l) => l.includes('dialog'));
  await clickRef(refAfter(s.split('\n').slice(d3).join('\n'), 'dialog', 'button', 'Принять смену'), 'Принять смену');
  await pause(1200);
  evR.save('snapshot-accepted-1440.md', await snap());
  await evR.shot(mcp, '1440.png');
  await pick('Ширина', '390 · телефон');
  await pause(1500);
  await evR.shot(mcp, '390.png');
  step('ok — эталон: смена принята (1440, 390)');
  await pick('Персонаж', 'Водитель · Илья Васильев');
  await pause(1500);
  evD.save('snapshot-accepted-390.md', await snap());
  await evD.shot(mcp, 'accepted-390.png');
  step('ok — эталон: водитель — «Смена принята»');
} catch (e) {
  step(`FAIL — ${e.message.split('\n').slice(0, 3).join(' ')}`);
} finally {
  evD.save('walk-reference-log.txt', log.join('\n') + '\n');
  mcp.close();
}
