// W5.33 · «Пользователи и роли»: блок «Касса · остаток и лимиты» в редакторе роли (Ортус CRM.dc.html :373–379,
// VM :3202–3205; 02-company §6.12) и область «Касса» в диалоге «Назначить роль» (:2213, :3984–4005). Права роли —
// ключи api/permissions.yaml: `cash.balance.read` и `cash.advance.self` (rolePermKeys M:317–318) выдаются флажками
// блока, а не уровнями модуля; суммы лимитов в контракте роли не хранятся (Q-W5.33-2).
import type { ScenarioServer } from '@ortus/adapter/msw';
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');

// jsdom без CSS.escape: React Aria (Modal → getMetaValue) зовёт его, когда диалог открыт не указателем.
if (typeof globalThis.CSS?.escape !== 'function') {
  Object.assign(globalThis, {
    CSS: { escape: (s: string) => s.replace(/[^\w-]/g, (c) => `\\${c}`) },
  });
}

interface RoleRow {
  name: string;
  permissions: string[];
}
interface OrgState {
  roles: RoleRow[];
  policyVersion: number;
}

/** Ключи роли `name` (новым массивом: массив прав — общий пример контракта, его правка протекла бы в другие тесты). */
const withKeys =
  (name: string, keys: string[]) =>
  (s: ScenarioServer): void => {
    const org = s.state().orgs[ALTA] as unknown as OrgState;
    const r = org.roles.find((x) => x.name === name);
    if (r) r.permissions = [...r.permissions, ...keys];
    org.policyVersion++;
  };

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (query: string, setup?: (s: ScenarioServer) => void) => {
  app = await renderMockApp(`/t/${ALTA}/users${query}`, {
    persona: 'owner',
    ...(setup ? { setup } : {}),
  });
  await screen.findByRole('heading', { level: 1, name: 'Пользователи и роли' });
  return app;
};

const roleBtn = (name: string) =>
  screen.findByRole('button', { name: new RegExp(`^${name}(Системная|Шаблон|Своя)`) });
const editor = () => screen.findByRole('region', { name: 'Редактор роли' });
const block = (root: HTMLElement) =>
  within(root).queryByRole('group', { name: 'Касса · остаток и лимиты' });
const flag = (b: HTMLElement, label: string) =>
  within(b).getByRole('checkbox', { name: new RegExp(`^${label}`) }) as HTMLInputElement;

describe('блок «Касса · остаток и лимиты»', () => {
  it('у роли без модуля «Касса» блока нет; включение модуля показывает блок', async () => {
    await open('?tab=roles');
    const ed = await editor();
    expect(block(ed)).toBeNull();
    fireEvent.click(within(ed).getByRole('switch', { name: 'Доступ роли к модулю Касса' }));
    const b = block(ed);
    if (!b) throw new Error('нет блока «Касса · остаток и лимиты»');
    expect(
      within(b).getByText(
        'Действуют в области назначения: организация, регион, фирма или конкретная касса. Выше лимита операция уходит на согласование роли с действием «Проверять», свою заявку автор не согласует.',
      ),
    ).toBeTruthy();
    expect(flag(b, 'Видеть остаток и ожидаемую сумму смены').checked).toBe(false);
    expect(flag(b, 'Только свой подотчёт').checked).toBe(false);
    expect(within(b).getByText('cash.balance.read')).toBeTruthy();
    expect(within(b).getByText('cash.advance.self')).toBeTruthy();
    for (const l of [
      'Расход без согласования до, ₽',
      'Возврат без согласования до, ₽',
      'Выдача под отчёт до, ₽',
    ]) {
      const input = within(b).getByLabelText(l) as HTMLInputElement;
      expect(input.placeholder).toBe('без лимита');
      expect(input.disabled).toBe(true);
    }
    expect(within(b).getByText('Пусто — без лимита, 0 — всегда с согласованием.')).toBeTruthy();
  });

  it('уровни модуля не выдают флажки блока: «Просматривать» — cash.read, без cash.balance.read', async () => {
    await open('?tab=roles');
    const ed = await editor();
    fireEvent.click(within(ed).getByRole('switch', { name: 'Доступ роли к модулю Касса' }));
    const aside = screen.getByRole('complementary', { name: 'Итоговые права роли' });
    const keys = () => [...aside.querySelectorAll('code')].map((c) => c.textContent);
    expect(keys()).toContain('cash.read');
    expect(keys()).not.toContain('cash.balance.read');
    expect(keys()).not.toContain('cash.advance.self');
  });

  it('«Видеть остаток…» → «Есть несохранённые изменения» → «Сохранить роль»: ключ в итоговых правах', async () => {
    await open('?tab=roles');
    const ed = await editor();
    fireEvent.click(within(ed).getByRole('switch', { name: 'Доступ роли к модулю Касса' }));
    const b = block(ed) as HTMLElement;
    fireEvent.click(flag(b, 'Видеть остаток и ожидаемую сумму смены'));
    expect(flag(b, 'Видеть остаток и ожидаемую сумму смены').checked).toBe(true);
    const aside = screen.getByRole('complementary', { name: 'Итоговые права роли' });
    expect(aside.textContent).toContain('cash.balance.read');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить роль' }));
    expect(await screen.findByText(/^Роль «.+» сохранена$/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Есть несохранённые изменения')).toBeNull());
    expect(
      flag(block(await editor()) as HTMLElement, 'Видеть остаток и ожидаемую сумму смены').checked,
    ).toBe(true);
    // Снятие флажка убирает ключ.
    fireEvent.click(
      flag(block(await editor()) as HTMLElement, 'Видеть остаток и ожидаемую сумму смены'),
    );
    expect(aside.textContent).not.toContain('cash.balance.read');
  });

  it('«Только свой подотчёт»: поля лимитов скрыты; снятие возвращает их', async () => {
    await open('?tab=roles');
    const ed = await editor();
    fireEvent.click(within(ed).getByRole('switch', { name: 'Доступ роли к модулю Касса' }));
    const b = block(ed) as HTMLElement;
    fireEvent.click(flag(b, 'Только свой подотчёт'));
    expect(flag(b, 'Только свой подотчёт').checked).toBe(true);
    expect(within(b).queryByLabelText('Расход без согласования до, ₽')).toBeNull();
    fireEvent.click(flag(b, 'Только свой подотчёт'));
    expect(within(b).getByLabelText('Расход без согласования до, ₽')).toBeTruthy();
  });

  it('роль с функцией «Водитель»: «Только свой подотчёт» включён и заблокирован, ключ добавляется при включении модуля', async () => {
    await open('?tab=roles');
    fireEvent.click(await roleBtn('Водитель'));
    const ed = await editor();
    await waitFor(() =>
      expect((within(ed).getByLabelText('Название роли') as HTMLInputElement).value).toBe(
        'Водитель',
      ),
    );
    expect(block(ed)).toBeNull();
    fireEvent.click(within(ed).getByRole('switch', { name: 'Доступ роли к модулю Касса' }));
    const b = block(ed) as HTMLElement;
    const self = flag(b, 'Только свой подотчёт');
    expect(self.checked).toBe(true);
    expect(self.disabled).toBe(true);
    expect(within(b).queryByLabelText('Расход без согласования до, ₽')).toBeNull();
    const aside = screen.getByRole('complementary', { name: 'Итоговые права роли' });
    expect(aside.textContent).toContain('cash.advance.self');
    // Выключение модуля убирает и ключ подотчёта, и блок.
    fireEvent.click(within(ed).getByRole('switch', { name: 'Доступ роли к модулю Касса' }));
    expect(block(ed)).toBeNull();
    expect(aside.textContent).not.toContain('cash.advance.self');
  });

  it('роль с ключами кассы из API: флажки отражают права, блок виден сразу', async () => {
    await open(
      '?tab=roles',
      withKeys('Исполнитель', ['cash.read', 'cash.balance.read', 'cash.advance.self']),
    );
    fireEvent.click(await roleBtn('Исполнитель'));
    const ed = await editor();
    await waitFor(() => expect(block(ed)).not.toBeNull());
    const b = block(ed) as HTMLElement;
    expect(flag(b, 'Видеть остаток и ожидаемую сумму смены').checked).toBe(true);
    expect(flag(b, 'Только свой подотчёт').checked).toBe(true);
  });
});

describe('область «Касса» в диалоге «Назначить роль»', () => {
  const member = seedUuid('t-alta', 'm-kotova');

  const openAssign = async (roleName: string, keys: string[]) => {
    await open('?tab=people', withKeys(roleName, keys));
    const roles = await screen.findByRole('list', { name: 'Участники' });
    const li = within(roles)
      .getAllByRole('listitem')
      .find((x) => x.textContent?.includes('Марина Котова')) as HTMLElement;
    fireEvent.click(within(li).getByRole('button', { name: 'Назначить роль' }));
    return screen.findByRole('dialog', { name: 'Назначить роль' });
  };

  it('роли без модуля «Касса» кнопки «Касса» нет', async () => {
    const dlg = await openAssign('Исполнитель', []);
    fireEvent.change(within(dlg).getByLabelText('Роль'), {
      target: { value: seedUuid('t-alta', 'r-exec') },
    });
    const area = within(dlg).getByRole('group', { name: 'Область действия' });
    expect(
      within(area)
        .getAllByRole('button')
        .map((x) => x.textContent),
    ).toEqual(['Вся организация', 'Регион', 'Фирма']);
  });

  it('роль с модулем «Касса»: «Касса», список касс без подотчётов, итог и назначение', async () => {
    const dlg = await openAssign('Исполнитель', ['cash.read', 'cash.post']);
    fireEvent.change(within(dlg).getByLabelText('Роль'), {
      target: { value: seedUuid('t-alta', 'r-exec') },
    });
    const area = within(dlg).getByRole('group', { name: 'Область действия' });
    expect(
      within(area)
        .getAllByRole('button')
        .map((x) => x.textContent),
    ).toEqual(['Вся организация', 'Регион', 'Фирма', 'Касса']);
    fireEvent.click(within(area).getByRole('button', { name: 'Касса' }));
    const select = within(dlg).getByLabelText('Касса', { selector: 'select' }) as HTMLSelectElement;
    const options = [...select.options].map((o) => o.text);
    expect(options.length).toBeGreaterThan(1);
    expect(options.some((o) => o.startsWith('Подотчёт'))).toBe(false);
    fireEvent.change(select, { target: { value: seedUuid('t-alta', 'ca-spa') } });
    const name = select.selectedOptions[0]?.text ?? '';
    expect(
      within(dlg).getByText(`Только касса «${name}»: другие кассы по этой роли не видны`),
    ).toBeTruthy();
    expect(dlg.textContent).toContain(`Касса «${name}»`);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Назначить' }));
    expect(await screen.findByText(/^Роль «Исполнитель» назначена/)).toBeTruthy();
    const created = app
      ?.responses()
      .some((r) => r.method === 'POST' && r.path.endsWith('/assignments') && r.status === 201);
    expect(created).toBe(true);
    void member;
  });
});
