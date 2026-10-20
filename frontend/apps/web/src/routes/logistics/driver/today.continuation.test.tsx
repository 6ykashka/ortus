// W2.61 · «Моя смена» начатого рейса без списка машин (Q-W2.32-2, дефект журни W2.32 AC-06): у временного водителя в
// продолжении после срока (D09, W2.57) `listVehicles` отвечает 403 `forbidden_action`. Экран берёт машину и рейс из
// рейса: «Маршрут», «Завершить рейс», осмотр при сдаче и «Сдать машину» — на экране. До выезда список машин нужен —
// его ошибка остаётся с «Повторить». MSW W2.00, пресет logistics-ready, Илья Васильев, Р-208.
import { seedUuid } from '@ortus/domain/seed';
import { onlineManager } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../app/testing.tsx';
import { transport } from './photos.ts';

const ALTA = seedUuid('platform', 't-alta');
const SLOW = { timeout: 8_000 };
vi.setConfig({ testTimeout: 30_000 });

const FORBIDDEN = 'listVehicles=forbidden_action';
const CARS_FAILED =
  'Не удалось загрузить машины: Нет права на это действие: ни одна ваша роль его не разрешает.';

let app: MockApp | undefined;
const realPut = transport.put;
const realPoll = transport.pollMs;
beforeEach(() => {
  transport.put = async (_url, _file, _type, _signal, onProgress) => {
    onProgress?.(50, 100);
  };
  transport.pollMs = 15;
});
afterEach(() => {
  app?.close();
  app = undefined;
  transport.put = realPut;
  transport.pollMs = realPoll;
  onlineManager.setOnline(true);
});

const open = async (o: MockAppOptions = {}): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/today`, {
    persona: 'driver',
    preset: 'logistics-ready',
    ...o,
  });
  await screen.findByRole('heading', { level: 1, name: 'Моя смена' }, SLOW);
  return app;
};

const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;

type Org = { files: { status: string }[] };
const quarantined = (a: MockApp): number =>
  (a.scenario.state().orgs[ALTA] as unknown as Org).files.filter((f) => f.status === 'quarantined')
    .length;
function scan(a: MockApp): void {
  const org = a.scenario.state().orgs[ALTA] as unknown as Org;
  for (const f of org.files) if (f.status === 'quarantined') f.status = 'ready';
}

function choose(slot: HTMLElement): void {
  fireEvent.click(slot);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('нет поля выбора файла');
  const f = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [f] } });
}

const SIDES = ['Спереди', 'Сзади', 'Слева', 'Справа', 'Одометр'];
const DEP = [
  'Кузов и стёкла осмотрены',
  'Шины и световые приборы исправны',
  'Документы и комплект на месте',
];
const RET = ['Груз выгружен полностью', 'Личные вещи забраны', 'Ключи и документы на месте'];

async function photos(a: MockApp): Promise<void> {
  const before = quarantined(a);
  for (const side of SIDES) choose(screen.getByRole('button', { name: new RegExp(`^${side}: `) }));
  await waitFor(() => expect(quarantined(a)).toBe(before + SIDES.length), SLOW);
  scan(a);
  await screen.findByText('Фото · 5 из 5', undefined, SLOW);
}

function fill(odometer: string, checks: string[]): void {
  fireEvent.change(screen.getByLabelText(/^Пробег по одометру, км/), {
    target: { value: odometer },
  });
  fireEvent.click(screen.getByRole('button', { name: '½' }));
  for (const c of checks) fireEvent.click(screen.getByLabelText(c));
}

async function depart(a: MockApp): Promise<void> {
  const model = await screen.findByText('ГАЗель Next', { selector: '.ox-dr-car-model' }, SLOW);
  const card = model.closest('article') as HTMLElement;
  fireEvent.click(within(card).getByRole('button', { name: 'Забронировать' }));
  await screen.findByRole('heading', { level: 2, name: 'Осмотр перед выездом' }, SLOW);
  await photos(a);
  fill('84500', DEP);
  fireEvent.click(screen.getByRole('button', { name: 'Выехать на маршрут' }));
  await screen.findByRole('heading', { level: 2, name: 'Маршрут' }, SLOW);
}

/** Уйти на «Автомобили» и вернуться: смена и машины перечитываются. */
async function revisit(a: MockApp): Promise<void> {
  await a.router.navigate({ to: `/t/${ALTA}/cars` });
  await screen.findByRole('heading', { level: 1, name: 'Автомобили' }, SLOW);
  await a.router.navigate({ to: `/t/${ALTA}/today` });
  await screen.findByRole('heading', { level: 1, name: 'Моя смена' }, SLOW);
}

const listVehicles403 = (a: MockApp): number =>
  a.responses().filter((r) => r.path.endsWith('/fleet/vehicles') && r.status === 403).length;

describe('«Сегодня»: начатый рейс без списка машин (W2.61, Q-W2.32-2)', () => {
  it('после выезда listVehicles 403: «Маршрут» без ошибки машин, «Завершить рейс», сдача на экране', async () => {
    const a = await open();
    await depart(a);
    a.scenario.setScenario(FORBIDDEN);
    await revisit(a);
    await waitFor(() => expect(listVehicles403(a)).toBeGreaterThan(0), SLOW);
    await screen.findByRole('heading', { level: 2, name: 'Маршрут' }, SLOW);
    expect(screen.queryByText(/^Не удалось загрузить машины/)).toBeNull();
    expect(screen.getByText('Р-208 · Северный маршрут')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Завершить рейс' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Завершить рейс' }),
    );
    await waitFor(() => expect(toast()).toBe('Рейс завершён. Заполните осмотр при сдаче'), SLOW);
    await screen.findByRole('heading', { level: 2, name: 'Осмотр при сдаче' }, SLOW);
    expect(screen.queryByText(/^Не удалось загрузить машины/)).toBeNull();
    await photos(a);
    fill('84560', RET);
    fireEvent.click(screen.getByRole('button', { name: 'Сдать машину' }));
    await waitFor(() => expect(toast()).toBe('Сдача принята сервером. Ожидайте приёмки'), SLOW);
    await screen.findByRole('heading', { level: 2, name: 'Ожидает приёмки менеджером' }, SLOW);
    expect(screen.queryByText(/^Не удалось загрузить машины/)).toBeNull();
  });

  it('до выезда список нужен: ошибка listVehicles — «Не удалось загрузить машины» и «Повторить»', async () => {
    const a = await open({ scenario: FORBIDDEN });
    const err = await screen.findByText(CARS_FAILED, undefined, SLOW);
    expect(err.closest('[role="alert"]')).toBeTruthy();
    a.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByRole('heading', { level: 2, name: 'Выберите машину' }, SLOW);
    expect(screen.queryByText(/^Не удалось загрузить машины/)).toBeNull();
  });
});
