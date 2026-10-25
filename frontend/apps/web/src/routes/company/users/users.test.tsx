// W1.23 · Экранные тесты «Пользователи и роли» на MSW-сценарном сервере W0.13 (сид W0.12): вкладки «Люди»,
// «Группы», «Роли» (RoleEditor), «Проверка доступа»; состояния загрузки и ошибки (эталон design-stage-1
// :283–427; чек-лист 02-company §10 #15–#17, #27–#32, #34).
import { seedUuid } from '@ortus/domain/seed';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, renderMockApp } from '../../../app/testing.tsx';

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

const open = async (query = '', o: Parameters<typeof renderMockApp>[1] = {}) => {
  app = await renderMockApp(`/t/${ALTA}/users${query}`, { persona: 'owner', ...o });
  await screen.findByRole('heading', { level: 1, name: 'Пользователи и роли' });
  return app;
};

const people = () => screen.findByRole('list', { name: 'Участники' });
const row = async (name: string) =>
  within(await people())
    .getAllByRole('listitem')
    .find((li) => li.textContent?.includes(name)) as HTMLElement;

describe('«Люди»', () => {
  it('шапка, вкладки со счётчиками, строка мест, назначения и статусы', async () => {
    await open();
    expect(screen.getByText('Альта Групп / Компания и доступ')).toBeTruthy();
    const tabs = within(screen.getByRole('tablist', { name: 'Разделы доступа' })).getAllByRole(
      'tab',
    );
    await waitFor(() =>
      expect(tabs.map((t) => t.textContent)).toEqual([
        'Люди10',
        'Группы2',
        'Роли9',
        'Проверка доступа',
      ]),
    );
    expect(
      await screen.findByText('10 участников · без роли: 3 · мест занято 9 из 10'),
    ).toBeTruthy();
    expect(within(await people()).getAllByRole('listitem')).toHaveLength(10);
    expect((await row('Илья Васильев')).textContent).toContain(
      'Водитель· Москва / Север Логистик· через группу «Водители Север»',
    );
    expect((await row('Илья Васильев')).textContent).toContain(
      'Функция «Водитель»: начисления недоступны через любую роль',
    );
    expect((await row('Олеся Петрова')).textContent).toContain('Приглашён');
    const gromov = await row('Кирилл Громов');
    expect(gromov.textContent).toContain('Заблокирован');
    expect(
      (within(gromov).getByRole('button', { name: 'Назначить роль' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  // Возврат 16.10 №1: участник с members.read без roles.read на всю организацию (Котова — «Менеджер логистики»
  // в «Север Логистик») — бриф §1 называет его пользователем страницы: listRoles 403 не роняет страницу.
  it('нет права на роли: «Люди» открыты, вкладка «Роли» — «Нет права…» без «Повторить»', async () => {
    app = await renderMockApp(`/t/${ALTA}/users`, {
      persona: 'manager',
      preset: 'logistics-ready',
    });
    await screen.findByRole('heading', { level: 1, name: 'Пользователи и роли' });
    expect(await people()).toBeTruthy();
    expect(screen.queryByText(/Не удалось загрузить список/)).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /^Роли/ }));
    const note = await screen.findByText('Нет права просматривать роли организации.');
    expect(note).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
  });

  // Возврат 16.10 №1: вход по адресу проверяет участника и роль.
  it('?assign= заблокированного участника — диалог не открывается', async () => {
    await open(`?tab=people&assign=${seedUuid('t-alta', 'm-gromov')}`);
    await people();
    expect((await row('Кирилл Громов')).textContent).toContain('Заблокирован');
    expect(screen.queryByRole('dialog', { name: 'Назначить роль' })).toBeNull();
  });

  it('?assign=&role=<системная роль> — роль не подставляется', async () => {
    await open(
      `?tab=people&assign=${seedUuid('t-alta', 'm-kotova')}&role=${seedUuid('t-alta', 'r-owner')}`,
    );
    const dlg = await screen.findByRole('dialog', { name: 'Назначить роль' });
    expect((within(dlg).getByLabelText('Роль') as HTMLSelectElement).value).toBe('');
    expect(dlg.textContent).toContain('Роль не выбрана · Москва / Север Логистик');
  });

  it('ошибка загрузки списка — текст и «Повторить»', async () => {
    app = await renderMockApp(`/t/${ALTA}/users`, {
      persona: 'owner',
      setup: (s) => s.setScenario('listMembers=rate_limited', true),
    });
    const alert = await screen.findByText(/Не удалось загрузить список/);
    fireEvent.click(
      within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', {
        name: 'Повторить',
      }),
    );
    expect(await people()).toBeTruthy();
  });
});

describe('«Группы»', () => {
  it('карточки групп: участники и роли через группу', async () => {
    await open('?tab=groups');
    const drv = (await screen.findByText('Водители Север')).closest('article') as HTMLElement;
    expect(drv.textContent).toContain('2 участника: Илья Васильев, Кирилл Громов');
    expect(drv.textContent).toContain(
      'Роли через группу: Исполнитель · Проект «Логистика · Север»; Водитель · Москва / Север Логистик',
    );
    const disp = (await screen.findByText('Диспетчеры Север')).closest('article') as HTMLElement;
    expect(disp.textContent).toContain('Роли через группу не назначены');
  });
});

describe('«Роли»', () => {
  const roleBtn = (name: string) =>
    screen.findByRole('button', { name: new RegExp(`^${name}(Системная|Шаблон|Своя)`) });

  it('список: чипы и мета, выбрана «Менеджер логистики», редактор и итог', async () => {
    await open('?tab=roles');
    expect((await roleBtn('Владелец бизнеса')).textContent).toBe(
      'Владелец бизнесаСистемная Все права · назначена: 1',
    );
    const manager = await roleBtn('Менеджер логистики');
    expect(manager.textContent).toBe('Менеджер логистикиШаблон 34 разрешений · назначена: 0');
    expect(manager.getAttribute('aria-pressed')).toBe('true');
    const editor = await screen.findByRole('region', { name: 'Редактор роли' });
    expect((within(editor).getByLabelText('Название роли') as HTMLInputElement).value).toBe(
      'Менеджер логистики',
    );
    const fleet = within(editor).getByRole('switch', { name: 'Доступ роли к модулю Логистика' });
    expect(fleet.getAttribute('aria-checked')).toBe('true');
    expect((fleet as HTMLButtonElement).disabled).toBe(true);
    const aside = screen.getByRole('complementary', { name: 'Итоговые права роли' });
    expect(aside.textContent).toContain('Роль пока никому не назначена');
    expect(aside.textContent).toContain('fleet.trips.review');
    expect(aside.textContent).toContain('Начисления видны в области назначения');
  });

  it('изменение: «Есть несохранённые изменения», «Отменить», «Сохранить роль» → тост', async () => {
    await open('?tab=roles');
    const editor = await screen.findByRole('region', { name: 'Редактор роли' });
    fireEvent.click(within(editor).getByRole('switch', { name: 'Доступ роли к модулю Задачи' }));
    expect(screen.getByText('Есть несохранённые изменения')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(screen.queryByText('Есть несохранённые изменения')).toBeNull();
    fireEvent.change(within(editor).getByLabelText('Название роли'), {
      target: { value: 'Менеджер Север' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить роль' }));
    expect(await screen.findByText('Роль «Менеджер Север» сохранена')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Есть несохранённые изменения')).toBeNull());
  });

  it('системная роль: имя недоступно, итог «*»', async () => {
    await open('?tab=roles');
    fireEvent.click(await roleBtn('Владелец бизнеса'));
    const editor = await screen.findByRole('region', { name: 'Редактор роли' });
    expect((within(editor).getByLabelText('Название роли') as HTMLInputElement).disabled).toBe(
      true,
    );
    const aside = screen.getByRole('complementary', { name: 'Итоговые права роли' });
    expect([...aside.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['*']);
  });

  // Возврат 16.10 №1 (blocker): у «Водителя» задачи и календарь выданы частично (tasks.read,
  // calendar.availability.read) — переименование и выключение другого модуля их не снимают.
  it('«Водитель»: переименование сохраняет права; выключение «Задач» не трогает «Календарь»', async () => {
    await open('?tab=roles');
    fireEvent.click(await roleBtn('Водитель'));
    const editor = await screen.findByRole('region', { name: 'Редактор роли' });
    await waitFor(() =>
      expect((within(editor).getByLabelText('Название роли') as HTMLInputElement).value).toBe(
        'Водитель',
      ),
    );
    const aside = screen.getByRole('complementary', { name: 'Итоговые права роли' });
    const keys = () => [...aside.querySelectorAll('code')].map((c) => c.textContent);
    const before = keys();
    expect(before).toEqual(expect.arrayContaining(['tasks.read', 'calendar.availability.read']));
    const calendar = within(editor).getByRole('switch', { name: 'Доступ роли к модулю Календарь' });
    const tasks = within(editor).getByRole('switch', { name: 'Доступ роли к модулю Задачи' });
    expect(calendar.getAttribute('aria-checked')).toBe('true');
    expect(editor.textContent).not.toMatch(/0 из \d+ действий/);
    fireEvent.change(within(editor).getByLabelText('Название роли'), {
      target: { value: 'Водитель рейса' },
    });
    expect(screen.getByText('Есть несохранённые изменения')).toBeTruthy();
    expect(keys()).toEqual(before);
    fireEvent.click(tasks);
    expect(tasks.getAttribute('aria-checked')).toBe('false');
    expect(calendar.getAttribute('aria-checked')).toBe('true');
    const notTasks = (ks: (string | null)[]) => ks.filter((k) => !k?.startsWith('tasks.'));
    expect(keys().filter((k) => k?.startsWith('tasks.'))).toEqual([]);
    expect(notTasks(keys())).toEqual(notTasks(before));
  });

  // Возврат 16.10 №2: черновик роли живёт на странице (эталон: roleDraft в состоянии страницы) — смена вкладки
  // его не теряет.
  it('«Роли» → правка → «Люди» → «Роли»: правка и «Есть несохранённые изменения» остаются', async () => {
    await open('?tab=roles');
    let editor = await screen.findByRole('region', { name: 'Редактор роли' });
    fireEvent.click(within(editor).getByRole('switch', { name: 'Доступ роли к модулю Задачи' }));
    expect(screen.getByText('Есть несохранённые изменения')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /^Люди/ }));
    await people();
    fireEvent.click(screen.getByRole('tab', { name: /^Роли/ }));
    editor = await screen.findByRole('region', { name: 'Редактор роли' });
    expect(
      within(editor)
        .getByRole('switch', { name: 'Доступ роли к модулю Задачи' })
        .getAttribute('aria-checked'),
    ).toBe('false');
    expect(screen.getByText('Есть несохранённые изменения')).toBeTruthy();
  });

  // Возврат 16.10 №2 (minor): после «Сохранить роль» перечитываются роли, а не все списки страницы.
  it('«Сохранить роль» перечитывает роли, но не людей, группы и подписку', async () => {
    const a = await open('?tab=roles');
    const editor = await screen.findByRole('region', { name: 'Редактор роли' });
    fireEvent.change(within(editor).getByLabelText('Название роли'), {
      target: { value: 'Менеджер Север' },
    });
    const from = a.responses().length;
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить роль' }));
    expect(await screen.findByText('Роль «Менеджер Север» сохранена')).toBeTruthy();
    await waitFor(() =>
      expect(
        a
          .responses()
          .slice(from)
          .some((r) => r.method === 'GET' && r.path.endsWith('/roles')),
      ).toBe(true),
    );
    const after = a
      .responses()
      .slice(from)
      .filter((r) => r.method === 'GET')
      .map((r) => r.path.split('/').pop());
    expect(after).not.toContain('members');
    expect(after).not.toContain('groups');
    expect(after).not.toContain('subscription');
    expect(after).not.toContain('org-units');
  });

  it('пустой список ролей: «Создать роль» и текст пустого состояния', async () => {
    await open('?tab=roles', { setup: (s) => s.setScenario('listRoles=empty') });
    expect(await screen.findByText('Ролей пока нет. Создайте первую роль.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Создать роль' })).toBeTruthy();
  });

  it('«Водитель»: функция «Водитель», финансы недоступны', async () => {
    await open('?tab=roles');
    fireEvent.click(await roleBtn('Водитель'));
    const editor = await screen.findByRole('region', { name: 'Редактор роли' });
    expect(editor.textContent).toContain('Профессиональная функция «Водитель».');
    expect(editor.textContent).toContain(
      'Роль с функцией «Водитель» не может содержать начисления',
    );
  });
});

describe('«Проверка доступа»', () => {
  it('по умолчанию: Котова · «Просматривать машины» — «Модуль не подключён»', async () => {
    await open('?tab=check');
    const result = await screen.findByRole('region', { name: 'Результат проверки' });
    await waitFor(() =>
      expect(result.textContent).toContain('Марина Котова не может: просматривать машины'),
    );
    expect(result.textContent).toContain(
      'Модуль не подключён организацией. Подключить его может владелец бизнеса. Модуль: Логистика.',
    );
    await waitFor(() => expect(result.textContent).toContain('Нет доступных разделов модулей'));
  });

  // W4.85 · Q-W1.23-8: «Объект» — машины и рейсы логистики (эталон OBJECTS :2344), а не фирмы организации.
  it('«Объект»: машины и рейсы с подразделением; по умолчанию — первая машина домашней фирмы', async () => {
    await open('?tab=check', { preset: 'logistics-ready' });
    const select = (await screen.findByLabelText(/^Объект/)) as HTMLSelectElement;
    await waitFor(() =>
      expect([...select.options].map((o) => o.text)).toContain(
        'ГАЗель Next · Москва / Север Логистик',
      ),
    );
    const labels = [...select.options].map((o) => o.text);
    expect(labels.some((l) => /^Рейс Р-\d+ · Москва \/ /.test(l))).toBe(true);
    expect(labels.at(-1)).toBe('Без конкретного объекта');
    expect(labels).not.toContain('Москва / Север Логистик');
    expect(select.selectedOptions[0]?.text).toMatch(/ · Москва \/ Север Логистик$/);
  });

  it('«Объект» без права на машины и рейсы — фирмы организации, как прежде', async () => {
    await open('?tab=check');
    const select = (await screen.findByLabelText(/^Объект/)) as HTMLSelectElement;
    await waitFor(() =>
      expect([...select.options].map((o) => o.text)).toContain('Москва / Север Логистик'),
    );
    expect([...select.options].map((o) => o.text)).not.toContain(
      'ГАЗель Next · Москва / Север Логистик',
    );
  });
  // Возврат 16.10 №1: состояния главного запроса вкладки (verification-protocol §1.3).
  it('ошибка explainAccess — текст ошибки и «Повторить»', async () => {
    const a = await open('?tab=check', {
      setup: (s) => s.setScenario('explainAccess=rate_limited'),
    });
    const result = await screen.findByRole('region', { name: 'Результат проверки' });
    const alert = await within(result).findByRole('alert');
    expect(alert.textContent).toContain('Не удалось проверить доступ.');
    a.scenario.setScenario(null);
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await waitFor(() =>
      expect(result.textContent).toContain('Марина Котова не может: просматривать машины'),
    );
    expect(within(result).queryByRole('alert')).toBeNull();
  });

  it('загрузка explainAccess — «Проверяем доступ…» и aria-busy', async () => {
    const a = await open('?tab=check', {
      setup: (s) => s.setScenario('explainAccess=delay=1500'),
    });
    const result = await screen.findByRole('region', { name: 'Результат проверки' });
    await waitFor(() => expect(result.getAttribute('aria-busy')).toBe('true'));
    expect(within(result).getByRole('status').textContent).toBe('Проверяем доступ…');
    a.scenario.setScenario(null);
    await waitFor(() =>
      expect(result.textContent).toContain('Марина Котова не может: просматривать машины'),
    );
    expect(result.getAttribute('aria-busy')).toBe('false');
  });

  // Возврат 16.10 №2 (minor): сбой запросов «Рабочего места» — не пустой список, а ошибка с «Повторить».
  it(
    'сбой «Рабочего места» — ошибка и «Повторить», а не «Нет доступных разделов»',
    { timeout: 20_000 },
    async () => {
      const a = await open('?tab=check');
      const result = await screen.findByRole('region', { name: 'Результат проверки' });
      await waitFor(() => expect(result.textContent).toContain('Нет доступных разделов модулей'));
      a.scenario.setScenario('explainAccess=rate_limited');
      const member = screen.getByLabelText('Сотрудник') as HTMLSelectElement;
      const vasiliev = [...member.options].find((o) => o.text.startsWith('Илья Васильев'));
      fireEvent.change(member, { target: { value: vasiliev?.value } });
      await within(result).findByRole('alert');
      a.scenario.setScenario(null);
      // Другой объект — новый главный запрос; запросы «Рабочего места» (без объекта) остаются в ошибке.
      fireEvent.change(screen.getByLabelText(/^Объект/), { target: { value: '' } });
      await waitFor(() => expect(result.textContent).toContain('Илья Васильев'));
      await waitFor(() =>
        expect(result.textContent).toContain('Не удалось вычислить рабочее место сотрудника.'),
      );
      expect(result.textContent).not.toContain('Нет доступных разделов модулей');
      fireEvent.click(within(result).getByRole('button', { name: 'Повторить' }));
      await waitFor(() =>
        expect(result.textContent).not.toContain('Не удалось вычислить рабочее место сотрудника.'),
      );
    },
  );

  // Порядок проверок контракта (x-authorization-order): модуль раньше SoD — с подключённой «Логистикой».
  it('пресет «Начисления водителю» — «Запрещено функцией «Водитель»»', async () => {
    await open('?tab=check', { preset: 'logistics-ready' });
    await screen.findByRole('region', { name: 'Результат проверки' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Начисления водителю' }));
    });
    const result = screen.getByRole('region', { name: 'Результат проверки' });
    await waitFor(() =>
      expect(result.textContent).toContain('Илья Васильев не может: видеть начисления'),
    );
    expect(result.textContent).toContain('Запрещено функцией «Водитель»');
  });
});

// Возврат 16.10 №3 (major): участник с правами в своей области (бриф §1) — Котова, «Менеджер логистики» в «Север
// Логистик», пресет logistics-ready: listRoles — 403, listAssignments — 200. Роль назначения не видна — строка
// говорит об этом, а не начинается с «· »; действий без права записи нет (сервер отказал бы после нажатия).
describe(
  'участник с правами в своей области (Котова, logistics-ready)',
  { timeout: 20_000 },
  () => {
    const HIDDEN = 'Роль не видна — нет права просматривать роли';
    const asManager = async (query = '') => {
      app = await renderMockApp(`/t/${ALTA}/users${query}`, {
        persona: 'manager',
        preset: 'logistics-ready',
      });
      await screen.findByRole('heading', { level: 1, name: 'Пользователи и роли' });
      return app;
    };

    it('«Люди» и карточка: «Роль не видна — нет права просматривать роли · …»', async () => {
      await asManager();
      const vas = await row('Илья Васильев');
      await waitFor(() =>
        expect(vas.textContent).toContain(
          `${HIDDEN}· Проект «Логистика · Север»· через группу «Водители Север»`,
        ),
      );
      const lines = [...vas.querySelectorAll('.ox-grant')].map((g) => g.textContent ?? '');
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.filter((l) => l.startsWith('·'))).toEqual([]);
      fireEvent.click(within(vas).getByRole('button', { name: 'Илья Васильев' }));
      const card = await screen.findByRole('dialog', { name: 'Илья Васильев' });
      expect(card.textContent).toContain(
        `${HIDDEN} · Проект «Логистика · Север» · через группу «Водители Север»`,
      );
    });

    it('«Группы»: «Роли через группу: Роль не видна…»; участники вне области названы', async () => {
      await asManager('?tab=groups');
      const drv = (await screen.findByText('Водители Север')).closest('article') as HTMLElement;
      expect(drv.textContent).toContain(
        `Роли через группу: ${HIDDEN} · Проект «Логистика · Север»; ${HIDDEN} · `,
      );
      const disp = (await screen.findByText('Диспетчеры Север')).closest('article') as HTMLElement;
      expect(disp.textContent).not.toContain('0 участников: ');
      expect(disp.textContent).toContain('вне вашей области');
    });

    it('без права записи: нет «Пригласить», «Заблокировать», «Создать группу», «Изменить состав»', async () => {
      await asManager();
      await people();
      expect(screen.queryByRole('button', { name: 'Пригласить' })).toBeNull();
      fireEvent.click(
        within(await row('Илья Васильев')).getByRole('button', { name: 'Илья Васильев' }),
      );
      const card = await screen.findByRole('dialog', { name: 'Илья Васильев' });
      expect(within(card).queryByRole('button', { name: 'Заблокировать' })).toBeNull();
      fireEvent.click(within(card).getByRole('button', { name: 'Закрыть' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      fireEvent.click(screen.getByRole('tab', { name: /^Группы/ }));
      await screen.findByText('Водители Север');
      expect(screen.queryByRole('button', { name: 'Создать группу' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Изменить состав' })).toBeNull();
    });
  },
);

// Возврат 16.10 №3 (minor): гейт пускает с roles.read без members.read — listMembers и listGroups 403 показываются
// как «нет права», а не как пустой список «0 участников · мест занято 0 из 10» с «Пригласить».
describe('нет права на участников (listMembers и listGroups — 403)', { timeout: 20_000 }, () => {
  it('«Люди» и «Группы» — «Нет права просматривать…», без «Пригласить» и строки мест', async () => {
    await open('', {
      setup: (s) => s.setScenario('listMembers=forbidden_action,listGroups=forbidden_action'),
    });
    expect(await screen.findByText('Нет права просматривать участников организации.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Пригласить' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Участники' })).toBeNull();
    expect(screen.queryByText(/участников · /)).toBeNull();
    expect(screen.queryByText(/Не удалось загрузить список/)).toBeNull();
    const tabs = within(screen.getByRole('tablist', { name: 'Разделы доступа' })).getAllByRole(
      'tab',
    );
    expect(tabs[0]?.textContent).toBe('Люди');
    fireEvent.click(screen.getByRole('tab', { name: /^Группы/ }));
    expect(await screen.findByText('Нет права просматривать группы организации.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Создать группу' })).toBeNull();
  });
});

// Возврат 16.10 №3 (major): кнопки подвала редактора — aria-disabled, а не disabled (иначе фокус уходит на body);
// после «Отменить» и «Сохранить роль» фокус — на поле «Название роли».
describe('«Роли»: подвал редактора и порядок итога', { timeout: 20_000 }, () => {
  it('«Отменить» и «Сохранить роль»: aria-disabled; фокус после команды — «Название роли»', async () => {
    await open('?tab=roles');
    const editor = await screen.findByRole('region', { name: 'Редактор роли' });
    const revert = screen.getByRole('button', { name: 'Отменить' });
    expect(revert.hasAttribute('disabled')).toBe(false);
    expect(revert.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(within(editor).getByRole('switch', { name: 'Доступ роли к модулю Задачи' }));
    expect(revert.getAttribute('aria-disabled')).toBeNull();
    revert.focus();
    fireEvent.click(revert);
    expect(screen.queryByText('Есть несохранённые изменения')).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(within(editor).getByLabelText('Название роли')),
    );
    fireEvent.change(within(editor).getByLabelText('Название роли'), {
      target: { value: 'Менеджер Север' },
    });
    const save = screen.getByRole('button', { name: 'Сохранить роль' });
    save.focus();
    fireEvent.click(save);
    expect(await screen.findByText('Роль «Менеджер Север» сохранена')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Есть несохранённые изменения')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(within(editor).getByLabelText('Название роли')),
    );
    expect(screen.getByRole('button', { name: 'Сохранить роль' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('«Итоговые права роли» — в порядке модулей: сначала логистика, затем прочие ключи', async () => {
    await open('?tab=roles');
    const aside = await screen.findByRole('complementary', { name: 'Итоговые права роли' });
    const keys = [...aside.querySelectorAll('code')].map((c) => c.textContent ?? '');
    expect(keys[0]).toBe('fleet.vehicles.read');
    const firstOther = keys.findIndex((k) => !k.startsWith('fleet.'));
    expect(keys.slice(firstOther).filter((k) => /^fleet\.(?!earnings)/.test(k))).toEqual([]);
    expect(keys.indexOf('members.read')).toBeGreaterThan(keys.indexOf('fleet.earnings.read'));
  });
});
