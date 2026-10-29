// W6.22 · Экранные тесты вкладки «Снабжение» карточки объекта (`repair-supply-tab`, эталон :532–545) и формы заявки
// прораба (`repair-supply-request`, no-reference, Q-W4.00-repair-6). Карточку объекта встраивает W6.20: тесты
// подставляют вкладку вместо заглушки страницы `repair` (подмена реестра страниц, сеть — сценарный сервер).
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, renderMockApp } from '../../../app/testing.tsx';

vi.mock('../../../app/pages.tsx', async (orig) => {
  const mod = await orig<typeof import('../../../app/pages.tsx')>();
  const { SupplyTab } = await import('./SupplyTab.tsx');
  return {
    ...mod,
    PageSlot: (p: Parameters<typeof mod.PageSlot>[0]): ReactElement =>
      p.page === 'repair'
        ? createElement(SupplyTab, { projectId: seedUuid('t-alta', 'obj-42') })
        : createElement(mod.PageSlot, p),
  };
});
const ALTA = seedUuid('platform', 't-alta');
const SLOW = { timeout: 5_000 };

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

const open = async (persona: string, scenario?: string): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/repair`, {
    persona,
    preset: 'repairs-ready',
    ...(scenario ? { scenario } : {}),
  });
  await screen.findByRole('heading', { level: 2, name: 'Снабжение' }, SLOW);
  return app;
};

const item = async (number: string): Promise<HTMLElement> =>
  (await screen.findByText(number, { selector: '.ox-rps-mono' }, SLOW)).closest(
    '.ox-rps-row',
  ) as HTMLElement;

const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;

describe('вкладка «Снабжение» объекта — владелец', () => {
  it('заявки объекта: статусы и действия эталона', async () => {
    await open('owner');
    expect(
      screen.getByText(
        /^Прораб просит материал, снабженец решает: выдать со склада фирмы или купить/,
      ),
    ).toBeTruthy();
    const waiting = await item('З-14');
    expect(waiting.textContent).toContain('Ламинат 33 класс · 52 м²');
    expect(waiting.textContent).toContain('нужно к 27.10');
    expect(waiting.textContent).toContain('Ждёт решения снабжения');
    expect(within(waiting).getByRole('button', { name: 'Решить в снабжении' })).toBeTruthy();
    const bought = await item('З-13');
    expect(bought.textContent).toContain('Закуплено');
    expect(bought.textContent).toContain('Чек по QR · 13 200 ₽');
    expect(within(bought).getByRole('button', { name: 'Списать на объект' })).toBeTruthy();
    const used = await item('З-12');
    expect(used.textContent).toContain('Списано на объект');
    expect(within(used).queryByRole('button')).toBeNull();
    expect(screen.queryByText('З-21', { selector: '.ox-rps-mono' })).toBeNull();
  });

  it('«Решить в снабжении» ведёт на страницу «Снабжение»', async () => {
    const a = await open('owner');
    fireEvent.click(within(await item('З-14')).getByRole('button', { name: 'Решить в снабжении' }));
    await waitFor(() => expect(a.path()).toBe(`/t/${ALTA}/repair-supply`), SLOW);
  });

  it('«Списать на объект» → «Списано на объект»', async () => {
    await open('owner');
    fireEvent.click(within(await item('З-13')).getByRole('button', { name: 'Списать на объект' }));
    await waitFor(
      () =>
        expect(
          within(screen.getByText('З-13').closest('.ox-rps-row') as HTMLElement).queryByRole(
            'button',
          ),
        ).toBeNull(),
      SLOW,
    );
    expect((await item('З-13')).textContent).toContain('Списано на объект');
  });

  it('ошибка загрузки заявок: alert с причиной и «Повторить» (бриф §4)', async () => {
    await open('owner', 'listSupplyRequests=rate_limited');
    const alert = await screen.findByRole('alert', undefined, SLOW);
    expect(alert.textContent).toContain(
      'Не удалось загрузить снабжение: Слишком много запросов. Подождите и повторите.',
    );
    const retry = within(alert).getByRole('button', { name: 'Повторить' });
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy(), SLOW);
    expect(screen.queryByText('Заявок по объекту пока нет.')).toBeNull();
  });

  it('порядок строк, вводный абзац и иконки действий — как в эталоне', async () => {
    await open('owner');
    await item('З-14');
    expect(
      [...document.querySelectorAll('.ox-rps-row .ox-rps-mono')].map((x) => x.textContent),
    ).toEqual(['З-12', 'З-13', 'З-14', 'З-15']);
    expect(screen.getByText(/^Прораб просит материал/).tagName).toBe('P');
    const decide = within(await item('З-14')).getByRole('button', { name: /Решить в снабжении/ });
    expect(decide.querySelector('.material-symbols-rounded')?.textContent).toBe('warehouse');
    const consume = within(await item('З-13')).getByRole('button', { name: /Списать на объект/ });
    expect(consume.querySelector('.material-symbols-rounded')?.textContent).toBe('check_circle');
  });

  it('владелец не пишет заявок: формы нет', async () => {
    await open('owner');
    await item('З-14');
    expect(screen.queryByRole('heading', { name: 'Новая заявка на материал' })).toBeNull();
  });
});

describe('форма заявки прораба (no-reference)', () => {
  it('без права чтения справочника форма не запрашивает расценки (нет 403 в консоли)', async () => {
    const a = await open('foreman');
    await screen.findByRole('heading', { level: 3, name: 'Новая заявка на материал' }, SLOW);
    await item('З-14');
    expect(a.responses().filter((x) => x.path.endsWith('/repairs/price-items'))).toEqual([]);
  });

  it('дата «Нужно к» в прошлом отклоняется с ошибкой', async () => {
    await open('foreman');
    const form = (
      await screen.findByRole('heading', { level: 3, name: 'Новая заявка на материал' }, SLOW)
    ).closest('form') as HTMLElement;
    const material = within(form).getByLabelText('Материал') as HTMLSelectElement;
    await waitFor(() => expect(material.options.length).toBeGreaterThan(1), SLOW);
    fireEvent.change(material, { target: { value: material.options[1]?.value } });
    fireEvent.change(within(form).getByLabelText('Количество'), { target: { value: '5' } });
    fireEvent.change(within(form).getByLabelText('Нужно к'), { target: { value: '2026-01-01' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Отправить заявку снабжению' }));
    expect(
      within(form)
        .getAllByRole('alert')
        .map((x) => x.textContent),
    ).toEqual(['Дата не может быть в прошлом']);
  });
  it('поля, ошибки, отправка → строка «Ждёт решения снабжения»', async () => {
    await open('foreman');
    const form = (
      await screen.findByRole('heading', { level: 3, name: 'Новая заявка на материал' }, SLOW)
    ).closest('form') as HTMLElement;
    expect(within(form).queryByRole('button', { name: 'Решить в снабжении' })).toBeNull();
    const material = within(form).getByLabelText('Материал') as HTMLSelectElement;
    await waitFor(() => expect(material.options.length).toBeGreaterThan(1), SLOW);
    fireEvent.click(within(form).getByRole('button', { name: 'Отправить заявку снабжению' }));
    expect(
      within(form)
        .getAllByRole('alert')
        .map((x) => x.textContent),
    ).toEqual([
      'Выберите материал из справочника',
      'Укажите количество больше нуля',
      'Укажите дату, к которой нужен материал',
    ]);
    expect(material.options[0]?.textContent).toBe('Выберите материал');
    const grunt = [...material.options].find((o) => o.textContent === 'Ламинат 33 класс');
    fireEvent.change(material, { target: { value: grunt?.value } });
    fireEvent.change(within(form).getByLabelText('Количество'), { target: { value: '20' } });
    fireEvent.change(within(form).getByLabelText('Нужно к'), { target: { value: '2026-10-30' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Отправить заявку снабжению' }));
    await waitFor(() => expect(toast()).toBe('Заявка отправлена снабжению'), SLOW);
    const created = await item('З-26');
    expect(created.textContent).toContain('Ламинат 33 класс · 20 м²');
    expect(created.textContent).toContain('нужно к 30.10');
    expect(created.textContent).toContain('Ждёт решения снабжения');
    expect((within(form).getByLabelText('Количество') as HTMLInputElement).value).toBe('');
  });
});
