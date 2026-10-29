// W6.22 · Экранные тесты страницы «Снабжение» (`repair-supply`) на сценарном сервере (MSW repairs W6.00, пресет
// repairs-ready, сид «Альты»: 7 заявок ждут решения, закупка ЗК-6 получена, остатки на объектах). Сценарии эталона
// :724–829: «Заявки» (выдать со склада, собрать закупку), «Закупки», «Остатки» (на объектах), «Движения».
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const SLOW = { timeout: 5_000 };
const H1 = 'Снабжение';

let app: MockApp | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T10:30:00+03:00'));
});

afterEach(() => {
  app?.close();
  app = undefined;
  vi.useRealTimers();
});

const open = async (path = 'repair-supply', o: MockAppOptions = {}): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/${path}`, {
    persona: 'owner',
    preset: 'repairs-ready',
    ...o,
  });
  await screen.findByRole('heading', { level: 1, name: H1 }, SLOW);
  return app;
};

const row = async (number: string): Promise<HTMLElement> =>
  (await screen.findByText(number, { selector: '.ox-rps-mono' }, SLOW)).closest(
    'tr',
  ) as HTMLElement;

const note = (): string | null | undefined =>
  document.querySelector('.ox-rps-note .ox-rps-note-text')?.textContent;

describe('«Снабжение»: каркас', () => {
  it('крошка, h1, описание, вкладки со счётчиками', async () => {
    await open();
    expect(document.querySelector('.ox-rps-crumb')?.textContent).toBe('Ремонт и стройка');
    expect(screen.getByText(/^Заявки прорабов со всех объектов и склады фирм\./)).toBeTruthy();
    const tabs = screen.getByRole('tablist', { name: 'Снабжение' });
    await waitFor(
      () => expect(within(tabs).getByRole('tab', { name: 'Заявки · 7' })).toBeTruthy(),
      SLOW,
    );
    expect(within(tabs).getByRole('tab', { name: 'Закупки · 1' })).toBeTruthy();
    expect(within(tabs).getByRole('tab', { name: 'Остатки' })).toBeTruthy();
    expect(within(tabs).getByRole('tab', { name: 'Движения' })).toBeTruthy();
    expect(
      within(tabs).getByRole('tab', { name: 'Заявки · 7' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('прораб: оболочка закрывает страницу гейтом «Нет доступа к разделу»', async () => {
    app = await renderMockApp(`/t/${ALTA}/repair-supply`, {
      persona: 'foreman',
      preset: 'repairs-ready',
    });
    expect(
      await screen.findByText(/Нет доступа к разделу «Ремонт и стройка»/, undefined, SLOW),
    ).toBeTruthy();
  });

  it('ошибка загрузки: текст и «Повторить»', async () => {
    await open('repair-supply', { scenario: 'listSupplyRequests=rate_limited' });
    expect(
      await screen.findByText(
        'Не удалось загрузить снабжение: Слишком много запросов. Подождите и повторите.',
        undefined,
        SLOW,
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });
});

describe('«Заявки»', () => {
  it('таблица «Ждут решения»: колонки, срок «Нужно к», «На складах», смета', async () => {
    await open();
    expect(
      await screen.findByRole('heading', { level: 3, name: 'Ждут решения' }, SLOW),
    ).toBeTruthy();
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual([
      'В закупку',
      'Заявка и объект',
      'Материал',
      'Нужно к',
      'На складах',
      'Решение',
    ]);
    const r = await row('З-21');
    expect(r.textContent).toContain('ЖК Северный парк · квартира 117');
    expect(r.textContent).toContain('Плинтус МДФ · 42 м');
    expect(r.textContent).toContain('по смете 13 020 ₽');
    expect(r.textContent).toContain('22.10');
    expect(r.textContent).toContain('через 2 дня');
    expect(r.textContent).toContain('Москва · Отрадное: 60 м');
    expect(
      within(r).getByRole('button', { name: 'Выдать со склада «Москва · Отрадное»' }),
    ).toBeTruthy();
    const none = await row('З-14');
    expect(none.textContent).toContain('На складах нет');
    expect(within(none).queryByRole('button', { name: /Выдать со склада/ })).toBeNull();
    expect(within(await row('З-23')).getByText('через 1 день')).toBeTruthy();
  });

  it('строки «Ждут решения» идут по номеру заявки, как в эталоне (З-14, З-15, З-21 …)', async () => {
    await open();
    await row('З-14');
    const numbers = [...document.querySelectorAll('tbody tr .ox-rps-mono')].map(
      (e) => e.textContent,
    );
    expect(numbers.slice(0, 4)).toEqual(['З-14', 'З-15', 'З-21', 'З-22']);
  });
  it('«Выдать со склада» → резерв, заявка в «В работе», счётчик 6; «Выдать прорабу» → расход объекта', async () => {
    await open();
    const r = await row('З-21');
    fireEvent.click(
      within(r).getByRole('button', { name: 'Выдать со склада «Москва · Отрадное»' }),
    );
    await waitFor(
      () =>
        expect(note()).toContain(
          'Резерв на складе «Москва · Отрадное»: Плинтус МДФ, 42 м. Кладовщик выдаст прорабу по заявке З-21.',
        ),
      SLOW,
    );
    expect(await screen.findByRole('tab', { name: 'Заявки · 6' }, SLOW)).toBeTruthy();
    const work = screen
      .getByRole('heading', { level: 3, name: 'В работе' })
      .closest('div.ox-rps-card');
    expect(work?.textContent).toContain('К выдаче со склада');
    expect(work?.textContent).toContain('З-21');
    fireEvent.click(within(work as HTMLElement).getByRole('button', { name: 'Выдать прорабу' }));
    await waitFor(
      () =>
        expect(note()).toContain(
          'Плинтус МДФ выдан на объект «ЖК Северный парк · квартира 117»: 11 130 ₽ по средней цене склада — в расходы объекта.',
        ),
      SLOW,
    );
    expect(screen.getByText('Выполнено: 3 заявки — см. «Движения».')).toBeTruthy();
  });

  it('закупка: отметки, «Собрать закупку · 2 заявки», форма, цена, «Оформить закупку»', async () => {
    await open();
    const buy = await screen.findByRole('button', { name: 'Собрать закупку' }, SLOW);
    expect((buy as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(
      within(await row('З-14')).getByRole('checkbox', { name: 'В закупку: Ламинат 33 класс' }),
    );
    fireEvent.click(
      within(await row('З-24')).getByRole('checkbox', { name: 'В закупку: Керамогранит 60×60' }),
    );
    const go = screen.getByRole('button', { name: 'Собрать закупку · 2 заявки' });
    fireEvent.click(go);
    const form = (await screen.findByRole('heading', { level: 3, name: 'Новая закупка' })).closest(
      'div.ox-rps-card-sel',
    ) as HTMLElement;
    expect(form.textContent).toContain('Одна поставка, суммы распределяются по объектам: 2');
    expect((within(form).getByLabelText('Поставщик') as HTMLSelectElement).value).toBe(
      'СтройБаза Север',
    );
    expect(
      [...within(form).getByLabelText('Поставщик').querySelectorAll('option')].map(
        (o) => o.textContent,
      ),
    ).toEqual(['СтройБаза Север', 'ПолМаркет', 'КерамТорг']);
    expect(form.textContent).toContain('ЖК Речной · квартира 42 — 52 м²');
    expect(form.textContent).toContain(
      'Цена по умолчанию — средняя цена склада или последняя закупка',
    );
    fireEvent.change(within(form).getByLabelText('Цена закупки: Ламинат 33 класс'), {
      target: { value: '1 300' },
    });
    expect(form.textContent).toContain('67 600 ₽');
    fireEvent.change(within(form).getByLabelText('Поставщик'), { target: { value: 'ПолМаркет' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Оформить закупку' }));
    await waitFor(
      () =>
        expect(note()).toBe(
          'Закупка ЗК-7 у «ПолМаркет»: 2 позиции для 2 объектов. После получения сумма каждой строки уйдёт в расходы своего объекта.',
        ),
      SLOW,
    );
    expect(await screen.findByRole('tab', { name: 'Заявки · 5' }, SLOW)).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Закупки · 2' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Новая закупка' })).toBeNull();
  });

  it('закупка: неверная цена — сообщение, aria-invalid, «Оформить закупку» заблокирована', async () => {
    await open();
    await screen.findByRole('button', { name: 'Собрать закупку' }, SLOW);
    fireEvent.click(
      within(await row('З-14')).getByRole('checkbox', { name: 'В закупку: Ламинат 33 класс' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Собрать закупку · 1 заявка' }));
    const form = (await screen.findByRole('heading', { level: 3, name: 'Новая закупка' })).closest(
      'div.ox-rps-card-sel',
    ) as HTMLElement;
    const price = within(form).getByLabelText('Цена закупки: Ламинат 33 класс');
    const save = within(form).getByRole('button', {
      name: 'Оформить закупку',
    }) as HTMLButtonElement;
    expect(within(form).queryByRole('alert')).toBeNull();
    expect(save.disabled).toBe(false);
    for (const bad of ['abc', '-5', '0']) {
      fireEvent.change(price, { target: { value: bad } });
      const alert = within(form).getByRole('alert');
      expect(alert.textContent).toBe('Введите цену числом больше нуля');
      expect(price.getAttribute('aria-invalid')).toBe('true');
      expect(price.getAttribute('aria-describedby')).toBe(alert.id);
      expect(save.disabled).toBe(true);
    }
    fireEvent.change(price, { target: { value: '1 300' } });
    expect(within(form).queryByRole('alert')).toBeNull();
    expect(price.getAttribute('aria-invalid')).toBeNull();
    expect(save.disabled).toBe(false);
  });
  it('«Отмена» закрывает форму закупки, «Скрыть сообщение» — сообщение', async () => {
    await open();
    fireEvent.click(within(await row('З-14')).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /^Собрать закупку/ }));
    await screen.findByRole('heading', { level: 3, name: 'Новая закупка' });
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('heading', { name: 'Новая закупка' })).toBeNull();
    fireEvent.click(within(await row('З-21')).getByRole('button', { name: /Выдать со склада/ }));
    await waitFor(() => expect(note()).toContain('Резерв на складе'), SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть сообщение' }));
    expect(note()).toBeUndefined();
  });
});

describe('«Закупки»', () => {
  it('получена ЗК-6; новая закупка «Заказано» → чек по QR → «Получено»', async () => {
    await open('repair-supply?tab=purchases');
    const p6 = (await screen.findByText('ЗК-6', undefined, SLOW)).closest('article') as HTMLElement;
    expect(p6.textContent).toContain('СтройБаза Север');
    expect(p6.textContent).toContain('14.10 · 1 позиция · 1 объект');
    expect(p6.textContent).toContain('13 200 ₽');
    expect(p6.textContent).toContain('Получено');
    expect(within(p6).queryByRole('button', { name: 'Получено' })).toBeNull();
  });

  it('оформленная закупка: приём по чеку QR разносит суммы', async () => {
    await open();
    fireEvent.click(within(await row('З-21')).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /^Собрать закупку/ }));
    await screen.findByRole('heading', { level: 3, name: 'Новая закупка' });
    fireEvent.click(screen.getByRole('button', { name: 'Оформить закупку' }));
    await waitFor(() => expect(note()).toContain('Закупка ЗК-7 у «СтройБаза Север»'), SLOW);
    fireEvent.click(screen.getByRole('tab', { name: /^Закупки/ }));
    const p7 = (await screen.findByText('ЗК-7', undefined, SLOW)).closest('article') as HTMLElement;
    expect(p7.textContent).toContain('Заказано');
    const receive = within(p7).getByRole('button', { name: 'Получено' }) as HTMLButtonElement;
    expect(receive.disabled).toBe(true);
    fireEvent.change(within(p7).getByLabelText('Чек по QR'), {
      target: { value: 't=20261020T1010&s=11130.00' },
    });
    expect(receive.disabled).toBe(false);
    fireEvent.click(receive);
    await waitFor(
      () =>
        expect(note()).toBe(
          'Закупка ЗК-7 получена: материалы на объектах, суммы разнесены по объектам.',
        ),
      SLOW,
    );
    await waitFor(
      () => expect(within(p7).queryByRole('button', { name: 'Получено' })).toBeNull(),
      SLOW,
    );
  });
});

describe('«Остатки» и «Движения»', () => {
  it('остатки складов из модуля «Склад»; на объектах — список', async () => {
    await open('repair-supply?tab=stock');
    const stockRow = await screen.findByText('Масло массажное', undefined, SLOW);
    expect(stockRow.closest('tr')?.textContent).toContain('Склад салона');
    expect(screen.queryByText('Данные склада недоступны')).toBeNull();
    expect(screen.getByRole('group', { name: 'Склад' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Остатки на объектах' })).toBeTruthy();
    const tile = await screen.findByText('Керамогранит 60×60 · 4 м²', undefined, SLOW);
    expect(tile.closest('.ox-rps-row')?.textContent).toContain('Дом на Лесной · Мытищи · 6 160 ₽');
    expect(screen.getAllByRole('button', { name: 'Вернуть на склад' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Переместить на объект' })).toHaveLength(3);
  });

  it('вернуть на склад: выбор склада, «Подтвердить» → заметка, остаток уходит', async () => {
    await open('repair-supply?tab=stock');
    const item = (await screen.findByText('Керамогранит 60×60 · 4 м²', undefined, SLOW)).closest(
      '.ox-rps-row',
    ) as HTMLElement;
    fireEvent.click(within(item).getByRole('button', { name: 'Вернуть на склад' }));
    const sel = within(item).getByLabelText('Склад') as HTMLSelectElement;
    await waitFor(() => expect(sel.options.length).toBeGreaterThan(0), SLOW);
    expect([...sel.options].map((o) => o.textContent)).toContain('Склад «Мытищи»');
    fireEvent.change(sel, {
      target: { value: [...sel.options].find((o) => o.textContent === 'Склад «Мытищи»')?.value },
    });
    fireEvent.click(within(item).getByRole('button', { name: 'Подтвердить' }));
    await waitFor(
      () =>
        expect(note()).toBe(
          'Керамогранит 60×60, 4 м² возвращены на склад «Мытищи». Средняя цена склада пересчитана, объект «Дом на Лесной · Мытищи» уменьшил расходы на 6 160 ₽.',
        ),
      SLOW,
    );
    await waitFor(() => expect(screen.queryByText('Керамогранит 60×60 · 4 м²')).toBeNull(), SLOW);
    expect(screen.getAllByRole('button', { name: 'Вернуть на склад' })).toHaveLength(2);
  });

  it('переместить на объект: цели — объекты, заявка цели в подписи; «Отмена»', async () => {
    await open('repair-supply?tab=stock');
    const item = (await screen.findByText('Плинтус МДФ · 8 м', undefined, SLOW)).closest(
      '.ox-rps-row',
    ) as HTMLElement;
    fireEvent.click(within(item).getByRole('button', { name: 'Переместить на объект' }));
    const sel = within(item).getByLabelText('Объект') as HTMLSelectElement;
    const labels = [...sel.options].map((o) => o.textContent);
    expect(labels[0]).toBe('ЖК Северный парк · квартира 117 · заявка З-21: 42 м');
    expect(labels).not.toContain('Профсоюзная, 64 · квартира 210');
    fireEvent.click(within(item).getByRole('button', { name: 'Отмена' }));
    expect(within(item).queryByLabelText('Объект')).toBeNull();
    fireEvent.click(within(item).getByRole('button', { name: 'Переместить на объект' }));
    fireEvent.click(within(item).getByRole('button', { name: 'Подтвердить' }));
    await waitFor(
      () =>
        expect(note()).toBe(
          'Плинтус МДФ, 8 м перемещены на «ЖК Северный парк · квартира 117». Заявка З-21 уменьшена до 34 м. Стоимость перенесена в расходы нового объекта.',
        ),
      SLOW,
    );
  });

  it('«Движения» из модуля «Склад»: журнал и подсказка о неизменяемости', async () => {
    await open('repair-supply?tab=movements');
    expect((await screen.findAllByText('Приход на склад', undefined, SLOW)).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText('Данные склада недоступны')).toBeNull();
    expect(
      screen.getByText(
        'Движения не редактируются: ошибка исправляется обратным движением (модуль «Склад», см. OpenAPI 0.1).',
      ),
    ).toBeTruthy();
  });
});

describe('«Остатки» без права на склад', () => {
  it('нет доступа к складу (forbidden_action): пояснение «Данные склада недоступны», остатки на объектах остаются', async () => {
    await open('repair-supply?tab=stock', { scenario: 'listWarehouses=forbidden_action' });
    expect(await screen.findByText('Данные склада недоступны', undefined, SLOW)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Остатки на объектах' })).toBeTruthy();
  });
});

describe('вкладки', () => {
  it('стрелки переключают вкладки и обновляют ?tab=', async () => {
    const a = await open();
    const tabs = screen.getByRole('tablist', { name: 'Снабжение' });
    const first = await within(tabs).findByRole('tab', { name: /^Заявки/ }, SLOW);
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    await waitFor(
      () =>
        expect(
          within(tabs)
            .getByRole('tab', { name: /^Закупки/ })
            .getAttribute('aria-selected'),
        ).toBe('true'),
      SLOW,
    );
    expect(a.router.state.location.search).toMatchObject({ tab: 'purchases' });
    expect(document.activeElement).toBe(within(tabs).getByRole('tab', { name: /^Закупки/ }));
  });
});
