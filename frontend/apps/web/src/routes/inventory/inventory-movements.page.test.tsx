// W5.11 · Экранные тесты «Движений склада» (`inventoryMovements`, экран inventory-movements, no-reference, B-6) на сценарном
// сервере MSW: журнал от новых к старым, приход с партией и сроком, расход по FEFO и отказы «не хватает» и «срок истёк»,
// перемещение, корректировка, сторно с причиной, ошибка загрузки, только чтение, гейт без права.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../app/testing.tsx';
import { ALTA } from '../logistics/manager/review/fixtures.test-util.ts';

const SLOW = { timeout: 8_000 };
const NB = ' ';
vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => {
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

const H1 = 'Движения склада';
const open = async (o: MockAppOptions = {}): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/inventory-movements`, {
    persona: 'owner',
    setup: (s) => s.applyPreset('inventory-ready'),
    ...o,
  });
  await screen.findByRole('heading', { level: 1, name: H1 }, SLOW);
  return app;
};

const rows = async (): Promise<HTMLElement[]> =>
  within(await screen.findByRole('list', { name: H1 }, SLOW)).getAllByRole('listitem');
const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const dialog = (name: string): Promise<HTMLElement> => screen.findByRole('dialog', { name }, SLOW);
const kindOf = (li: HTMLElement): string | null | undefined =>
  li.querySelector('.ox-inv-chip')?.textContent;

const optionByText = (select: HTMLElement, text: string): string => {
  const o = [...(select as HTMLSelectElement).options].find((x) => x.textContent === text);
  if (!o) throw new Error(`нет варианта «${text}»`);
  return o.value;
};
const pick = (dlg: HTMLElement, label: string, text: string): void => {
  const select = within(dlg).getByLabelText(label);
  fireEvent.change(select, { target: { value: optionByText(select, text) } });
};
const type = (dlg: HTMLElement, label: string, value: string): void => {
  fireEvent.change(within(dlg).getByLabelText(label), { target: { value } });
};

/** Окно «Новое движение» с выбранным видом. */
async function newMovement(kind: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: 'Новое движение' }, SLOW));
  const dlg = await dialog('Новое движение');
  pick(dlg, 'Вид движения', kind);
  return dlg;
}

describe('«Движения склада» · журнал', () => {
  it('заголовок, крошка, вход в «Склад», шесть движений сида от новых к старым', async () => {
    await open();
    expect(screen.getByText('Альта Групп · все подразделения')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Остатки и резервы' })).toBeTruthy();
    const list = await rows();
    expect(list.map(kindOf)).toEqual(['Расход', 'Сторно', 'Расход', 'Расход', 'Приход', 'Приход']);
    const first = list[0] as HTMLElement;
    expect(first.querySelector('.ox-inv-where')?.textContent).toBe('Склад салона');
    expect(first.querySelector('.ox-inv-when')?.textContent).toBe('01.10.2026, 09:50');
    expect(first.querySelector('.ox-inv-line')?.textContent).toContain(`Масло массажное`);
    expect(first.querySelector('.ox-inv-line')?.textContent).toContain(`−30${NB}мл`);
    expect(first.querySelector('.ox-inv-line')?.textContent).toContain('до 15.11.2026');
    expect(first.textContent).toContain('Салон и SPA · запись');
  });

  it('сторно — без кнопки «Сторно», остальные движения — с кнопкой', async () => {
    await open();
    const list = await rows();
    expect(within(list[1] as HTMLElement).queryByRole('button', { name: /^Сторно/ })).toBeNull();
    expect(within(list[0] as HTMLElement).getByRole('button', { name: /^Сторно/ })).toBeTruthy();
  });
});

describe('«Движения склада» · проведение', () => {
  it('приход с партией и сроком годности: тост, новая строка сверху со знаком «+»', async () => {
    await open();
    const dlg = await newMovement('Приход');
    pick(dlg, 'Склад', 'Склад салона');
    pick(dlg, 'Позиция 1', 'Масло массажное');
    type(dlg, 'Количество 1', '40,5');
    type(dlg, 'Срок годности 1', '2026-12-01');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Провести' }));
    await waitFor(() => expect(toast()).toBe('Движение проведено'), SLOW);
    await waitFor(async () => expect(kindOf((await rows())[0] as HTMLElement)).toBe('Приход'));
    const line = (await rows())[0]?.querySelector('.ox-inv-line')?.textContent ?? '';
    expect(line).toContain(`+40,5${NB}мл`);
    expect(line).toContain('до 01.12.2026');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW);
  });

  it('пустая форма — ошибки полей, запрос не уходит', async () => {
    await open();
    const dlg = await newMovement('Приход');
    const sent = app?.responses().length ?? 0;
    fireEvent.click(within(dlg).getByRole('button', { name: 'Провести' }));
    for (const text of [
      'Выберите склад',
      'Выберите позицию',
      'Введите количество больше нуля, не более шести знаков после запятой',
    ]) {
      expect(within(dlg).getByText(text), text).toBeTruthy();
    }
    expect(app?.responses().length).toBe(sent);
  });

  it('расход больше остатка — «не хватает» в окне, остаток не изменился', async () => {
    await open();
    const dlg = await newMovement('Расход');
    pick(dlg, 'Склад', 'Склад салона');
    pick(dlg, 'Позиция 1', 'Масло массажное');
    type(dlg, 'Количество 1', '1000');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Провести' }));
    const alert = await within(dlg).findByRole('alert', {}, SLOW);
    expect(alert.textContent).toBe(
      'На складе не хватает: остаток меньше, чем нужно. Проверьте количество.',
    );
    expect(toast()).toBeFalsy();
  });

  it('расход из просроченной партии — «срок годности истёк»; партия названа в списке «Партия»', async () => {
    await open();
    const dlg = await newMovement('Расход');
    pick(dlg, 'Склад', 'Склад № 1');
    pick(dlg, 'Позиция 1', 'Масло массажное');
    await waitFor(() => {
      const lot = within(dlg).getByLabelText('Партия 1') as HTMLSelectElement;
      expect([...lot.options].map((o) => o.textContent)).toEqual([
        'По сроку годности (FEFO)',
        `до 20.09.2026 · 40${NB}мл`,
        `до 30.06.2027 · 500${NB}мл`,
      ]);
    }, SLOW);
    pick(dlg, 'Партия 1', `до 20.09.2026 · 40${NB}мл`);
    type(dlg, 'Количество 1', '10');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Провести' }));
    const alert = await within(dlg).findByRole('alert', {}, SLOW);
    expect(alert.textContent).toContain('Срок годности партии истёк');
  });

  it('перемещение между складами: тост и строка «Склад салона → Склад № 1»', async () => {
    await open();
    const dlg = await newMovement('Перемещение');
    pick(dlg, 'Откуда', 'Склад салона');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Провести' }));
    expect(within(dlg).getByText('Выберите склад назначения')).toBeTruthy();
    pick(dlg, 'Куда', 'Склад салона');
    expect(within(dlg).getByLabelText('Куда')).toBeTruthy();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Провести' }));
    expect(within(dlg).getByText('Склад назначения должен отличаться от исходного')).toBeTruthy();
    pick(dlg, 'Куда', 'Склад № 1');
    pick(dlg, 'Позиция 1', 'Крем восстанавливающий');
    type(dlg, 'Количество 1', '2');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Провести' }));
    await waitFor(() => expect(toast()).toBe('Движение проведено'), SLOW);
    await waitFor(async () => expect(kindOf((await rows())[0] as HTMLElement)).toBe('Перемещение'));
    expect((await rows())[0]?.querySelector('.ox-inv-where')?.textContent).toBe(
      'Склад салона → Склад № 1',
    );
  });

  it('корректировка: направление и причина обязательны; затем проведение без знака в строке', async () => {
    await open();
    const dlg = await newMovement('Корректировка');
    pick(dlg, 'Склад', 'Склад салона');
    pick(dlg, 'Позиция 1', 'Крем восстанавливающий');
    type(dlg, 'Количество 1', '2');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Провести' }));
    expect(within(dlg).getByText('Выберите, что изменилось')).toBeTruthy();
    expect(within(dlg).getByText('Укажите причину')).toBeTruthy();
    pick(dlg, 'Что изменилось', 'Меньше, чем в учёте');
    type(dlg, 'Причина', 'Пролив');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Провести' }));
    await waitFor(() => expect(toast()).toBe('Движение проведено'), SLOW);
    await waitFor(async () =>
      expect(kindOf((await rows())[0] as HTMLElement)).toBe('Корректировка'),
    );
    const line = (await rows())[0]?.querySelector('.ox-inv-line')?.textContent ?? '';
    expect(line).toContain(`2${NB}г`);
    expect(line).not.toMatch(/[+−]/);
  });

  it('позиции добавляются и убираются; у одной позиции кнопки «Убрать» нет', async () => {
    await open();
    const dlg = await newMovement('Приход');
    expect(within(dlg).queryByRole('button', { name: /^Убрать позицию/ })).toBeNull();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Добавить позицию' }));
    expect(within(dlg).getByLabelText('Позиция 2')).toBeTruthy();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Убрать позицию 2' }));
    expect(within(dlg).queryByLabelText('Позиция 2')).toBeNull();
  });
});

describe('«Движения склада» · сторно', () => {
  it('причина обязательна; сторно — новая строка сверху, тост', async () => {
    await open();
    const first = (await rows())[0] as HTMLElement;
    fireEvent.click(within(first).getByRole('button', { name: /^Сторно/ }));
    const dlg = await dialog('Сторно движения');
    expect(dlg.textContent).toContain('Сторно вернёт остатки как до движения');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Сторнировать' }));
    expect(within(dlg).getByText('Укажите причину сторно')).toBeTruthy();
    type(dlg, 'Причина сторно', 'Ошибочное списание');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Сторнировать' }));
    await waitFor(() => expect(toast()).toBe('Сторно проведено'), SLOW);
    await waitFor(async () => expect(kindOf((await rows())[0] as HTMLElement)).toBe('Сторно'));
    expect(await rows()).toHaveLength(7);
  });

  it('повторное сторно того же движения — отказ сервера в тосте, журнал не меняется', async () => {
    await open();
    const target = (await rows())[2] as HTMLElement;
    fireEvent.click(within(target).getByRole('button', { name: /^Сторно/ }));
    const dlg = await dialog('Сторно движения');
    type(dlg, 'Причина сторно', 'Повторно');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Сторнировать' }));
    await waitFor(() => expect(toast()).toBeTruthy(), SLOW);
    expect(toast()).not.toBe('Сторно проведено');
    expect(await rows()).toHaveLength(6);
  });
});

describe('«Движения склада» · состояния', () => {
  it('ошибка загрузки — сообщение и «Повторить»', async () => {
    await open({ scenario: 'listInventoryMovements=rate_limited' });
    expect(
      await screen.findByText(
        'Не удалось загрузить данные склада: Слишком много запросов. Подождите и повторите.',
        {},
        SLOW,
      ),
    ).toBeTruthy();
    app?.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect((await rows()).length).toBe(6);
  });

  it('организация только для чтения: журнал виден, «Новое движение» и «Сторно» нет', async () => {
    await open({ preset: 'trial-ended' });
    expect((await rows()).length).toBe(6);
    expect(screen.queryByRole('button', { name: 'Новое движение' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Сторно/ })).toBeNull();
  });

  it('водитель без прав склада — гейт, журнала нет', async () => {
    app = await renderMockApp(`/t/${ALTA}/inventory-movements`, { persona: 'driver' });
    await screen.findByRole('heading', { name: /^Нет доступа к разделу/ }, SLOW);
    expect(screen.queryByRole('list', { name: H1 })).toBeNull();
  });

  it('«Остатки и резервы» ведут на страницу склада', async () => {
    const a = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Остатки и резервы' }));
    await waitFor(() => expect(a.path()).toBe(`/t/${ALTA}/inventory`), SLOW);
  });
});
