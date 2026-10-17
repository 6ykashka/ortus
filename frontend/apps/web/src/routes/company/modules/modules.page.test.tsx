// W1.24 · Экранные тесты «Модули и место» на MSW-сценарном сервере (сид W0.12; эталон design-stage-1
// :205–281; 02-company.md §5, §10 #1–14; решения брифа §10).
import { seedUuid } from '@ortus/domain/seed';
import { errors } from '@ortus/texts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const LOTOS = seedUuid('platform', 't-lotos');

let app: MockApp | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T07:30:00Z'));
});
afterEach(() => {
  app?.close();
  app = undefined;
  vi.useRealTimers();
});

/** Ленивая страница и каталог при параллельном прогоне пакетов грузятся дольше 1 с по умолчанию findBy*. */
const SLOW = { timeout: 5_000 };

const open = async (o: Parameters<typeof renderMockApp>[1] = {}, tenant = ALTA) => {
  app = await renderMockApp(`/t/${tenant}/modules`, { persona: 'owner', ...o });
  await screen.findByRole('heading', { level: 1, name: 'Модули и место' }, SLOW);
  await screen.findAllByRole('article', {}, SLOW);
  return app;
};

const card = (name: string) =>
  screen
    .getAllByRole('article', { hidden: true })
    .find((a) => within(a).queryByRole('heading', { level: 3, name, hidden: true }));

const cardOf = (name: string): HTMLElement => {
  const c = card(name);
  if (!c) throw new Error(`нет карточки «${name}»`);
  return c;
};

const toast = () => document.querySelector('.ox-toast .ox-toast-text');

/** Как браузер: фокус уходит на body (кнопка стала недоступной на время команды). В jsdom blur() недоступной
 * кнопки ничего не делает — фокус ставится на временное поле, которое затем удаляется. */
const loseFocus = (): void => {
  const tmp = document.createElement('input');
  document.body.append(tmp);
  tmp.focus();
  tmp.remove();
};
const dialog = () => screen.getByRole('dialog');
const after = (a: MockApp, method: string, path: string, since: number) =>
  a
    .responses()
    .slice(since)
    .some((r) => r.method === method && r.path === path);

describe('«Модули и место»: обычное состояние', () => {
  it('крошка, заголовок, абзац; карточка пробного периода без демо-кнопки', async () => {
    await open();
    expect(screen.getByText('Альта Групп / Компания')).toBeTruthy();
    expect(
      screen.getByText(
        'Подключение модуля открывает его организации. Сотрудники получают доступ только через роли и области.',
      ),
    ).toBeTruthy();
    const status = document.querySelector('.ox-mod-status') as HTMLElement;
    expect(status.textContent).toContain('Осталось 12 дней · до 13.10.2026');
    expect(status.textContent).toContain('Пробный период');
    expect(screen.queryByRole('button', { name: 'Демо: завершить пробный период' })).toBeNull();
  });

  it('отраслевые модули по каталогу: чипы, кнопки, зависимости, сотрудники с ролями', async () => {
    await open();
    expect(screen.getAllByRole('article')).toHaveLength(3);
    const fleet = cardOf('Логистика');
    expect(fleet.textContent).toContain('Не подключён');
    expect(within(fleet).getByRole('button', { name: 'Подключить' })).toBeTruthy();
    expect([...fleet.querySelectorAll('.ox-mod-dep-name')].map((d) => d.textContent)).toEqual([
      'Календарь',
      'Файлы',
      'Формы',
    ]);
    await waitFor(() =>
      expect(fleet.textContent).toContain(
        'Роли с правами модуля есть у: 1 сотрудник. Они заработают после подключения',
      ),
    );
    const spa = cardOf('Салон и SPA');
    expect(spa.textContent).toContain('Подключён');
    expect(within(spa).getByRole('button', { name: 'Отключить' })).toBeTruthy();
    expect(cardOf('Ремонт и стройка').textContent).toContain('Не подключён');
  });

  it('базовые модули: 12 плиток, «Использует: Салон и SPA»', async () => {
    await open();
    const tiles = [...document.querySelectorAll('.ox-mod-core')];
    expect(tiles).toHaveLength(12);
    const by = (name: string) => {
      const tile = tiles.find((t) => t.querySelector('.ox-mod-core-name')?.textContent === name);
      return tile?.querySelector('.ox-mod-core-used')?.textContent;
    };
    expect(by('Календарь')).toBe('Использует: Салон и SPA');
    expect(by('Задачи')).toBe('Общий модуль ядра');
  });

  it('место организации: 46,2 ГБ из 100 ГБ, meter, разбивка, «Изменить лимит» недоступна', async () => {
    await open();
    const meter = await screen.findByRole('meter', { name: 'Занятое место' });
    expect(meter.getAttribute('aria-valuenow')).toBe('46.2');
    expect(meter.getAttribute('aria-valuemax')).toBe('100');
    const st = document.querySelector('.ox-mod-storage') as HTMLElement;
    expect(st.textContent).toContain('46,2 ГБ из 100 ГБ');
    await waitFor(() => expect(st.querySelectorAll('.ox-mod-break')).toHaveLength(4));
    expect(st.querySelector('.ox-mod-break')?.textContent).toBe('Фото осмотров и отчётов31,4 ГБ');
    expect((screen.getByLabelText('Лимит места') as HTMLSelectElement).value).toBe('100');
    expect(screen.getByRole('button', { name: 'Изменить лимит' })).toHaveProperty('disabled', true);
    expect(within(st).getByRole('link', { name: 'Хранилище' }).getAttribute('href')).toBe(
      `/t/${ALTA}/storage`,
    );
  });
});

describe('подключение и отключение модуля', () => {
  it('подключить «Логистику»: диалог, тост, чип, /me/context перечитан', async () => {
    const a = await open();
    fireEvent.click(within(cardOf('Логистика')).getByRole('button', { name: 'Подключить' }));
    const d = await screen.findByRole('dialog');
    expect(within(d).getByRole('heading', { name: 'Подключить «Логистика»?' })).toBeTruthy();
    expect(d.textContent).toContain('Рабочее место логиста');
    expect(d.textContent).toContain('Календарь — уже включён');
    const since = a.responses().length;
    fireEvent.click(within(d).getByRole('button', { name: 'Подключить' }));
    await waitFor(() => expect(toast()?.textContent).toBe('Модуль «Логистика» подключён'));
    await waitFor(() => expect(cardOf('Логистика').textContent).toContain('Подключён'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      within(cardOf('Логистика')).getByRole('button', { name: 'Назначить роли' }),
    ).toBeTruthy();
    expect(after(a, 'PUT', `/api/v1/tenants/${ALTA}/modules/fleet`, since)).toBe(true);
    await waitFor(() => expect(after(a, 'GET', '/api/v1/me/context', since)).toBe(true));
  });

  it('отключить «Салон и SPA»: «Активных процессов нет», флажок, тост, «Отключён · только чтение»', async () => {
    await open();
    fireEvent.click(within(cardOf('Салон и SPA')).getByRole('button', { name: 'Отключить' }));
    const d = await screen.findByRole('dialog');
    expect(within(d).getByRole('heading', { name: 'Отключить «Салон и SPA»?' })).toBeTruthy();
    expect(d.textContent).toContain('Активных процессов нет');
    expect(d.textContent).toContain('Новые записи, визиты и списания будут закрыты');
    const confirm = within(d).getByRole('button', { name: 'Отключить модуль' });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.click(
      within(d).getByRole('checkbox', { name: 'Понимаю последствия для текущей работы' }),
    );
    await waitFor(() => expect(confirm).toHaveProperty('disabled', false));
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(toast()?.textContent).toBe('Модуль отключён. История доступна для чтения'),
    );
    await waitFor(() =>
      expect(cardOf('Салон и SPA').textContent).toContain('Отключён · только чтение'),
    );
    expect(within(cardOf('Салон и SPA')).getByRole('button', { name: 'Подключить' })).toBeTruthy();
  });

  it('нет связи: тост «Нет связи с сервером…», диалог открыт, чип прежний', async () => {
    await open({ scenario: 'setModuleInstallation=offline' });
    fireEvent.click(within(cardOf('Логистика')).getByRole('button', { name: 'Подключить' }));
    const d = await screen.findByRole('dialog');
    fireEvent.click(within(d).getByRole('button', { name: 'Подключить' }));
    await waitFor(() => expect(toast()?.textContent).toBe(errors.client.offline));
    expect(dialog()).toBeTruthy();
    expect(cardOf('Логистика').textContent).toContain('Не подключён');
  });

  it('нет связи: после отказа фокус возвращается в диалог, Tab с body остаётся в диалоге', async () => {
    await open({ scenario: 'setModuleInstallation=offline' });
    fireEvent.click(within(cardOf('Логистика')).getByRole('button', { name: 'Подключить' }));
    const d = await screen.findByRole('dialog');
    const ok = within(d).getByRole('button', { name: 'Подключить' });
    ok.focus();
    fireEvent.click(ok);
    // Браузер снимает фокус с кнопки, ставшей недоступной на время команды («Выполняем…»).
    loseFocus();
    await waitFor(() => expect(toast()?.textContent).toBe(errors.client.offline));
    await waitFor(() => expect(d.contains(document.activeElement)).toBe(true));
    loseFocus();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(d.contains(document.activeElement)).toBe(true);
  });

  it('во время команды «Отмена» недоступна, как Escape и подложка: диалог не закрывается до ответа', async () => {
    await open({ scenario: 'setModuleInstallation=delay=400' });
    fireEvent.click(within(cardOf('Логистика')).getByRole('button', { name: 'Подключить' }));
    const d = await screen.findByRole('dialog');
    fireEvent.click(within(d).getByRole('button', { name: 'Подключить' }));
    await waitFor(() => expect(within(d).getByRole('button', { name: 'Выполняем…' })).toBeTruthy());
    const cancel = within(d).getByRole('button', { name: 'Отмена' });
    expect(cancel).toHaveProperty('disabled', true);
    fireEvent.click(cancel);
    expect(screen.getByRole('dialog')).toBe(d);
    await waitFor(() => expect(toast()?.textContent).toBe('Модуль «Логистика» подключён'));
  });

  it('«Назначить роли» ведёт в «Пользователи и роли»', async () => {
    const a = await open({ preset: 'logistics-ready' });
    fireEvent.click(within(cardOf('Логистика')).getByRole('button', { name: 'Назначить роли' }));
    await waitFor(() => expect(a.path()).toBe(`/t/${ALTA}/users`));
  });
});

describe('лимит места', () => {
  it('250 ГБ: «Изменить лимит на 250 ГБ?», расчёт и подтверждение, тост, место и /me/context перечитаны', async () => {
    const a = await open();
    fireEvent.change(screen.getByLabelText('Лимит места'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Изменить лимит' }));
    const d = await screen.findByRole('dialog');
    expect(within(d).getByRole('heading', { name: 'Изменить лимит на 250 ГБ?' })).toBeTruthy();
    expect(within(d).queryByRole('checkbox')).toBeNull();
    const since = a.responses().length;
    fireEvent.click(within(d).getByRole('button', { name: 'Изменить' }));
    await waitFor(() => expect(toast()?.textContent).toBe('Лимит места: 250 ГБ'));
    await waitFor(() =>
      expect(
        screen.getByRole('meter', { name: 'Занятое место' }).getAttribute('aria-valuemax'),
      ).toBe('250'),
    );
    const posts = a
      .responses()
      .slice(since)
      .filter((r) => r.method === 'POST' && r.path.endsWith('/storage/changes'));
    expect(posts.map((r) => r.status)).toEqual([201, 201]);
    await waitFor(() => expect(after(a, 'GET', '/api/v1/me/context', since)).toBe(true));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('250 ГБ без секций и флажка: контейнер секций эталона на месте (пустой, ещё один gap перед подвалом, :2185)', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Лимит места'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Изменить лимит' }));
    const d = await screen.findByRole('dialog');
    const body = d.querySelector('.ox-confirm') as HTMLElement;
    // Порядок детей, как в эталоне: шапка, контейнер секций (всегда, даже при sections: []), подвал.
    expect([...body.children].map((c) => c.className)).toEqual([
      'ox-confirm-head',
      'ox-confirm-scroll',
      'ox-confirm-foot',
    ]);
    expect(body.querySelector('.ox-confirm-scroll')?.children).toHaveLength(0);
  });

  it('после смены лимита «Изменить лимит» недоступна — фокус на «Лимит места», а не на body (PD-29)', async () => {
    await open();
    const select = screen.getByLabelText('Лимит места');
    fireEvent.change(select, { target: { value: '250' } });
    const apply = screen.getByRole('button', { name: 'Изменить лимит' });
    apply.focus();
    fireEvent.click(apply);
    const d = await screen.findByRole('dialog');
    fireEvent.click(within(d).getByRole('button', { name: 'Изменить' }));
    await waitFor(() => expect(toast()?.textContent).toBe('Лимит места: 250 ГБ'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Изменить лимит' })).toHaveProperty('disabled', true);
    expect(document.activeElement).toBe(screen.getByLabelText('Лимит места'));
  });

  it('25 ГБ меньше занятого: диалог эталона, 409 — тост по коду, диалог открыт', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Лимит места'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Изменить лимит' }));
    const d = await screen.findByRole('dialog');
    expect(d.textContent).toContain('Занято 46,2 ГБ, новый лимит 25 ГБ. Не хватает 21,2 ГБ.');
    fireEvent.click(
      within(d).getByRole('checkbox', { name: 'Понимаю: новые загрузки будут недоступны' }),
    );
    fireEvent.click(within(d).getByRole('button', { name: 'Всё равно применить' }));
    // Запрос идёт через расчёт и MSW: при параллельном прогоне каталога дольше 1 с по умолчанию waitFor.
    await waitFor(
      () =>
        expect(toast()?.textContent).toBe(
          'Новый лимит меньше занятого места. Освободите место или выберите лимит больше.',
        ),
      SLOW,
    );
    expect(dialog()).toBeTruthy();
    // Кнопка подтверждения на время команды недоступна — фокус уходит из диалога; Escape всё равно закрывает.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('место заполнено: alert «Занято больше лимита…» в карточке', async () => {
    await open({ preset: 'storage-full' });
    const st = document.querySelector('.ox-mod-storage') as HTMLElement;
    await waitFor(() =>
      expect(within(st).getByRole('alert').textContent).toContain(
        'Новые загрузки заблокированы, файлы не удалены.',
      ),
    );
    expect(st.querySelector('.ox-mod-bar-fill')?.getAttribute('data-tone')).toBe('danger');
  });
});

describe('ограничения и другие организации', () => {
  it('пробный период завершён: «Ограничен», «Подключить» и «Изменить лимит» недоступны', async () => {
    await open({ preset: 'trial-ended' });
    const status = document.querySelector('.ox-mod-status') as HTMLElement;
    expect(status.textContent).toContain('Пробный период завершён');
    expect(status.textContent).toContain('Ограничен');
    expect(within(cardOf('Логистика')).getByRole('button', { name: 'Подключить' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.change(screen.getByLabelText('Лимит места'), { target: { value: '250' } });
    expect(screen.getByRole('button', { name: 'Изменить лимит' })).toHaveProperty('disabled', true);
  });

  it('«Лотос»: «Подписка действует», 12,4 ГБ из 50 ГБ', async () => {
    await open({ persona: 'owner@t-lotos' }, LOTOS);
    expect(screen.getByText('SPA «Лотос» / Компания')).toBeTruthy();
    expect(document.querySelector('.ox-mod-status')?.textContent).toContain('Подписка действует');
    await waitFor(() =>
      expect(document.querySelector('.ox-mod-storage')?.textContent).toContain('12,4 ГБ из 50 ГБ'),
    );
    // Эталон у «Лотоса» — «Фото работ и техкарты» (mock-data.js :60), у «Альты» — «Фото осмотров и отчётов».
    // Контракт отдаёт только ключ группы `photos` без подписи и без отрасли организации: подпись одна,
    // расхождение — allowlist/modules.md (Q-W1.24-16) до решения стюарда контракта.
    const photos = document.querySelector('.ox-mod-break .ox-mod-break-label');
    expect(photos?.textContent).toBe('Фото осмотров и отчётов');
  });

  it('ошибка каталога: заголовок и alert с текстом кода', async () => {
    app = await renderMockApp(`/t/${ALTA}/modules`, {
      persona: 'owner',
      scenario: 'listModuleCatalog=rate_limited',
    });
    await screen.findByRole('heading', { level: 1, name: 'Модули и место' }, SLOW);
    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(alert.textContent).toBe(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
  });
});

describe('«Модули и место»: загрузка, ошибки, фокус (возврат 16.10 №3)', () => {
  const section = (): HTMLElement => document.querySelector('.ox-mod') as HTMLElement;

  it('загрузка каталога: заголовок и свой скелетон, без подписи оболочки «Загружаем рабочее пространство…»', async () => {
    app = await renderMockApp(`/t/${ALTA}/modules`, {
      persona: 'owner',
      scenario: 'listModuleCatalog=loading',
    });
    await screen.findByRole('heading', { level: 1, name: 'Модули и место' }, SLOW);
    expect(await within(section()).findByRole('status', { name: 'Загрузка' })).toBeTruthy();
    expect(section().textContent).not.toContain('Загружаем рабочее пространство…');
  });

  it('место грузится: карточка «Место организации» уже на месте (aria-busy)', async () => {
    await open({ scenario: 'getStorageUsage=loading' });
    const st = document.querySelector<HTMLElement>('.ox-mod-storage');
    expect(st).not.toBeNull();
    expect(st?.getAttribute('aria-busy')).toBe('true');
    expect(st?.textContent).toContain('Место организации');
  });

  it('разбивка грузится: место строк разбивки занято (aria-busy)', async () => {
    await open({ scenario: 'getStorageBreakdown=loading' });
    await screen.findByRole('meter', { name: 'Занятое место' }, SLOW);
    const breaks = document.querySelector<HTMLElement>('.ox-mod-storage .ox-mod-breaks');
    expect(breaks).not.toBeNull();
    expect(breaks?.getAttribute('aria-busy')).toBe('true');
  });

  it('ошибка разбивки: в карточке места alert по коду и «Повторить», а не пропавшие строки', async () => {
    const a = await open({ scenario: 'getStorageBreakdown=rate_limited' });
    await screen.findByRole('meter', { name: 'Занятое место' }, SLOW);
    const st = document.querySelector('.ox-mod-storage') as HTMLElement;
    const alert = await within(st).findByRole('alert', {}, SLOW);
    expect(alert.textContent).toBe(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    a.scenario.setScenario('');
    fireEvent.click(within(st).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(st.querySelectorAll('.ox-mod-break')).toHaveLength(4));
  });

  it('ошибка каталога, «Повторить»: после загрузки фокус на заголовке страницы, а не на body', async () => {
    const a = await renderMockApp(`/t/${ALTA}/modules`, {
      persona: 'owner',
      scenario: 'listModuleCatalog=rate_limited',
    });
    app = a;
    await screen.findByRole('alert', {}, SLOW);
    a.scenario.setScenario('');
    const retry = screen.getByRole('button', { name: 'Повторить' });
    retry.focus();
    fireEvent.click(retry);
    await screen.findAllByRole('article', {}, SLOW);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 1, name: 'Модули и место' }),
      ),
    );
  });
});
