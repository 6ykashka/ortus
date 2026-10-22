// W4.61 · Экран «Заявки на тариф» оператора на MSW-сценарном сервере W4.07 (renderMockApp): фильтр, карточки,
// отказ с причиной и подтверждение с диалогами, бейдж меню, повторное решение (409), нет права роли, ошибка чтения.
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

async function open(
  url = '/platform/requests',
  o: Parameters<typeof renderMockApp>[1] = {},
): Promise<HTMLElement> {
  app = await renderMockApp(url, { persona: 'operator', ...o });
  await screen.findByRole('heading', { level: 1, name: 'Заявки на изменение тарифа' });
  const root = document.querySelector<HTMLElement>('section[aria-labelledby="h-req"]');
  if (!root) throw new Error('нет секции');
  return root;
}

const article = (root: HTMLElement, number: string) =>
  [...root.querySelectorAll<HTMLElement>('article')].find((a) => text(a).includes(number));

/** Карточка заявки, когда она появилась (ожидание бросает, пока её нет). */
const findArticle = (root: HTMLElement, number: string) =>
  waitFor(() => {
    const a = article(root, number);
    if (!a) throw new Error(`нет карточки ${number}`);
    return a;
  });

const badge = () => document.querySelector('.ox-nav-badge');

/** Подпись кнопки, как её собирает структурная сверка (collectLabels e2e-kit): textContent без aria-hidden. */
const label = (el: Element) => {
  const clone = el.cloneNode(true) as Element;
  for (const hidden of Array.from(clone.querySelectorAll('[aria-hidden="true"]'))) hidden.remove();
  return text(clone);
};

describe('«Заявки на тариф» оператора', () => {
  it('фильтр «На рассмотрении · 1», карточка SR-12 с ценой по расчёту заявки, бейдж меню', async () => {
    const root = await open();
    expect(root.dataset.screenLabel).toBe('Оператор · заявки');
    const filter = await within(root).findByRole('group', { name: 'Фильтр заявок' });
    expect(
      within(filter)
        .getAllByRole('button')
        .map((b) => text(b)),
    ).toEqual(['На рассмотрении · 1', 'Все заявки · 2']);
    expect(root.querySelectorAll('article')).toHaveLength(1);
    const sr12 = article(root, 'SR-12') as HTMLElement;
    expect(within(sr12).getByRole('heading', { level: 2, name: 'SPA «Лотос»' })).toBeTruthy();
    expect(text(sr12.querySelector('.ox-rq-meta'))).toBe('29.09 16:40 · Ирина Белова');
    expect(text(sr12.querySelector('dl'))).toBe(
      'Сейчас «Команда» · до 25 мест Запрошено «Бизнес» · до 50 мест Занято мест 23 из 50 после перехода Срок оплаты 12 месяцев',
    );
    expect(text(sr12.querySelector('.ox-rq-price'))).toBe(
      'payments11 920 ₽ в месяц · 143 040 ₽ за период · скидка 20%',
    );
    expect(within(sr12).getByLabelText('Комментарий для владельца')).toBeTruthy();
    await waitFor(() => expect(text(badge())).toBe('1'));
  });

  // Возврат 2 (Q-W4.50-10): в эталоне подпись пункта — «Заявки на тариф 1» (пробел перед бейджем), shell.labels
  // W1.20 снимает бейдж только после пробела; без него подпись склеивается в «Заявки на тариф1».
  it('пункт меню с бейджем: подпись «Заявки на тариф 1» — пробел перед числом, как в эталоне', async () => {
    await open();
    await waitFor(() => expect(text(badge())).toBe('1'));
    const items = [...document.querySelectorAll('.ox-nav-badge, .ox-bottom-badge')].map((b) =>
      b.closest('button'),
    );
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(label(item as Element)).toBe('Заявки на тариф 1');
  });

  it('«Все заявки · 2»: адрес ?status=all, SR-9 подтверждена, без поля и кнопок', async () => {
    const root = await open();
    fireEvent.click(await within(root).findByRole('button', { name: 'Все заявки · 2' }));
    await waitFor(() => expect(root.querySelectorAll('article')).toHaveLength(2));
    expect(app?.router.state.location.search).toEqual({ status: 'all' });
    const sr9 = article(root, 'SR-9') as HTMLElement;
    expect(
      within(sr9).getByText('Подтверждена · Е. Лаптева · 12.05 15:20 — Оплата по счёту получена'),
    ).toBeTruthy();
    expect(sr9.querySelector('textarea')).toBeNull();
    expect(within(sr9).queryAllByRole('button')).toHaveLength(0);
  });

  it('«Отклонить» без комментария — тост, диалога нет', async () => {
    const root = await open();
    const sr12 = await findArticle(root, 'SR-12');
    fireEvent.click(within(sr12).getByRole('button', { name: 'Отклонить' }));
    expect(await screen.findByText('Напишите причину отказа в поле комментария')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('отказ с причиной: диалог, тост, пусто, «Отклонена» в «Все заявки», бейдж исчез', async () => {
    const root = await open();
    const sr12 = await findArticle(root, 'SR-12');
    fireEvent.change(within(sr12).getByLabelText('Комментарий для владельца'), {
      target: { value: 'Нет оплаты' },
    });
    fireEvent.click(within(sr12).getByRole('button', { name: 'Отклонить' }));
    const dialog = await screen.findByRole('dialog', { name: 'Отклонить заявку SR-12?' });
    expect(within(dialog).getByText('Владелец увидит причину: «Нет оплаты».')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отклонить' }));
    expect(await screen.findByText('Готово · запись добавлена в журнал')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      await within(root).findByText(
        'Новых заявок нет. Заявки появляются, когда владелец запрашивает другой тариф.',
      ),
    ).toBeTruthy();
    expect(within(root).getByRole('button', { name: 'На рассмотрении · 0' })).toBeTruthy();
    await waitFor(() => expect(badge()).toBeNull());
    fireEvent.click(within(root).getByRole('button', { name: 'Все заявки · 2' }));
    const rejected = await findArticle(root, 'SR-12');
    expect(text(rejected.querySelector('.ox-chip-label'))).toBe('Отклонена');
    expect(text(rejected)).toMatch(/Отклонена · Е\. Лаптева · \d\d\.\d\d \d\d:\d\d — Нет оплаты/);
  });

  it('подтверждение: диалог с суммой, заявка ушла из очереди', async () => {
    const root = await open();
    const sr12 = await findArticle(root, 'SR-12');
    fireEvent.click(within(sr12).getByRole('button', { name: 'Подтвердить и подключить' }));
    const dialog = await screen.findByRole('dialog', { name: 'Подтвердить заявку SR-12?' });
    expect(text(dialog)).toContain(
      'Подписка на 12 мес, 143 040 ₽ за период. В пилоте оплату подтверждает оператор',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Подтвердить' }));
    expect(await screen.findByText('Готово · запись добавлена в журнал')).toBeTruthy();
    await waitFor(() => expect(root.querySelectorAll('article')).toHaveLength(0));
  });

  it('повторное решение (409): тост «Заявка уже рассмотрена или отменена», диалог открыт', async () => {
    const root = await open();
    const sr12 = await findArticle(root, 'SR-12');
    fireEvent.click(within(sr12).getByRole('button', { name: 'Подтвердить и подключить' }));
    const dialog = await screen.findByRole('dialog', { name: 'Подтвердить заявку SR-12?' });
    app?.scenario.setScenario('decidePlatformSubscriptionRequest=invalid_transition', true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Подтвердить' }));
    expect(await screen.findByText('Заявка уже рассмотрена или отменена')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Подтвердить заявку SR-12?' })).toBeTruthy();
  });

  it('поддержка (роль support): нет права — текст раздела, бейджа нет', async () => {
    const root = await open('/platform/requests', { persona: 'op-4' });
    expect(
      await within(root).findByText(
        'Нет права на заявки на тариф: раздел доступен ролям «Владелец платформы», «Администратор» и «Биллинг».',
      ),
    ).toBeTruthy();
    expect(badge()).toBeNull();
  });

  it('ошибка чтения: alert и «Повторить» (без эталона)', async () => {
    const root = await open('/platform/requests', {
      scenario: 'listPlatformSubscriptionRequests=rate_limited',
    });
    const alert = await within(root).findByRole('alert');
    expect(text(alert)).toContain('Не удалось загрузить заявки: Слишком много запросов');
    app?.scenario.setScenario(null);
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(root.querySelectorAll('article')).toHaveLength(1));
  });
});
