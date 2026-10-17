// W2.22 · Экранные тесты «Автомобили» водителя (pg.cars :850–867): заголовок и пояснение, фильтр, карточки по рейсу
// смены, «Забронировать» → «Сегодня», «По фильтру машин нет», офлайн, ошибка и «Повторить».
import { seedUuid } from '@ortus/domain/seed';
import { onlineManager } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const SLOW = { timeout: 8_000 };
vi.setConfig({ testTimeout: 30_000 });

let app: MockApp | undefined;
afterEach(() => {
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
  window.dispatchEvent(new Event('online'));
  app?.close();
  app = undefined;
  onlineManager.setOnline(true);
});

const open = async (o: MockAppOptions = {}): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/cars`, {
    persona: 'driver',
    preset: 'logistics-ready',
    ...o,
  });
  await screen.findByRole('heading', { level: 1, name: 'Автомобили' }, SLOW);
  return app;
};

const models = (): (string | null)[] =>
  [...document.querySelectorAll('.ox-dr-car-model')].map((e) => e.textContent);
const card = (model: string): HTMLElement => {
  const el = screen.getByText(model, { selector: '.ox-dr-car-model' }).closest('article');
  if (!el) throw new Error(`нет карточки ${model}`);
  return el;
};
const filter = (): HTMLElement => screen.getByRole('group', { name: 'Фильтр' });

describe('«Автомобили»', () => {
  it('заголовок, пояснение, фильтр «Все»; карточки без «Подходит рейсу» и без недоступной кнопки', async () => {
    await open();
    expect(
      screen.getByText('Машины вашей фирмы и их состояние. Бронь подтверждает сервер.'),
    ).toBeTruthy();
    expect(
      within(filter())
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Все', 'Подходят к рейсу', 'Свободны']);
    expect(within(filter()).getByRole('button', { name: 'Все' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await screen.findByText('ГАЗель Next', { selector: '.ox-dr-car-model' }, SLOW);
    expect(models()).toHaveLength(5);
    expect(document.body.textContent).not.toContain('Подходит рейсу');
    expect(within(card('Ford Transit')).queryByRole('button')).toBeNull();
    expect(within(card('ГАЗель Next')).getByRole('button', { name: 'Забронировать' })).toBeTruthy();
  });

  it('«Подходят к рейсу» и «Свободны»', async () => {
    await open();
    await screen.findByText('ГАЗель Next', { selector: '.ox-dr-car-model' }, SLOW);
    fireEvent.click(within(filter()).getByRole('button', { name: 'Подходят к рейсу' }));
    expect(models()).toEqual(['ГАЗель Next', 'Mercedes Sprinter', 'ГАЗон Next']);
    fireEvent.click(within(filter()).getByRole('button', { name: 'Свободны' }));
    expect(models()).not.toContain('ГАЗон Next');
  });

  it('«Забронировать» → «Сегодня» с подтверждённой бронью', async () => {
    const a = await open();
    await screen.findByText('ГАЗель Next', { selector: '.ox-dr-car-model' }, SLOW);
    fireEvent.click(within(card('ГАЗель Next')).getByRole('button', { name: 'Забронировать' }));
    await waitFor(() => expect(a.path()).toBe(`/t/${ALTA}/today`), SLOW);
    await screen.findByText(/Бронь подтверждена сервером · ГАЗель Next/, undefined, SLOW);
  });

  it('«По фильтру машин нет»', async () => {
    await open({ scenario: 'listVehicles=empty' });
    await screen.findByText('По фильтру машин нет', undefined, SLOW);
  });

  it('нет связи: кнопок брони нет', async () => {
    await open();
    await screen.findByText('ГАЗель Next', { selector: '.ox-dr-car-model' }, SLOW);
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    window.dispatchEvent(new Event('offline'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Забронировать' })).toBeNull());
  });

  it('ошибка listVehicles: текст и «Повторить»', async () => {
    const a = await open({ scenario: 'listVehicles=rate_limited' });
    await screen.findByText(
      'Не удалось загрузить машины: Слишком много запросов. Подождите и повторите.',
      undefined,
      SLOW,
    );
    a.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByText('ГАЗель Next', { selector: '.ox-dr-car-model' }, SLOW);
  });
});
