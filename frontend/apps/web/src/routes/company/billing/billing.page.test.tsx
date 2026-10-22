// W4.61 · Экран «Подписка и места» владельца на MSW-сценарном сервере W4.07 (renderMockApp): пробный период «Альты»,
// сроки, тарифы и расчёт, заявка оператору и её отмена, оплаченный «Лотос» с заявкой SR-12, списки мест, переход
// «Пригласить», отказ 409, ошибка чтения.
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const LOTOS = seedUuid('platform', 't-lotos');

let app: MockApp | undefined;
// Часы сида: 01.10.2026 10:30 по Москве (как часы e2e) — «осталось N дн.» пробного периода.
beforeEach(() => {
  // React Aria Modal диалога приглашения зовёт CSS.escape (jsdom его не даёт) — как people.test.tsx W1.23.
  globalThis.CSS ??= {} as typeof CSS;
  globalThis.CSS.escape ??= (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T07:30:00Z'));
});
afterEach(() => {
  app?.close();
  app = undefined;
  vi.useRealTimers();
});

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function open(
  tenant = ALTA,
  o: Parameters<typeof renderMockApp>[1] = {},
): Promise<HTMLElement> {
  app = await renderMockApp(`/t/${tenant}/billing`, { persona: 'owner', ...o });
  await screen.findByRole('heading', { level: 1, name: 'Подписка и места' });
  const root = document.querySelector<HTMLElement>('section[aria-labelledby="h-bill"]');
  if (!root) throw new Error('нет секции');
  return root;
}

const tiers = (root: HTMLElement) =>
  within(within(root).getByRole('radiogroup', { name: 'Тариф' })).getAllByRole('radio');
const tier = (root: HTMLElement, name: string) =>
  tiers(root).find((t) => text(t.querySelector('strong')) === name) as HTMLElement;

describe('«Подписка и места» владельца', () => {
  it('пробный период «Альты»: тариф, чип, места, сроки и тарифы, подсказка', async () => {
    const root = await open();
    expect(root.dataset.screenLabel).toBe('Владелец · подписка и места');
    expect(text(root.querySelector('.ox-pk-crumb'))).toBe('Альта Групп / Компания');
    expect(
      await within(root).findByRole('heading', { level: 2, name: 'Пробный период · «Старт»' }),
    ).toBeTruthy();
    expect(text(root.querySelector('.ox-bl-plan .ox-chip-label'))).toBe(
      'до 13.10.2026 · осталось 12 дн.',
    );
    expect(text(root.querySelector('.ox-bl-seats-value'))).toBe('9 из 10');
    const terms = within(root).getByRole('radiogroup', { name: 'Срок оплаты' });
    expect(
      within(terms)
        .getAllByRole('radio')
        .map((r) => [text(r), r.getAttribute('aria-checked')]),
    ).toEqual([
      ['Месяц', 'false'],
      ['4 мес−5%', 'false'],
      ['8 мес−10%', 'false'],
      ['12 мес−20%', 'true'],
    ]);
    expect(tiers(root)).toHaveLength(5);
    expect(text(tier(root, 'Старт'))).toContain('Тот же лимит, что в пробном периоде');
    expect(within(root).getByText('Выберите тариф')).toBeTruthy();
    expect(
      (
        within(root).getByRole('button', {
          name: 'Отправить заявку оператору',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('выбор «Команда», заявка оператору, баннер и отмена', async () => {
    const root = await open();
    await within(root).findByRole('radiogroup', { name: 'Тариф' });
    fireEvent.click(tier(root, 'Команда'));
    expect(tier(root, 'Команда').getAttribute('aria-checked')).toBe('true');
    expect(text(root.querySelector('.ox-bl-calc'))).toBe(
      '7 120 ₽ в месяц · 85 440 ₽ за 12 месЭкономия 21 360 ₽ по сравнению с помесячной оплатой. Новый лимит: 25 мест.',
    );
    fireEvent.change(within(root).getByLabelText('Комментарий для оператора'), {
      target: { value: 'Подключаем ещё две фирмы' },
    });
    fireEvent.click(within(root).getByRole('button', { name: 'Отправить заявку оператору' }));
    expect(await screen.findByText('Заявка отправлена оператору')).toBeTruthy();
    const banner = await waitFor(() => {
      const b = [...root.querySelectorAll<HTMLElement>('[role="status"]')].find((x) =>
        text(x).includes('Новый лимит начнёт действовать'),
      );
      if (!b) throw new Error('нет баннера');
      return b;
    });
    expect(text(banner)).toMatch(/Заявка SR-\d+ на «Команда» · 12 мес отправлена/);
    await waitFor(() =>
      expect(tiers(root).every((t) => t.getAttribute('aria-disabled') === 'true')).toBe(true),
    );
    expect(
      within(root).getByText('Сначала дождитесь решения по текущей заявке или отмените её'),
    ).toBeTruthy();
    fireEvent.click(within(banner).getByRole('button', { name: 'Отменить заявку' }));
    expect(await screen.findByText('Заявка отменена')).toBeTruthy();
    await waitFor(() => expect(tier(root, 'Команда').getAttribute('aria-disabled')).toBe('false'));
  });

  it('владелец «Лотоса»: оплачено, заявка SR-12 на рассмотрении, тарифы недоступны', async () => {
    const root = await open(LOTOS, { persona: 'owner@t-lotos' });
    expect(
      await within(root).findByRole('heading', { level: 2, name: 'Тариф «Команда»' }),
    ).toBeTruthy();
    expect(text(root.querySelector('.ox-bl-plan .ox-chip-label'))).toBe('Оплачено до 31.03.2027');
    expect(
      within(root).getByText('Оплата за 12 мес · цены версии v1 сохраняются до конца периода'),
    ).toBeTruthy();
    expect(
      await within(root).findByText(
        'Заявка SR-12 на «Бизнес» · 12 мес отправлена 29.09 16:40. Новый лимит начнёт действовать после подтверждения оператором.',
      ),
    ).toBeTruthy();
    expect(text(tier(root, 'Команда'))).toContain('Текущий тариф');
    expect(text(tier(root, 'Старт'))).toContain('Занято 23 — не поместится');
    expect(tiers(root).every((t) => t.getAttribute('aria-disabled') === 'true')).toBe(true);
  });

  it('кто занимает и не занимает место', async () => {
    const root = await open();
    const paid = await waitFor(() => {
      const p = root.querySelector<HTMLElement>('.ox-bl-paid');
      if (!p?.querySelector('.ox-bl-person')) throw new Error('нет списка');
      return p;
    });
    expect(
      within(paid).getByRole('heading', { level: 2, name: 'Занимают место · 9' }),
    ).toBeTruthy();
    expect(paid.querySelectorAll('.ox-bl-person')).toHaveLength(9);
    const free = root.querySelector('.ox-bl-free') as HTMLElement;
    expect(
      within(free).getByRole('heading', { level: 2, name: 'Не занимают место · 1' }),
    ).toBeTruthy();
    expect(text(free)).toContain('Водитель · заблокирован, история сохранена');
  });

  it('«Пригласить» открывает «Пользователи и роли» с диалогом приглашения', async () => {
    const root = await open();
    fireEvent.click(await within(root).findByRole('button', { name: 'Пригласить' }));
    await waitFor(() => expect(app?.path()).toBe(`/t/${ALTA}/users`));
    expect(await screen.findByRole('dialog', { name: 'Пригласить участника' })).toBeTruthy();
  });

  it('заявка уже на рассмотрении (409): тост, выбор сохраняется', async () => {
    const root = await open();
    await within(root).findByRole('radiogroup', { name: 'Тариф' });
    fireEvent.click(tier(root, 'Команда'));
    app?.scenario.setScenario('createSubscriptionChangeRequest=request_pending', true);
    fireEvent.click(within(root).getByRole('button', { name: 'Отправить заявку оператору' }));
    expect(
      await screen.findByText('Заявка уже на рассмотрении. Отмените её, чтобы отправить новую.'),
    ).toBeTruthy();
    expect(tier(root, 'Команда').getAttribute('aria-checked')).toBe('true');
  });

  it('ошибка чтения: alert и «Повторить» (без эталона)', async () => {
    const root = await open(ALTA, { scenario: 'getTenantPriceBook=rate_limited' });
    const alert = await within(root).findByRole('alert');
    expect(text(alert)).toContain('Не удалось загрузить подписку: Слишком много запросов');
    app?.scenario.setScenario(null);
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(tiers(root)).toHaveLength(5));
  });
});
