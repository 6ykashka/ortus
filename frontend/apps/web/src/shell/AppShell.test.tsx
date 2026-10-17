// W1.20 · Экранные тесты оболочки на MSW-сценарном сервере (сид W0.12): редирект `/` (ADR-0001), шапка,
// меню D-23, AccessGate, состояния и баннеры (01-shell.md §7, §9–§12, §16; эталон design-stage-1).
import { devLogin } from '@ortus/api-client';
import { banners, errors, gate, shell } from '@ortus/texts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BASE_URL, type MockApp, renderMockApp, tenantIdOf } from '../app/testing.tsx';
import type { RealtimeConnect } from './realtime.ts';
import { SHELL_TEXT } from './texts.ts';

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (url: string, o: Parameters<typeof renderMockApp>[1] = {}) => {
  app = await renderMockApp(url, o);
  return app;
};

/** Оболочка загружена: в основном меню есть пункты (у меню кадра загрузки их нет, :2822). */
const ready = () =>
  waitFor(() => {
    const nav = screen.getByRole('navigation', { name: shell.a11y.mainNav });
    expect(within(nav).getAllByRole('button').length).toBeGreaterThan(0);
  });

const ALTA = 'Альта Групп';
/** Кнопка переключателя бизнеса: доступное имя содержит видимое название организации (WCAG 2.5.3). */
const SWITCHER = /сменить бизнес/i;
const LOTOS = 'SPA «Лотос»';

const mainNav = () => screen.getByRole('navigation', { name: shell.a11y.mainNav });
const navButtons = () =>
  within(mainNav())
    .getAllByRole('button')
    .map((b) => b.getAttribute('title'));

describe('загрузка и вход', () => {
  it('/ владельца → /t/<«Альта»>/home: шапка, меню, «Главная» отмечена', async () => {
    const a = await open('/', { persona: 'owner' });
    await waitFor(() => expect(a.path()).toBe(`/t/${tenantIdOf(a.scenario, ALTA)}/home`));
    const header = await screen.findByRole('banner');
    expect(within(header).getByText(shell.header.brandName)).toBeTruthy();
    expect(within(header).getByText(shell.header.business)).toBeTruthy();
    expect(within(header).getByText(ALTA)).toBeTruthy();
    expect(navButtons()).toEqual([
      'Главная',
      'Модули и место',
      'Пользователи и роли',
      'Структура',
      'Подписка и места',
      'Оформление',
      'Салон и SPA',
      'Чаты',
      'Задачи',
      'Обращения',
      'Формы и опросы',
      'Календарь',
      'База знаний',
      'Документы',
      'Данные',
      'Файлы',
      'Касса',
    ]);
    const current = within(mainNav()).getByRole('button', { current: 'page' });
    expect(current.getAttribute('title')).toBe('Главная');
    // W2.25: «Главная» — страница с приветствием (заглушка с заголовком «Главная» заменена).
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /^(Доброе утро|Добрый день|Добрый вечер), Дарья$/,
      }),
    ).toBeTruthy();
    expect(screen.getByText(shell.nav.sideNote.tenant)).toBeTruthy();
  });

  it('пока /me/context в пути — скелетон «Загружаем рабочее пространство…»', async () => {
    await open('/', { persona: 'owner', scenario: 'getMyContext=loading' });
    const status = await screen.findByRole('status', { name: shell.a11y.loading });
    expect(status.textContent).toContain(shell.boot.loading);
  });

  // Кадр загрузки эталона (:2821–2823, :149–170): меню без пунктов с подписью «Данные других организаций
  // изолированы», пустая нижняя навигация; в шапке нет знака и «ортус · пространство бизнеса» (top.noLogo не задан).
  it('кадр загрузки и ошибки — меню без пунктов с подписью изоляции, шапка без знака', async () => {
    for (const scenario of ['getMyContext=loading', 'getMyContext=rate_limited']) {
      const a = await open('/', { persona: 'owner', scenario });
      await screen.findByRole(scenario.endsWith('loading') ? 'status' : 'alert');
      const nav = screen.getByRole('navigation', { name: shell.a11y.mainNav });
      expect(within(nav).queryAllByRole('button')).toEqual([]);
      expect(nav.textContent).toContain(shell.nav.sideNote.tenant);
      const bottom = screen.getByRole('navigation', { name: shell.a11y.bottomNav });
      expect(within(bottom).queryAllByRole('button')).toEqual([]);
      const header = screen.getByRole('banner');
      expect(within(header).queryByText(shell.header.brandName)).toBeNull();
      expect(within(header).queryByText(shell.header.business)).toBeNull();
      expect(within(header).getByText(SHELL_TEXT.bootTenant)).toBeTruthy();
      a.close();
      app = undefined;
    }
  });

  it('ошибка /me/context — alert «Не удалось загрузить модули прототипа: …»', async () => {
    await open('/', { persona: 'owner', scenario: 'getMyContext=rate_limited' });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      `Не удалось загрузить модули прототипа: ${errors.problem.rate_limited}`,
    );
  });

  it('без входа — «Нужен вход» и ссылка «Войти»', async () => {
    await open('/');
    expect(await screen.findByText('Нужен вход')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Войти' }).getAttribute('href')).toBe('/auth/login');
  });

  it('оператор → /platform/tenants: тёмная шапка, меню «Платформа», без колокольчика', async () => {
    const a = await open('/', { persona: 'operator' });
    await waitFor(() => expect(a.path()).toBe('/platform/tenants'));
    const header = await screen.findByRole('banner');
    expect(header.dataset.chrome).toBe('dark');
    expect(within(header).getByText(shell.header.platform)).toBeTruthy();
    expect(within(header).getByText(shell.header.platformTitle)).toBeTruthy();
    expect(within(header).getByText(shell.header.operatorScope)).toBeTruthy();
    expect(within(header).queryByRole('button', { name: /^Уведомления/ })).toBeNull();
    expect(within(header).getByRole('button', { name: shell.header.profile }).textContent).toBe(
      'ОП',
    );
    expect(navButtons()).toEqual([
      'Организации',
      'Использование',
      'Заявки на тариф',
      'Пользователи',
      'Тарифная сетка',
    ]);
    expect(screen.getByText(shell.nav.sideNote.operator)).toBeTruthy();
  });

  it('неизвестная страница — «Страница не найдена» внутри оболочки', async () => {
    const tenant = (await open('/', { persona: 'owner' })).scenario;
    const id = tenantIdOf(tenant, ALTA);
    await act(async () => {
      await app?.router.navigate({ to: `/t/${id}/planned` });
    });
    expect(await screen.findByRole('heading', { name: SHELL_TEXT.notFound.title })).toBeTruthy();
    expect(screen.getByRole('banner')).toBeTruthy();
  });

  it('чужая организация и неизвестный путь — «Страница не найдена» со ссылкой на стартовую страницу', async () => {
    for (const url of ['/t/00000000-0000-4000-8000-000000000000/home', '/nonsense/path']) {
      const a = await open(url, { persona: 'owner' });
      const heading = await screen.findByRole('heading', { name: SHELL_TEXT.notFound.title });
      const section = heading.closest('section') as HTMLElement;
      // Меню нет — текст не отсылает к нему; выход — ссылка на «/» (стартовая страница, ADR-0001).
      expect(section.textContent).not.toContain('Выберите раздел в меню.');
      const home = within(section).getByRole('link', { name: 'На стартовую страницу' });
      expect(home.getAttribute('href')).toBe('/');
      fireEvent.click(home);
      await waitFor(() => expect(a.path()).toBe(`/t/${tenantIdOf(a.scenario, ALTA)}/home`));
      a.close();
      app = undefined;
    }
  });
});

describe('шапка', () => {
  it('владелец: select «Область просмотра» — «Все подразделения», регионы и фирмы', async () => {
    await open('/', { persona: 'owner' });
    const select = await screen.findByRole('combobox', { name: shell.a11y.scope });
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1));
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options[0]).toBe('Все подразделения');
    expect(options).toContain('Москва · весь регион');
    expect(options).toContain('Москва / Север Логистик');
  });

  it('логист без роли логистики: «Область не назначена»', async () => {
    await open('/', { persona: 'manager' });
    expect(await screen.findByText(shell.header.noScope)).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: shell.a11y.scope })).toBeNull();
  });

  it('профиль: имя, «Назначения», «Владелец бизнеса · Вся организация», «Выйти»', async () => {
    await open('/', { persona: 'owner' });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: shell.header.profile }));
    const dialog = screen.getByRole('dialog', { name: shell.header.profile });
    expect(within(dialog).getByText('Дарья Зимина')).toBeTruthy();
    expect(within(dialog).getByText(shell.popovers.assignments)).toBeTruthy();
    expect(within(dialog).getByText('Владелец бизнеса · Вся организация')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: SHELL_TEXT.logout })).toBeTruthy();
  });

  it('«Выйти» с ошибкой logout — тост, страница и сессия остаются', async () => {
    const a = await open('/', { persona: 'owner', scenario: 'logout=rate_limited' });
    await ready();
    const before = a.path();
    fireEvent.click(screen.getByRole('button', { name: shell.header.profile }));
    const dialog = screen.getByRole('dialog', { name: shell.header.profile });
    fireEvent.click(within(dialog).getByRole('button', { name: SHELL_TEXT.logout }));
    expect((await screen.findByRole('alert')).textContent).toContain(errors.problem.rate_limited);
    expect(a.path()).toBe(before);
    expect(screen.getByRole('navigation', { name: shell.a11y.mainNav })).toBeTruthy();
  });

  // W1.49 (проверяющий W1.20, возврат 3): кэш очищается, когда оболочка уже размонтирована, — запросы оболочки
  // (область, место, счётчик входящих) не перезапускаются и не получают 401 после выхода.
  it('«Выйти»: сначала /auth/login, после выхода — ни одного запроса, кроме logout (нет 401)', async () => {
    const a = await open('/', { persona: 'owner' });
    await ready();
    const select = await screen.findByRole('combobox', { name: shell.a11y.scope });
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1));
    await screen.findByRole('button', { name: /^Уведомления: \d+ новых$/ });
    await waitFor(() => {
      const paths = a.responses().map((r) => r.path);
      expect(paths.some((p) => p.endsWith('/storage'))).toBe(true);
    });
    const from = a.responses().length;
    fireEvent.click(screen.getByRole('button', { name: shell.header.profile }));
    const dialog = screen.getByRole('dialog', { name: shell.header.profile });
    fireEvent.click(within(dialog).getByRole('button', { name: SHELL_TEXT.logout }));
    await waitFor(() => expect(a.path()).toBe('/auth/login'));
    await waitFor(() => expect(screen.queryByRole('banner')).toBeNull());
    await new Promise((r) => setTimeout(r, 200));
    const after = a.responses().slice(from);
    expect(after.filter((r) => r.status === 401)).toEqual([]);
    expect(after.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /api/v1/auth/logout']);
  });

  it('профиль логиста: проектные роли — не назначения организации, «Ролей нет — доступ к модулям не выдан»', async () => {
    await open('/', { persona: 'manager' });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: shell.header.profile }));
    const dialog = screen.getByRole('dialog', { name: shell.header.profile });
    expect(within(dialog).getByText('Марина Котова')).toBeTruthy();
    expect(within(dialog).getByText(shell.popovers.assignments)).toBeTruthy();
    expect(within(dialog).getByText(shell.popovers.noRoles)).toBeTruthy();
  });

  it('поповеры исключают друг друга, Escape закрывает', async () => {
    await open('/', { persona: 'owner' });
    await ready();
    const profile = screen.getByRole('button', { name: shell.header.profile });
    fireEvent.click(profile);
    expect(profile.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /^Уведомления/ }));
    expect(screen.queryByRole('dialog', { name: shell.header.profile })).toBeNull();
    expect(screen.getByRole('dialog', { name: shell.a11y.notifications })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: shell.a11y.notifications })).toBeNull();
  });

  // PD-29: Escape в поповере возвращает фокус на кнопку, которая его открыла (как лист «Все разделы» — на «Ещё»).
  it('Escape в поповере «Профиль» и «Уведомления» возвращает фокус на кнопку шапки', async () => {
    await open('/', { persona: 'owner' });
    await ready();
    const profile = screen.getByRole('button', { name: shell.header.profile });
    fireEvent.click(profile);
    const logout = within(screen.getByRole('dialog', { name: shell.header.profile })).getByRole(
      'button',
      { name: SHELL_TEXT.logout },
    );
    logout.focus();
    fireEvent.keyDown(logout, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: shell.header.profile })).toBeNull();
    expect(document.activeElement).toBe(profile);

    const bell = await screen.findByRole('button', { name: /^Уведомления/ });
    fireEvent.click(bell);
    const read = within(screen.getByRole('dialog', { name: shell.a11y.notifications })).getByRole(
      'button',
      { name: shell.popovers.readAll },
    );
    read.focus();
    fireEvent.keyDown(read, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: shell.a11y.notifications })).toBeNull();
    expect(document.activeElement).toBe(bell);
  });

  it('счётчик входящих — непрочитанные текущей организации (getMyNotificationSummary)', async () => {
    const a = await open('/', { persona: 'owner' });
    const altaId = tenantIdOf(a.scenario, ALTA);
    const org = a.scenario.state().orgs[altaId];
    const owner = a.scenario.state().accounts.find((x) => x.proto === 'acc-1');
    const unread =
      org?.notifications.filter((n) => n.accountId === owner?.id && n.readAt === null).length ?? 0;
    expect(unread).toBeGreaterThan(0);
    expect(
      await screen.findByRole('button', { name: `Уведомления: ${unread} новых` }),
    ).toBeTruthy();
  });

  it('поповер «Уведомления»: события организации, «Прочитать все» — markMyNotificationsRead', async () => {
    const a = await open('/', { persona: 'owner' });
    const altaId = tenantIdOf(a.scenario, ALTA);
    const owner = a.scenario.state().accounts.find((x) => x.proto === 'acc-1');
    const mine = () =>
      a.scenario.state().orgs[altaId]?.notifications.filter((n) => n.accountId === owner?.id) ?? [];
    const unread = mine().filter((n) => n.readAt === null);
    expect(unread.length).toBeGreaterThan(0);
    fireEvent.click(
      await screen.findByRole('button', { name: `Уведомления: ${unread.length} новых` }),
    );
    const dialog = screen.getByRole('dialog', { name: shell.a11y.notifications });
    for (const n of unread) expect(await within(dialog).findByText(n.title)).toBeTruthy();
    expect(within(dialog).queryByText(shell.popovers.empty)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: shell.popovers.readAll }));
    expect(await screen.findByRole('button', { name: 'Уведомления' })).toBeTruthy();
    expect(mine().every((n) => n.readAt !== null)).toBe(true);
  });

  it('поповер «Уведомления» без событий — «Новых событий нет»', async () => {
    await open('/', { persona: 'driver' });
    fireEvent.click(await screen.findByRole('button', { name: 'Уведомления' }));
    const dialog = screen.getByRole('dialog', { name: shell.a11y.notifications });
    expect(await within(dialog).findByText(shell.popovers.empty)).toBeTruthy();
  });

  it('«Прочитать все» без непрочитанных активна, как в эталоне (:126); нажатие ничего не ломает', async () => {
    await open('/', { persona: 'driver' });
    fireEvent.click(await screen.findByRole('button', { name: 'Уведомления' }));
    const dialog = screen.getByRole('dialog', { name: shell.a11y.notifications });
    await within(dialog).findByText(shell.popovers.empty);
    const read = within(dialog).getByRole('button', { name: shell.popovers.readAll });
    expect((read as HTMLButtonElement).disabled).toBe(false);
    expect(read.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(read);
    expect(screen.getByRole('dialog', { name: shell.a11y.notifications })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Уведомления' })).toBeTruthy();
  });
});

describe('переключатель бизнеса (S1-07)', () => {
  it('две организации в порядке ru; выбор — selectTenant и стартовая страница выбранной', async () => {
    const a = await open('/', { persona: 'therapist' });
    const altaId = tenantIdOf(a.scenario, ALTA);
    await waitFor(() => expect(a.path()).toBe(`/t/${altaId}/spa`));
    // Заголовок заглушки — подпись пункта своего рабочего места («Мой день», а не «Салон и SPA»).
    expect(await screen.findByRole('heading', { level: 1, name: 'Мой день' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: SWITCHER }));
    const list = screen.getByRole('dialog', { name: SHELL_TEXT.switcher.title });
    const items = within(list).getAllByRole('button');
    expect(items.map((b) => b.textContent)).toEqual([ALTA, LOTOS]);
    expect(items[0]?.getAttribute('aria-current')).toBe('true');
    fireEvent.click(items[1] as HTMLElement);
    const lotosId = tenantIdOf(a.scenario, LOTOS);
    await waitFor(() => expect(a.path()).toBe(`/t/${lotosId}/spa`));
    expect(within(screen.getByRole('banner')).getByText(LOTOS)).toBeTruthy();
    const acc = a.scenario.state().accounts.find((x) => x.proto === 'acc-4');
    expect(acc?.lastTenantId).toBe(lotosId);
  });

  // W1.49: «Касса» массажиста — по праву cash.* (core() эталона :2964), а не по рабочему месту: у массажиста
  // «Лотоса» в эталоне четыре пункта (01-shell.md §8.3, §20 п. 33); в «Альте» сида этапа 1 права кассы тоже нет.
  it('меню массажиста в «Альте» и после перехода в «Лотос» — без «Касса» (нет права cash.*)', async () => {
    const a = await open('/', { persona: 'therapist' });
    await ready();
    const menu = ['Мой день', 'Чаты', 'Календарь', 'База знаний'];
    expect(navButtons()).toEqual(menu);
    fireEvent.click(await screen.findByRole('button', { name: SWITCHER }));
    const list = screen.getByRole('dialog', { name: SHELL_TEXT.switcher.title });
    fireEvent.click(within(list).getByRole('button', { name: LOTOS }));
    const lotosId = tenantIdOf(a.scenario, LOTOS);
    await waitFor(() => expect(a.path()).toBe(`/t/${lotosId}/spa`));
    await waitFor(() => expect(navButtons()).toEqual(menu));
  });

  it('доступное имя кнопки начинается с видимого названия организации (WCAG 2.5.3)', async () => {
    await open('/', { persona: 'therapist' });
    const button = await screen.findByRole('button', { name: SWITCHER });
    expect(button.getAttribute('aria-label')).toBe(`${ALTA} — сменить бизнес`);
    expect(button.textContent).toContain(ALTA);
  });

  it('у владельца одной организации переключателя нет', async () => {
    await open('/', { persona: 'owner' });
    await screen.findByRole('banner');
    expect(screen.queryByRole('button', { name: SWITCHER })).toBeNull();
  });

  it('ошибка selectTenant — тост, организация не меняется', async () => {
    const a = await open('/', { persona: 'therapist', scenario: 'selectTenant=not_found' });
    const altaId = tenantIdOf(a.scenario, ALTA);
    await waitFor(() => expect(a.path()).toBe(`/t/${altaId}/spa`));
    // Заголовок заглушки — подпись пункта своего рабочего места («Мой день», а не «Салон и SPA»).
    expect(await screen.findByRole('heading', { level: 1, name: 'Мой день' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: SWITCHER }));
    const list = screen.getByRole('dialog', { name: SHELL_TEXT.switcher.title });
    fireEvent.click(within(list).getByRole('button', { name: LOTOS }));
    expect((await screen.findByRole('alert')).textContent).toContain(errors.problem.not_found);
    expect(a.path()).toBe(`/t/${altaId}/spa`);
  });
});

describe('AccessGate', () => {
  it('водитель: «Логистика» не подключена организацией, без демо-кнопки (PD-54)', async () => {
    const a = await open('/', { persona: 'driver' });
    await waitFor(() => expect(a.path()).toMatch(/\/today$/));
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: '«Логистика» не подключена организацией',
      }),
    ).toBeTruthy();
    expect(screen.getByText(gate.chips.moduleOff)).toBeTruthy();
    expect(screen.getByText(gate.b.textOther)).toBeTruthy();
    expect(screen.queryByRole('button', { name: gate.actions.demoAsOwner })).toBeNull();
  });

  it('прораб: «Ремонт и стройка» не подключён организацией (ветка A)', async () => {
    await open('/', { persona: 'foreman' });
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: '«Ремонт и стройка» не подключён организацией',
      }),
    ).toBeTruthy();
    expect(screen.getByText(gate.a.textOther)).toBeTruthy();
  });

  it('владелец по прямому URL: «Открыть «Модули и место»» ведёт в «Модули и место»', async () => {
    const first = await open('/', { persona: 'owner' });
    const id = tenantIdOf(first.scenario, ALTA);
    await act(async () => {
      await first.router.navigate({ to: `/t/${id}/fleet` });
    });
    fireEvent.click(await screen.findByRole('button', { name: gate.actions.openModules }));
    await waitFor(() => expect(first.path()).toBe(`/t/${id}/modules`));
    // W1.24: «Модули и место» — ленивая страница с данными (не PageStub): заголовок появляется асинхронно.
    expect(await screen.findByRole('heading', { level: 1, name: 'Модули и место' })).toBeTruthy();
  });
});

describe('баннеры', () => {
  it('пробный период завершён — «Пробный период завершён.» без демо-кнопки', async () => {
    await open('/', { persona: 'owner', preset: 'trial-ended' });
    const banner = await screen.findByText(banners.trialEnded.title);
    expect(banner.closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: banners.trialEnded.action })).toBeNull();
  });

  it('место заполнено — alert и «Открыть «Модули и место»» (кроме самой страницы)', async () => {
    const a = await open('/', { persona: 'owner', preset: 'storage-full' });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(banners.storageFull.title);
    expect(alert.textContent).toContain(banners.storageFull.textOwner);
    fireEvent.click(within(alert).getByRole('button', { name: banners.storageFull.action }));
    await waitFor(() => expect(a.path()).toMatch(/\/modules$/));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: banners.storageFull.action })).toBeNull(),
    );
  });

  // Эталон bannersVM :3096: баннер видят все, кроме оператора; не владельцу — свой текст и без кнопки. Признак —
  // tenantState.storageWriteStatus в /me/context (0.4.0-stage1), без billing.read.
  for (const persona of ['driver', 'foreman'] as const) {
    it(`место заполнено — ${persona}: alert с текстом сотрудника, без «Открыть «Модули и место»»`, async () => {
      await open('/', { persona, preset: 'storage-full' });
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain(banners.storageFull.title);
      expect(alert.textContent).toContain(banners.storageFull.textOther);
      expect(alert.textContent).not.toContain(banners.storageFull.textOwner);
      expect(within(alert).queryByRole('button')).toBeNull();
    });
  }

  it('место не заполнено — у сотрудника баннера нет', async () => {
    await open('/', { persona: 'driver' });
    await ready();
    expect(screen.queryByText(banners.storageFull.title)).toBeNull();
  });

  // Эталон :3088: «Пробный период завершён.» — по статусу организации (restricted, suspended), а не по причинам
  // модулей: у приостановленной организации доступности модулей в /me/context нет.
  it('организация приостановлена — «Пробный период завершён.»', async () => {
    await open('/', {
      persona: 'driver',
      setup: (s) => {
        const alta = s.state().tenants.find((t) => t.name === ALTA);
        if (alta) alta.status = 'suspended';
      },
    });
    const banner = await screen.findByText(banners.trialEnded.title);
    expect(banner.closest('[role="status"]')?.textContent).toContain(banners.trialEnded.text);
  });

  it('модуль отключён с историей: гейт пропускает, баннер «Модуль «Логистика» отключён.»', async () => {
    const a = await open('/', {
      persona: 'owner',
      preset: 'logistics-ready',
      setup: (s) => {
        const fleet = s.state().orgs[tenantIdOf(s, ALTA)]?.modules.fleet;
        if (fleet) fleet.state = 'read_only';
      },
    });
    const id = tenantIdOf(a.scenario, ALTA);
    await act(async () => {
      await a.router.navigate({ to: `/t/${id}/fleet` });
    });
    expect(await screen.findByText('Модуль «Логистика» отключён.')).toBeTruthy();
    expect(screen.getByText(banners.moduleReadonly.text.logistics)).toBeTruthy();
    // W2.20: страница «Рабочее место логиста» — ленивый модуль реестра (не заглушка): заголовок — после загрузки.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Рабочее место логиста' }),
    ).toBeTruthy();
  });
});

// W1.49 · канал реального времени (ADR-0015, PD-58): билет createRealtimeTicket (MSW — 201), сокет — поддельный
// транспорт приложения; подсказки перечитывают /me/context и входящие.
describe('канал реального времени', () => {
  interface Wire {
    url: string;
    on: Parameters<RealtimeConnect>[2];
    sent: string[];
    /** Код закрытия сокета клиентом (`undefined` — не закрывался). */
    closed?: number | undefined;
  }

  const wires: Wire[] = [];
  const connect: RealtimeConnect = (url, _protocol, on) => {
    const w: Wire = { url, on, sent: [] };
    wires.push(w);
    return {
      send: (d) => w.sent.push(d),
      close: (code) => {
        w.closed = code;
      },
    };
  };
  afterEach(() => {
    wires.length = 0;
  });

  it('без транспорта (режим mock) билет не запрашивается', async () => {
    const a = await open('/', { persona: 'owner' });
    await ready();
    await new Promise((r) => setTimeout(r, 100));
    expect(a.responses().some((r) => r.path === '/api/v1/auth/realtime-tickets')).toBe(false);
  });

  it('билет → сокет → auth; context.changed — /me/context, notifications.changed — счётчик', async () => {
    const a = await open('/', { persona: 'owner', realtime: connect });
    await ready();
    await waitFor(() => expect(wires).toHaveLength(1));
    const w = wires[0] as Wire;
    expect(w.url).toMatch(/^ws:\/\/[^/]+\/api\/v1\/realtime$/);
    const ticket = a.responses().find((r) => r.path === '/api/v1/auth/realtime-tickets');
    expect(ticket).toMatchObject({ method: 'POST', status: 201 });
    act(() => w.on.open());
    expect(JSON.parse(w.sent[0] ?? '{}')).toMatchObject({ type: 'auth' });
    const count = (path: string) => a.responses().filter((r) => r.path === path).length;
    const me = count('/api/v1/me/context');
    act(() =>
      w.on.message(JSON.stringify({ type: 'context.changed', seq: 1, at: '2026-10-15T10:00:00Z' })),
    );
    await waitFor(() => expect(count('/api/v1/me/context')).toBe(me + 1));
    const summary = count('/api/v1/me/notifications/summary');
    act(() =>
      w.on.message(
        JSON.stringify({ type: 'notifications.changed', seq: 2, at: '2026-10-15T10:00:01Z' }),
      ),
    );
    await waitFor(() => expect(count('/api/v1/me/notifications/summary')).toBe(summary + 1));
  });

  it('session.ended — /me/context перечитывается, без сессии — «Нужен вход»', async () => {
    const a = await open('/', { persona: 'owner', realtime: connect });
    await ready();
    await waitFor(() => expect(wires).toHaveLength(1));
    const w = wires[0] as Wire;
    act(() => w.on.open());
    // Сессия завершена на сервере: /me/context теперь отвечает 401 session_expired.
    a.scenario.setScenario('getMyContext=session_expired');
    act(() =>
      w.on.message(
        JSON.stringify({
          type: 'session.ended',
          reason: 'logout',
          seq: 1,
          at: '2026-10-15T10:00:00Z',
        }),
      ),
    );
    expect(await screen.findByText('Нужен вход')).toBeTruthy();
  });

  // W1.49, возврат 1 (ревью): выход очищает кэш — канал обязан закрыться (1000), а повторный вход без
  // перезагрузки вкладки (новый /me/context в кэше) — запросить новый билет и открыть новый сокет.
  it('«Выйти» закрывает сокет кодом 1000; повторный вход без перезагрузки — новый билет и сокет', async () => {
    const a = await open('/', { persona: 'owner', realtime: connect });
    await ready();
    await waitFor(() => expect(wires).toHaveLength(1));
    const first = wires[0] as Wire;
    act(() => first.on.open());
    fireEvent.click(screen.getByRole('button', { name: shell.header.profile }));
    const dialog = screen.getByRole('dialog', { name: shell.header.profile });
    fireEvent.click(within(dialog).getByRole('button', { name: SHELL_TEXT.logout }));
    await waitFor(() => expect(a.path()).toBe('/auth/login'));
    await waitFor(() => expect(first.closed).toBe(1000));
    const tickets = () =>
      a.responses().filter((r) => r.path === '/api/v1/auth/realtime-tickets').length;
    expect(tickets()).toBe(1);

    await devLogin('owner', { baseUrl: BASE_URL });
    await act(async () => {
      await a.router.navigate({ to: '/' });
    });
    await ready();
    await waitFor(() => expect(wires).toHaveLength(2));
    expect(tickets()).toBe(2);
    expect(wires[1]?.closed).toBeUndefined();
  });
});

describe('офлайн', () => {
  it('событие offline: пилюля «Нет связи», баннер «Нет связи.», тост warn; online — исчезают', async () => {
    await open('/', { persona: 'owner' });
    await ready();
    const header = screen.getByRole('banner');
    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    expect(within(header).getByRole('status').textContent).toContain(shell.demo.flags.offline);
    expect(screen.getByText(banners.offline.title)).toBeTruthy();
    expect(screen.getByText('Нет связи. Черновики сохраняются на устройстве')).toBeTruthy();
    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      window.dispatchEvent(new Event('online'));
    });
    expect(within(header).queryByRole('status')).toBeNull();
    expect(screen.queryByText(banners.offline.title)).toBeNull();
  });
});
