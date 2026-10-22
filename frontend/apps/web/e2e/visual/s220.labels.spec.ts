// W2.73 · Структурная сверка экранов S2-20 с макетами «Временный водитель - варианты.dc.html» (design-2026-10-19b;
// verification-protocol.md §3 п. 4): подписи кнопок, заголовков и label блока макета и того же блока реализации —
// 1b (входящий запрос фирмы водителя, `logistics-pool`), 1f (итог у логиста, `logistics-pool`), 1g («Требует
// решения» логиста, `home`). Макеты 1b/1f/1g — фрагменты 600 px холста, поэтому пиксельной сверки нет (allowlist),
// тексты дословно проверяют e2e S2-20. Состояние макета — tweaks (`setProps`). Allowlist — `allowlist/s220.md`.
import { expect, test } from '../fixtures/index.ts';
import { card as homeCard } from '../home.helpers.ts';
import { driverCard, incomingCard, openPool } from '../logistics-pool.helpers.ts';
import {
  apiDecideVehicle,
  apiRequestVehicle,
  patchUsual,
  serverClock,
} from '../logistics-pool-s220.helpers.ts';
import { S220_FILE, setProps } from './s220.compare.ts';
import { labelsOf } from './shell.compare.ts';

type AppFn = Parameters<typeof openPool>[0];

/** Владелец «Альты»: Водитель #104 с обычной машиной запрошен на Р-211 в режиме `mode`. */
async function requested(
  app: AppFn,
  page: Parameters<typeof openPool>[1],
  mode: 'host_or_home' | 'host' | 'home',
): Promise<{ alta: string; id: string }> {
  const alta = await openPool(app, page, { persona: 'owner', route: 'home' });
  await patchUsual(page, alta);
  await app(`/t/${alta}/pool`, { persona: 'owner' });
  await driverCard(page, 'Водитель #104').waitFor();
  const x = await apiRequestVehicle(page, alta, mode);
  return { alta, id: x.id };
}

test('logistics-pool: подписи входящего запроса 1b совпадают с макетом («Наша + можно свою») @mock', async ({
  app,
  page,
  reference,
  harness,
}) => {
  test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
  test.slow();
  const ref = await reference(S220_FILE);
  const { alta } = await requested(app, page, 'host_or_home');
  await app(`/t/${alta}/pool`, { persona: 'owner' });
  const row = incomingCard(page, 'Водитель #104');
  await row.getByRole('button', { name: 'Одобрить с машиной' }).waitFor();
  const expected = await labelsOf([ref.page.locator('[id="1b"] article')], 's220');
  const actual = await labelsOf([row], 's220');
  expect(actual).toEqual(expected);
  expect(actual).toEqual([
    'button:Одобрить с машиной',
    'button:Только водителя',
    'button:Отклонить',
  ]);
});

test('logistics-pool: подписи входящего запроса 1b без обычной машины совпадают с макетом («Только наша») @mock', async ({
  app,
  page,
  reference,
  harness,
}) => {
  test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
  test.slow();
  const ref = await reference(S220_FILE);
  await setProps(ref.page, { vehicleMode: 'Только наша' });
  const { alta } = await requested(app, page, 'host');
  await app(`/t/${alta}/pool`, { persona: 'owner' });
  const row = incomingCard(page, 'Водитель #104');
  await row.getByRole('button', { name: 'Одобрить' }).waitFor();
  const expected = await labelsOf([ref.page.locator('[id="1b"] article')], 's220');
  expect(await labelsOf([row], 's220')).toEqual(expected);
});

test('logistics-pool: подписи итога 1f без машины совпадают с макетом («Своя машина» → «Только водитель») @mock', async ({
  app,
  page,
  reference,
  harness,
}) => {
  test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
  test.slow();
  const ref = await reference(S220_FILE);
  await setProps(ref.page, {
    vehicleMode: 'Своя машина водителя',
    homeDecision: 'Только водитель',
  });
  const { alta, id } = await requested(app, page, 'home');
  await apiDecideVehicle(page, alta, id, 'approve_driver_only');
  await app(`/t/${alta}/pool`, { persona: 'manager' });
  const c = driverCard(page, 'Водитель #104');
  await c.getByRole('button', { name: 'Поставить машину' }).waitFor();
  const expected = await labelsOf([ref.page.locator('[id="1f"] article')], 's220');
  const actual = await labelsOf([c], 's220');
  expect(actual).toEqual(expected);
  expect(actual).toEqual(['button:Поставить машину']);
});

test('home: подписи пунктов 1g совпадают с макетом (выбор не сделан; нет машины) @mock', async ({
  app,
  page,
  reference,
  harness,
}) => {
  test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
  test.slow();
  const ref = await reference(S220_FILE);
  // Макет показывает оба пункта (для одного рейса они не встречаются вместе): кнопки сверяются по состояниям.
  const refButtons = await labelsOf([ref.page.locator('[id="1g"] > div:last-child')], 's220');
  expect(refButtons).toEqual([
    'h2:Требует решения',
    'button:Оставить Ford Transit',
    'button:Поставить машину',
  ]);
  const { alta, id } = await requested(app, page, 'host_or_home');
  await apiDecideVehicle(page, alta, id, 'approve');
  await serverClock(page, '2026-10-01T10:20:00Z');
  await app(`/t/${alta}/home`, { persona: 'manager' });
  const choice = homeCard(page, 'Р-211: водитель ещё не выбрал машину');
  await choice.waitFor();
  expect(await labelsOf([choice], 's220')).toEqual(['button:Оставить Ford Transit']);
});
