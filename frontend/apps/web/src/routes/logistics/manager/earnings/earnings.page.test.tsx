// W2.21 · Экранные тесты «Начислений водителям» на сценарном сервере (MSW fleet W2.00, пресет logistics-ready):
// пусто, строка после приёмки, итог, правка суммы владельцем (If-Match), проверки суммы, менеджер без права правки,
// фильтр по подразделению, ошибка загрузки, гейт водителя (D-10, AC-05).
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../../app/testing.tsx';
import { acceptedShift, ALTA, fleetOf } from '../review/fixtures.test-util.ts';

const SLOW = { timeout: 5_000 };
const H1 = 'Начисления водителям';
const nb = (s: string): string => s.replace(/(\d) (\d{3})/g, '$1 $2');

beforeAll(() => {
  globalThis.CSS ??= {} as typeof CSS;
  globalThis.CSS.escape ??= (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (o: MockAppOptions = {}): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/earnings`, {
    persona: 'owner',
    preset: 'logistics-ready',
    ...o,
  });
  await screen.findByRole('heading', { level: 1, name: H1 }, SLOW);
  return app;
};

const accepted: MockAppOptions = {
  setup: (s) => {
    acceptedShift(s);
  },
};
const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const row = (): Promise<HTMLElement> =>
  screen
    .findByText('Р-208 · Северный маршрут', undefined, SLOW)
    .then((x) => x.closest('[role="listitem"]') as HTMLElement);

describe('начисления водителям', () => {
  it('пусто: «Начислений пока нет»', async () => {
    await open();
    expect(await screen.findByText('Начислений пока нет', undefined, SLOW)).toBeTruthy();
    expect(
      screen.getByText('Начисление появляется, когда менеджер принимает смену водителя.'),
    ).toBeTruthy();
  });

  it('после приёмки: рейс, водитель, сумма, кто и когда; итог', async () => {
    await open(accepted);
    const r = await row();
    expect(r.textContent).toContain('Илья Васильев');
    expect(r.textContent).toContain(nb('4 500 ₽'));
    expect(r.textContent).toContain('Изменено 01.10.2026 в 14:42 · Марина Котова');
    // getByText нормализует пробелы узла (NBSP → пробел).
    expect(screen.getByText('Итого: 4 500 ₽')).toBeTruthy();
  });

  it('владелец правит сумму: проверки, тост, новая сумма, If-Match', async () => {
    const a = await open(accepted);
    const r = await row();
    fireEvent.click(within(r).getByRole('button', { name: 'Изменить начисление по рейсу Р-208' }));
    const dlg = await screen.findByRole('dialog', undefined, SLOW);
    expect(within(dlg).getByRole('heading', { name: 'Начисление по рейсу Р-208' })).toBeTruthy();
    const input = within(dlg).getByLabelText('Сумма, ₽');
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Сохранить' }));
    expect((await within(dlg).findByRole('alert')).textContent).toContain(
      'Сумма должна быть больше нуля',
    );
    fireEvent.change(input, { target: { value: '5000' } });
    fireEvent.change(within(dlg).getByLabelText('Как рассчитано'), {
      target: { value: 'Доплата за выходной' },
    });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(toast()).toBe('Начисление по рейсу Р-208 изменено'), SLOW);
    await waitFor(async () => expect((await row()).textContent).toContain(nb('5 000 ₽')), SLOW);
    expect(fleetOf(a.scenario).earnings[0]?.amount.amountMinor).toBe(500000);
    expect(fleetOf(a.scenario).earnings[0]?.calculationNote).toBe('Доплата за выходной');
  });

  it('менеджер с правом чтения: строки есть, «Изменить» нет', async () => {
    await open({ ...accepted, persona: 'manager' });
    const r = await row();
    expect(within(r).queryByRole('button', { name: /Изменить/ })).toBeNull();
  });

  it('фильтр «Подразделение»: все и подразделения рейсов', async () => {
    await open(accepted);
    await row();
    const select = screen.getByLabelText('Подразделение') as HTMLSelectElement;
    const labels = [...select.options].map((o) => o.textContent);
    expect(labels[0]).toBe('Все подразделения');
    expect(labels.some((l) => l?.includes('Север Логистик'))).toBe(true);
    fireEvent.change(select, { target: { value: select.options[1]?.value ?? '' } });
    expect((await row()).textContent).toContain('Илья Васильев');
  });

  it('ошибка загрузки: текст и «Повторить»', async () => {
    const a = await open({ scenario: 'listTripEarnings=rate_limited' });
    const err = await screen.findByText(/Не удалось загрузить начисления/, undefined, SLOW);
    expect(err.textContent).toBe(
      'Не удалось загрузить начисления: Слишком много запросов. Подождите и повторите.',
    );
    a.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Начислений пока нет', undefined, SLOW)).toBeTruthy();
  });

  it('водитель: гейт (функция «Водитель» закрывает начисления, D-10)', async () => {
    app = await renderMockApp(`/t/${ALTA}/earnings`, {
      persona: 'driver',
      preset: 'logistics-ready',
    });
    expect(await screen.findByText(/Нет роли с доступом/, undefined, SLOW)).toBeTruthy();
    expect(screen.queryByText(/₽/)).toBeNull();
  });
});
