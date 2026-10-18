// W1.23 · Экранные тесты диалогов «Пользователей и ролей» на MSW-сценарном сервере W0.13: «Назначить роль»,
// «Пригласить участника», «Создать роль» (эталон :2203–2262, modalVM :3964–4034, 02 §10 #18–#26, #33) и без
// эталона — карточка сотрудника (updateMember), «Передать владение», «Создать группу», «Почему доступно».
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, renderMockApp } from '../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
// Сроки ожиданий и тестов — общие (vitest.config.ts, vitest.setup.ts, W2.53): первый тест файла ждёт ленивый
// маршрут и MSW на холодную.
// jsdom без CSS.escape: React Aria (Modal → getMetaValue) зовёт его, когда диалог открыт не указателем.
if (typeof globalThis.CSS?.escape !== 'function') {
  Object.assign(globalThis, {
    CSS: { escape: (s: string) => s.replace(/[^\w-]/g, (c) => `\\${c}`) },
  });
}

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (query = '') => {
  app = await renderMockApp(`/t/${ALTA}/users${query}`, { persona: 'owner' });
  await screen.findByRole('heading', { level: 1, name: 'Пользователи и роли' });
  return app;
};

const row = async (name: string) => {
  const list = await screen.findByRole('list', { name: 'Участники' });
  await waitFor(() => expect(list.textContent).toContain(name));
  return within(list)
    .getAllByRole('listitem')
    .find((li) => li.textContent?.includes(name)) as HTMLElement;
};

/**
 * Текст строки участника сейчас, без ожидания: для `waitFor` без вложенного findBy (W2.53 — вложенные ожидания
 * под нагрузкой опрашивали всё дерево ролей каждые 50 мс и съедали срок теста).
 */
const rowText = (name: string): string =>
  [...within(screen.getByRole('list', { name: 'Участники' })).getAllByRole('listitem')].find((li) =>
    li.textContent?.includes(name),
  )?.textContent ?? '';

const dialog = (name: string) => screen.findByRole('dialog', { name });
const toast = () => document.querySelector('.ox-toast-text');

describe('«Назначить роль»', () => {
  it('открытие, «Выберите роль», итог и назначение с тостом', async () => {
    await open();
    fireEvent.click(
      within(await row('Марина Котова')).getByRole('button', { name: 'Назначить роль' }),
    );
    const dlg = await dialog('Назначить роль');
    expect(dlg.textContent).toContain('Марина Котова · m.kotova@alta.example');
    expect(dlg.textContent).toContain('Роль не выбрана · Москва / Север Логистик');
    expect(dlg.textContent).toContain('Руководитель проекта · Проект');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Назначить' }));
    expect(within(dlg).getByRole('alert').textContent).toContain('Выберите роль');
    const roleSel = within(dlg).getByLabelText('Роль') as HTMLSelectElement;
    const manager = [...roleSel.options].find((o) => o.text === 'Менеджер логистики');
    fireEvent.change(roleSel, { target: { value: manager?.value } });
    expect(within(dlg).queryByRole('alert')).toBeNull();
    expect(
      within(within(dlg).getByRole('list', { name: 'Итог назначения' }))
        .getAllByRole('listitem')
        .map((li) => li.lastElementChild?.textContent),
    ).toEqual([
      'Отраслевые модули: Логистика (модуль не подключён)',
      'Только Москва / Север Логистик; соседние фирмы скрыты',
      'Начисления водителям — видны в этой области',
    ]);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Назначить' }));
    await waitFor(() => expect(toast()?.textContent).toBe('Роль «Менеджер логистики» назначена'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Назначить роль' })).toBeNull(),
    );
    await waitFor(() =>
      expect(rowText('Марина Котова')).toContain('Менеджер логистики· Москва / Север Логистик'),
    );
  });

  it('водитель и роль с начислениями: ошибка сервера в диалоге, без тоста', async () => {
    await open();
    fireEvent.click(
      within(await row('Илья Васильев')).getByRole('button', { name: 'Назначить роль' }),
    );
    const dlg = await dialog('Назначить роль');
    const roleSel = within(dlg).getByLabelText('Роль') as HTMLSelectElement;
    const manager = [...roleSel.options].find((o) => o.text === 'Менеджер логистики');
    fireEvent.change(roleSel, { target: { value: manager?.value } });
    expect(dlg.textContent).toContain(
      'Конфликт: функция «Водитель» несовместима с правом на начисления',
    );
    fireEvent.click(within(dlg).getByRole('button', { name: 'Назначить' }));
    await waitFor(() =>
      expect(within(dlg).getByRole('alert').textContent).toContain(
        'Функция «Водитель» несовместима с правом на начисления (правило MVP).',
      ),
    );
    expect(toast()).toBeNull();
  });

  it('«Снять» у последнего владельца — тост «Нельзя снять роль с последнего владельца»', async () => {
    await open();
    fireEvent.click(
      within(await row('Дарья Зимина')).getByRole('button', { name: 'Назначить роль' }),
    );
    const dlg = await dialog('Назначить роль');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Снять' }));
    await waitFor(() =>
      expect(toast()?.textContent).toBe('Нельзя снять роль с последнего владельца'),
    );
    expect(dlg.textContent).toContain('Владелец бизнеса · Вся организация');
  });
});

describe('«Снять» (revokeAssignment, ответ 204 без тела)', () => {
  it('обычное назначение: тост «Назначение снято», строка исчезла', async () => {
    await open();
    fireEvent.click(
      within(await row('Анна Морозова')).getByRole('button', { name: 'Назначить роль' }),
    );
    const dlg = await dialog('Назначить роль');
    expect(dlg.textContent).toContain('Массажист · Только назначенное лично');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Снять' }));
    await waitFor(() => expect(toast()?.textContent).toBe('Назначение снято'));
    await waitFor(() =>
      expect(dlg.textContent).not.toContain('Массажист · Только назначенное лично'),
    );
  });
});

describe('«Пригласить участника»', () => {
  it('ошибки полей, адрес участника, приглашение и «Все места тарифа заняты.»', async () => {
    await open();
    await row('Дарья Зимина');
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));
    let dlg = await dialog('Пригласить участника');
    await waitFor(() =>
      expect(dlg.textContent).toContain(
        'Свободно мест: 1 из 10 — это последнее. Приглашение занимает место сразу, до принятия.',
      ),
    );
    expect((within(dlg).getByLabelText('Область') as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Пригласить' }));
    expect(dlg.textContent).toContain('Укажите имя');
    expect(dlg.textContent).toContain('Укажите адрес');
    fireEvent.change(within(dlg).getByLabelText(/^Имя и фамилия/), { target: { value: 'Тест' } });
    fireEvent.change(within(dlg).getByLabelText(/^Электронная почта/), {
      target: { value: 'd.zimina@alta.example' },
    });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Пригласить' }));
    await waitFor(() =>
      expect(within(dlg).getByRole('alert').textContent).toBe('Участник с таким адресом уже есть'),
    );
    fireEvent.change(within(dlg).getByLabelText(/^Электронная почта/), {
      target: { value: 'p.novy@alta.example' },
    });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Пригласить' }));
    await waitFor(() =>
      expect(toast()?.textContent).toBe('Приглашение отправлено: p.novy@alta.example'),
    );
    await waitFor(() => expect(rowText('Тест')).toContain('Приглашён'));
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));
    dlg = await dialog('Пригласить участника');
    await waitFor(() => expect(dlg.textContent).toContain('Все места тарифа заняты.'));
    expect(
      (within(dlg).getByRole('button', { name: 'Пригласить' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

// Возврат 16.10 №1: места без данных подписки — не «без ограничения»: свои состояния загрузки и ошибки.
describe('«Пригласить участника»: места без данных подписки', () => {
  it('сбой getTenantSubscription — ошибка мест, «Повторить», «Пригласить» недоступна', async () => {
    const a = (app = await renderMockApp(`/t/${ALTA}/users`, {
      persona: 'owner',
      setup: (s) => s.setScenario('getTenantSubscription=rate_limited'),
    }));
    await row('Дарья Зимина');
    expect(screen.getByText('10 участников · без роли: 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));
    const dlg = await dialog('Пригласить участника');
    const alert = await within(dlg).findByRole('alert');
    await waitFor(() =>
      expect(alert.textContent).toContain('Не удалось проверить свободные места.'),
    );
    expect(dlg.textContent).not.toContain('Мест без ограничения');
    expect(
      (within(dlg).getByRole('button', { name: 'Пригласить' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    a.scenario.setScenario(null);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Повторить' }));
    await waitFor(() =>
      expect(dlg.textContent).toContain(
        'Свободно мест: 1 из 10 — это последнее. Приглашение занимает место сразу, до принятия.',
      ),
    );
    expect(
      (within(dlg).getByRole('button', { name: 'Пригласить' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('загрузка подписки — «Проверяем свободные места…», «Пригласить» недоступна', async () => {
    app = await renderMockApp(`/t/${ALTA}/users`, {
      persona: 'owner',
      setup: (s) => s.setScenario('getTenantSubscription=delay=4000'),
    });
    await row('Дарья Зимина');
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));
    const dlg = await dialog('Пригласить участника');
    expect(within(dlg).getByRole('status').textContent).toBe('Проверяем свободные места…');
    expect(dlg.textContent).not.toContain('Мест без ограничения');
    expect(
      (within(dlg).getByRole('button', { name: 'Пригласить' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('«Создать роль»', () => {
  it('пустое название — ошибка; из шаблона — тост и выбранная роль «Своя»', async () => {
    const a = await open('?tab=roles');
    fireEvent.click(await screen.findByRole('button', { name: 'Создать роль' }));
    const dlg = await dialog('Создать роль');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Создать и настроить' }));
    expect(within(dlg).getByRole('alert').textContent).toBe('Укажите название роли');
    fireEvent.change(within(dlg).getByLabelText(/^Название/), { target: { value: 'Диспетчер' } });
    fireEvent.click(within(dlg).getByRole('radio', { name: /Из шаблона/ }));
    expect(
      (within(dlg).getByRole('combobox', { name: 'Из шаблона' }) as HTMLSelectElement)
        .selectedOptions[0]?.text,
    ).toBe('Менеджер логистики');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Создать и настроить' }));
    await waitFor(() => expect(toast()?.textContent).toBe('Роль создана'));
    const created = await screen.findByRole('button', { name: /^ДиспетчерСвоя/ });
    await waitFor(() => expect(created.getAttribute('aria-pressed')).toBe('true'));
    expect(a.router.state.location.search).toMatchObject({ tab: 'roles' });
  });
});

describe('без эталона: карточка, владение, группы, «Почему доступно»', () => {
  // Возврат 16.10 №1: блокировка — с подтверждением (verification-protocol §7); после команд фокус остаётся в
  // карточке (иначе Escape её не закрывает).
  it('карточка: «Заблокировать» с подтверждением и «Разблокировать»; фокус в карточке', async () => {
    await open();
    fireEvent.click(
      within(await row('Тимур Ахмедов')).getByRole('button', { name: 'Тимур Ахмедов' }),
    );
    let card = await dialog('Тимур Ахмедов');
    expect(card.textContent).toContain('Водитель');
    fireEvent.click(within(card).getByRole('button', { name: 'Заблокировать' }));
    let confirm = await dialog('Заблокировать сотрудника «Тимур Ахмедов»?');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Отмена' }));
    card = await dialog('Тимур Ахмедов');
    expect(card.textContent).toContain('Активен');
    fireEvent.click(within(card).getByRole('button', { name: 'Заблокировать' }));
    confirm = await dialog('Заблокировать сотрудника «Тимур Ахмедов»?');
    expect(confirm.textContent).toContain('Вход и новые операции будут закрыты');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Заблокировать' }));
    await waitFor(() =>
      expect(toast()?.textContent).toBe('Сотрудник заблокирован: вход и новые операции закрыты'),
    );
    card = await dialog('Тимур Ахмедов');
    await waitFor(() => expect(card.textContent).toContain('Заблокирован'));
    await waitFor(() => expect(card.contains(document.activeElement)).toBe(true));
    const resume = within(card).getByRole('button', { name: 'Разблокировать' });
    resume.focus();
    fireEvent.click(resume);
    await waitFor(() => expect(toast()?.textContent).toBe('Сотрудник снова может входить'));
    await waitFor(() => expect(card.textContent).toContain('Активен'));
    expect(card.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toBe('Заблокировать');
  });

  it('своя карточка — без «Заблокировать» и «Передать владение»', async () => {
    await open();
    fireEvent.click(
      within(await row('Дарья Зимина')).getByRole('button', { name: 'Дарья Зимина' }),
    );
    const card = await dialog('Дарья Зимина');
    expect(within(card).queryByRole('button', { name: 'Заблокировать' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Передать владение' })).toBeNull();
    expect(card.textContent).toContain('Владелец бизнеса');
  });

  it('«Передать владение»: почта подтверждения, тост', async () => {
    await open();
    fireEvent.click(
      within(await row('Марина Котова')).getByRole('button', { name: 'Марина Котова' }),
    );
    fireEvent.click(
      within(await dialog('Марина Котова')).getByRole('button', { name: 'Передать владение' }),
    );
    const dlg = await dialog('Передать владение');
    fireEvent.change(within(dlg).getByLabelText('Почта получателя'), {
      target: { value: 'wrong@alta.example' },
    });
    fireEvent.change(within(dlg).getByLabelText('Причина'), {
      target: { value: 'Расширяем управление' },
    });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Передать владение' }));
    await waitFor(() =>
      expect(within(dlg).getByRole('alert').textContent).toBe(
        'Введите почту m.kotova@alta.example',
      ),
    );
    fireEvent.change(within(dlg).getByLabelText('Почта получателя'), {
      target: { value: 'm.kotova@alta.example' },
    });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Передать владение' }));
    await waitFor(() => expect(toast()?.textContent).toBe('Владение передано: Марина Котова'));
  });

  it('«Создать группу»: название, участник, тост и карточка', async () => {
    await open('?tab=groups');
    fireEvent.click(await screen.findByRole('button', { name: 'Создать группу' }));
    const dlg = await dialog('Создать группу');
    fireEvent.change(within(dlg).getByLabelText('Название группы'), {
      target: { value: 'Логисты Самара' },
    });
    fireEvent.click(within(dlg).getByRole('checkbox', { name: 'Вера Котельникова' }));
    fireEvent.click(within(dlg).getByRole('button', { name: 'Создать группу' }));
    await waitFor(() => expect(toast()?.textContent).toBe('Группа «Логисты Самара» создана'));
    const card = (await screen.findByText('Логисты Самара')).closest('article') as HTMLElement;
    await waitFor(() => expect(card.textContent).toContain('1 участник: Вера Котельникова'));
  });

  it('«Удалить группу» — с подтверждением; «Отмена» возвращает к составу', async () => {
    await open('?tab=groups');
    const card = (await screen.findByText('Диспетчеры Север')).closest('article') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Изменить состав' }));
    let dlg = await dialog('Состав группы «Диспетчеры Север»');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Удалить группу' }));
    let confirm = await dialog('Удалить группу «Диспетчеры Север»?');
    expect(toast()).toBeNull();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Отмена' }));
    dlg = await dialog('Состав группы «Диспетчеры Север»');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Удалить группу' }));
    confirm = await dialog('Удалить группу «Диспетчеры Север»?');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Удалить группу' }));
    await waitFor(() => expect(toast()?.textContent).toBe('Группа «Диспетчеры Север» удалена'));
    await waitFor(() => expect(screen.queryByText('Диспетчеры Север')).toBeNull());
  });

  it('«Почему доступно»: проверки по порядку', async () => {
    await open('?tab=check');
    await screen.findByRole('region', { name: 'Результат проверки' });
    fireEvent.click(await screen.findByRole('button', { name: 'Почему доступно' }));
    const dlg = await dialog('Почему доступно');
    await waitFor(() =>
      expect(
        within(within(dlg).getByRole('list', { name: 'Проверки по порядку' })).getAllByRole(
          'listitem',
        ),
      ).toHaveLength(6),
    );
    expect(dlg.textContent).toContain('Модуль «Логистика» не подключён.');
    // Возврат 16.10 №2: в подзаголовке — подпись действия, а не ключ права.
    expect(dlg.textContent).toContain('Марина Котова · Просматривать машины');
    expect(dlg.textContent).not.toContain('fleet.vehicles.read');
  });
});

// Возврат 16.10 №2: Escape закрывает диалог, если фокус в нём; подтверждение поверх диалога не уводит фокус из
// него, после закрытия фокус возвращается на вызвавшую кнопку.
const esc = () =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' });

describe('фокус: подтверждение поверх карточки и состава группы', { timeout: 20_000 }, () => {
  it('карточка: «Заблокировать» → «Отмена» → Escape — фокус на имени в строке', async () => {
    await open();
    const name = within(await row('Тимур Ахмедов')).getByRole('button', { name: 'Тимур Ахмедов' });
    name.focus();
    fireEvent.click(name);
    const card = await dialog('Тимур Ахмедов');
    const block = within(card).getByRole('button', { name: 'Заблокировать' });
    block.focus();
    fireEvent.click(block);
    const confirm = await dialog('Заблокировать сотрудника «Тимур Ахмедов»?');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Отмена' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /^Заблокировать сотрудника/ })).toBeNull(),
    );
    await waitFor(() => expect(card.contains(document.activeElement)).toBe(true));
    esc();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Тимур Ахмедов' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(name));
  });

  it('карточка: блокировка подтверждена → «Закрыть» — фокус на имени в строке', async () => {
    await open();
    const name = within(await row('Тимур Ахмедов')).getByRole('button', { name: 'Тимур Ахмедов' });
    name.focus();
    fireEvent.click(name);
    const card = await dialog('Тимур Ахмедов');
    const block = within(card).getByRole('button', { name: 'Заблокировать' });
    block.focus();
    fireEvent.click(block);
    const confirm = await dialog('Заблокировать сотрудника «Тимур Ахмедов»?');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Заблокировать' }));
    await waitFor(() =>
      expect(toast()?.textContent).toBe('Сотрудник заблокирован: вход и новые операции закрыты'),
    );
    await waitFor(() => expect(card.textContent).toContain('Заблокирован'));
    const close = within(card).getByRole('button', { name: 'Закрыть' });
    close.focus();
    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Тимур Ахмедов' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(name));
  });

  it('состав группы: «Удалить группу» → «Отмена» → Escape — фокус на «Изменить состав»', async () => {
    await open('?tab=groups');
    const card = (await screen.findByText('Диспетчеры Север')).closest('article') as HTMLElement;
    const edit = within(card).getByRole('button', { name: 'Изменить состав' });
    edit.focus();
    fireEvent.click(edit);
    const dlg = await dialog('Состав группы «Диспетчеры Север»');
    const remove = within(dlg).getByRole('button', { name: 'Удалить группу' });
    remove.focus();
    fireEvent.click(remove);
    const confirm = await dialog('Удалить группу «Диспетчеры Север»?');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Отмена' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /^Удалить группу/ })).toBeNull(),
    );
    await waitFor(() => expect(dlg.contains(document.activeElement)).toBe(true));
    esc();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /^Состав группы/ })).toBeNull(),
    );
    await waitFor(() => expect(document.activeElement).toBe(edit));
  });
});

// Возврат 16.10 №2: основная кнопка на время запроса — aria-disabled, не disabled (иначе браузер уводит фокус на
// body, и Escape диалог не закрывает); после ошибки сервера Escape закрывает диалог.
describe('основная кнопка диалога на время запроса', { timeout: 20_000 }, () => {
  const pending = async (btn: HTMLElement) => {
    btn.focus();
    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute('aria-disabled')).toBe('true'));
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(btn);
  };

  it('«Назначить роль»: aria-disabled на время запроса; ошибка → Escape закрывает', async () => {
    const a = await open();
    fireEvent.click(
      within(await row('Марина Котова')).getByRole('button', { name: 'Назначить роль' }),
    );
    const dlg = await dialog('Назначить роль');
    const roleSel = within(dlg).getByLabelText('Роль') as HTMLSelectElement;
    const spa = [...roleSel.options].find((o) => o.text === 'Массажист');
    fireEvent.change(roleSel, { target: { value: spa?.value } });
    a.scenario.setScenario('createAssignment=delay=600');
    await pending(within(dlg).getByRole('button', { name: 'Назначить' }));
    await waitFor(() => expect(toast()?.textContent).toBe('Роль «Массажист» назначена'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Назначить роль' })).toBeNull(),
    );
    fireEvent.click(
      within(await row('Анна Морозова')).getByRole('button', { name: 'Назначить роль' }),
    );
    const again = await dialog('Назначить роль');
    const sel = within(again).getByLabelText('Роль') as HTMLSelectElement;
    fireEvent.change(sel, {
      target: { value: [...sel.options].find((o) => o.text === 'Прораб')?.value },
    });
    a.scenario.setScenario('createAssignment=offline', true);
    const submit = within(again).getByRole('button', { name: 'Назначить' });
    submit.focus();
    fireEvent.click(submit);
    await waitFor(() => expect(within(again).getByRole('alert')).toBeTruthy());
    expect(again.contains(document.activeElement)).toBe(true);
    esc();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Назначить роль' })).toBeNull(),
    );
  });

  it('«Создать роль»: aria-disabled на время запроса', async () => {
    const a = await open('?tab=roles');
    fireEvent.click(await screen.findByRole('button', { name: 'Создать роль' }));
    const dlg = await dialog('Создать роль');
    fireEvent.change(within(dlg).getByLabelText(/^Название/), { target: { value: 'Диспетчер' } });
    a.scenario.setScenario('createRole=delay=600');
    await pending(within(dlg).getByRole('button', { name: 'Создать и настроить' }));
    await waitFor(() => expect(toast()?.textContent).toBe('Роль создана'));
  });

  it('«Создать группу»: aria-disabled на время запроса', async () => {
    const a = await open('?tab=groups');
    fireEvent.click(await screen.findByRole('button', { name: 'Создать группу' }));
    const dlg = await dialog('Создать группу');
    fireEvent.change(within(dlg).getByLabelText(/^Название группы/), {
      target: { value: 'Логисты Самара' },
    });
    a.scenario.setScenario('createGroup=delay=600');
    await pending(within(dlg).getByRole('button', { name: 'Создать группу' }));
    await waitFor(() => expect(toast()?.textContent).toBe('Группа «Логисты Самара» создана'));
  });

  it('«Передать владение»: aria-disabled на время запроса', async () => {
    const a = await open();
    fireEvent.click(
      within(await row('Марина Котова')).getByRole('button', { name: 'Марина Котова' }),
    );
    fireEvent.click(
      within(await dialog('Марина Котова')).getByRole('button', { name: 'Передать владение' }),
    );
    const dlg = await dialog('Передать владение');
    fireEvent.change(within(dlg).getByLabelText(/^Почта получателя/), {
      target: { value: 'm.kotova@alta.example' },
    });
    fireEvent.change(within(dlg).getByLabelText(/^Причина/), {
      target: { value: 'Расширяем управление' },
    });
    a.scenario.setScenario('transferOwnership=delay=600');
    await pending(within(dlg).getByRole('button', { name: 'Передать владение' }));
    await waitFor(() => expect(toast()?.textContent).toBe('Владение передано: Марина Котова'));
  });
});

// Возврат 16.10 №2 (minor): ошибки полей диалогов без эталона связаны с полем (aria-invalid, текст в подписи).
describe('ошибки полей: группа и передача владения', () => {
  it('«Создать группу» без названия — aria-invalid и ошибка в подписи поля', async () => {
    await open('?tab=groups');
    fireEvent.click(await screen.findByRole('button', { name: 'Создать группу' }));
    const dlg = await dialog('Создать группу');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Создать группу' }));
    const input = within(dlg).getByLabelText(/^Название группы/);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.closest('label')?.textContent).toContain('Укажите название группы');
  });

  it('«Передать владение»: причина и почта — ошибка у своего поля', async () => {
    await open();
    fireEvent.click(
      within(await row('Марина Котова')).getByRole('button', { name: 'Марина Котова' }),
    );
    fireEvent.click(
      within(await dialog('Марина Котова')).getByRole('button', { name: 'Передать владение' }),
    );
    const dlg = await dialog('Передать владение');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Передать владение' }));
    const reason = within(dlg).getByLabelText(/^Причина/);
    expect(reason.getAttribute('aria-invalid')).toBe('true');
    expect(reason.closest('label')?.textContent).toContain('Причина — не короче 5 символов');
    fireEvent.change(reason, { target: { value: 'Расширяем управление' } });
    fireEvent.change(within(dlg).getByLabelText(/^Почта получателя/), {
      target: { value: 'wrong@alta.example' },
    });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Передать владение' }));
    const mail = within(dlg).getByLabelText(/^Почта получателя/);
    await waitFor(() => expect(mail.getAttribute('aria-invalid')).toBe('true'));
    expect(mail.closest('.ox-dlg-field')?.textContent).toContain(
      'Введите почту m.kotova@alta.example',
    );
  });
});

// Возврат 16.10 №2 (minor): createGroup прошёл, setGroupMembers упал — повтор не создаёт вторую группу.
describe('«Создать группу»: частичный сбой', { timeout: 20_000 }, () => {
  it('после сбоя состава диалог переходит к правке созданной группы', async () => {
    const a = await open('?tab=groups');
    fireEvent.click(await screen.findByRole('button', { name: 'Создать группу' }));
    const dlg = await dialog('Создать группу');
    fireEvent.change(within(dlg).getByLabelText(/^Название группы/), {
      target: { value: 'Логисты Самара' },
    });
    fireEvent.click(within(dlg).getByRole('checkbox', { name: 'Вера Котельникова' }));
    a.scenario.setScenario('setGroupMembers=offline', true);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Создать группу' }));
    const edit = await dialog('Состав группы «Логисты Самара»');
    expect(within(edit).getByRole('alert').textContent).toContain('Нет связи');
    expect(
      (within(edit).getByRole('checkbox', { name: 'Вера Котельникова' }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    fireEvent.click(within(edit).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(toast()?.textContent).toBe('Состав группы «Логисты Самара» сохранён'),
    );
    await waitFor(() => expect(screen.getAllByText('Логисты Самара')).toHaveLength(1));
    expect(
      a.responses().filter((r) => r.method === 'POST' && r.path.endsWith('/groups')),
    ).toHaveLength(1);
  });
});

// Возврат 16.10 №3: кнопки-источника после закрытия диалога больше нет — фокус не уходит на body (WCAG 2.4.3,
// verification-protocol §1.3): после передачи владения — «Закрыть» карточки (кнопка «Передать владение» исчезла,
// получатель стал владельцем); после удаления группы — «Создать группу»; после диалога из адреса ?assign= —
// «Назначить роль» в строке участника.
describe('фокус: кнопки-источника больше нет', { timeout: 20_000 }, () => {
  it('«Передать владение» выполнено — фокус на «Закрыть» карточки; Escape закрывает карточку', async () => {
    await open();
    const name = within(await row('Марина Котова')).getByRole('button', { name: 'Марина Котова' });
    name.focus();
    fireEvent.click(name);
    const card = await dialog('Марина Котова');
    const transfer = within(card).getByRole('button', { name: 'Передать владение' });
    transfer.focus();
    fireEvent.click(transfer);
    const dlg = await dialog('Передать владение');
    fireEvent.change(within(dlg).getByLabelText('Почта получателя'), {
      target: { value: 'm.kotova@alta.example' },
    });
    fireEvent.change(within(dlg).getByLabelText('Причина'), {
      target: { value: 'Расширяем управление' },
    });
    const submit = within(dlg).getByRole('button', { name: 'Передать владение' });
    submit.focus();
    fireEvent.click(submit);
    await waitFor(() => expect(toast()?.textContent).toBe('Владение передано: Марина Котова'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Передать владение' })).toBeNull(),
    );
    await waitFor(() => expect(card.textContent).toContain('Владелец бизнеса'));
    await waitFor(() =>
      expect(document.activeElement).toBe(within(card).getByRole('button', { name: 'Закрыть' })),
    );
    esc();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Марина Котова' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(name));
  });

  it('«Удалить группу» подтверждено — фокус на «Создать группу»', async () => {
    await open('?tab=groups');
    const card = (await screen.findByText('Диспетчеры Север')).closest('article') as HTMLElement;
    const edit = within(card).getByRole('button', { name: 'Изменить состав' });
    edit.focus();
    fireEvent.click(edit);
    const dlg = await dialog('Состав группы «Диспетчеры Север»');
    const remove = within(dlg).getByRole('button', { name: 'Удалить группу' });
    remove.focus();
    fireEvent.click(remove);
    const confirm = await dialog('Удалить группу «Диспетчеры Север»?');
    const yes = within(confirm).getByRole('button', { name: 'Удалить группу' });
    yes.focus();
    fireEvent.click(yes);
    await waitFor(() => expect(toast()?.textContent).toBe('Группа «Диспетчеры Север» удалена'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Создать группу' })),
    );
  });

  it('диалог из адреса ?assign= — после Escape фокус на «Назначить роль» в строке', async () => {
    await open(`?tab=people&assign=${seedUuid('t-alta', 'm-kotova')}`);
    const dlg = await dialog('Назначить роль');
    await waitFor(() => expect(dlg.contains(document.activeElement)).toBe(true));
    esc();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Назначить роль' })).toBeNull(),
    );
    const assign = within(await row('Марина Котова')).getByRole('button', {
      name: 'Назначить роль',
    });
    await waitFor(() => expect(document.activeElement).toBe(assign));
  });
});
