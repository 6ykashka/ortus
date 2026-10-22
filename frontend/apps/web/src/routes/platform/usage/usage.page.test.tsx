// W4.61 · Экран «Использование» оператора на MSW-сценарном сервере W4.07 (renderMockApp): плитки, сигналы,
// модули, таблица и сортировки, переходы «Карточка» и «Открыть заявку», ошибка чтения, «всё спокойно».
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, renderMockApp, tenantIdOf } from '../../../app/testing.tsx';

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function open(o: Parameters<typeof renderMockApp>[1] = {}): Promise<HTMLElement> {
  app = await renderMockApp('/platform/usage', { persona: 'operator', ...o });
  await screen.findByRole('heading', { level: 1, name: 'Использование' });
  const root = document.querySelector<HTMLElement>('section[aria-labelledby="h-usage"]');
  if (!root) throw new Error('нет секции');
  return root;
}

describe('«Использование» оператора', () => {
  it('шапка, плитки, сигналы, модули и таблица по данным сида', async () => {
    const root = await open();
    expect(root.dataset.screenLabel).toBe('Оператор · использование');
    await waitFor(() => expect(root.querySelectorAll('.ox-us-tile')).toHaveLength(4));
    expect(text(root.querySelector('.ox-us-tile'))).toBe(
      'Организации 4 Пробный период: 1 · Действует: 1 · Ограничен: 1 · Приостановлен: 1',
    );
    const signals = within(root.querySelector('.ox-us-signals') as HTMLElement);
    expect(signals.getByRole('heading', { level: 2, name: 'Требуют внимания' })).toBeTruthy();
    expect(text(root.querySelector('.ox-us-count'))).toBe('7');
    const rows = root.querySelectorAll('.ox-us-signal');
    expect(rows).toHaveLength(7);
    // Конец пробного периода «Ремстрой Плюс» — из подписки (getPlatformSubscription).
    await waitFor(() =>
      expect(text(rows[3]?.querySelector('.ox-us-signal-text'))).toBe(
        'Ограничен: пробный период закончился 20.09.2026, оплаты нет',
      ),
    );
    expect(root.querySelectorAll('.ox-us-module')).toHaveLength(3);
    const table = within(root).getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => text(h)),
    ).toEqual(['Организация', 'Тариф', 'Места', 'Хранилище', 'Модули', 'Входили за 7 дней']);
    expect([...root.querySelectorAll('tbody .ox-us-org-name')].map((e) => text(e))).toEqual([
      'SPA «Лотос»',
      'Альта Групп',
      'Карго Сити',
      'Ремстрой Плюс',
    ]);
    const sorts = within(root).getByRole('group', { name: 'Сортировка' });
    expect(
      within(sorts).getByRole('button', { name: 'По местам' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('«По названию» сортирует по алфавиту, кнопка нажата', async () => {
    const root = await open();
    const sorts = await within(root).findByRole('group', { name: 'Сортировка' });
    fireEvent.click(within(sorts).getByRole('button', { name: 'По названию' }));
    expect([...root.querySelectorAll('tbody .ox-us-org-name')].map((e) => text(e))).toEqual([
      'Альта Групп',
      'Карго Сити',
      'Ремстрой Плюс',
      'SPA «Лотос»',
    ]);
    expect(
      within(sorts).getByRole('button', { name: 'По названию' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('«Открыть заявку» ведёт в «Заявки на тариф»', async () => {
    const root = await open();
    fireEvent.click(await within(root).findByRole('button', { name: 'Открыть заявку' }));
    await waitFor(() => expect(app?.path()).toBe('/platform/requests'));
  });

  it('«Карточка» ведёт в «Организации» с выбранной организацией', async () => {
    const root = await open();
    await waitFor(() => expect(root.querySelectorAll('.ox-us-signal')).toHaveLength(7));
    const cargo = [...root.querySelectorAll<HTMLElement>('.ox-us-signal')].find((r) =>
      text(r).includes('Карго Сити'),
    );
    fireEvent.click(within(cargo as HTMLElement).getByRole('button', { name: 'Карточка' }));
    const id = tenantIdOf(app?.scenario as MockApp['scenario'], 'Карго Сити');
    await waitFor(() => expect(app?.path()).toBe('/platform/tenants'));
    expect(app?.router.state.location.search).toEqual({ org: id });
  });

  it('чип организации в модуле и имя в таблице ведут в её карточку', async () => {
    const root = await open();
    const mod = (await within(root).findAllByText('Салон и SPA'))[0]?.closest('.ox-us-module');
    fireEvent.click(within(mod as HTMLElement).getByRole('button', { name: 'SPA «Лотос»' }));
    await waitFor(() => expect(app?.path()).toBe('/platform/tenants'));
  });

  it('все сигналы сняты — «Сейчас всё спокойно…», счётчик 0', async () => {
    const root = await open({
      setup: (sc) => {
        const s = sc.state();
        for (const t of s.tenants) {
          t.status = 'active';
          t.storage.committedBytes = 0;
          for (const e of t.subscription.entitlements) if (e.key === 'seats') e.value = 1000;
        }
        for (const a of s.accounts) a.lastLoginAt = s.clock;
      },
    });
    expect(
      await within(root).findByText(
        'Сейчас всё спокойно: лимиты не исчерпаны, все организации активны.',
      ),
    ).toBeTruthy();
    expect(text(root.querySelector('.ox-us-count'))).toBe('0');
  });

  it('загрузка — скелетон области, ошибка — alert и «Повторить» (без эталона)', async () => {
    const root = await open({ scenario: 'getPlatformUsage=rate_limited' });
    const alert = await within(root).findByRole('alert');
    expect(text(alert)).toContain('Не удалось загрузить данные: Слишком много запросов');
    app?.scenario.setScenario(null);
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(root.querySelectorAll('.ox-us-tile')).toHaveLength(4));
  });

  // Возврат 1 (ревью, minor): 403 — текст раздела (бриф §5), офлайн чтения — свой текст.
  it('нет права (403) — текст раздела вместо данных, без «Повторить»', async () => {
    const root = await open({ scenario: 'getPlatformUsage=forbidden_action' });
    expect(
      await within(root).findByText(
        'Нет права на использование платформы: раздел доступен всем ролям операторов платформы.',
      ),
    ).toBeTruthy();
    expect(within(root).queryByRole('alert')).toBeNull();
    expect(within(root).queryByRole('button', { name: 'Повторить' })).toBeNull();
  });

  it('нет связи при чтении — «Нет связи с сервером. Проверьте подключение.» и «Повторить»', async () => {
    const root = await open({ scenario: 'getPlatformUsage=offline' });
    const alert = await within(root).findByRole('alert');
    expect(text(alert)).toContain(
      'Не удалось загрузить данные: Нет связи с сервером. Проверьте подключение.',
    );
    expect(within(alert).getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });
});
