// W4.61 · Экран «Тарифная сетка» оператора на MSW-сценарном сервере W4.07 (renderMockApp): просмотр v2, черновик v3
// с проверками, добавлением и удалением тарифа, публикация с даты и отмена запланированной версии, нет права роли,
// ошибка чтения.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, renderMockApp } from '../../../app/testing.tsx';

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function open(o: Parameters<typeof renderMockApp>[1] = {}): Promise<HTMLElement> {
  app = await renderMockApp('/platform/plans', { persona: 'operator', ...o });
  await screen.findByRole('heading', { level: 1, name: 'Тарифная сетка' });
  const root = document.querySelector<HTMLElement>('section[aria-labelledby="h-pb"]');
  if (!root) throw new Error('нет секции');
  return root;
}

const rows = (root: HTMLElement) => root.querySelectorAll('tbody tr');
const prepare = (root: HTMLElement, v = 3) =>
  within(root).findByRole('button', { name: `Подготовить версию v${v}` });

describe('«Тарифная сетка» оператора', () => {
  it('просмотр v2: шапка, плашка, заголовки, строки, история и правила', async () => {
    const root = await open();
    expect(root.dataset.screenLabel).toBe('Оператор · тарифная сетка');
    await prepare(root);
    expect(text(root.querySelector('.ox-pb-ver'))).toBe('Версия v2 · действует с 01.10.2026');
    expect(
      within(root).getByText(
        'Цены в прототипе — пример для макета, не согласованный тариф. Налоги и онлайн-оплата не рассчитываются.',
      ),
    ).toBeTruthy();
    expect(
      within(root)
        .getAllByRole('columnheader')
        .map((h) => text(h)),
    ).toEqual([
      'Тариф',
      'Цена за месяц',
      'Месяцбазовая цена',
      '4 месскидка 5%',
      '8 месскидка 10%',
      '12 месскидка 20%',
    ]);
    expect(rows(root)).toHaveLength(5);
    expect(text(rows(root)[0])).toContain('Старт');
    expect(root.querySelectorAll('.ox-pb-version')).toHaveLength(2);
    expect(root.querySelectorAll('.ox-pb-rules li')).toHaveLength(6);
  });

  it('черновик v3: поля, проверки и закрытая публикация', async () => {
    const root = await open();
    fireEvent.click(await prepare(root));
    expect(await within(root).findByText('Черновик v3 · не опубликован')).toBeTruthy();
    expect(within(root).queryByRole('button', { name: 'Подготовить версию v3' })).toBeNull();
    expect((within(root).getByLabelText('Мест в тарифе Старт') as HTMLInputElement).value).toBe(
      '10',
    );
    expect(
      (within(root).getByLabelText('Цена за месяц, тариф Старт') as HTMLInputElement).value,
    ).toBe('3900');
    const publish = within(root).getByRole('button', {
      name: 'Опубликовать v3',
    }) as HTMLButtonElement;
    expect(publish.disabled).toBe(false);
    fireEvent.change(within(root).getAllByLabelText('Название тарифа')[0] as HTMLElement, {
      target: { value: '' },
    });
    const alert = within(root).getByRole('alert');
    expect(text(alert)).toBe('Перед публикацией исправьте:· Тариф 1: укажите название');
    expect(publish.disabled).toBe(true);
    fireEvent.change(within(root).getByLabelText('Мест в тарифе Команда'), {
      target: { value: '5x' },
    });
    expect((within(root).getByLabelText('Мест в тарифе Команда') as HTMLInputElement).value).toBe(
      '5',
    );
  });

  it('«Добавить тариф» и «Удалить тариф»', async () => {
    const root = await open();
    fireEvent.click(await prepare(root));
    fireEvent.click(within(root).getByRole('button', { name: 'Добавить тариф' }));
    expect(rows(root)).toHaveLength(6);
    expect(text(within(root).getByRole('alert'))).toContain('· Тариф 5: укажите цену в месяц');
    fireEvent.click(within(root).getByRole('button', { name: 'Удалить тариф' }));
    expect(rows(root)).toHaveLength(5);
    expect(within(root).queryByRole('alert')).toBeNull();
  });

  it('публикация v3 и отмена запланированной версии', async () => {
    const root = await open();
    fireEvent.click(await prepare(root));
    fireEvent.change(within(root).getByLabelText('Что изменилось'), { target: { value: 'Тест' } });
    fireEvent.click(within(root).getByRole('button', { name: 'Опубликовать v3' }));
    const dialog = await screen.findByRole('dialog', { name: 'Опубликовать тарифную сетку v3?' });
    expect(within(dialog).getByText('Начнёт действовать 01.11.2026.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Опубликовать' }));
    expect(await screen.findByText('Готово · запись добавлена в журнал')).toBeTruthy();
    const banner = await within(root).findByText(
      'Запланирована версия v3 с 01.11.2026: Тест. До этой даты действуют цены v2.',
    );
    expect(within(root).queryByRole('button', { name: /^Подготовить версию/ })).toBeNull();
    expect(text(root.querySelector('.ox-pb-version'))).toContain('с 01.11.2026 · ещё не действует');
    const status = banner.closest('[role="status"]') as HTMLElement;
    fireEvent.click(within(status).getByRole('button', { name: 'Отменить версию' }));
    const cancel = await screen.findByRole('dialog', { name: 'Отменить версию v3?' });
    fireEvent.click(within(cancel).getByRole('button', { name: 'Отменить версию' }));
    await waitFor(() => expect(within(root).queryByText(/Запланирована версия v3/)).toBeNull());
    expect(await prepare(root, 4)).toBeTruthy();
    expect(text(root.querySelector('.ox-pb-version'))).toContain('01.10.2026 — сейчас');
  });

  it('«Отменить» черновик — без диалога, снова только чтение', async () => {
    const root = await open();
    fireEvent.click(await prepare(root));
    fireEvent.click(within(root).getByRole('button', { name: 'Отменить' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(root).queryAllByLabelText('Название тарифа')).toHaveLength(0);
    expect(await prepare(root)).toBeTruthy();
  });

  it('поддержка (роль support): нет права — текст раздела', async () => {
    const root = await open({ persona: 'op-4' });
    expect(
      await within(root).findByText(
        'Нет права на тарифную сетку: раздел доступен ролям «Владелец платформы», «Администратор» и «Биллинг».',
      ),
    ).toBeTruthy();
  });

  it('ошибка чтения: alert и «Повторить» (без эталона)', async () => {
    const root = await open({ scenario: 'listPriceBookVersions=rate_limited' });
    const alert = await within(root).findByRole('alert');
    expect(text(alert)).toContain('Не удалось загрузить тарифную сетку: Слишком много запросов');
    app?.scenario.setScenario(null);
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(rows(root)).toHaveLength(5));
  });
});
