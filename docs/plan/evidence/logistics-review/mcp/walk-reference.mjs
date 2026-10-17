// Снимки эталона design-stage-2 для сверки «Приёмки смен» (verification-protocol.md §4 п. 6): «Ортус CRM.dc.html» на
// 127.0.0.1:4108 (design-preview --offline --ref design-stage-2). Персонаж и ширина — панель «Демо-режим» эталона.
// «Путь проверки» эталона: владелец подключает «Логистику», водитель проходит смену в интерфейсе (бронь, осмотр с
// демо-фото, выезд, расход, завершение, сдача), владелец открывает «Приёмку смен» — карточка смены, доработка,
// приёмка. Запуск: W221_ROOT=<корень> PORT=5208 node docs/plan/evidence/logistics-review/mcp/walk-reference.mjs
import { evidence, refOf, snapshotOf, startMcp } from './lib.mjs';

const REF = `http://127.0.0.1:${process.env.REF_PORT ?? '4108'}/${encodeURIComponent('Ортус CRM.dc.html')}`;
const mcp = startMcp();
const ev = evidence('logistics-review');
const log = [];
const step = (t) => {
  log.push(t);
  console.log(t);
};
const snap = async () => snapshotOf(await mcp.call('browser_snapshot'));
const wait = (text) => mcp.call('browser_wait_for', { text });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const ref = (s, role, name, n = 0) => refOf(s, role, name, n);
/** ref первой строки `role "name…"` после строки-якоря (карточка модуля, строка осмотра). */
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
const click = async (role, name, n = 0) => clickRef(ref(await snap(), role, name, n), `${role} «${name}»`);
const pick = async (combo, label) =>
  mcp.call('browser_select_option', {
    element: combo,
    target: ref(await snap(), 'combobox', combo),
    values: [label],
  });
const typeIn = async (role, name, text) =>
  mcp.call('browser_type', { element: name, target: ref(await snap(), role, name), text });
/** Нажимать, пока кнопка есть (демо-фото слотов, пункты чек-листа). */
async function clickWhile(role, name, max) {
  let n = 0;
  for (; n < max; n++) {
    let s;
    try {
      s = await snap();
      await clickRef(ref(s, role, name), `${role} «${name}»`);
      await pause(400);
    } catch {
      break;
    }
  }
  return n;
}
const checkAll = async () => {
  const s = await snap();
  const refs = [...s.matchAll(/- checkbox "([^"]+)"(?! \[checked\])[^\n]*\[ref=([a-z0-9]+)\]/g)];
  for (const [, name, r] of refs) await clickRef(r, `checkbox «${name}»`);
  return refs.length;
};

/** Осмотр в интерфейсе эталона: пять демо-фото, пробег, топливо «½», пункты чек-листа. */
async function inspectOnReference(odo) {
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
  step(`ok — эталон: пробег ${odo}, топливо ½, чек-лист ${boxes.length}`);
}

try {
  await mcp.init();
  await mcp.call('browser_resize', { width: 1440, height: 900 });
  await mcp.call('browser_navigate', { url: REF });
  await wait('Персонаж');
  await pick('Ширина', '1440 · компьютер');
  await pause(1500);

  // 1. Владелец подключает «Логистику».
  await click('button', 'Модули и место');
  await wait('Логистика');
  let s = await snap();
  await clickRef(refAfter(s, 'heading "Логистика"', 'button', 'Подключить'), 'Подключить «Логистика»');
  await wait('Подключить «Логистика»?');
  s = await snap();
  const dlg = s.split('\n').findIndex((l) => l.includes('dialog'));
  await clickRef(refAfter(s.split('\n').slice(dlg).join('\n'), 'dialog', 'button', 'Подключить'), 'Подключить');
  await pause(800);
  step('ok — эталон: владелец подключил «Логистику»');
  await click('button', 'Приёмка смен');
  await wait('Нет смен на проверке');
  await ev.shot(mcp, 'reference/empty-1440.png');
  step('ok — эталон: владелец, «Приёмка смен», пусто');

  // 2. Водитель: бронь, осмотр, выезд, расход, завершение, сдача.
  await pick('Персонаж', 'Водитель · Илья Васильев');
  await pause(1500);
  await wait('Моя смена');
  s = await snap();
  ev.save('reference/snapshot-driver-1.md', s);
  await clickRef(refAfter(s, 'ГАЗель Next', 'button', 'Забронировать'), 'Забронировать ГАЗель');
  await pause(800);
  s = await snap();
  try {
    await clickRef(ref(s, 'button', 'Подтвердить бронь'), 'Подтвердить бронь');
    await pause(1200);
  } catch {
    // бронь без подтверждения
  }
  await wait('Осмотр перед выездом');
  await inspectOnReference('84500');
  s = await snap();
  ev.save('reference/snapshot-driver-2.md', s);
  await click('button', 'Выехать на маршрут');
  await wait('Завершить рейс');
  step('ok — эталон: выезд');
  await click('button', 'Добавить расход');
  await pause(800);
  s = await snap();
  ev.save('reference/snapshot-driver-3.md', s);
  await mcp.call('browser_type', { element: 'Сумма', target: refAfter(s, 'Сумма, ₽', 'textbox', 'Сумма'), text: '2500' });
  await click('button', 'Демо-фото чека');
  await pause(2500);
  await click('button', 'Сохранить расход');
  await wait('Расход принят сервером');
  step('ok — эталон: расход «Топливо» 2 500 ₽');
  await click('button', 'Завершить рейс');
  await pause(800);
  s = await snap();
  const d2 = s.split('\n').findIndex((l) => l.includes('dialog'));
  await clickRef(refAfter(s.split('\n').slice(d2).join('\n'), 'dialog', 'button', 'Завершить рейс'), 'Завершить рейс');
  await wait('Осмотр при сдаче');
  step('ok — эталон: рейс завершён, осмотр при сдаче');
  await inspectOnReference('84560');
  s = await snap();
  ev.save('reference/snapshot-driver-4.md', s);
  await click('button', 'Сдать машину');
  await wait('Ожидает приёмки менеджером');
  step('ok — эталон: машина сдана');

  // 3. Владелец: «Приёмка смен» — карточка смены, проверки доработки, диалог приёмки.
  await pick('Персонаж', 'Владелец · Дарья Зимина');
  await pause(1500);
  // Пункт меню с бейджем («Приёмка смен 1») — по префиксу подписи в навигации.
  s = await snap();
  await clickRef(refAfter(s, 'navigation "Основная навигация"', 'button', 'Приёмка смен'), 'Приёмка смен');
  await wait('Итого заявлено');
  s = await snap();
  ev.save('reference/snapshot-shift-1440.md', s);
  await ev.shot(mcp, 'reference/shift-1440.png');
  step('ok — эталон: карточка смены, 1440');
  await click('button', 'Вернуть на доработку');
  await wait('Опишите, что нужно исправить');
  await ev.shot(mcp, 'reference/rework-errors-1440.png');
  step('ok — эталон: «Опишите, что нужно исправить»');
  await click('button', 'Принять смену');
  await wait('Что произойдёт');
  s = await snap();
  ev.save('reference/snapshot-accept-dialog.md', s);
  await ev.shot(mcp, 'reference/accept-1440.png');
  step('ok — эталон: диалог «Принять смену Р-208?»');
  await mcp.call('browser_press_key', { key: 'Escape' });
  await pick('Ширина', '390 · телефон');
  await pause(1500);
  await ev.shot(mcp, 'reference/shift-390.png');
  step('ok — эталон: карточка смены, 390');} catch (e) {
  step(`FAIL — ${e.message.split('\n').slice(0, 3).join(' ')}`);
} finally {
  ev.save('reference/walk-reference-log.txt', log.join('\n') + '\n');
  mcp.close();
}
