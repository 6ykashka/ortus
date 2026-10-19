// W2.21 · Экранные тесты «Очереди блокирующих дефектов» на сценарном сервере (MSW fleet W2.00, пресет
// logistics-ready): пусто, дефект на проверке, «разрешить выезд» с комментарием → «Решённые», «подтвердить
// неисправность», 409 (решён другим), ошибка загрузки, гейт водителя. Дефект — fixtures.test-util.ts «Приёмки смен».
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../../app/testing.tsx';
import { ALTA, blockingDefect, fleetOf } from '../review/fixtures.test-util.ts';

const SLOW = { timeout: 5_000 };
const H1 = 'Очередь блокирующих дефектов';

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (o: MockAppOptions = {}): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/defects`, {
    persona: 'manager',
    preset: 'logistics-ready',
    ...o,
  });
  await screen.findByRole('heading', { level: 1, name: H1 }, SLOW);
  return app;
};

const withDefect = {
  setup: (s: Parameters<NonNullable<MockAppOptions['setup']>>[0]) => void blockingDefect(s),
};
const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const card = (title: string): Promise<HTMLElement> =>
  screen
    .findByRole('heading', { level: 2, name: title }, SLOW)
    .then((h) => h.closest('article') as HTMLElement);

describe('очередь блокирующих дефектов', () => {
  it('пусто: «Блокирующих дефектов нет», вкладки «На проверке» и «Решённые»', async () => {
    await open();
    expect(await screen.findByText('Блокирующих дефектов нет', undefined, SLOW)).toBeTruthy();
    const tabs = screen.getByRole('tablist', { name: 'Дефекты' });
    expect(
      within(tabs)
        .getByRole('tab', { name: /На проверке/ })
        .getAttribute('aria-selected'),
    ).toBe('true');
    fireEvent.click(within(tabs).getByRole('tab', { name: /Решённые/ }));
    expect(await screen.findByText('Решённых дефектов пока нет', undefined, SLOW)).toBeTruthy();
  });

  it('вкладки по шаблону ARIA: aria-controls на панель (и в пустом состоянии), стрелки, roving tabindex', async () => {
    await open();
    await screen.findByText('Блокирующих дефектов нет', undefined, SLOW);
    const tabs = screen.getByRole('tablist', { name: 'Дефекты' });
    const review = within(tabs).getByRole('tab', { name: /На проверке/ });
    const decided = within(tabs).getByRole('tab', { name: /Решённые/ });
    const panelOf = (tab: HTMLElement): HTMLElement | null =>
      document.getElementById(tab.getAttribute('aria-controls') ?? '');
    const panel = panelOf(review);
    expect(panel?.getAttribute('role')).toBe('tabpanel');
    expect(panel?.getAttribute('aria-labelledby')).toBe(review.id);
    expect(panel?.textContent).toContain('Блокирующих дефектов нет');
    expect(review.tabIndex).toBe(0);
    expect(decided.tabIndex).toBe(-1);
    review.focus();
    fireEvent.keyDown(review, { key: 'ArrowRight' });
    await waitFor(() => expect(decided.getAttribute('aria-selected')).toBe('true'), SLOW);
    expect(document.activeElement).toBe(decided);
    expect(decided.tabIndex).toBe(0);
    expect(panelOf(decided)?.textContent).toContain('Решённых дефектов пока нет');
    fireEvent.keyDown(decided, { key: 'Home' });
    await waitFor(() => expect(review.getAttribute('aria-selected')).toBe('true'), SLOW);
    expect(document.activeElement).toBe(review);
    fireEvent.keyDown(review, { key: 'ArrowLeft' });
    await waitFor(() => expect(decided.getAttribute('aria-selected')).toBe('true'), SLOW);
  });

  it('дефект на проверке: заголовок, рейс, машина, время; команды эталона', async () => {
    await open(withDefect);
    const c = await card('Стёкла: Скол');
    expect(c.textContent).toContain('Рейс Р-208 · Илья Васильев');
    expect(c.textContent).toContain('ГАЗель Next · А 412 МР 77');
    expect(c.textContent).toContain('Отмечен при осмотре перед выездом 01.10.2026 в 08:47');
    expect(
      within(c).getByRole('button', { name: 'Дефект некритичный — разрешить выезд' }),
    ).toBeTruthy();
    expect(within(c).getByRole('button', { name: 'Подтвердить неисправность' })).toBeTruthy();
    expect(
      within(screen.getByRole('tablist', { name: 'Дефекты' })).getByRole('tab', {
        name: /На проверке/,
      }).textContent,
    ).toContain('1');
  });

  it('«разрешить выезд» с комментарием → тост, дефект в «Решённых» с чипом и комментарием', async () => {
    const a = await open(withDefect);
    const c = await card('Стёкла: Скол');
    fireEvent.change(within(c).getByLabelText('Комментарий к решению'), {
      target: { value: 'Скол вне зоны обзора' },
    });
    fireEvent.click(
      within(c).getByRole('button', { name: 'Дефект некритичный — разрешить выезд' }),
    );
    await waitFor(() => expect(toast()).toBe('Выезд разрешён'), SLOW);
    expect(await screen.findByText('Блокирующих дефектов нет', undefined, SLOW)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Решённые/ }));
    const done = await card('Стёкла: Скол');
    expect(done.textContent).toContain('Выезд разрешён');
    expect(done.textContent).toContain('Скол вне зоны обзора');
    expect(within(done).queryByRole('button', { name: /разрешить выезд/ })).toBeNull();
    const d = fleetOf(a.scenario).defects[0];
    expect(d?.state).toBe('resolved');
    expect(d?.decisionComment).toBe('Скол вне зоны обзора');
  });

  it('«Подтвердить неисправность» → тост, машина недоступна', async () => {
    const a = await open(withDefect);
    const c = await card('Стёкла: Скол');
    fireEvent.click(within(c).getByRole('button', { name: 'Подтвердить неисправность' }));
    await waitFor(
      () => expect(toast()).toBe('Неисправность подтверждена, машина снята с рейса'),
      SLOW,
    );
    expect(fleetOf(a.scenario).vehicles.find((v) => v.proto === 'v1')?.vstate).toBe('unavailable');
  });

  it('решён другим (409): тост и перечитывание очереди', async () => {
    const a = await open({ ...withDefect, scenario: 'decideInspectionDefect=invalid_transition' });
    const c = await card('Стёкла: Скол');
    const before = a.responses().filter((r) => r.path.endsWith('/fleet/defects')).length;
    fireEvent.click(within(c).getByRole('button', { name: 'Подтвердить неисправность' }));
    await waitFor(() => expect(toast()).toBeTruthy(), SLOW);
    await waitFor(
      () =>
        expect(
          a.responses().filter((r) => r.path.endsWith('/fleet/defects')).length,
        ).toBeGreaterThan(before),
      SLOW,
    );
  });

  it('ошибка загрузки: текст и «Повторить»', async () => {
    const a = await open({ scenario: 'listInspectionDefects=rate_limited' });
    const err = await screen.findByText(/Не удалось загрузить дефекты/, undefined, SLOW);
    expect(err.textContent).toBe(
      'Не удалось загрузить дефекты: Слишком много запросов. Подождите и повторите.',
    );
    a.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Блокирующих дефектов нет', undefined, SLOW)).toBeTruthy();
  });

  it('водитель: гейт оболочки', async () => {
    app = await renderMockApp(`/t/${ALTA}/defects`, {
      persona: 'driver',
      preset: 'logistics-ready',
    });
    expect(await screen.findByText(/Нет роли с доступом/, undefined, SLOW)).toBeTruthy();
  });
});

// W2.46 (D-29 комплекта): исполнитель и срок решения дефекта в очереди — assignInspectionDefect (If-Match, MSW W2.52).
describe('исполнитель и срок дефекта', () => {
  // Кандидатов даёт listMembers в области members.read: владелец видит всех; менеджер фирмы в сиде видит только
  // водителей своей фирмы (себя — нет), поэтому назначает владелец (decisionsNeeded W2.46).
  const asOwner = { ...withDefect, persona: 'owner' };
  const pick = (c: HTMLElement, name: string): void => {
    const select = within(c).getByLabelText('Исполнитель') as HTMLSelectElement;
    const option = within(select).getByRole('option', { name }) as HTMLOptionElement;
    fireEvent.change(select, { target: { value: option.value } });
  };

  it('без исполнителя: «Исполнитель не назначен», форма назначения', async () => {
    await open(asOwner);
    const c = await card('Стёкла: Скол');
    expect(c.textContent).toContain('Исполнитель не назначен');
    expect(await within(c).findByRole('option', { name: 'Марина Котова' }, SLOW)).toBeTruthy();
    expect(within(c).getByLabelText('Срок решения')).toBeTruthy();
    expect(within(c).getByRole('button', { name: 'Назначить' })).toBeTruthy();
  });

  it('«Назначить» → тост, на карточке исполнитель и срок по Москве, дефект в сценарии', async () => {
    const a = await open(asOwner);
    const c = await card('Стёкла: Скол');
    await within(c).findByRole('option', { name: 'Марина Котова' }, SLOW);
    pick(c, 'Марина Котова');
    fireEvent.change(within(c).getByLabelText('Срок решения'), {
      target: { value: '2030-10-02T12:00' },
    });
    fireEvent.click(within(c).getByRole('button', { name: 'Назначить' }));
    await waitFor(() => expect(toast()).toBe('Исполнитель назначен'), SLOW);
    await waitFor(
      () =>
        expect(c.isConnected ? c.textContent : '').toContain(
          'Исполнитель: Марина Котова · срок 02.10.2030 в 12:00',
        ),
      SLOW,
    );
    const d = fleetOf(a.scenario).defects[0];
    expect(d?.dueAt).toBe('2030-10-02T09:00:00Z');
    expect(d?.assigneeDisplayName).toBe('Марина Котова');
  });

  it('срок в прошлом: текст сервера в тосте, исполнитель не назначен', async () => {
    const a = await open(asOwner);
    const c = await card('Стёкла: Скол');
    await within(c).findByRole('option', { name: 'Марина Котова' }, SLOW);
    pick(c, 'Марина Котова');
    fireEvent.change(within(c).getByLabelText('Срок решения'), {
      target: { value: '2020-01-01T10:00' },
    });
    fireEvent.click(within(c).getByRole('button', { name: 'Назначить' }));
    await waitFor(() => expect(toast()).toBe('Срок решения уже прошёл.'), SLOW);
    expect(fleetOf(a.scenario).defects[0]?.assigneeMemberId).toBeUndefined();
  });

  it('«Назначить» недоступна, пока не выбраны исполнитель и срок', async () => {
    await open(asOwner);
    const c = await card('Стёкла: Скол');
    await within(c).findByRole('option', { name: 'Марина Котова' }, SLOW);
    const button = within(c).getByRole('button', { name: 'Назначить' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    pick(c, 'Марина Котова');
    expect(button.disabled).toBe(true);
    fireEvent.change(within(c).getByLabelText('Срок решения'), {
      target: { value: '2030-10-02T12:00' },
    });
    expect(button.disabled).toBe(false);
  });

  it('менеджер без кандидатов (видит только водителей): строка исполнителя есть, формы нет', async () => {
    const a = await open(withDefect);
    const c = await card('Стёкла: Скол');
    expect(c.textContent).toContain('Исполнитель не назначен');
    await waitFor(
      () => expect(a.responses().some((r) => r.path.endsWith('/members'))).toBe(true),
      SLOW,
    );
    expect(within(c).queryByLabelText('Исполнитель')).toBeNull();
    expect(within(c).queryByRole('button', { name: 'Назначить' })).toBeNull();
  });
});
