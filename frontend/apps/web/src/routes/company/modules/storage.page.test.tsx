// W1.24 · Экранные тесты «Хранилища» (S1-22, no-reference B-6 №5): занято / резерв / лимит, разбивка по группам
// эталона и модулям, расчёт смены лимита (quote → commit), отказ ниже занятого, заполнено, ожидающее уменьшение.
import { seedUuid } from '@ortus/domain/seed';
import { errors } from '@ortus/texts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const GiB = 1024 ** 3;

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

/** Ленивая страница при параллельном прогоне пакетов грузится дольше 1 с по умолчанию findBy*. */
const SLOW = { timeout: 5_000 };

const open = async (o: Parameters<typeof renderMockApp>[1] = {}) => {
  app = await renderMockApp(`/t/${ALTA}/storage`, { persona: 'owner', ...o });
  await screen.findByRole('heading', { level: 1, name: 'Хранилище' }, SLOW);
  await screen.findByRole('meter', { name: 'Занятое место' }, SLOW);
  return app;
};

/** Страница «Хранилище» (без оболочки). */
const pageEl = (): HTMLElement => el('.ox-st');

const el = (sel: string): HTMLElement => {
  const e = document.querySelector<HTMLElement>(sel);
  if (!e) throw new Error(`нет ${sel}`);
  return e;
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

describe('«Хранилище»', () => {
  it('крошка, занято 46,2 ГБ из 100 ГБ, резерв, meter', async () => {
    await open();
    expect(screen.getByText('Альта Групп / Компания')).toBeTruthy();
    const usage = el('.ox-st-usage');
    expect(usage.textContent).toContain('46,2 ГБ из 100 ГБ');
    expect(usage.textContent).toContain('Резерв начатых загрузок: 0 ГБ');
    expect(screen.getByRole('meter', { name: 'Занятое место' }).getAttribute('aria-valuenow')).toBe(
      '46.2',
    );
  });

  it('разбивка по видам файлов (группы эталона, число файлов) и по модулям', async () => {
    await open();
    await waitFor(() => expect(el('.ox-st-groups').querySelectorAll('.ox-st-row')).toHaveLength(4));
    const groups = [...el('.ox-st-groups').querySelectorAll('.ox-st-row')].map(
      (r) => r.textContent,
    );
    expect(groups[0]).toMatch(/^Фото осмотров и отчётов1\s840 файлов31,4 ГБ$/);
    expect(groups[3]).toMatch(/^Прочее0 файлов1,9 ГБ$/);
    const modules = [...el('.ox-st-modules').querySelectorAll('.ox-st-row')].map(
      (r) => r.querySelector('.ox-st-label')?.textContent,
    );
    expect(modules).toEqual(['Логистика', 'Файлы', 'Задачи', 'База данных и служебные данные']);
  });

  it('смена лимита: расчёт с ценой, «Применить» — тост, место и /me/context перечитаны', async () => {
    const a = await open();
    fireEvent.change(screen.getByLabelText('Новый лимит'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Рассчитать' }));
    const quote = await waitFor(() => el('.ox-st-quote'));
    expect(quote.textContent).toMatch(/Лимит 250 ГБ · 2\s500 ₽ в месяц/);
    const since = a.responses().length;
    fireEvent.click(within(quote).getByRole('button', { name: 'Применить' }));
    await waitFor(() => expect(toast()?.textContent).toBe('Лимит места: 250 ГБ'));
    await waitFor(() => expect(el('.ox-st-usage').textContent).toContain('из 250 ГБ'));
    expect(document.querySelector('.ox-st-quote')).toBeNull();
    await waitFor(() =>
      expect(
        a
          .responses()
          .slice(since)
          .some((r) => r.method === 'GET' && r.path === '/api/v1/me/context'),
      ).toBe(true),
    );
  });

  it('лимит меньше занятого: текст отказа в карточке, без тоста', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Новый лимит'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Рассчитать' }));
    await waitFor(() =>
      expect(within(el('.ox-st-change')).getByRole('alert').textContent).toBe(
        'Новый лимит меньше занятого места. Освободите место или выберите лимит больше.',
      ),
    );
    expect(toast()).toBeNull();
  });

  it('место заполнено: alert и полоса danger', async () => {
    await open({ preset: 'storage-full' });
    await waitFor(() =>
      expect(within(el('.ox-st-usage')).getByRole('alert').textContent).toContain(
        'Новые загрузки заблокированы, файлы не удалены.',
      ),
    );
    expect(el('.ox-st-usage .ox-mod-bar-fill').getAttribute('data-tone')).toBe('danger');
  });

  it('ожидающее уменьшение и резерв начатых загрузок', async () => {
    await open({
      setup: (s) => {
        const t = s.state().tenants.find((x) => x.id === ALTA);
        if (!t) throw new Error('нет «Альты»');
        t.storage.reservedBytes = 2 * GiB;
        t.storage.pendingQuotaBytes = 50 * GiB;
        t.storage.pendingEffectiveAt = '2026-11-01T00:00:00Z';
      },
    });
    const usage = el('.ox-st-usage');
    expect(usage.textContent).toContain('Резерв начатых загрузок: 2 ГБ');
    expect(usage.textContent).toContain('Запрошено уменьшение до 50 ГБ с 01.11.2026');
  });

  it('больше 85 %: полоса warn, без alert', async () => {
    await open({
      setup: (s) => {
        const t = s.state().tenants.find((x) => x.id === ALTA);
        if (!t) throw new Error('нет «Альты»');
        t.storage.committedBytes = 90 * GiB;
      },
    });
    expect(el('.ox-st-usage .ox-mod-bar-fill').getAttribute('data-tone')).toBe('warn');
    expect(within(el('.ox-st-usage')).queryByRole('alert')).toBeNull();
  });

  it('организация ограничена (trial-ended): «Рассчитать» недоступна и при другом лимите', async () => {
    await open({ preset: 'trial-ended' });
    fireEvent.change(screen.getByLabelText('Новый лимит'), { target: { value: '250' } });
    expect(screen.getByRole('button', { name: 'Рассчитать' })).toHaveProperty('disabled', true);
  });
});

describe('«Хранилище»: загрузка, ошибка, офлайн', () => {
  it('загрузка: скелетон «Загрузка»', async () => {
    app = await renderMockApp(`/t/${ALTA}/storage`, {
      persona: 'owner',
      scenario: 'getStorageUsage=loading',
    });
    expect(await screen.findByRole('status', { name: 'Загрузка' }, SLOW)).toBeTruthy();
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('ошибка getStorageUsage: заголовок, alert по коду и «Повторить»', async () => {
    const a = await renderMockApp(`/t/${ALTA}/storage`, {
      persona: 'owner',
      scenario: 'getStorageUsage=rate_limited',
    });
    app = a;
    await screen.findByRole('heading', { level: 1, name: 'Хранилище' }, SLOW);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    a.scenario.setScenario('');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('meter', { name: 'Занятое место' })).toBeTruthy();
  });

  it('ошибка getStorageBreakdown: место есть, вместо разбивки alert и «Повторить»', async () => {
    const a = await renderMockApp(`/t/${ALTA}/storage`, {
      persona: 'owner',
      scenario: 'getStorageBreakdown=rate_limited',
    });
    app = a;
    await screen.findByRole('meter', { name: 'Занятое место' }, SLOW);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    // Строк разбивки нет; заголовок блока остаётся, alert и «Повторить» — в блоке (возврат 1 доделки №2).
    expect(document.querySelectorAll('.ox-st-row')).toHaveLength(0);
    a.scenario.setScenario('');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(el('.ox-st-groups').querySelectorAll('.ox-st-row')).toHaveLength(4));
  });

  it('офлайн на «Рассчитать»: тост «Нет связи…», расчёта нет, фокус на «Рассчитать»', async () => {
    const a = await open();
    a.scenario.setScenario('requestStorageChange=offline');
    fireEvent.change(screen.getByLabelText('Новый лимит'), { target: { value: '250' } });
    const btn = screen.getByRole('button', { name: 'Рассчитать' });
    btn.focus();
    fireEvent.click(btn);
    // Браузер снимает фокус с кнопки, ставшей недоступной на время команды.
    loseFocus();
    await waitFor(() => expect(toast()?.textContent).toBe(errors.client.offline));
    expect(document.querySelector('.ox-st-quote')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(btn));
  });

  it('офлайн на «Применить»: тост «Нет связи…», расчёт остаётся, фокус на «Применить»', async () => {
    const a = await open();
    fireEvent.change(screen.getByLabelText('Новый лимит'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Рассчитать' }));
    const quote = await waitFor(() => el('.ox-st-quote'));
    a.scenario.setScenario('requestStorageChange=offline');
    const apply = within(quote).getByRole('button', { name: 'Применить' });
    apply.focus();
    fireEvent.click(apply);
    loseFocus();
    await waitFor(() => expect(toast()?.textContent).toBe(errors.client.offline));
    expect(el('.ox-st-usage').textContent).toContain('из 100 ГБ');
    expect(document.querySelector('.ox-st-quote')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(apply));
  });
});

describe('«Хранилище»: загрузка и повтор (возврат 16.10 №3)', () => {
  it('загрузка места: заголовок страницы и свой скелетон, без подписи оболочки «Загружаем рабочее пространство…»', async () => {
    app = await renderMockApp(`/t/${ALTA}/storage`, {
      persona: 'owner',
      scenario: 'getStorageUsage=loading',
    });
    await screen.findByRole('heading', { level: 1, name: 'Хранилище' }, SLOW);
    const status = await within(pageEl()).findByRole('status', { name: 'Загрузка' });
    expect(status).toBeTruthy();
    expect(pageEl().textContent).not.toContain('Загружаем рабочее пространство…');
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('разбивка грузится: блоки «По видам файлов» и «По модулям» уже на месте (aria-busy)', async () => {
    await open({ scenario: 'getStorageBreakdown=loading' });
    const grid = el('.ox-st-grid');
    expect(grid.getAttribute('aria-busy')).toBe('true');
    expect(grid.textContent).toContain('По видам файлов');
    expect(grid.textContent).toContain('По модулям');
    // Форма смены лимита — после блока разбивки, как в загруженном состоянии.
    const change = el('.ox-st-change');
    expect(grid.compareDocumentPosition(change) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('ошибка места, «Повторить»: после загрузки фокус на заголовке страницы, а не на body', async () => {
    const a = await renderMockApp(`/t/${ALTA}/storage`, {
      persona: 'owner',
      scenario: 'getStorageUsage=rate_limited',
    });
    app = a;
    await screen.findByRole('alert', {}, SLOW);
    a.scenario.setScenario('');
    const retry = screen.getByRole('button', { name: 'Повторить' });
    retry.focus();
    fireEvent.click(retry);
    await screen.findByRole('meter', { name: 'Занятое место' }, SLOW);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 1, name: 'Хранилище' }),
      ),
    );
  });

  it('ошибка разбивки: заголовок «По видам файлов» на месте, alert в блоке, «Повторить» описан заголовком', async () => {
    await open({ scenario: 'getStorageBreakdown=rate_limited' });
    const alert = await screen.findByRole('alert', {}, SLOW);
    const block = el('.ox-st-groups');
    expect(block.contains(alert)).toBe(true);
    expect(within(block).getByRole('heading', { level: 2, name: 'По видам файлов' })).toBeTruthy();
    const retry = within(block).getByRole('button', { name: 'Повторить' });
    const by = retry.getAttribute('aria-describedby') ?? '';
    expect(by).not.toBe('');
    expect(document.getElementById(by)?.textContent).toBe('По видам файлов');
  });

  it('ошибка разбивки, «Повторить»: после загрузки фокус на «По видам файлов», а не на body', async () => {
    const a = await open({ scenario: 'getStorageBreakdown=rate_limited' });
    await screen.findByRole('alert', {}, SLOW);
    a.scenario.setScenario('');
    const retry = screen.getByRole('button', { name: 'Повторить' });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(el('.ox-st-groups').querySelectorAll('.ox-st-row')).toHaveLength(4));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 2, name: 'По видам файлов' }),
      ),
    );
  });

  it('расчёт истёк: «Применить» — тост, расчёт убран, фокус на «Рассчитать» для нового расчёта', async () => {
    const a = await open();
    fireEvent.change(screen.getByLabelText('Новый лимит'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Рассчитать' }));
    const quote = await waitFor(() => el('.ox-st-quote'));
    const t = a.scenario.state().tenants.find((x) => x.id === ALTA);
    if (!t) throw new Error('нет «Альты»');
    for (const c of t.storageChanges) c.quoteExpiresAt = '2000-01-01T00:00:00Z';
    const apply = within(quote).getByRole('button', { name: 'Применить' });
    apply.focus();
    fireEvent.click(apply);
    loseFocus();
    await waitFor(() => expect(toast()).not.toBeNull());
    await waitFor(() => expect(document.querySelector('.ox-st-quote')).toBeNull());
    const calc = screen.getByRole('button', { name: 'Рассчитать' });
    expect(calc).toHaveProperty('disabled', false);
    await waitFor(() => expect(document.activeElement).toBe(calc));
    expect(el('.ox-st-usage').textContent).toContain('из 100 ГБ');
  });
});

describe('«Хранилище»: фокус после команд', () => {
  it('после «Рассчитать» фокус на блоке расчёта, после «Применить» — на «Новый лимит»', async () => {
    await open();
    const select = screen.getByLabelText('Новый лимит');
    fireEvent.change(select, { target: { value: '250' } });
    const btn = screen.getByRole('button', { name: 'Рассчитать' });
    btn.focus();
    fireEvent.click(btn);
    loseFocus();
    const quote = await waitFor(() => el('.ox-st-quote'));
    await waitFor(() => expect(document.activeElement).toBe(quote));
    const apply = within(quote).getByRole('button', { name: 'Применить' });
    apply.focus();
    fireEvent.click(apply);
    await waitFor(() => expect(toast()?.textContent).toBe('Лимит места: 250 ГБ'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Новый лимит')));
  });
});
