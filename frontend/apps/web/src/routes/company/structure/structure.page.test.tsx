// W1.54 · Экранные тесты «Структуры» (S1-08, no-reference): дерево listOrgUnits, создание (createOrgUnit),
// переименование и перенос с If-Match свежего getOrgUnit, предпросмотр влияния previewOrgUnitMove, состояния
// (загрузка, пусто, ошибка и «Повторить», нет связи, только чтение, без права изменения), 409/412/422.
import { seedUuid } from '@ortus/domain/seed';
import { errors } from '@ortus/texts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const SLOW = { timeout: 5_000 };
// jsdom без CSS.escape: React Aria (Modal → getMetaValue) зовёт его, когда диалог открыт не указателем (как
// people.test.tsx W1.23).
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

const open = async (o: MockAppOptions = {}, ready = true): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/structure`, { persona: 'owner', ...o });
  await screen.findByRole('heading', { level: 1, name: 'Структура' }, SLOW);
  if (ready) await screen.findByRole('list', { name: 'Структура организации' }, SLOW);
  return app;
};

const tree = (): HTMLElement => screen.getByRole('list', { name: 'Структура организации' });
/** Строка узла по названию (заголовок строки — название). */
const row = (name: string): HTMLElement => {
  const label = within(tree()).getByText(name, { selector: '.ox-str-name' });
  const r = label.closest<HTMLElement>('.ox-str-row');
  if (!r) throw new Error(`нет строки «${name}»`);
  return r;
};
const dialog = (): HTMLElement => screen.getByRole('dialog');
const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const type = (label: string, value: string): void => {
  fireEvent.change(within(dialog()).getByLabelText(label), { target: { value } });
};
const press = (name: string): void => {
  fireEvent.click(within(dialog()).getByRole('button', { name }));
};
const sent = (a: MockApp, method: string, suffix: string) =>
  a.responses().filter((r) => r.method === method && r.path.endsWith(suffix));

/** Узлы «Альты» сценарного сервера по названию. */
const unitId = (a: MockApp, name: string): string => {
  const u = a.scenario.state().orgs[ALTA]?.units.find((x) => x.name === name);
  if (!u) throw new Error(`нет подразделения «${name}»`);
  return u.id;
};

describe('«Структура»: дерево', () => {
  it('крошка, заголовок, пояснение; три региона и их фирмы с подписью вида', async () => {
    await open();
    expect(screen.getByText('Альта Групп / Компания')).toBeTruthy();
    const roots = [...tree().children].map((li) => li.querySelector('.ox-str-name')?.textContent);
    expect(roots).toEqual(['Москва', 'Самара', 'Санкт-Петербург']);
    expect(row('Москва').textContent).toContain('Регион');
    expect(row('Север Логистик').textContent).toContain('Фирма');
    const msk = row('Москва').closest('li');
    expect(msk?.textContent).toContain('Север Логистик');
    expect(msk?.textContent).not.toContain('Волга Логистик');
  });

  it('меню «Компания»: пункт «Структура» отмечен как текущая страница', async () => {
    await open();
    const nav = screen.getByRole('navigation', { name: 'Основная навигация' });
    const item = within(nav).getByRole('button', { current: 'page' });
    expect(item.getAttribute('title')).toBe('Структура');
  });

  it('загрузка: скелетон «Загрузка» под заголовком, затем дерево', async () => {
    await open({ scenario: 'listOrgUnits=delay=400' }, false);
    expect(within(screen.getByRole('main')).getByRole('status', { name: 'Загрузка' })).toBeTruthy();
    await screen.findByRole('list', { name: 'Структура организации' }, SLOW);
  });

  it('ошибка listOrgUnits: alert по коду и «Повторить» перечитывает', async () => {
    const a = await open({ scenario: 'listOrgUnits=rate_limited' }, false);
    const alert = await screen.findByText(/Не удалось загрузить структуру/, undefined, SLOW);
    expect(alert.textContent).toBe(
      'Не удалось загрузить структуру: Слишком много запросов. Подождите и повторите.',
    );
    a.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByRole('list', { name: 'Структура организации' }, SLOW);
  });

  it('пусто: «Структура пока пуста» и «Добавить регион»', async () => {
    await open({ scenario: 'listOrgUnits=empty' }, false);
    await screen.findByText('Структура пока пуста', undefined, SLOW);
    expect(screen.getAllByRole('button', { name: 'Добавить регион' }).length).toBeGreaterThan(0);
  });
});

describe('«Структура»: создание', () => {
  it('регион → фирма → подразделение: вид по умолчанию, тосты, узлы в дереве', async () => {
    const a = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить регион' }));
    expect(within(dialog()).getByRole('heading', { name: 'Новое подразделение' })).toBeTruthy();
    expect(dialog().textContent).toContain('Где: верхний уровень структуры');
    expect((within(dialog()).getByLabelText('Вид') as HTMLSelectElement).value).toBe('region');
    type('Название', 'Казань');
    press('Добавить');
    await waitFor(() => expect(toast()).toBe('Добавлено: «Казань»'));
    await waitFor(() => expect(row('Казань').textContent).toContain('Регион'));

    fireEvent.click(within(row('Казань')).getByRole('button', { name: 'Добавить в «Казань»' }));
    expect(dialog().textContent).toContain('Где: Казань');
    expect((within(dialog()).getByLabelText('Вид') as HTMLSelectElement).value).toBe('company');
    type('Название', 'Кама Логистик');
    press('Добавить');
    await waitFor(() => expect(row('Кама Логистик').textContent).toContain('Фирма'));

    fireEvent.click(
      within(row('Кама Логистик')).getByRole('button', { name: 'Добавить в «Кама Логистик»' }),
    );
    expect((within(dialog()).getByLabelText('Вид') as HTMLSelectElement).value).toBe('branch');
    type('Название', 'Склад');
    press('Добавить');
    await waitFor(() => expect(row('Склад').textContent).toContain('Подразделение'));
    const units = a.scenario.state().orgs[ALTA]?.units ?? [];
    const kazan = units.find((u) => u.name === 'Казань');
    const firm = units.find((u) => u.name === 'Кама Логистик');
    expect(kazan?.parentId).toBeNull();
    expect(firm?.parentId).toBe(kazan?.id);
    expect(units.find((u) => u.name === 'Склад')?.parentId).toBe(firm?.id);
    expect(sent(a, 'POST', '/org-units').map((r) => r.status)).toEqual([201, 201, 201]);
  });

  it('«Добавить» недоступна, пока название пустое; длиннее 150 — ошибка под полем', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить регион' }));
    expect(
      within(dialog()).getByRole('button', { name: 'Добавить' }).hasAttribute('disabled'),
    ).toBe(true);
    type('Название', 'я'.repeat(151));
    expect(dialog().textContent).toContain('Не длиннее 150 символов');
  });

  it('422: занятое название — текст под полем «Название», диалог открыт, тоста нет', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить регион' }));
    type('Название', 'Москва');
    press('Добавить');
    await waitFor(() => expect(dialog().textContent).toContain('Такое название уже есть'));
    expect(toast()).toBeUndefined();
    expect(within(dialog()).getByLabelText('Название').getAttribute('aria-invalid')).toBe('true');
  });

  it('нет связи: тост «Нет связи…», диалог открыт; повтор создаёт узел один раз', async () => {
    const a = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить регион' }));
    type('Название', 'Казань');
    a.scenario.setScenario('createOrgUnit=offline', true);
    press('Добавить');
    await waitFor(() => expect(toast()).toBe(errors.client.offline));
    expect(screen.getByRole('dialog')).toBeTruthy();
    press('Добавить');
    await waitFor(() => expect(row('Казань')).toBeTruthy());
    const units = a.scenario.state().orgs[ALTA]?.units ?? [];
    expect(units.filter((u) => u.name === 'Казань')).toHaveLength(1);
  });

  it('403 tenant_read_only на команду: тост словаря, диалог открыт', async () => {
    const a = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить регион' }));
    type('Название', 'Казань');
    a.scenario.setScenario('createOrgUnit=tenant_read_only', true);
    press('Добавить');
    await waitFor(() => expect(toast()).toBe(errors.problem.tenant_read_only));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Escape закрывает диалог, фокус возвращается на «Добавить регион»', async () => {
    await open();
    const opener = screen.getByRole('button', { name: 'Добавить регион' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe('«Структура»: переименование', () => {
  it('If-Match свежего getOrgUnit, тост, новое название в дереве', async () => {
    const a = await open();
    fireEvent.click(
      within(row('Юг Транс')).getByRole('button', { name: 'Переименовать «Юг Транс»' }),
    );
    expect(
      within(dialog()).getByRole('heading', { name: 'Переименовать «Юг Транс»' }),
    ).toBeTruthy();
    const save = within(dialog()).getByRole('button', { name: 'Сохранить' });
    expect(save.hasAttribute('disabled')).toBe(true);
    type('Название', 'Юг Транс Плюс');
    press('Сохранить');
    await waitFor(() => expect(toast()).toBe('Переименовано: «Юг Транс Плюс»'));
    await waitFor(() => expect(row('Юг Транс Плюс')).toBeTruthy());
    const id = unitId(a, 'Юг Транс Плюс');
    expect(sent(a, 'GET', `/org-units/${id}`).map((r) => r.status)).toEqual([200]);
    expect(sent(a, 'PATCH', `/org-units/${id}`).map((r) => r.status)).toEqual([200]);
  });

  it('412 revision_mismatch: тост словаря, дерево перечитано', async () => {
    const a = await open();
    fireEvent.click(
      within(row('Юг Транс')).getByRole('button', { name: 'Переименовать «Юг Транс»' }),
    );
    type('Название', 'Юг');
    a.scenario.setScenario('updateOrgUnit=revision_mismatch', true);
    const before = sent(a, 'GET', '/org-units').length;
    press('Сохранить');
    await waitFor(() => expect(toast()).toBe(errors.problem.revision_mismatch));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await waitFor(() => expect(sent(a, 'GET', '/org-units').length).toBeGreaterThan(before));
  });
});

describe('«Структура»: перенос', () => {
  it('цели: без самого узла, его потомков и текущего родителя', async () => {
    await open();
    fireEvent.click(within(row('Москва')).getByRole('button', { name: 'Перенести «Москва»' }));
    const options = [
      ...(within(dialog()).getByLabelText('Куда перенести') as HTMLSelectElement).options,
    ].map((o) => o.textContent);
    expect(options[0]).toBe('Выберите, куда перенести');
    expect(options).toContain('Самара');
    expect(options).toContain('Самара / Волга Логистик');
    expect(options.some((o) => o?.startsWith('Москва'))).toBe(false);
  });

  it('без влияния: счётчики и «Доступ ни у кого не изменится.»; «Перенести» после расчёта; тост', async () => {
    const a = await open();
    fireEvent.click(within(row('Юг Транс')).getByRole('button', { name: 'Перенести «Юг Транс»' }));
    const submit = within(dialog()).getByRole('button', { name: 'Перенести' });
    expect(submit.hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(dialog()).getByLabelText('Куда перенести'), {
      target: { value: unitId(a, 'Самара') },
    });
    await waitFor(() => expect(dialog().textContent).toContain('Доступ ни у кого не изменится.'));
    expect(dialog().textContent).toContain('Вложенных подразделений: 0');
    expect(dialog().textContent).toContain('Сотрудников в переносимой части:');
    await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false));
    press('Перенести');
    await waitFor(() => expect(toast()).toBe('Перенесено: «Юг Транс»'));
    const id = unitId(a, 'Юг Транс');
    expect(a.scenario.state().orgs[ALTA]?.units.find((u) => u.id === id)?.parentId).toBe(
      unitId(a, 'Самара'),
    );
    await waitFor(() => expect(row('Самара').closest('li')?.textContent).toContain('Юг Транс'));
  });

  it('есть затронутые: «Получат доступ» — имя и роль (скрытые — ниже, право в части организации)', async () => {
    await open({
      setup: (s) => {
        const org = s.state().orgs[ALTA];
        if (!org) throw new Error('нет «Альты»');
        const smr = org.units.find((u) => u.name === 'Самара');
        const ilyin = org.members.find((m) => m.displayName === 'Сергей Ильин');
        const role = org.roles.find((r) => r.name === 'Менеджер логистики');
        if (!smr || !ilyin || !role) throw new Error('нет данных сида');
        org.assignments.push({
          id: '00000000-0000-4000-8000-000000000154',
          proto: 'a-w154',
          principalType: 'member',
          principalId: ilyin.id,
          roleId: role.id,
          scope: { kind: 'org_unit', resourceIds: [smr.id], includeDescendants: true },
          state: 'active',
        });
      },
    });
    fireEvent.click(within(row('Юг Транс')).getByRole('button', { name: 'Перенести «Юг Транс»' }));
    const select = within(dialog()).getByLabelText('Куда перенести') as HTMLSelectElement;
    const smr = [...select.options].find((o) => o.textContent === 'Самара')?.value ?? '';
    fireEvent.change(select, { target: { value: smr } });
    await waitFor(() => expect(dialog().textContent).toContain('Получат доступ'));
    expect(dialog().textContent).toContain('Сергей Ильин · Менеджер логистики');
    expect(dialog().textContent).not.toContain('Доступ ни у кого не изменится.');
  });

  it('ошибка предпросмотра: alert в диалоге, «Перенести» недоступна', async () => {
    const a = await open();
    fireEvent.click(within(row('Юг Транс')).getByRole('button', { name: 'Перенести «Юг Транс»' }));
    a.scenario.setScenario('previewOrgUnitMove=rate_limited');
    fireEvent.change(within(dialog()).getByLabelText('Куда перенести'), {
      target: { value: unitId(a, 'Самара') },
    });
    await waitFor(() =>
      expect(within(dialog()).getByRole('alert').textContent).toBe(
        'Не удалось рассчитать влияние: Слишком много запросов. Подождите и повторите.',
      ),
    );
    expect(
      within(dialog()).getByRole('button', { name: 'Перенести' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('409 при переносе: тост словаря, диалог открыт', async () => {
    const a = await open();
    fireEvent.click(within(row('Юг Транс')).getByRole('button', { name: 'Перенести «Юг Транс»' }));
    fireEvent.change(within(dialog()).getByLabelText('Куда перенести'), {
      target: { value: unitId(a, 'Самара') },
    });
    const submit = within(dialog()).getByRole('button', { name: 'Перенести' });
    await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false));
    a.scenario.setScenario('updateOrgUnit=invalid_transition', true);
    press('Перенести');
    await waitFor(() => expect(toast()).toBe(errors.problem.invalid_transition));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('«Структура»: права и только чтение', () => {
  it('организация только для чтения: текст словаря, команды недоступны', async () => {
    await open({ preset: 'trial-ended' });
    expect(screen.getByText(errors.problem.tenant_read_only)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Добавить регион' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(
      within(row('Москва'))
        .getByRole('button', { name: 'Перенести «Москва»' })
        .hasAttribute('disabled'),
    ).toBe(true);
    // Возврат 1 доделки №2 (major, axe scrollable-region-focusable): без доступных команд дерево — цель Tab.
    expect(tree().getAttribute('tabindex')).toBe('0');
  });

  it('команды доступны: дерево не лишняя цель Tab', async () => {
    await open();
    expect(tree().hasAttribute('tabindex')).toBe(false);
  });

  it('сотрудник без org_units.read: гейт «Нет доступа к разделу «Структура»»', async () => {
    app = await renderMockApp(`/t/${ALTA}/structure`, { persona: 'manager' });
    await screen.findByRole(
      'heading',
      { level: 1, name: 'Нет доступа к разделу «Структура»' },
      SLOW,
    );
    expect(app.responses().some((r) => r.path.endsWith('/org-units') && r.method === 'GET')).toBe(
      false,
    );
  });

  it('сотрудник с org_units.read без org_units.manage: дерево без команд и пояснение', async () => {
    app = await renderMockApp(`/t/${ALTA}/structure`, {
      persona: 'manager',
      setup: (s) => {
        const org = s.state().orgs[ALTA];
        const kotova = org?.members.find((m) => m.displayName === 'Марина Котова');
        if (!org || !kotova) throw new Error('нет данных сида');
        org.roles.push({
          id: '00000000-0000-4000-8000-000000000155',
          proto: 'r-w154',
          name: 'Читатель структуры',
          description: '',
          builtIn: false,
          permissions: ['org_units.read'],
          revision: 1,
        });
        org.assignments.push({
          id: '00000000-0000-4000-8000-000000000156',
          proto: 'a-w154r',
          principalType: 'member',
          principalId: kotova.id,
          roleId: '00000000-0000-4000-8000-000000000155',
          scope: { kind: 'tenant', resourceIds: [], includeDescendants: true },
          state: 'active',
        });
      },
    });
    await screen.findByRole('list', { name: 'Структура организации' }, SLOW);
    expect(
      screen.getByText('Изменять структуру может владелец или сотрудник с правом на структуру.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Добавить регион' })).toBeNull();
    expect(within(tree()).queryAllByRole('button')).toHaveLength(0);
    expect(tree().getAttribute('tabindex')).toBe('0');
  });
});

/**
 * Котова (`manager`): «Читатель структуры» (org_units.read) на всю организацию и «Руководитель филиала»
 * (org_units.manage, members.read) на «Москву» с поддеревом; у Котельниковой — «Менеджер логистики» на «Юг Транс»
 * (вне members.read Котовой — в предпросмотре только счёт). Как conformance stage1b `branchManager`.
 */
const branchManager = (s: Parameters<NonNullable<MockAppOptions['setup']>>[0]): void => {
  const org = s.state().orgs[ALTA];
  const kotova = org?.members.find((m) => m.displayName === 'Марина Котова');
  const kotelnikova = org?.members.find((m) => m.displayName === 'Вера Котельникова');
  const msk = org?.units.find((u) => u.name === 'Москва');
  const yug = org?.units.find((u) => u.name === 'Юг Транс');
  const logist = org?.roles.find((r) => r.name === 'Менеджер логистики');
  if (!org || !kotova || !kotelnikova || !msk || !yug || !logist)
    throw new Error('нет данных сида');
  const role = (n: number, name: string, permissions: string[]) => {
    const id = `00000000-0000-4000-8000-00000000016${n}`;
    org.roles.push({
      id,
      proto: `r-w154-${n}`,
      name,
      description: '',
      builtIn: false,
      permissions,
      revision: 1,
    });
    return id;
  };
  const grant = (
    n: number,
    principalId: string,
    roleId: string,
    scope: { kind: 'tenant' | 'org_unit'; resourceIds: string[] },
  ) => {
    org.assignments.push({
      id: `00000000-0000-4000-8000-00000000017${n}`,
      proto: `a-w154-${n}`,
      principalType: 'member',
      principalId,
      roleId,
      scope: { ...scope, includeDescendants: true },
      state: 'active',
    });
  };
  grant(1, kotova.id, role(1, 'Читатель структуры', ['org_units.read']), {
    kind: 'tenant',
    resourceIds: [],
  });
  grant(2, kotova.id, role(2, 'Руководитель филиала', ['org_units.manage', 'members.read']), {
    kind: 'org_unit',
    resourceIds: [msk.id],
  });
  grant(3, kotelnikova.id, logist.id, { kind: 'org_unit', resourceIds: [yug.id] });
};

describe('«Структура»: право изменения в части организации', () => {
  // Возврат 1 доделки №2 (minor): верхний уровень и перенос узла верхнего уровня требуют org_units.manage на всю
  // организацию (units.go CreateOrgUnit, mayManageParent); перенос — права на старого и нового родителя.
  it('право на «Москву»: без «Добавить регион» и «Перенести «Москва»»; команды внутри «Москвы»', async () => {
    app = await renderMockApp(`/t/${ALTA}/structure`, { persona: 'manager', setup: branchManager });
    await screen.findByRole('list', { name: 'Структура организации' }, SLOW);
    expect(screen.queryByRole('button', { name: 'Добавить регион' })).toBeNull();
    expect(
      screen.queryByText('Изменять структуру может владелец или сотрудник с правом на структуру.'),
    ).toBeNull();
    const msk = within(row('Москва'));
    expect(msk.getByRole('button', { name: 'Добавить в «Москва»' })).toBeTruthy();
    expect(msk.getByRole('button', { name: 'Переименовать «Москва»' })).toBeTruthy();
    expect(msk.queryByRole('button', { name: 'Перенести «Москва»' })).toBeNull();
    expect(within(row('Самара')).queryAllByRole('button')).toHaveLength(0);
    expect(tree().hasAttribute('tabindex')).toBe(false);

    fireEvent.click(
      within(row('Север Логистик')).getByRole('button', { name: 'Перенести «Север Логистик»' }),
    );
    const options = [
      ...(within(dialog()).getByLabelText('Куда перенести') as HTMLSelectElement).options,
    ].map((o) => o.textContent ?? '');
    expect(options[0]).toBe('Выберите, куда перенести');
    expect(options).toContain('Москва / Юг Транс');
    expect(options.slice(1).every((o) => o.startsWith('Москва / '))).toBe(true);
  });

  it('есть затронутые вне области просмотра: «Ещё 1 — вне вашей области просмотра»', async () => {
    app = await renderMockApp(`/t/${ALTA}/structure`, { persona: 'manager', setup: branchManager });
    await screen.findByRole('list', { name: 'Структура организации' }, SLOW);
    fireEvent.click(
      within(row('Север Логистик')).getByRole('button', { name: 'Перенести «Север Логистик»' }),
    );
    const select = within(dialog()).getByLabelText('Куда перенести') as HTMLSelectElement;
    const yug = [...select.options].find((o) => o.textContent === 'Москва / Юг Транс')?.value ?? '';
    fireEvent.change(select, { target: { value: yug } });
    await waitFor(() =>
      expect(dialog().textContent).toContain('Ещё 1 — вне вашей области просмотра'),
    );
    expect(dialog().textContent).not.toContain('Доступ ни у кого не изменится.');
    expect(dialog().textContent).not.toContain('Вера Котельникова');
  });
});
