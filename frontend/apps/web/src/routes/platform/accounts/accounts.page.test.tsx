// W4.61 · Экран «Пользователи платформы» оператора на MSW-сценарном сервере W4.07 (renderMockApp): организации
// слева, поиск и фильтры, карточка аккаунта с блокировкой и разблокировкой, организация с чипами участия, popover
// участий, «Ортус · Платформа» с операторами (отключение, роль, приглашение), ошибка чтения.
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

async function open(
  url = '/platform/accounts',
  o: Parameters<typeof renderMockApp>[1] = {},
): Promise<HTMLElement> {
  app = await renderMockApp(url, { persona: 'operator', ...o });
  await screen.findByRole('heading', { level: 1, name: 'Пользователи платформы' });
  const root = document.querySelector<HTMLElement>('section[aria-labelledby="h-acc"]');
  if (!root) throw new Error('нет секции');
  return root;
}

const rows = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.ox-acc-row > button')];
const row = (root: HTMLElement, name: string) =>
  rows(root).find((r) => text(r.querySelector('.ox-acc-name')) === name);
const findRow = (root: HTMLElement, name: string) =>
  waitFor(() => {
    const r = row(root, name);
    if (!r) throw new Error(`нет строки ${name}`);
    return r;
  });
const realm = (root: HTMLElement, name: string) =>
  within(within(root).getByRole('navigation', { name: 'Организации' }))
    .getAllByRole('button')
    .find((b) => text(b).includes(name)) as HTMLElement;
const card = () => screen.getByRole('complementary', { name: 'Карточка аккаунта' });

describe('«Пользователи платформы» оператора', () => {
  it('организации слева, итог, фильтры, первая строка выбрана, карточка', async () => {
    const root = await open();
    expect(root.dataset.screenLabel).toBe('Оператор · пользователи');
    await findRow(root, 'Дарья Зимина');
    expect(text(realm(root, 'Ортус · Платформа'))).toContain('5');
    expect(realm(root, 'Все аккаунты').getAttribute('aria-current')).toBe('page');
    expect(text(realm(root, 'Альта Групп'))).toContain('Пробный период · мест 9/10');
    expect(text(root.querySelector('.ox-acc-total'))).toBe('Аккаунтов на платформе: 58');
    const filters = within(root).getByRole('group', { name: 'Фильтр аккаунтов' });
    expect(
      within(filters)
        .getAllByRole('button')
        .map((b) => text(b)),
    ).toEqual([
      'Все · 58',
      'В нескольких организациях · 2',
      'Без второго фактора · 36',
      'Заблокированы · 1',
      'Не входили · 2',
    ]);
    expect(rows(root)[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(
      await within(card()).findByRole('heading', { level: 2, name: 'Дарья Зимина' }),
    ).toBeTruthy();
  });

  it('поиск «Шишкин»: одна строка, «· показано 1», разблокировка с диалогом', async () => {
    const root = await open();
    await findRow(root, 'Дарья Зимина');
    fireEvent.change(within(root).getByLabelText('Поиск по имени, почте или организации'), {
      target: { value: 'Шишкин' },
    });
    await waitFor(() => expect(rows(root)).toHaveLength(1));
    expect(text(root.querySelector('.ox-acc-total'))).toBe(
      'Аккаунтов на платформе: 58 · показано 1',
    );
    fireEvent.click(await findRow(root, 'Денис Шишкин'));
    expect(
      await within(card()).findByText(
        'Причина блокировки: Подозрительные входы из разных стран, 18.09',
      ),
    ).toBeTruthy();
    fireEvent.click(within(card()).getByRole('button', { name: 'Разблокировать вход' }));
    const d = await screen.findByRole('dialog', {
      name: 'Разблокировать вход d.shishkin@cargo.example?',
    });
    fireEvent.click(within(d).getByRole('button', { name: 'Разблокировать' }));
    expect(await screen.findByText('Готово · запись добавлена в журнал')).toBeTruthy();
    expect(await within(card()).findByRole('button', { name: 'Заблокировать вход' })).toBeTruthy();
  });

  it('блокировка: без причины — тост, с причиной — диалог, «Заблокированы · 2»', async () => {
    const root = await open();
    fireEvent.click(await findRow(root, 'Анна Морозова'));
    await within(card()).findByRole('heading', { level: 2, name: 'Анна Морозова' });
    expect(
      within(card()).getByText(
        'Один аккаунт в 2 организациях: данные организаций не пересекаются, у каждой свои роли и места.',
      ),
    ).toBeTruthy();
    fireEvent.click(within(card()).getByRole('button', { name: 'Заблокировать вход' }));
    expect(await screen.findByText('Укажите причину блокировки')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.change(within(card()).getByLabelText('Причина блокировки'), {
      target: { value: 'Подозрительные входы' },
    });
    fireEvent.click(within(card()).getByRole('button', { name: 'Заблокировать вход' }));
    const d = await screen.findByRole('dialog', {
      name: 'Заблокировать вход a.morozova@alta.example?',
    });
    expect(text(d)).toContain('Аккаунт не сможет войти ни в одну организацию (их 2)');
    fireEvent.click(within(d).getByRole('button', { name: 'Заблокировать' }));
    expect(
      await within(card()).findByText('Причина блокировки: Подозрительные входы'),
    ).toBeTruthy();
    expect(await within(root).findByRole('button', { name: 'Заблокированы · 2' })).toBeTruthy();
  });

  it('организация «Ремстрой Плюс»: адрес, шапка, итог, чипы участия, «Карточка организации»', async () => {
    const root = await open();
    await findRow(root, 'Дарья Зимина');
    fireEvent.click(realm(root, 'Ремстрой Плюс'));
    const id = tenantIdOf(app?.scenario as MockApp['scenario'], 'Ремстрой Плюс');
    await waitFor(() => expect(app?.router.state.location.search).toMatchObject({ org: id }));
    const head = await waitFor(() => {
      const h = root.querySelector('.ox-acc-orghead');
      if (!h) throw new Error('нет шапки');
      return h as HTMLElement;
    });
    await waitFor(() =>
      expect(text(head)).toContain('Владелец: Павел Орлов · тариф «Старт» · мест 5 из 10'),
    );
    expect(text(root.querySelector('.ox-acc-total'))).toBe('Участников в организации: 5');
    const orlov = await findRow(root, 'Павел Орлов');
    await waitFor(() =>
      expect(text(orlov.querySelector('.ox-acc-inorg'))).toBe('shield_personучастник · владелец'),
    );
    fireEvent.click(within(head).getByRole('button', { name: 'Карточка организации' }));
    await waitFor(() => expect(app?.path()).toBe('/platform/tenants'));
  });

  it('popover по наведению: участия и переход в организацию с выбранным человеком', async () => {
    const root = await open();
    const sokolov = await findRow(root, 'Алексей Соколов');
    fireEvent.mouseEnter(sokolov.parentElement as HTMLElement);
    const pop = await waitFor(() => {
      const p = root.querySelector('[aria-label="Организации аккаунта"]');
      if (!p) throw new Error('нет popover');
      return p as HTMLElement;
    });
    await waitFor(() => expect(text(pop)).toContain('Организации аккаунта · 2 действующ.'));
    fireEvent.click(
      within(pop)
        .getAllByRole('button')
        .find((b) => text(b).includes('Ремстрой Плюс')) as HTMLElement,
    );
    await waitFor(() =>
      expect(text(root.querySelector('.ox-acc-total'))).toBe('Участников в организации: 5'),
    );
    await waitFor(() =>
      expect(row(root, 'Алексей Соколов')?.getAttribute('aria-pressed')).toBe('true'),
    );
  });

  it('«Ортус · Платформа»: операторы, отключение Сорокина и включение', async () => {
    const root = await open('/platform/accounts?org=platform');
    await within(root).findByRole('heading', { level: 2, name: 'Операторы' });
    expect(within(root).queryByLabelText('Поиск по имени, почте или организации')).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Карточка аккаунта' })).toBeNull();
    expect(text(root.querySelector('.ox-pf-head'))).toContain(
      'Операторов: 5 · активных владельцев: 2',
    );
    const sorokin = await waitFor(() => {
      const r = [...root.querySelectorAll<HTMLElement>('.ox-op-row')].find((x) =>
        text(x).includes('Михаил Сорокин'),
      );
      if (!r) throw new Error('нет строки');
      return r;
    });
    fireEvent.click(within(sorokin).getByRole('button', { name: 'Отключить' }));
    const d = await screen.findByRole('dialog', { name: 'Отключить оператора?' });
    fireEvent.click(within(d).getByRole('button', { name: 'Отключить' }));
    expect(
      await within(root).findByText(
        'Активный владелец один. Назначьте второго, чтобы не потерять управление платформой при отпуске или увольнении.',
      ),
    ).toBeTruthy();
    fireEvent.click(await within(sorokin).findByRole('button', { name: 'Включить' }));
    expect(await screen.findByText('Оператор снова активен')).toBeTruthy();
  });

  it('роль «Администратор» без диалога, владелец без второго фактора — тост ошибки', async () => {
    const root = await open('/platform/accounts?org=platform');
    const guseva = await within(root).findByLabelText('Роль: Алёна Гусева');
    fireEvent.change(guseva, { target: { value: 'admin' } });
    expect(await screen.findByText('Роль изменена: Администратор')).toBeTruthy();
    fireEvent.change(within(root).getByLabelText('Роль: Дина Валиева'), {
      target: { value: 'owner' },
    });
    const d = await screen.findByRole('dialog', { name: 'Назначить владельцем платформы?' });
    fireEvent.click(within(d).getByRole('button', { name: 'Назначить' }));
    expect(
      await screen.findByText('Владельцем может стать только активный оператор со вторым фактором'),
    ).toBeTruthy();
  });

  it('приглашение оператора: проверки и отправка', async () => {
    const root = await open('/platform/accounts?org=platform');
    const form = (
      await within(root).findByRole('heading', {
        level: 2,
        name: 'Пригласить оператора',
      })
    ).parentElement as HTMLElement;
    const send = within(form).getByRole('button', { name: 'Отправить приглашение' });
    fireEvent.click(send);
    expect(await screen.findByText('Укажите имя и рабочую почту')).toBeTruthy();
    fireEvent.change(within(form).getByLabelText('Имя и фамилия'), {
      target: { value: 'Пётр Новый' },
    });
    fireEvent.change(within(form).getByLabelText('Рабочая почта'), {
      target: { value: 'e.lapteva@ortus.example' },
    });
    fireEvent.click(send);
    expect(await screen.findByText('Оператор с такой почтой уже есть')).toBeTruthy();
    fireEvent.change(within(form).getByLabelText('Рабочая почта'), {
      target: { value: 'p.novy@ortus.example' },
    });
    fireEvent.click(send);
    expect(await screen.findByText('Приглашение отправлено: p.novy@ortus.example')).toBeTruthy();
    await waitFor(() =>
      expect((within(form).getByLabelText('Имя и фамилия') as HTMLInputElement).value).toBe(''),
    );
    expect(await within(root).findByText('Пётр Новый')).toBeTruthy();
  });

  it('ошибка чтения каталога: alert и «Повторить» (без эталона)', async () => {
    const root = await open('/platform/accounts', { scenario: 'listPlatformUsers=rate_limited' });
    const alert = await within(root).findByRole('alert');
    expect(text(alert)).toContain('Не удалось загрузить аккаунты: Слишком много запросов');
    app?.scenario.setScenario(null);
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await findRow(root, 'Дарья Зимина');
  });

  // Возврат 1 (ревью): состояния без эталона и тексты allowlist, которых не проверял ни один тест.
  it('загрузка каталога — скелетон области «Загрузка»', async () => {
    const root = await open('/platform/accounts', { scenario: 'listPlatformUsers=delay=400' });
    expect(within(root).getByRole('status', { name: 'Загрузка' })).toBeTruthy();
    await findRow(root, 'Дарья Зимина');
    expect(within(root).queryByRole('status', { name: 'Загрузка' })).toBeNull();
  });

  it('нет права на каталог (403) — текст раздела вместо списка, без «Повторить» (бриф §5)', async () => {
    const root = await open('/platform/accounts', {
      scenario: 'listPlatformUsers=forbidden_action',
    });
    expect(
      await within(root).findByText(
        'Нет права на каталог аккаунтов: раздел доступен всем ролям операторов платформы.',
      ),
    ).toBeTruthy();
    expect(within(root).queryByRole('button', { name: 'Повторить' })).toBeNull();
    expect(rows(root)).toHaveLength(0);
  });

  it('нет права на операторов (403) — текст раздела вместо списка операторов', async () => {
    const root = await open('/platform/accounts?org=platform', {
      scenario: 'listPlatformOperators=forbidden_action',
    });
    expect(
      await within(root).findByText(
        'Нет права на список операторов: раздел доступен всем ролям операторов платформы.',
      ),
    ).toBeTruthy();
    expect(within(root).queryByRole('heading', { level: 2, name: 'Операторы' })).toBeNull();
  });

  it('нет связи при чтении каталога — alert «Нет связи с сервером…» и «Повторить»', async () => {
    const root = await open('/platform/accounts', { scenario: 'listPlatformUsers=offline' });
    const alert = await within(root).findByRole('alert');
    expect(text(alert)).toContain(
      'Не удалось загрузить аккаунты: Нет связи с сервером. Проверьте подключение.',
    );
    expect(within(alert).getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });

  it('повторная блокировка (409) — тост «Вход уже заблокирован», диалог открыт', async () => {
    const root = await open();
    fireEvent.click(await findRow(root, 'Анна Морозова'));
    await within(card()).findByRole('heading', { level: 2, name: 'Анна Морозова' });
    fireEvent.change(within(card()).getByLabelText('Причина блокировки'), {
      target: { value: 'Подозрительные входы' },
    });
    fireEvent.click(within(card()).getByRole('button', { name: 'Заблокировать вход' }));
    const d = await screen.findByRole('dialog', {
      name: 'Заблокировать вход a.morozova@alta.example?',
    });
    app?.scenario.setScenario('lockPlatformUser=invalid_transition', true);
    fireEvent.click(within(d).getByRole('button', { name: 'Заблокировать' }));
    expect(await screen.findByText('Вход уже заблокирован')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Заблокировать вход a.morozova@alta.example?' }));
  });

  it('сброс второго фактора, которого нет (409) — тост «Второй фактор не настроен»', async () => {
    const root = await open();
    fireEvent.click(await findRow(root, 'Дарья Зимина'));
    fireEvent.click(await within(card()).findByRole('button', { name: 'Сбросить второй фактор' }));
    const d = await screen.findByRole('dialog', { name: 'Сбросить второй фактор?' });
    app?.scenario.setScenario('resetPlatformUserMfa=invalid_transition', true);
    fireEvent.click(within(d).getByRole('button', { name: 'Сбросить' }));
    expect(await screen.findByText('Второй фактор не настроен')).toBeTruthy();
  });

  it('popover участий — группа с доступным именем «Организации аккаунта» (role="group")', async () => {
    const root = await open();
    const sokolov = await findRow(root, 'Алексей Соколов');
    fireEvent.mouseEnter(sokolov.parentElement as HTMLElement);
    expect(await within(root).findByRole('group', { name: 'Организации аккаунта' })).toBeTruthy();
  });
});
