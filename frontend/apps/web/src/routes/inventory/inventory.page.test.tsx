// W5.11 · Экранные тесты «Склада» (`inventory`, экран inventory-stock, no-reference: склада в эталоне нет, B-6) на сценарном
// сервере MSW (тег Inventory, сид «Альты» — остатки кабинета эталона): остатки со складом и единицей, партии в порядке
// FEFO, фильтры, правка и создание позиции, новый склад, резервы, ошибка загрузки, только чтение, гейт без права.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../app/testing.tsx';
import { ALTA } from '../logistics/manager/review/fixtures.test-util.ts';

const SLOW = { timeout: 8_000 };
const NB = ' ';
vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => {
  // React Aria Modal зовёт CSS.escape при открытии диалога (jsdom его не даёт).
  globalThis.CSS ??= {} as typeof CSS;
  globalThis.CSS.escape ??= (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});

let app: MockApp | undefined;
// Дата страницы — «сегодня» сценарного сервера (SEED_NOW): срок годности партий не зависит от дня прогона.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T07:30:00Z'));
});
afterEach(() => {
  app?.close();
  app = undefined;
  vi.useRealTimers();
});

const open = async (path = 'inventory', o: MockAppOptions = {}): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/${path}`, {
    persona: 'owner',
    setup: (s) => s.applyPreset('inventory-ready'),
    ...o,
  });
  await screen.findByRole('heading', { level: 1, name: 'Склад' }, SLOW);
  return app;
};

const list = (name: string): Promise<HTMLElement> => screen.findByRole('list', { name }, SLOW);
const rows = async (name = 'Остатки'): Promise<HTMLElement[]> =>
  within(await list(name)).getAllByRole('listitem');
const rowOf = async (title: string, where = 'Склад салона'): Promise<HTMLElement> => {
  await list('Остатки');
  const found = (await rows()).find(
    (li) =>
      li.querySelector('.ox-inv-name')?.textContent === title &&
      li.querySelector('.ox-inv-where')?.textContent?.startsWith(where),
  );
  if (!found) throw new Error(`нет строки ${title} · ${where}`);
  return found;
};
const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const dialog = (name: string | RegExp): Promise<HTMLElement> =>
  screen.findByRole('dialog', { name }, SLOW);

describe('«Склад» · остатки', () => {
  it('заголовок, крошка владельца, вход в «Движения склада», пять строк остатков по складам', async () => {
    await open();
    expect(screen.getByText('Альта Групп · все подразделения')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Движения склада' })).toBeTruthy();
    const list = await rows();
    expect(
      list.map((li) => [
        li.querySelector('.ox-inv-name')?.textContent,
        li.querySelector('.ox-inv-where')?.textContent,
      ]),
    ).toEqual([
      ['Крем восстанавливающий', 'Склад салона · Артикул CRM-50'],
      ['Масло массажное', 'Склад салона · Артикул OIL-500'],
      ['Масло массажное', 'Склад № 1 · Артикул OIL-500'],
      ['Перчатки нитриловые', 'Склад салона · Артикул GLV-100'],
      ['Полотенца одноразовые', 'Склад салона · Артикул TWL-200'],
    ]);
  });

  it('масло в салоне: в наличии 250 мл, в резерве 30 мл, доступно 220 мл, минимум 100 мл', async () => {
    await open();
    const oil = await rowOf('Масло массажное');
    expect(oil.textContent).toContain(`В наличии250${NB}мл`);
    expect(oil.textContent).toContain(`В резерве30${NB}мл`);
    expect(oil.textContent).toContain(`Доступно220${NB}мл`);
    expect(oil.textContent).toContain(`Минимум: 100${NB}мл`);
    expect(within(oil).queryByText('Ниже минимума')).toBeNull();
    const cream = await rowOf('Крем восстанавливающий');
    expect(cream.textContent).toContain(`В наличии12${NB}г`);
    expect(within(cream).getByText('Ниже минимума')).toBeTruthy();
  });

  it('партии открываются по кнопке: ближайший срок первым и «Спишется первой», без партий — без кнопки', async () => {
    await open();
    const oil = await rowOf('Масло массажное');
    const toggle = within(oil).getByRole('button', { name: 'Партии (2)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    const lots = within(oil).getByRole('list', { name: 'Партии: Масло массажное' });
    const items = within(lots).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      `до 15.11.2026100${NB}млСпишется первой`,
      `до 01.03.2027150${NB}мл`,
    ]);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(within(oil).getByRole('button', { name: 'Скрыть партии' }));
    expect(within(oil).queryByRole('list', { name: 'Партии: Масло массажное' })).toBeNull();
    const towel = await rowOf('Полотенца одноразовые');
    expect(within(towel).queryByRole('button', { name: /^Партии/ })).toBeNull();
    expect(towel.textContent).toContain('Без партий');
  });

  it('просроченная партия помечена «Срок истёк»', async () => {
    await open();
    const oil = await rowOf('Масло массажное', 'Склад № 1');
    fireEvent.click(within(oil).getByRole('button', { name: 'Партии (2)' }));
    const lots = within(oil).getAllByRole('listitem');
    expect(lots[0]?.textContent).toContain('до 20.09.2026');
    expect(lots[0]?.textContent).toContain('Срок истёк');
    expect(lots[1]?.textContent).not.toContain('Срок истёк');
  });

  it('фильтры: «Ниже минимума» — крем и перчатки; склад — только его остатки', async () => {
    await open();
    await list('Остатки');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ниже минимума' }));
    await waitFor(async () => expect(await rows()).toHaveLength(2), SLOW);
    expect((await rows()).map((li) => li.querySelector('.ox-inv-name')?.textContent)).toEqual([
      'Крем восстанавливающий',
      'Перчатки нитриловые',
    ]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ниже минимума' }));
    const warehouse = screen.getByRole('combobox', { name: 'Склад' }) as HTMLSelectElement;
    expect([...warehouse.options].map((o) => o.textContent)).toEqual([
      'Все склады',
      'Склад салона',
      'Склад № 1',
    ]);
    fireEvent.change(warehouse, { target: { value: warehouse.options[2]?.value } });
    await waitFor(async () => expect(await rows()).toHaveLength(1), SLOW);
    expect((await rows())[0]?.textContent).toContain('Склад № 1');
    expect(app?.router.state.location.searchStr).toContain('warehouse=');
  });

  it('пустой фильтр «Ниже минимума» — пояснение', async () => {
    await open('inventory?low=1&warehouse=00000000-0000-5000-8000-0000000000aa');
    expect(await screen.findByText('Ниже минимума ничего нет', {}, SLOW)).toBeTruthy();
  });
});

describe('«Склад» · позиции и склады', () => {
  it('правка позиции: минимальный уровень и название, тост; в строке новый минимум', async () => {
    await open();
    const oil = await rowOf('Масло массажное');
    fireEvent.click(within(oil).getByRole('button', { name: 'Изменить позицию: Масло массажное' }));
    const dlg = await dialog('Позиция «Масло массажное»');
    const min = within(dlg).getByLabelText('Минимальный уровень') as HTMLInputElement;
    expect(min.value).toBe('100');
    fireEvent.change(min, { target: { value: '120,5' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(toast()).toBe('Позиция «Масло массажное» сохранена'), SLOW);
    await waitFor(async () =>
      expect((await rowOf('Масло массажное')).textContent).toContain(`Минимум: 120,5${NB}мл`),
    );
  });

  it('правка позиции: минимум не число — ошибка поля, запрос не уходит', async () => {
    await open();
    fireEvent.click(
      within(await rowOf('Масло массажное')).getByRole('button', {
        name: 'Изменить позицию: Масло массажное',
      }),
    );
    const dlg = await dialog('Позиция «Масло массажное»');
    const sent = app?.responses().length ?? 0;
    fireEvent.change(within(dlg).getByLabelText('Минимальный уровень'), { target: { value: 'x' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Сохранить' }));
    expect(
      within(dlg).getByText('Введите число: 0 или больше, не более шести знаков после запятой'),
    ).toBeTruthy();
    expect(app?.responses().length).toBe(sent);
  });

  it('архив позиции из диалога правки — тост, строка исчезает', async () => {
    await open();
    fireEvent.click(
      within(await rowOf('Перчатки нитриловые')).getByRole('button', {
        name: 'Изменить позицию: Перчатки нитриловые',
      }),
    );
    const dlg = await dialog('Позиция «Перчатки нитриловые»');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Убрать позицию в архив' }));
    await waitFor(() => expect(toast()).toBe('Позиция «Перчатки нитриловые» убрана в архив'), SLOW);
    await waitFor(async () => expect(await rows()).toHaveLength(4), SLOW);
  });

  it('новая позиция: пустая форма — ошибки полей; артикул-дубль — ошибка сервера под полем; затем добавление', async () => {
    await open();
    await list('Остатки');
    fireEvent.click(screen.getByRole('button', { name: 'Новая позиция' }));
    const dlg = await dialog('Новая позиция');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Добавить' }));
    for (const text of [
      'Выберите подразделение',
      'Укажите название позиции',
      'Укажите артикул',
      'Выберите единицу',
    ]) {
      expect(within(dlg).getByText(text), text).toBeTruthy();
    }
    const unit = within(dlg).getByLabelText('Подразделение') as HTMLSelectElement;
    fireEvent.change(unit, { target: { value: unit.options[1]?.value } });
    fireEvent.change(within(dlg).getByLabelText('Название'), {
      target: { value: 'Скраб солевой' },
    });
    fireEvent.change(within(dlg).getByLabelText('Артикул'), { target: { value: 'oil-500' } });
    fireEvent.change(within(dlg).getByLabelText('Единица'), { target: { value: 'g' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Добавить' }));
    expect(
      await within(dlg).findByText('Позиция с таким артикулом уже есть', {}, SLOW),
    ).toBeTruthy();
    fireEvent.change(within(dlg).getByLabelText('Артикул'), { target: { value: 'SCR-1' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(toast()).toBe('Позиция «Скраб солевой» добавлена'), SLOW);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW);
  });

  it('новый склад: ошибки полей, затем тост и склад в фильтре', async () => {
    await open();
    await list('Остатки');
    fireEvent.click(screen.getByRole('button', { name: 'Новый склад' }));
    const dlg = await dialog('Новый склад');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Создать склад' }));
    expect(within(dlg).getByText('Укажите название склада')).toBeTruthy();
    expect(within(dlg).getByText('Выберите подразделение')).toBeTruthy();
    const unit = within(dlg).getByLabelText('Подразделение') as HTMLSelectElement;
    fireEvent.change(unit, { target: { value: unit.options[1]?.value } });
    fireEvent.change(within(dlg).getByLabelText('Название'), {
      target: { value: 'Склад прачечной' },
    });
    fireEvent.change(within(dlg).getByLabelText('Код'), { target: { value: 'S1' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Создать склад' }));
    expect(await within(dlg).findByText('Склад с таким кодом уже есть', {}, SLOW)).toBeTruthy();
    fireEvent.change(within(dlg).getByLabelText('Код'), { target: { value: 'LND' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Создать склад' }));
    await waitFor(() => expect(toast()).toBe('Склад «Склад прачечной» создан'), SLOW);
    await waitFor(() => {
      const select = screen.getByRole('combobox', { name: 'Склад' }) as HTMLSelectElement;
      expect([...select.options].map((o) => o.textContent)).toContain('Склад прачечной');
    }, SLOW);
  });
});

describe('«Склад» · резервы', () => {
  const reservations = async (): Promise<HTMLElement[]> => rows('Резервы');

  it('вкладка «Резервы»: действующий резерв записи SPA и снятый; в адресе view=reservations', async () => {
    await open();
    fireEvent.click(screen.getByRole('tab', { name: 'Резервы' }));
    const list = await reservations();
    expect(list).toHaveLength(2);
    expect(list[0]?.textContent).toContain('Салон и SPA · запись');
    expect(list[0]?.textContent).toContain(`Масло массажное30${NB}мл`);
    expect(list.map((li) => li.querySelector('.ox-inv-chip')?.textContent).sort()).toEqual([
      'Действует',
      'Снят',
    ]);
    expect(app?.router.state.location.searchStr).toContain('view=reservations');
  });

  it('«Снять резерв» — подтверждение, тост, статус «Снят»; кнопка пропадает', async () => {
    await open('inventory?view=reservations');
    const active = (await reservations()).find((li) => li.textContent?.includes('Действует'));
    expect(active).toBeTruthy();
    fireEvent.click(within(active as HTMLElement).getByRole('button', { name: 'Снять резерв' }));
    const dlg = await dialog('Снять резерв?');
    expect(dlg.textContent).toContain('Количество снова станет доступным.');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Снять резерв' }));
    await waitFor(() => expect(toast()).toBe('Резерв снят'), SLOW);
    await waitFor(async () =>
      expect((await reservations()).every((li) => li.textContent?.includes('Снят'))).toBe(true),
    );
    expect(screen.queryByRole('button', { name: 'Снять резерв' })).toBeNull();
  });
});

describe('«Склад» · состояния', () => {
  it('ошибка загрузки остатков — сообщение и «Повторить»', async () => {
    await open('inventory', { scenario: 'listInventoryBalances=rate_limited' });
    expect(
      await screen.findByText(
        'Не удалось загрузить данные склада: Слишком много запросов. Подождите и повторите.',
        {},
        SLOW,
      ),
    ).toBeTruthy();
    app?.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect((await rows()).length).toBe(5);
  });

  it('организация только для чтения: остатки видны, кнопок действий нет, подсказка', async () => {
    await open('inventory', { preset: 'trial-ended' });
    expect((await rows()).length).toBe(5);
    for (const name of ['Новая позиция', 'Новый склад']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByRole('button', { name: /^Изменить позицию/ })).toBeNull();
    expect(
      screen.getByText('Организация только для чтения: остатки и движения доступны для просмотра.'),
    ).toBeTruthy();
  });

  it('водитель без прав склада — страницы нет, остатков нет', async () => {
    app = await renderMockApp(`/t/${ALTA}/inventory`, { persona: 'driver' });
    await screen.findByRole('heading', { name: /^Нет доступа к разделу/ }, SLOW);
    expect(screen.queryByRole('list', { name: 'Остатки' })).toBeNull();
  });

  it('«Движения склада» ведут на страницу движений', async () => {
    const a = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Движения склада' }));
    await waitFor(() => expect(a.path()).toBe(`/t/${ALTA}/inventory-movements`), SLOW);
  });
});
