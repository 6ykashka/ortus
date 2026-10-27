// W6.20 · Экранные тесты страницы `repair` «Объекты» на сценарном сервере (MSW repairs W6.00, пресет repairs-ready,
// «сегодня» 20.10.2026): список владельца и прораба (фильтры со счётчиками, поиск, пустые состояния, ошибка), карточка
// по правам (вкладки, «Требует решения», «Деньги»), вкладка «Работы» (отметка прораба с проверками, приёмка объёма,
// допработы), диалог «Назначить прораба?». Эталон: design-2026-10-19, «Ортус CRM.dc.html» :1921–2123, :4429.
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const SLOW = { timeout: 8_000 };

let app: MockApp | undefined;
beforeEach(() => {
  // React Aria Modal диалога зовёт CSS.escape (jsdom его не даёт) — как people.test.tsx W1.23.
  globalThis.CSS ??= {} as typeof CSS;
  globalThis.CSS.escape ??= (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T07:30:00Z'));
});
afterEach(() => {
  app?.close();
  app = undefined;
  vi.useRealTimers();
});

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function open(persona: 'owner' | 'foreman' = 'owner', o: MockAppOptions = {}) {
  app = await renderMockApp(`/t/${ALTA}/repair`, { persona, preset: 'repairs-ready', ...o });
  return app;
}

const filters = () => screen.getByRole('group', { name: 'Фильтр объектов' });
const cards = () => [...document.querySelectorAll<HTMLElement>('.ox-rp-obj')];
const names = () => cards().map((c) => text(c.querySelector('.ox-rp-obj-name')));
const toast = () => document.querySelector('.ox-toast .ox-toast-text')?.textContent;

const listReady = () => screen.findByRole('heading', { level: 1, name: 'Объекты' }, SLOW);
const waitCards = async (n: number) => {
  await waitFor(() => {
    expect(cards()).toHaveLength(n);
  }, SLOW);
};

/** Открывает карточку объекта кликом в списке; возвращает заголовок. */
async function openObject(name: string): Promise<void> {
  await listReady();
  await waitFor(() => {
    expect(names()).toContain(name);
  }, SLOW);
  const card = cards().find((c) => text(c.querySelector('.ox-rp-obj-name')) === name);
  const open = card?.querySelector('button') ?? card;
  if (!open) throw new Error(`нет объекта ${name}`);
  fireEvent.click(open);
  await screen.findByRole('heading', { level: 1, name }, SLOW);
}

const tabNames = () =>
  within(screen.getByRole('tablist', { name: 'Разделы объекта' }))
    .getAllByRole('tab')
    .map((t) => text(t).replace(/\d+$/, '').trim());

const tab = async (label: string) => {
  const t = within(screen.getByRole('tablist', { name: 'Разделы объекта' }))
    .getAllByRole('tab')
    .find((x) => text(x).startsWith(label));
  if (!t) throw new Error(`нет вкладки ${label}`);
  fireEvent.click(t);
};

describe('список объектов владельца', () => {
  it('заголовок, четыре фильтра со счётчиками, сортировка и объекты', async () => {
    await open();
    await listReady();
    await waitCards(4);
    expect(
      within(filters())
        .getAllByRole('button')
        .map((b) => text(b)),
    ).toEqual(['Активные4', 'Требуют решения5', 'До договора1', 'Сданы1']);
    expect(
      within(filters())
        .getByRole('button', { name: /Активные/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(text(document.querySelector('#ox-main'))).toContain('Сначала то, что ждёт решения');
    expect(names()).toEqual([
      'ЖК Северный парк · квартира 117',
      'ЖК Речной · квартира 42',
      'Кофейня на Покровке',
      'Профсоюзная, 64 · квартира 210',
    ]);
    expect(screen.queryByRole('button', { name: 'Отметить работу' })).toBeNull();
    expect(text(cards()[0])).toContain('Прораб: Алексей Соколов');
  });

  it('фильтры «До договора» и «Сданы»', async () => {
    await open();
    await waitCards(4);
    fireEvent.click(within(filters()).getByRole('button', { name: /До договора/ }));
    await waitCards(1);
    expect(text(cards()[0])).toContain('Дом 120 м², Истра');
    expect(text(cards()[0])).toContain('после договора');
    fireEvent.click(within(filters()).getByRole('button', { name: /Сданы/ }));
    await waitFor(() => {
      expect(text(cards()[0])).toContain('Дом на Лесной · Мытищи');
    });
  });

  it('поиск по адресу, заказчику и прорабу; пусто «По фильтру объектов нет»', async () => {
    await open();
    await waitCards(4);
    const search = screen.getByRole('searchbox', { name: 'Поиск по объектам' });
    expect(search.getAttribute('placeholder')).toBe('Адрес, заказчик, прораб');
    fireEvent.change(search, { target: { value: 'Покровка' } });
    await waitCards(1);
    fireEvent.change(search, { target: { value: 'нет такого' } });
    await screen.findByText('По фильтру объектов нет');
    expect(screen.getByText('Измените запрос или очистите поиск.')).toBeTruthy();
    fireEvent.change(search, { target: { value: '' } });
    await waitCards(4);
  });

  it('нет объектов: пустое состояние владельца и прораба', async () => {
    await open('owner', { scenario: 'listRepairProjects=empty' });
    await screen.findByText('Объектов пока нет', {}, SLOW);
    expect(screen.getByText('Объект-черновик создаётся из заявки на этапе «Замер».')).toBeTruthy();
    app?.close();
    await open('foreman', { scenario: 'listRepairProjects=empty' });
    await screen.findByText('Вам пока не назначены объекты', {}, SLOW);
    expect(
      screen.getByText('Объект появится здесь, когда владелец назначит вас прорабом.'),
    ).toBeTruthy();
  });

  it('ошибка чтения: баннер с текстом сервера и «Повторить»', async () => {
    await open('owner', { scenario: 'listRepairProjects=rate_limited' });
    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(text(alert)).toContain(
      'Не удалось загрузить объекты: Слишком много запросов. Подождите и повторите.',
    );
    expect(within(alert).getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });
});

describe('список объектов прораба', () => {
  it('«Объекты, где вы прораб», два фильтра, без поиска, «Отметить работу» на каждой карточке', async () => {
    await open('foreman');
    await listReady();
    await waitCards(3);
    expect(text(document.querySelector('#ox-main'))).toContain('Объекты, где вы прораб');
    expect(
      within(filters())
        .getAllByRole('button')
        .map((b) => text(b)),
    ).toEqual(['Активные3', 'Сданы1']);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Отметить работу' })).toHaveLength(3);
    expect(text(document.querySelector('#ox-main'))).not.toContain('Прораб:');
  });

  it('«Отметить работу» открывает вкладку «Работы» объекта', async () => {
    await open('foreman');
    await waitCards(3);
    fireEvent.click(screen.getAllByRole('button', { name: 'Отметить работу' })[0] as HTMLElement);
    await screen.findByRole('heading', { level: 2, name: 'Отметка за сегодня' }, SLOW);
    expect(app?.router.state.location.search).toMatchObject({ tab: 'works' });
  });
});

describe('карточка объекта по правам', () => {
  it('владелец: шапка, чипы, одиннадцать вкладок, «Требует решения», «Деньги»', async () => {
    await open();
    await openObject('ЖК Северный парк · квартира 117');
    expect(tabNames()).toEqual([
      'Обзор',
      'Работы',
      'Замер',
      'Смета',
      'График',
      'Документы',
      'Снабжение',
      'Финансы',
      'Оплата бригады',
      'Подрядчики',
      'Кабинет заказчика',
    ]);
    expect(text(document.querySelector('.ox-rp-prog'))).toContain('Готовность по объёмам');
    expect(text(document.querySelector('.ox-rp-prog'))).toContain('82%');
    expect(screen.getByRole('heading', { level: 2, name: 'Требует решения' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Деньги' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Кабинет заказчика/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Отметить работу' })).toBeNull();
  });

  it('прораб: без денег и финансовых вкладок, «Мои вопросы по объекту», «Отметить работу»', async () => {
    await open('foreman');
    await waitCards(3);
    const first = cards()[0]?.querySelector('.ox-rp-obj-name');
    fireEvent.click(first as HTMLElement);
    await screen.findByRole('tablist', { name: 'Разделы объекта' }, SLOW);
    expect(tabNames()).not.toContain('Финансы');
    expect(tabNames()).not.toContain('Кабинет заказчика');
    await screen.findByRole('heading', { level: 2, name: 'Мои вопросы по объекту' }, SLOW);
    expect(screen.queryByRole('heading', { level: 2, name: 'Деньги' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Отметить работу' }).length).toBeGreaterThan(0);
  });

  it('вкладка другого WS без реализации — заглушка, а не ошибка', async () => {
    await open();
    await openObject('ЖК Северный парк · квартира 117');
    await tab('Снабжение');
    expect(await screen.findByText('Снабжение: раздел ещё не подключён')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Снабжение/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('деньги: «аванс {pct}%» как в эталоне', async () => {
    await open();
    await openObject('ЖК Северный парк · квартира 117');
    const money = screen.getByRole('heading', { level: 2, name: 'Деньги' }).closest('div')
      ?.parentElement as HTMLElement;
    expect(text(money)).toMatch(/аванс \d+%/);
  });
});

describe('вкладка «Работы»', () => {
  it('владелец: «Объёмы работ», принятие объёма с тостом, допработы без формы', async () => {
    await open();
    await openObject('ЖК Северный парк · квартира 117');
    await tab('Работы');
    await screen.findByRole('heading', { level: 2, name: 'Объёмы работ' }, SLOW);
    expect(screen.queryByRole('heading', { level: 2, name: 'Отметка за сегодня' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Допработы' })).toBeTruthy();
    const accept = await screen.findAllByRole('button', { name: 'Принять объём' }, SLOW);
    fireEvent.click(accept[0] as HTMLElement);
    await waitFor(() => {
      expect(toast()).toBe('Объём принят, материалы списаны');
    }, SLOW);
  });

  it('прораб: форма отметки, «Без материалов», проверка до отправки', async () => {
    await open('foreman');
    await waitCards(3);
    fireEvent.click(screen.getAllByRole('button', { name: 'Отметить работу' })[0] as HTMLElement);
    await screen.findByRole('heading', { level: 2, name: 'Отметка за сегодня' }, SLOW);
    expect(screen.getByRole('option', { name: 'Без материалов' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Добавить фото' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Принять объём' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Отправить отметку на приёмку' }));
    const alert = await screen.findByRole('alert');
    expect(text(alert).length).toBeGreaterThan(0);
    expect(
      app?.responses().filter((r) => r.method === 'POST' && r.path.endsWith('/work-logs')),
    ).toHaveLength(0);
  });

  it('прораб: допработа без описания не уходит в офис', async () => {
    await open('foreman');
    await waitCards(3);
    fireEvent.click(screen.getAllByRole('button', { name: 'Отметить работу' })[0] as HTMLElement);
    await screen.findByRole('heading', { level: 2, name: 'Допработы' }, SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Отправить на оценку в офис' }));
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(
      app?.responses().filter((r) => r.method === 'POST' && r.path.endsWith('/changes')),
    ).toHaveLength(0);
  });
});

describe('диалог «Назначить прораба?»', () => {
  it('«Что произойдёт», «Назначить» и тост «Прораб назначен: …»', async () => {
    await open();
    await openObject('Кофейня на Покровке');
    fireEvent.click(await screen.findByRole('button', { name: 'Назначить прораба' }, SLOW));
    const dialog = await screen.findByRole('dialog', {}, SLOW);
    expect(within(dialog).getByText('Назначить прораба?')).toBeTruthy();
    // Иконка шапки по эталону assignForeman («Ортус CRM.dc.html» :4429) — engineering.
    const icons = Array.from(dialog.querySelectorAll('.material-symbols-rounded')).map(
      (e) => e.textContent,
    );
    expect(icons[0]).toBe('engineering');
    expect(within(dialog).getByText('Что произойдёт')).toBeTruthy();
    expect(within(dialog).getByText('Смета, цены и деньги объекта прорабу не видны')).toBeTruthy();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Назначить' }, SLOW));
    await waitFor(() => {
      expect(toast()).toMatch(/^Прораб назначен: /);
    }, SLOW);
  });

  it('«Нет сотрудника с ролью «Прораб»»: после Escape фокус возвращается на «Назначить прораба»', async () => {
    // listMembers=empty — кандидатов нет, диалог меняется на «Нет сотрудника…» после загрузки.
    await open('owner', { scenario: 'listMembers=empty' });
    await openObject('Кофейня на Покровке');
    const trigger = await screen.findByRole('button', { name: 'Назначить прораба' }, SLOW);
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole(
      'dialog',
      { name: 'Нет сотрудника с ролью «Прораб»' },
      SLOW,
    );
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    }, SLOW);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Назначить прораба' }),
      );
    }, SLOW);
  });
});
