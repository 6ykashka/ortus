import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../../test/axe';
import type { RoleCatalog, RoleDraft, RoleEditorProps } from '../../types';
import { RoleEditor } from '../RoleEditor';

// Каталог в форме, которую строит страница W1.23 из api/permissions.yaml: уровни модуля и финансовые
// разрешения логистики отдельно (restricted).
const CATALOG: RoleCatalog = {
  modules: [
    {
      key: 'logistics',
      name: 'Логистика',
      icon: 'local_shipping',
      on: false,
      verbs: [
        { key: 'view', label: 'Просматривать', perms: ['fleet.trips.read'] },
        { key: 'create', label: 'Создавать', perms: ['fleet.reservations.create'] },
        { key: 'edit', label: 'Изменять', perms: ['fleet.routes.manage'] },
        { key: 'review', label: 'Проверять', perms: ['fleet.trips.review'] },
        { key: 'settings', label: 'Настраивать', perms: ['fleet.vehicles.manage'] },
        {
          key: 'earnings.read',
          label: 'Видеть начисления водителям',
          perms: ['fleet.earnings.read'],
          restricted: true,
        },
        {
          key: 'earnings.manage',
          label: 'Управлять начислениями',
          perms: ['fleet.earnings.manage'],
          restricted: true,
        },
      ],
    },
    {
      key: 'tasks',
      name: 'Задачи',
      icon: 'task_alt',
      on: true,
      verbs: [
        { key: 'view', label: 'Просматривать', perms: ['tasks.read', 'tasks.projects.read'] },
        { key: 'create', label: 'Создавать', perms: ['tasks.create'] },
        { key: 'edit', label: 'Изменять', perms: ['tasks.update'] },
        { key: 'review', label: 'Проверять', perms: ['tasks.approve'] },
      ],
    },
    {
      key: 'files',
      name: 'Файлы',
      icon: 'folder_open',
      on: true,
      verbs: [
        { key: 'view', label: 'Просматривать', perms: ['files.read'] },
        { key: 'create', label: 'Создавать', perms: ['files.upload'] },
      ],
    },
  ],
};

const MANAGER: RoleDraft = {
  id: 'r-manager',
  name: 'Менеджер логистики',
  actions: {
    logistics: ['view', 'edit', 'review', 'settings', 'earnings.read'],
    tasks: ['create', 'edit'],
  },
};

function Harness(
  p: Partial<RoleEditorProps> & { onDraft?: (r: RoleDraft) => void; initial?: RoleDraft },
) {
  const [role, setRole] = useState(p.initial ?? MANAGER);
  return (
    <RoleEditor
      catalog={CATALOG}
      initiallyOpen={['logistics']}
      {...p}
      role={role}
      onChange={(r) => {
        setRole(r);
        p.onDraft?.(r);
      }}
    />
  );
}

const sw = (name: string) => screen.getByRole('switch', { name: `Доступ роли к модулю ${name}` });
const finance = () => screen.getByRole('group', { name: 'Финансовые разрешения' });

describe('RoleEditor (Ортус CRM.dc.html:346–372, roleEditorVM :3168–3216)', () => {
  it('UD-47: модуль не подключён — включён и недоступен; действия раскрыты; финансы; имя', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Название роли')).toHaveValue('Менеджер логистики');
    expect(screen.getByRole('heading', { level: 3, name: 'Модули и действия' })).toBeVisible();
    expect(sw('Логистика')).toHaveAttribute('aria-checked', 'true');
    expect(sw('Логистика')).toBeDisabled();
    expect(
      screen.getByText('Модуль не подключён организацией — включение недоступно'),
    ).toBeVisible();
    const row = sw('Логистика').closest('[data-module]') as HTMLElement;
    for (const v of ['Просматривать', 'Изменять', 'Проверять', 'Настраивать']) {
      expect(within(row).getByRole('checkbox', { name: v })).toBeChecked();
    }
    expect(within(row).getByRole('checkbox', { name: 'Создавать' })).not.toBeChecked();
    expect(
      within(row).getByRole('button', { name: 'Свернуть действия: Логистика' }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(finance()).getByRole('checkbox', { name: /Видеть начисления водителям/ }),
    ).toBeChecked();
    expect(
      within(finance()).getByRole('checkbox', { name: /Управлять начислениями/ }),
    ).not.toBeChecked();
    expect(within(finance()).getByText('fleet.earnings.read')).toBeVisible();
    expect(
      screen.getByText(
        'Выдаются отдельно и не включаются переключателем модуля. Действуют только в области назначения.',
      ),
    ).toBeVisible();
  });

  // Возврат W1.23 16.10 №2: контракт W0.10 (types/domain.ts) — группы `fieldset` + `legend`.
  it('группы — fieldset + legend: модули, действия модуля, финансовые разрешения', () => {
    render(<Harness />);
    const modules = screen.getByRole('group', { name: 'Модули и действия' });
    expect(modules.tagName).toBe('FIELDSET');
    expect(within(modules).getByRole('heading', { level: 3, name: 'Модули и действия' })).toBe(
      screen.getByRole('heading', { level: 3, name: 'Модули и действия' }),
    );
    const verbs = within(modules).getByRole('group', { name: 'Логистика' });
    expect(verbs.tagName).toBe('FIELDSET');
    expect(within(verbs).getAllByRole('checkbox')).toHaveLength(5);
    expect(finance().tagName).toBe('FIELDSET');
  });

  it('UD-48: выключение модуля «Задачи» — «Нет доступа», onChange без задач', async () => {
    const onDraft = vi.fn();
    render(<Harness onDraft={onDraft} />);
    expect(screen.getByText('2 из 4 действий')).toBeVisible();
    await userEvent.setup().click(sw('Задачи'));
    expect(onDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        actions: { logistics: MANAGER.actions.logistics },
      }),
    );
    expect(sw('Задачи')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getAllByText('Нет доступа')).toHaveLength(2);
  });

  it('включение модуля — «Просматривать» и раскрытие строки', async () => {
    const onDraft = vi.fn();
    render(<Harness onDraft={onDraft} />);
    const user = userEvent.setup();
    await user.click(sw('Файлы'));
    expect(onDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ actions: expect.objectContaining({ files: ['view'] }) }),
    );
    const row = sw('Файлы').closest('[data-module]') as HTMLElement;
    expect(within(row).getByRole('checkbox', { name: 'Просматривать' })).toBeChecked();
    expect(screen.getByText('1 из 2 действий')).toBeVisible();
  });

  it('выключение модуля сохраняет финансовые разрешения', async () => {
    const onDraft = vi.fn();
    const catalog = { modules: CATALOG.modules.map((m) => ({ ...m, on: true })) };
    render(<Harness onDraft={onDraft} catalog={catalog} />);
    await userEvent.setup().click(sw('Логистика'));
    expect(onDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        actions: { logistics: ['earnings.read'], tasks: ['create', 'edit'] },
      }),
    );
  });

  it('UD-52: раскрытие действий и флажок уровня; частичный уровень — неопределённый', async () => {
    const onDraft = vi.fn();
    render(<Harness onDraft={onDraft} initial={{ ...MANAGER, partial: { tasks: ['view'] } }} />);
    const user = userEvent.setup();
    expect(screen.getByText('3 из 4 действий')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Показать действия: Задачи' }));
    const row = sw('Задачи').closest('[data-module]') as HTMLElement;
    const view = within(row).getByRole('checkbox', { name: 'Просматривать' });
    expect((view as HTMLInputElement).indeterminate).toBe(true);
    await user.click(within(row).getByRole('checkbox', { name: 'Проверять' }));
    expect(onDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        actions: expect.objectContaining({ tasks: ['create', 'edit', 'review'] }),
        partial: { tasks: ['view'] },
      }),
    );
    await user.click(view);
    expect(onDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        actions: expect.objectContaining({ tasks: ['create', 'edit', 'review', 'view'] }),
        partial: {},
      }),
    );
    expect(view).toBeChecked();
    expect((view as HTMLInputElement).indeterminate).toBe(false);
  });

  // Возврат 16.10 №1: модуль только с частично выданными уровнями (роль «Водитель»: tasks.read из уровня
  // «Просматривать») включён и считает такой уровень: «{k ≥ 1} из {M}» (roleEditorVM :3182).
  it('модуль только с частичными уровнями — включён, «1 из 4 действий»; выключение снимает их', async () => {
    const onDraft = vi.fn();
    const driver: RoleDraft = {
      id: 'r-driver',
      name: 'Водитель',
      actions: {},
      partial: { tasks: ['view'], files: ['view'] },
    };
    render(<Harness onDraft={onDraft} initial={driver} />);
    expect(sw('Задачи')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('1 из 4 действий')).toBeVisible();
    expect(screen.queryByText(/^0 из/)).toBeNull();
    await userEvent.setup().click(sw('Задачи'));
    expect(onDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ actions: {}, partial: { files: ['view'] } }),
    );
    expect(sw('Задачи')).toHaveAttribute('aria-checked', 'false');
    expect(sw('Файлы')).toHaveAttribute('aria-checked', 'true');
  });

  it('ввод имени не меняет частичные уровни', async () => {
    const onDraft = vi.fn();
    const driver: RoleDraft = {
      id: 'r-driver',
      name: 'В',
      actions: {},
      partial: { tasks: ['view'] },
    };
    render(<Harness onDraft={onDraft} initial={driver} />);
    await userEvent.setup().type(screen.getByLabelText('Название роли'), 'о');
    expect(onDraft).toHaveBeenLastCalledWith({ ...driver, name: 'Во' });
  });

  it('UD-55: ввод названия — onChange с новым именем', async () => {
    const onDraft = vi.fn();
    render(<Harness onDraft={onDraft} />);
    const name = screen.getByLabelText('Название роли');
    const user = userEvent.setup();
    await user.clear(name);
    await user.type(name, 'Диспетчер Север');
    expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Диспетчер Север' }));
  });

  it('UD-49: роль функции «Водитель» — блок функции, финансы недоступны', () => {
    render(
      <Harness
        initial={{ id: 'r-driver', name: 'Водитель', actions: { logistics: ['view'] } }}
        driverBlocked
        driverReason="role"
      />,
    );
    expect(
      screen.getByText(
        'Профессиональная функция «Водитель». Начисления запрещены через эту и любую другую роль или группу.',
      ),
    ).toBeVisible();
    expect(
      within(finance()).getByRole('checkbox', { name: /Видеть начисления водителям/ }),
    ).toBeDisabled();
    expect(
      within(finance()).getByText('Роль с функцией «Водитель» не может содержать начисления'),
    ).toBeVisible();
  });

  it('UD-51: роль назначена водителю — «Роль назначена водителю — финансовые права недоступны»', () => {
    render(<Harness driverBlocked driverReason="holder" />);
    expect(
      within(finance()).getByText('Роль назначена водителю — финансовые права недоступны'),
    ).toBeVisible();
    expect(screen.queryByText(/Профессиональная функция/)).toBeNull();
  });

  it('UD-50: системная роль — имя недоступно, блок системной роли, модулей нет', () => {
    render(
      <Harness initial={{ id: 'r-owner', name: 'Владелец бизнеса', system: true, actions: {} }} />,
    );
    expect(screen.getByLabelText('Название роли')).toBeDisabled();
    expect(
      screen.getByText(
        'Системная роль: все модули и области организации. Не редактируется и защищает от потери доступа последним владельцем.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Модули и действия' })).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('только чтение: всё недоступно', () => {
    render(<Harness readOnly />);
    expect(screen.getByLabelText('Название роли')).toBeDisabled();
    expect(sw('Задачи')).toBeDisabled();
    for (const c of screen.getAllByRole('checkbox')) expect(c).toBeDisabled();
  });

  it('UD-56: axe — без нарушений serious/critical; у переключателей имена', async () => {
    const { container } = render(
      <Harness initial={{ ...MANAGER, partial: { tasks: ['view'] } }} />,
    );
    expect(screen.getAllByRole('switch').map((s) => s.getAttribute('aria-label'))).toEqual([
      'Доступ роли к модулю Логистика',
      'Доступ роли к модулю Задачи',
      'Доступ роли к модулю Файлы',
    ]);
    expect(await seriousViolations(container)).toEqual([]);
  });
});
