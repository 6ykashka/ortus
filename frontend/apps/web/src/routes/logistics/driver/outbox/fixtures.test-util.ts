// W2.24 · Помощники экранных тестов очереди (как today.page.test.tsx W2.22): водитель «Альты» на MSW-сценарном
// сервере с пресетом logistics-ready, фото через выбор файла, проверка файлов, путь до выезда, связь.
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../../app/testing.tsx';

export const ALTA = seedUuid('platform', 't-alta');
export const A = (id: string): string => seedUuid('t-alta', id);
export const SLOW = { timeout: 10_000 };

export const SIDES = ['Спереди', 'Сзади', 'Слева', 'Справа', 'Одометр'] as const;
export const DEP = [
  'Кузов и стёкла осмотрены',
  'Шины и световые приборы исправны',
  'Документы и комплект на месте',
] as const;
export const RET = [
  'Груз выгружен полностью',
  'Личные вещи забраны',
  'Ключи и документы на месте',
] as const;

/** Связь: navigator.onLine и событие окна (как context.setOffline в браузере). */
export function setOnline(on: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { value: on, configurable: true });
  window.dispatchEvent(new Event(on ? 'online' : 'offline'));
}

export async function open(o: MockAppOptions = {}): Promise<MockApp> {
  const app = await renderMockApp(`/t/${ALTA}/today`, {
    persona: 'driver',
    preset: 'logistics-ready',
    ...o,
  });
  await screen.findByRole('heading', { level: 1, name: 'Моя смена' }, SLOW);
  return app;
}

export function closeApp(app: MockApp | undefined): void {
  app?.close();
}

export const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;

export const card = (model: string): HTMLElement => {
  const el = screen.getByText(model, { selector: '.ox-dr-car-model' }).closest('article');
  if (!el) throw new Error(`нет карточки ${model}`);
  return el;
};

type Org = { files: { status: string }[]; fleet: Fleet };
type Fleet = {
  trips: { id: string; state: string; revision: number }[];
  expenses: { tripId: string }[];
};
const org = (a: MockApp): Org => a.scenario.state().orgs[ALTA] as unknown as Org;

/** Файлы, ждущие проверки (антивирус режима mock). */
export const quarantined = (a: MockApp): number =>
  org(a).files.filter((f) => f.status === 'quarantined').length;

/** Проверка файлов завершена (dev-маршрут scanFiles сценарного сервера). */
export function scan(a: MockApp): void {
  for (const f of org(a).files) if (f.status === 'quarantined') f.status = 'ready';
}

export const trip208 = (a: MockApp): { id: string; state: string; revision: number } => {
  const t = org(a).fleet.trips.find((x) => x.id === A('Р-208'));
  if (!t) throw new Error('нет Р-208');
  return t;
};

export const expensesOf = (a: MockApp): { tripId: string }[] =>
  org(a).fleet.expenses.filter((e) => e.tripId === A('Р-208'));

const fileInput = (): HTMLInputElement => {
  const el = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!el) throw new Error('нет поля выбора файла');
  return el;
};

export function choose(slot: HTMLElement, name = 'photo.jpg'): void {
  fireEvent.click(slot);
  const f = new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });
  fireEvent.change(fileInput(), { target: { files: [f] } });
}

export async function reserveGazel(): Promise<void> {
  await screen.findByText('ГАЗель Next', { selector: '.ox-dr-car-model' }, SLOW);
  fireEvent.click(within(card('ГАЗель Next')).getByRole('button', { name: 'Забронировать' }));
  await screen.findByRole('heading', { level: 2, name: 'Осмотр перед выездом' }, SLOW);
}

export async function photos(a: MockApp): Promise<void> {
  for (const side of SIDES) {
    choose(screen.getByRole('button', { name: new RegExp(`^${side}: `) }));
  }
  await waitFor(() => expect(quarantined(a)).toBe(SIDES.length), SLOW);
  scan(a);
  await screen.findByText('Фото · 5 из 5', undefined, SLOW);
}

export function fill(odometer: string, checks: readonly string[]): void {
  fireEvent.change(screen.getByLabelText(/^Пробег по одометру, км/), {
    target: { value: odometer },
  });
  fireEvent.click(screen.getByRole('button', { name: '½' }));
  for (const c of checks) fireEvent.click(screen.getByLabelText(c));
}

export async function depart(a: MockApp): Promise<void> {
  await reserveGazel();
  await photos(a);
  fill('84500', DEP);
  fireEvent.click(screen.getByRole('button', { name: 'Выехать на маршрут' }));
  await screen.findByRole('heading', { level: 2, name: 'Маршрут' }, SLOW);
}

/** Уйти на «Автомобили» и вернуться: экран «Сегодня» монтируется заново. */
export async function revisit(a: MockApp): Promise<void> {
  await a.router.navigate({ to: `/t/${ALTA}/cars` });
  await screen.findByRole('heading', { level: 1, name: 'Автомобили' }, SLOW);
  await a.router.navigate({ to: `/t/${ALTA}/today` });
  await screen.findByRole('heading', { level: 1, name: 'Моя смена' }, SLOW);
}
