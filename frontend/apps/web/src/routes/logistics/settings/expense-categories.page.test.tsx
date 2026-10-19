// W2.41 · Экранные тесты «Категорий расходов» (company-expense-categories, no-reference) на сценарном сервере MSW
// (W2.52, пресет logistics-ready): шесть категорий посева, добавление и ошибки поля, архивация с подтверждением
// и If-Match, архив, ошибка загрузки, только чтение, нет связи, гейт менеджера и водителя.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../app/testing.tsx';
import { ALTA } from '../manager/review/fixtures.test-util.ts';

const SLOW = { timeout: 8_000 };
const H1 = 'Категории расходов';
vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => {
  // React Aria Modal зовёт CSS.escape при открытии диалога (jsdom его не даёт) — как review.page.test.tsx.
  globalThis.CSS ??= {} as typeof CSS;
  globalThis.CSS.escape ??= (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

type Cat = { code: string; label: string; state: string; commentRequired: boolean };
const cats = (a: MockApp): Cat[] =>
  (a.scenario.state().orgs[ALTA] as unknown as { fleet: { categories: Cat[] } }).fleet.categories;

const open = async (o: MockAppOptions = {}): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/expense-categories`, {
    persona: 'owner',
    preset: 'logistics-ready',
    ...o,
  });
  await screen.findByRole('heading', { level: 1, name: H1 }, SLOW);
  return app;
};

const active = (): Promise<HTMLElement> =>
  screen.findByRole('list', { name: 'Активные категории' }, SLOW);
const items = async (): Promise<HTMLElement[]> => within(await active()).getAllByRole('listitem');
const rowOf = async (label: string): Promise<HTMLElement> => {
  const found = (await items()).find((li) => within(li).queryByText(label, { exact: true }));
  if (!found) throw new Error(`нет строки ${label}`);
  return found;
};
const form = (): HTMLElement => screen.getByRole('form', { name: 'Новая категория' });
const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;

describe('«Категории расходов»', () => {
  it('шесть категорий посева по порядку; «Прочее» — комментарий обязателен, без архивации', async () => {
    await open();
    const list = await items();
    expect(list.map((li) => li.querySelector('.ox-ec-name')?.textContent)).toEqual([
      'Топливо',
      'Мойка',
      'Парковка',
      'Платная дорога',
      'Шиномонтаж и мелкий ремонт',
      'Прочее',
    ]);
    const other = await rowOf('Прочее');
    expect(other.textContent).toContain('Комментарий обязателен');
    expect(other.textContent).toContain('Набор по умолчанию');
    expect(other.textContent).toContain('Не убирается в архив');
    expect(within(other).queryByRole('button')).toBeNull();
    expect(
      within(await rowOf('Мойка')).getByRole('button', { name: 'Убрать в архив: Мойка' }),
    ).toBeTruthy();
    expect(screen.getByText('Альта Групп · все подразделения')).toBeTruthy();
  });

  it('добавление: пустое название — ошибка поля; затем тост, строка и сброс формы', async () => {
    const a = await open();
    await active();
    fireEvent.click(within(form()).getByRole('button', { name: 'Добавить' }));
    expect(within(form()).getByRole('alert').textContent).toBe('Укажите название категории');
    const name = within(form()).getByLabelText('Название') as HTMLInputElement;
    expect(name.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(name, { target: { value: 'Стоянка на ночь' } });
    expect(within(form()).queryByRole('alert')).toBeNull();
    fireEvent.click(within(form()).getByLabelText('Комментарий обязателен'));
    fireEvent.click(within(form()).getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(toast()).toBe('Категория «Стоянка на ночь» добавлена'), SLOW);
    await waitFor(async () => expect(await items()).toHaveLength(7), SLOW);
    expect((await rowOf('Стоянка на ночь')).textContent).toContain('Комментарий обязателен');
    expect(name.value).toBe('');
    expect(
      (within(form()).getByLabelText('Комментарий обязателен') as HTMLInputElement).checked,
    ).toBe(false);
    expect(cats(a).find((c) => c.label === 'Стоянка на ночь')).toMatchObject({
      code: 'custom_1',
      commentRequired: true,
      state: 'active',
    });
  });

  it('дубль подписи без регистра — ошибка сервера под полем, без тоста', async () => {
    await open();
    await active();
    const name = within(form()).getByLabelText('Название');
    fireEvent.change(name, { target: { value: ' мойка ' } });
    fireEvent.click(within(form()).getByRole('button', { name: 'Добавить' }));
    expect((await within(form()).findByRole('alert', undefined, SLOW)).textContent).toBe(
      'Такая категория уже есть',
    );
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(toast()).toBeFalsy();
    expect(await items()).toHaveLength(6);
  });

  it('архивация: подтверждение, тост, архив с датой; «Показать архив» / «Скрыть архив»', async () => {
    const a = await open();
    fireEvent.click(
      within(await rowOf('Платная дорога')).getByRole('button', {
        name: 'Убрать в архив: Платная дорога',
      }),
    );
    const dlg = await screen.findByRole('dialog', undefined, SLOW);
    expect(
      within(dlg).getByRole('heading', { name: 'Убрать «Платная дорога» в архив?' }),
    ).toBeTruthy();
    expect(dlg.textContent).toContain('Водители больше не смогут выбрать её в новых расходах.');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Убрать в архив' }));
    await waitFor(() => expect(toast()).toBe('Категория «Платная дорога» убрана в архив'), SLOW);
    await waitFor(async () => expect(await items()).toHaveLength(5), SLOW);
    expect(cats(a).find((c) => c.code === 'toll')?.state).toBe('archived');
    fireEvent.click(screen.getByRole('button', { name: 'Показать архив (1)' }));
    const arch = screen.getByRole('list', { name: 'Категории в архиве' });
    expect(arch.textContent).toContain('Платная дорога');
    expect(arch.textContent).toMatch(/В архиве с \d\d\.\d\d\.\d{4}/);
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть архив' }));
    expect(screen.queryByRole('list', { name: 'Категории в архиве' })).toBeNull();
  });

  it('пустой архив: «В архиве пока нет категорий»', async () => {
    await open();
    await active();
    fireEvent.click(screen.getByRole('button', { name: 'Показать архив (0)' }));
    expect(screen.getByText('В архиве пока нет категорий')).toBeTruthy();
  });

  it('ошибка загрузки: текст и «Повторить»', async () => {
    const a = await open({ scenario: 'listExpenseCategories=rate_limited' });
    const err = await screen.findByText(/^Не удалось загрузить категории/, undefined, SLOW);
    expect(err.textContent).toBe(
      'Не удалось загрузить категории: Слишком много запросов. Подождите и повторите.',
    );
    a.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await items()).toHaveLength(6);
  });

  it('нет связи при добавлении: тост «нет связи», название остаётся', async () => {
    const a = await open();
    await active();
    const name = within(form()).getByLabelText('Название') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Ремни и стяжки' } });
    a.scenario.setScenario('createExpenseCategory=offline');
    fireEvent.click(within(form()).getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(toast()).toBe('Нет связи с сервером. Операция не выполнена.'), SLOW);
    expect(name.value).toBe('Ремни и стяжки');
    expect(cats(a).some((c) => c.label === 'Ремни и стяжки')).toBe(false);
  });

  it('организация только для чтения: список без формы и архивации', async () => {
    await open({
      setup: (s) => {
        s.applyPreset('trial-ended');
      },
    });
    expect(await items()).toHaveLength(6);
    expect(screen.queryByRole('form', { name: 'Новая категория' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Убрать в архив/ })).toBeNull();
    expect(
      screen.getByText(
        'Организация только для чтения: категории можно посмотреть, но не изменить.',
      ),
    ).toBeTruthy();
  });

  it('менеджер и водитель: гейт оболочки, справочника нет', async () => {
    for (const persona of ['manager', 'driver']) {
      app = await renderMockApp(`/t/${ALTA}/expense-categories`, {
        persona,
        preset: 'logistics-ready',
      });
      expect(await screen.findByText(/Нет роли с доступом/, undefined, SLOW)).toBeTruthy();
      expect(screen.queryByRole('list', { name: 'Активные категории' })).toBeNull();
      app.close();
      app = undefined;
    }
  });
});
