// W1.22 · Панель входящих в слоте шапки (S1-26, контракт C-7 W1.20; no-reference до B-6 №4, подписи поповера эталона
// «Ортус CRM.dc.html» :124–135). Сеть — MSW-сценарный сервер: у владельца «Альты» три события (примеры
// listMyNotifications/ok), два непрочитанных.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  type MockApp,
  type MockAppOptions,
  renderMockApp,
  tenantIdOf,
} from '../../app/testing.tsx';

const ALTA = 'Альта Групп';
const EVENTS = [
  'Олеся Петрова приняла приглашение',
  'Оператор платформы продлил пробный период на 14 дней',
  'Подключён модуль «Салон и SPA»',
];

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
  cleanup();
});

async function openPanel(o: MockAppOptions = { persona: 'owner' }) {
  app = await renderMockApp('/', o);
  const bell = await screen.findByRole('button', { name: /^Уведомления/ }, { timeout: 3000 });
  fireEvent.click(bell);
  const panel = await screen.findByRole('dialog', { name: 'Уведомления' });
  return { a: app, panel, bell };
}

/** Ещё 15 прочитанных событий владельца «Альты» (всего 18 — две страницы по 12). */
function fifteenMore(s: Parameters<NonNullable<MockAppOptions['setup']>>[0]): void {
  const st = s.state();
  const alta = tenantIdOf(s, ALTA);
  const org = st.orgs[alta];
  const owner = st.accounts.find((x) => x.proto === 'acc-1');
  if (!org || !owner) throw new Error('нет «Альты» или владельца');
  for (let i = 0; i < 15; i += 1) {
    org.notifications.push({
      accountId: owner.id,
      id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`,
      kind: 'members.member.updated',
      severity: 'info',
      title: `Событие ${i + 1}`,
      createdAt: `2026-09-2${Math.floor(i / 10)}T0${i % 10}:00:00Z`,
      readAt: '2026-09-29T00:00:00Z',
    });
  }
}

const reads = (a: MockApp) =>
  a.responses().filter((r) => r.method === 'POST' && r.path === '/api/v1/me/notifications/read');

describe('панель входящих', () => {
  it('владелец: события по убыванию, ссылки «Новое: …» на записи организации, «Прочитать все»', async () => {
    const { a, panel } = await openPanel();
    const alta = tenantIdOf(a.scenario, ALTA);
    const links = await within(panel).findAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(
      EVENTS.map((t) => expect.stringContaining(t) as unknown as string),
    );
    expect(links.map((l) => l.getAttribute('aria-label'))).toEqual([
      `Новое: ${EVENTS[0]}`,
      `Новое: ${EVENTS[1]}`,
      EVENTS[2],
    ]);
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      `/t/${alta}/users`,
      `/t/${alta}/billing`,
      `/t/${alta}/modules`,
    ]);
    expect(panel.querySelectorAll('.ox-inbox-item[data-unread]')).toHaveLength(2);
    expect(within(panel).getByRole('button', { name: 'Прочитать все' })).toBeTruthy();
    expect(within(panel).getByText('Уведомления')).toBeTruthy();
  });

  it('переход к записи: событие прочитано (notificationIds), панель закрыта, счётчик 1', async () => {
    const { a, panel } = await openPanel();
    const alta = tenantIdOf(a.scenario, ALTA);
    fireEvent.click(await within(panel).findByRole('link', { name: `Новое: ${EVENTS[0]}` }));
    await waitFor(() => expect(a.path()).toBe(`/t/${alta}/users`));
    await waitFor(() => expect(reads(a).map((r) => r.status)).toEqual([200]));
    expect(screen.queryByRole('dialog', { name: 'Уведомления' })).toBeNull();
    const banner = screen.getByRole('banner');
    await waitFor(() =>
      expect(within(banner).getByRole('button', { name: 'Уведомления: 1 новых' })).toBeTruthy(),
    );
    const n = a.scenario.state().orgs[alta]?.notifications.find((x) => x.title === EVENTS[0]);
    expect(n?.readAt).not.toBeNull();
  });

  it('время события — ЧЧ:ММ, как в поповере эталона (`hhmm()`), без дня и месяца', async () => {
    const { a, panel } = await openPanel();
    await within(panel).findAllByRole('link');
    const alta = tenantIdOf(a.scenario, ALTA);
    const org = a.scenario.state().orgs[alta];
    const hhmm = (iso: string) =>
      new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const expected = EVENTS.map((t) => {
      const n = org?.notifications.find((x) => x.title === t);
      if (!n) throw new Error(`нет события «${t}»`);
      return hhmm(n.createdAt);
    });
    const times = [...panel.querySelectorAll('.ox-inbox-at')].map((e) => e.textContent);
    expect(times).toEqual(expected);
    for (const t of times) expect(t).toMatch(/^\d{2}:\d{2}$/);
    const stamps = [...panel.querySelectorAll('.ox-inbox-at time')].map((e) =>
      e.getAttribute('datetime'),
    );
    expect(stamps).toHaveLength(3);
    expect(stamps.every((s) => s !== null && !Number.isNaN(Date.parse(s)))).toBe(true);
  });

  it('строка события — заголовок и время, как в поповере эталона (:129–132): body не показывается', async () => {
    const BODY = 'Пояснение события, которого нет в поповере эталона';
    const { panel } = await openPanel({
      persona: 'owner',
      setup: (s) => {
        const org = s.state().orgs[tenantIdOf(s, ALTA)];
        const n = org?.notifications.find((x) => x.title === EVENTS[0]);
        if (!n) throw new Error(`нет события «${EVENTS[0]}»`);
        n.body = BODY;
      },
    });
    const first = (await within(panel).findAllByRole('link'))[0];
    expect(first?.textContent).toContain(EVENTS[0]);
    expect(panel.textContent).not.toContain(BODY);
    expect(panel.querySelector('.ox-inbox-note')).toBeNull();
  });

  it('загрузка: «Загружаем уведомления…» (status)', async () => {
    const { panel } = await openPanel({
      persona: 'owner',
      scenario: 'listMyNotifications=loading',
    });
    expect((await within(panel).findByRole('status')).textContent).toBe('Загружаем уведомления…');
    expect(within(panel).queryByRole('link')).toBeNull();
    expect(within(panel).queryByText('Новых событий нет')).toBeNull();
  });

  it('«Прочитать все» — счётчик снят, непрочитанных нет', async () => {
    const { a, panel } = await openPanel();
    await within(panel).findAllByRole('link');
    fireEvent.click(within(panel).getByRole('button', { name: 'Прочитать все' }));
    const banner = screen.getByRole('banner');
    await waitFor(() =>
      expect(within(banner).getByRole('button', { name: 'Уведомления' })).toBeTruthy(),
    );
    await waitFor(() =>
      expect(panel.querySelectorAll('.ox-inbox-item[data-unread]')).toHaveLength(0),
    );
    expect(reads(a)).toHaveLength(1);
  });

  it('пусто: водитель — «Новых событий нет», «Прочитать все» без запроса', async () => {
    const { a, panel } = await openPanel({ persona: 'driver' });
    expect(await within(panel).findByText('Новых событий нет')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Прочитать все' }));
    await new Promise((r) => setTimeout(r, 30));
    expect(reads(a)).toHaveLength(0);
  });

  it('сбой ленты: «Не удалось загрузить уведомления.» и «Повторить»', async () => {
    const { a, panel } = await openPanel({
      persona: 'owner',
      scenario: 'listMyNotifications=rate_limited',
    });
    const alert = await within(panel).findByRole('alert');
    expect(alert.textContent).toContain('Не удалось загрузить уведомления.');
    expect(alert.textContent).toContain('Слишком много запросов. Подождите и повторите.');
    a.scenario.setScenario(null);
    fireEvent.click(within(panel).getByRole('button', { name: 'Повторить' }));
    expect(await within(panel).findAllByRole('link')).toHaveLength(3);
  });

  it('нет связи: «Нет связи с сервером. Операция не выполнена.»', async () => {
    const { panel } = await openPanel({
      persona: 'owner',
      scenario: 'listMyNotifications=offline',
    });
    expect((await within(panel).findByRole('alert')).textContent).toContain(
      'Нет связи с сервером. Операция не выполнена.',
    );
  });

  it('больше 12 событий — «Показать ещё» догружает следующую страницу по курсору', async () => {
    const { a, panel } = await openPanel({ persona: 'owner', setup: fifteenMore });
    expect(await within(panel).findAllByRole('link')).toHaveLength(3);
    expect(panel.querySelectorAll('.ox-inbox-item')).toHaveLength(12);
    fireEvent.click(within(panel).getByRole('button', { name: 'Показать ещё' }));
    await waitFor(() => expect(panel.querySelectorAll('.ox-inbox-item')).toHaveLength(18));
    expect(within(panel).queryByRole('button', { name: 'Показать ещё' })).toBeNull();
    const lists = a.responses().filter((r) => r.path === '/api/v1/me/notifications');
    expect(lists.map((r) => r.status)).toEqual([200, 200]);
  });

  it('сбой догрузки «Показать ещё»: события остаются, «Не удалось загрузить уведомления.» и «Повторить» догружает', async () => {
    const { a, panel } = await openPanel({ persona: 'owner', setup: fifteenMore });
    expect(await within(panel).findAllByRole('link')).toHaveLength(3);
    a.scenario.setScenario('listMyNotifications=rate_limited');
    fireEvent.click(within(panel).getByRole('button', { name: 'Показать ещё' }));
    const alert = await within(panel).findByRole('alert');
    expect(alert.textContent).toContain('Не удалось загрузить уведомления.');
    expect(alert.textContent).toContain('Слишком много запросов. Подождите и повторите.');
    expect(panel.querySelectorAll('.ox-inbox-item')).toHaveLength(12);
    a.scenario.setScenario(null);
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(panel.querySelectorAll('.ox-inbox-item')).toHaveLength(18));
    expect(within(panel).queryByRole('alert')).toBeNull();
  });

  it('запись вне прав: ссылка открывает страницу, гейт решает доступ (цель авторизуется заново)', async () => {
    const { a, panel } = await openPanel({
      persona: 'manager',
      setup: (s) => {
        const st = s.state();
        const alta = tenantIdOf(s, ALTA);
        const manager = st.accounts.find((x) => x.proto === 'acc-2');
        st.orgs[alta]?.notifications.push({
          accountId: manager?.id ?? '',
          id: '00000000-0000-4000-8000-000000000099',
          kind: 'members.invitation.accepted',
          severity: 'info',
          title: 'Олеся Петрова приняла приглашение',
          createdAt: '2026-10-01T07:00:00Z',
          readAt: null,
          link: '/users',
        });
      },
    });
    fireEvent.click(await within(panel).findByRole('link', { name: `Новое: ${EVENTS[0]}` }));
    const alta = tenantIdOf(a.scenario, ALTA);
    await waitFor(() => expect(a.path()).toBe(`/t/${alta}/users`));
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(
      'Нет доступа к разделу «Пользователи и роли»',
    );
  });
});
