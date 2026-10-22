// W2.73 · Экранные тесты S2-20 «Машина для временного водителя» (D-35; эталон design-2026-10-19b · «Временный водитель -
// варианты.dc.html») на сценарном сервере (MSW W2.71, пресет logistics-ready): 1a — блок «Машина» диалога «Запросить
// водителя»; 1b — входящий запрос фирмы водителя («Одобрить с машиной», «Только водителя», «Отклонить» с причиной);
// 1f — итог у логиста («Машины рейса», «Журнал», «Оставить …», «Поставить машину»). Обычная машина водителя #104 —
// Hyundai HD-35 «Юг Транс» макета (cars.home :504), добавляется в состояние сервера до первого запроса.
import type { components } from '@ortus/api-client';
import type { ScenarioServer } from '@ortus/adapter/msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../../app/testing.tsx';
import { ALTA } from '../review/fixtures.test-util.ts';

type S = components['schemas'];

const SLOW = { timeout: 5_000 };
const H1 = 'Ресурсный пул';
const HD = '5e2a7c10-0000-4000-8000-0000000000d1';

interface PoolState {
  pool: { displayName: string; homeOrgUnitId: string; usualVehicleId?: string }[];
  vehicles: Record<string, unknown>[];
  trips: { id: string; number: string; vehicleId?: string }[];
  transfers: S['DriverTransfer'][];
  reservations: S['Reservation'][];
}

const poolOf = (s: ScenarioServer): PoolState => {
  const org = s.state().orgs[ALTA] as unknown as { fleet?: PoolState };
  if (!org.fleet) throw new Error('в состоянии нет логистики «Альты»');
  return org.fleet;
};

/** Hyundai HD-35 «Юг Транс» — обычная машина Водителя #104; `fits=false` — фургон без охлаждения (:556). */
function usual(s: ScenarioServer, fits = true): void {
  const f = poolOf(s);
  const pub = f.pool.find((p) => p.displayName === 'Водитель #104');
  if (!pub) throw new Error('нет публикации #104');
  f.vehicles.push({
    id: HD,
    proto: 'v-hd35',
    orgUnitId: pub.homeOrgUnitId,
    registrationNumber: 'Н 384 ТК 77',
    displayName: 'Hyundai HD-35',
    bodyType: fits ? 'refrigerated' : 'van',
    capacity: {
      payloadKg: '1800',
      volumeM3: '13',
      cargoLengthM: '3.6',
      cargoWidthM: '2',
      cargoHeightM: '1.9',
    },
    ...(fits ? { temperatureMinC: '-10', temperatureMaxC: '10' } : {}),
    equipment: fits ? ['refrigerator'] : [],
    odometerKm: '84912',
    depot: 'Стоянка Юг Транс, Варшавское ш.',
    vstate: 'free',
    revision: 1,
  });
  pub.usualVehicleId = HD;
}

const HOST2 = '5e2a7c10-0000-4000-8000-0000000000d2';

/** Вторая подходящая машина «Север Логистик» (рефрижератор) — выбор в поле «Ставим нашу машину». */
function secondHost(s: ScenarioServer): void {
  const f = poolOf(s);
  const ford = f.vehicles.find((v) => v.displayName === 'Ford Transit');
  if (!ford) throw new Error('нет Ford Transit');
  f.vehicles.push({
    ...ford,
    id: HOST2,
    proto: 'v-ford-custom',
    registrationNumber: 'Е 905 КТ 77',
    displayName: 'Ford Transit Custom',
    revision: 1,
  });
}

beforeAll(() => {
  globalThis.CSS ??= {} as typeof CSS;
  globalThis.CSS.escape ??= (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (o: MockAppOptions = {}): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/pool`, {
    persona: 'manager',
    preset: 'logistics-ready',
    ...o,
  });
  await screen.findByRole('heading', { level: 1, name: H1 }, SLOW);
  return app;
};

const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;

const card = async (code: string): Promise<HTMLElement> => {
  const el = await screen.findByText(code, { selector: '.ox-pl-driver .ox-pl-code' }, SLOW);
  return el.closest('article') as HTMLElement;
};

const dd = (root: HTMLElement, term: string): string | null | undefined =>
  [...root.querySelectorAll('dt')].find((d) => d.textContent === term)?.nextElementSibling
    ?.textContent;

const dialogOf = async (code = 'Водитель #104'): Promise<HTMLElement> => {
  fireEvent.click(
    within(await card(code)).getByRole('button', { name: 'Запросить на рейс Р-211' }),
  );
  return screen.findByRole('dialog', undefined, SLOW);
};

const radio = (dlg: HTMLElement, name: string): HTMLElement =>
  within(dlg).getByRole('radio', { name });
const choice = (dlg: HTMLElement): HTMLElement =>
  within(dlg).getByRole('checkbox', { name: /Можно взять свою обычную/ });
const summary = (dlg: HTMLElement): string[] =>
  [...dlg.querySelectorAll('.ox-pl-sum-line')].map((x) => x.textContent ?? '');
const submit = (dlg: HTMLElement): HTMLButtonElement =>
  within(dlg).getByRole('button', { name: 'Отправить запрос' }) as HTMLButtonElement;

describe('1a · «Запросить водителя»: блок «Машина»', () => {
  it('обычная подходит: по умолчанию «Наша + можно свою», итог; запрос host_or_home с Ford Transit', async () => {
    const a = await open({ setup: (s) => usual(s) });
    const dlg = await dialogOf();
    expect(within(dlg).getByRole('radiogroup', { name: 'Машина' })).toBeTruthy();
    expect(radio(dlg, 'Едет на своей обычной').getAttribute('aria-checked')).toBe('false');
    expect(radio(dlg, 'Ставим нашу машину').getAttribute('aria-checked')).toBe('true');
    expect(dlg.textContent).toContain('Hyundai HD-35 · Н 384 ТК 77 · Юг Транс');
    expect(dlg.textContent).toContain('Рефрижератор · 1,8 т · 13 м³ · кузов 3,6 м · −10…+10 °C');
    expect(dlg.textContent).toContain('Подходит рейсу · свободна 14:00–18:00');
    expect(dlg.textContent).toContain('Машину тоже согласует Юг Транс.');
    const select = within(dlg).getByRole('combobox', { name: 'Ставим нашу машину' });
    expect((select as HTMLSelectElement).selectedOptions[0]?.textContent).toBe(
      'Ford Transit · М 608 КТ 77',
    );
    expect(dlg.textContent).toContain('Рейсу подходит 1 из 4 свободных машин Север Логистик.');
    expect(choice(dlg).getAttribute('aria-checked')).toBe('true');
    expect(choice(dlg).textContent).toContain(
      'Водитель выберет в день рейса до 13:30: Ford Transit или свою Hyundai HD-35.',
    );
    expect(within(dlg).getByText('Что произойдёт после одобрения')).toBeTruthy();
    expect(summary(dlg)).toEqual([
      'event_availableДве брони до выбора на 14:00–18:00: Ford Transit и Hyundai HD-35. До рейса Hyundai работает в Юг Транс.',
      'touch_appВодитель выберет машину до 13:30. Вторая бронь снимется сразу.',
      'scheduleНе выберет — останется Ford Transit, Hyundai вернётся в Юг Транс.',
      'lockДоступ водителя — только к рейсу Р-211 до 18:00. История и начисления остаются в Юг Транс.',
    ]);
    fireEvent.click(submit(dlg));
    await waitFor(() => expect(toast()).toBe('Запрос отправлен фирме Юг Транс'), SLOW);
    const [x] = poolOf(a.scenario).transfers;
    expect(x?.vehicle).toMatchObject({
      mode: 'host_or_home',
      hostVehicle: { displayName: 'Ford Transit' },
      homeVehicle: { displayName: 'Hyundai HD-35' },
    });
  });

  it('«Только наша»: галочка снята — бронь Ford Transit; «своя» — бронь Hyundai; запросы host и home', async () => {
    const a = await open({ setup: (s) => usual(s) });
    let dlg = await dialogOf();
    fireEvent.click(choice(dlg));
    expect(choice(dlg).getAttribute('aria-checked')).toBe('false');
    expect(summary(dlg).slice(0, 2)).toEqual([
      'event_availableБронь Ford Transit на 14:00–18:00.',
      'photo_cameraВодителю нечего подтверждать: он сразу начинает осмотр.',
    ]);
    fireEvent.click(radio(dlg, 'Едет на своей обычной'));
    expect(radio(dlg, 'Едет на своей обычной').getAttribute('aria-checked')).toBe('true');
    expect(summary(dlg).slice(0, 2)).toEqual([
      'event_availableБронь Hyundai HD-35 на 14:00–18:00, если Юг Транс одобрит машину.',
      'helpОдобрят только водителя — рейс попадёт в «Требует решения», машину поставите вы.',
    ]);
    // Клик по «Ставим нашу машину» возвращает последний выбор галочки — «Только наша».
    fireEvent.click(radio(dlg, 'Ставим нашу машину'));
    expect(choice(dlg).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(radio(dlg, 'Едет на своей обычной'));
    fireEvent.click(submit(dlg));
    await waitFor(() => expect(poolOf(a.scenario).transfers).toHaveLength(1), SLOW);
    expect(poolOf(a.scenario).transfers[0]?.vehicle?.mode).toBe('home');
    dlg = await dialogOf('Водитель #117');
    expect(within(dlg).queryByRole('radio', { name: 'Едет на своей обычной' })).toBeNull();
    expect(within(dlg).queryByRole('checkbox')).toBeNull();
    fireEvent.click(submit(dlg));
    await waitFor(() => expect(poolOf(a.scenario).transfers).toHaveLength(2), SLOW);
    expect(poolOf(a.scenario).transfers[1]?.vehicle).toMatchObject({
      mode: 'host',
      hostVehicle: { displayName: 'Ford Transit' },
    });
  });

  it('«своя»: клик и выбор в поле машины варианта 2 переключают на «Ставим нашу машину» (onHost на весь блок, :165, :562)', async () => {
    const a = await open({
      setup: (s) => {
        usual(s);
        secondHost(s);
      },
    });
    const dlg = await dialogOf();
    const select = within(dlg).getByRole('combobox', {
      name: 'Ставим нашу машину',
    }) as HTMLSelectElement;
    fireEvent.click(radio(dlg, 'Едет на своей обычной'));
    fireEvent.click(select);
    expect(radio(dlg, 'Ставим нашу машину').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(radio(dlg, 'Едет на своей обычной'));
    expect(radio(dlg, 'Едет на своей обычной').getAttribute('aria-checked')).toBe('true');
    // Выбор с клавиатуры (change без click): другая машина и режим «Ставим нашу машину».
    fireEvent.change(select, { target: { value: HOST2 } });
    expect(radio(dlg, 'Ставим нашу машину').getAttribute('aria-checked')).toBe('true');
    expect(select.value).toBe(HOST2);
    fireEvent.click(submit(dlg));
    await waitFor(() => expect(poolOf(a.scenario).transfers).toHaveLength(1), SLOW);
    expect(poolOf(a.scenario).transfers[0]?.vehicle).toMatchObject({
      mode: 'host_or_home',
      hostVehicle: { displayName: 'Ford Transit Custom' },
    });
  });

  it('«Машина» — одна группа радиокнопок: стрелки переключают вариант, Tab-остановка одна (APG radiogroup)', async () => {
    await open({ setup: (s) => usual(s) });
    const dlg = await dialogOf();
    const home = radio(dlg, 'Едет на своей обычной');
    const host = radio(dlg, 'Ставим нашу машину');
    expect(host.tabIndex).toBe(0);
    expect(home.tabIndex).toBe(-1);
    host.focus();
    fireEvent.keyDown(host, { key: 'ArrowUp' });
    expect(home.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(home);
    expect(home.tabIndex).toBe(0);
    expect(host.tabIndex).toBe(-1);
    fireEvent.keyDown(home, { key: 'ArrowDown' });
    expect(host.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(host);
  });

  it('обычная не подходит: причина, галочка недоступна; «своя» — «Отправить запрос» недоступна (:519–522)', async () => {
    const a = await open({ setup: (s) => usual(s, false) });
    const dlg = await dialogOf();
    expect(dlg.textContent).toContain('Фургон · 1,8 т · 13 м³ · кузов 3,6 м · без охлаждения');
    expect(dlg.textContent).toContain('Не подходит рейсу: нет охлаждения +2…+6 °C');
    expect(choice(dlg).getAttribute('aria-disabled')).toBe('true');
    expect(choice(dlg).getAttribute('aria-checked')).toBe('false');
    expect(choice(dlg).textContent).toContain(
      'Недоступно: обычная машина не подходит рейсу, нет охлаждения.',
    );
    fireEvent.click(choice(dlg));
    expect(choice(dlg).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(radio(dlg, 'Едет на своей обычной'));
    expect(submit(dlg).disabled).toBe(true);
    expect(summary(dlg)[0]).toBe(
      'errorОбычная машина не подходит рейсу. Выберите «Ставим нашу машину».',
    );
    fireEvent.click(radio(dlg, 'Ставим нашу машину'));
    expect(submit(dlg).disabled).toBe(false);
    fireEvent.click(submit(dlg));
    await waitFor(() => expect(poolOf(a.scenario).transfers).toHaveLength(1), SLOW);
    expect(poolOf(a.scenario).transfers[0]?.vehicle?.mode).toBe('host');
  });

  // Возврат 3 (ревью r3, major): список машин фирмы рейса (listVehicles) не загрузился или ещё грузится — блок
  // «Машина» не утверждает «0 из 0» и не выбирает «своя» по умолчанию; «Отправить запрос» недоступна до загрузки.
  it('машины фирмы рейса не загрузились: role=alert с «Повторить», отправка недоступна; загрузка — скелетон, затем «Наша + можно свою»', async () => {
    const a = await open({ setup: (s) => usual(s), scenario: 'listVehicles=offline' });
    const dlg = await dialogOf();
    const alert = await within(dlg).findByRole('alert', undefined, SLOW);
    expect(alert.textContent).toContain('Не удалось загрузить машины фирмы рейса: ');
    expect(dlg.textContent).not.toContain('Рейсу подходит 0 из 0');
    expect(within(dlg).queryByRole('radio')).toBeNull();
    expect(dlg.querySelector('.ox-pl-sum')).toBeNull();
    expect(submit(dlg).disabled).toBe(true);
    fireEvent.click(submit(dlg));
    expect(poolOf(a.scenario).transfers).toHaveLength(0);
    // «Повторить» — загрузка: скелетон в блоке «Машина», отправка по-прежнему недоступна.
    a.scenario.setScenario('listVehicles=delay=1500');
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    expect(await within(dlg).findByRole('status', { name: 'Загрузка' }, SLOW)).toBeTruthy();
    expect(within(dlg).queryByRole('radio')).toBeNull();
    expect(dlg.textContent).not.toContain('Рейсу подходит 0 из 0');
    expect(submit(dlg).disabled).toBe(true);
    // Загрузились — режим по умолчанию «Наша + можно свою», как без задержки.
    await waitFor(
      () => expect(radio(dlg, 'Ставим нашу машину').getAttribute('aria-checked')).toBe('true'),
      SLOW,
    );
    expect(choice(dlg).getAttribute('aria-checked')).toBe('true');
    expect(dlg.textContent).toContain('Рейсу подходит 1 из 4 свободных машин Север Логистик.');
    expect(within(dlg).queryByRole('alert')).toBeNull();
    expect(submit(dlg).disabled).toBe(false);
    a.scenario.setScenario(null);
    fireEvent.click(submit(dlg));
    await waitFor(() => expect(poolOf(a.scenario).transfers).toHaveLength(1), SLOW);
    expect(poolOf(a.scenario).transfers[0]?.vehicle?.mode).toBe('host_or_home');
  });

  it('машины фирмы рейса ещё грузятся при открытии диалога: скелетон, без «0 из 0», отправка недоступна', async () => {
    await open({ setup: (s) => usual(s), scenario: 'listVehicles=delay=6000' });
    const dlg = await dialogOf();
    expect(within(dlg).getByRole('status', { name: 'Загрузка' })).toBeTruthy();
    expect(within(dlg).queryByRole('radio', { name: 'Едет на своей обычной' })).toBeNull();
    expect(dlg.textContent).not.toContain('Рейсу подходит 0 из 0');
    expect(submit(dlg).disabled).toBe(true);
    await waitFor(
      () => expect(radio(dlg, 'Ставим нашу машину').getAttribute('aria-checked')).toBe('true'),
      { timeout: 12_000 },
    );
    expect(radio(dlg, 'Едет на своей обычной').getAttribute('aria-checked')).toBe('false');
  });
});

/** Владелец: «Запросить на рейс Р-211» Водителя #104 (режим по умолчанию) и входящий запрос этой же организации. */
async function ownerRequested(home = false): Promise<{ a: MockApp; row: HTMLElement }> {
  const a = await open({ persona: 'owner', setup: (s) => usual(s) });
  const dlg = await dialogOf();
  if (home) fireEvent.click(radio(dlg, 'Едет на своей обычной'));
  fireEvent.click(submit(dlg));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW);
  const block = (
    await screen.findByRole('heading', { level: 2, name: 'Входящие запросы' }, SLOW)
  ).closest('section') as HTMLElement;
  const row = within(block)
    .getByText(/Водитель #104/)
    .closest('article') as HTMLElement;
  return { a, row };
}

describe('1b · входящий запрос фирмы водителя', () => {
  it('«Ждёт решения», «Машина», «Ваша машина», «Что откроется …», три кнопки, сноска (:196–228)', async () => {
    const { row } = await ownerRequested();
    expect(row.textContent).toContain('Север Логистик просит на рейс Р-211');
    expect(row.textContent).toContain('Ждёт решения');
    expect(dd(row, 'Когда')).toBe('01.10, 14:00–18:00 · доступ до 18:00');
    expect(dd(row, 'Машина')).toBe('Их Ford Transit или ваша Hyundai HD-35 — на выбор водителя');
    expect(row.textContent).toContain('Ваша машина');
    expect(row.textContent).toContain('Hyundai HD-35 · Н 384 ТК 77');
    expect(row.textContent).toContain('Свободна 14:00–18:00');
    expect(row.textContent).toContain(
      'Удерживается на 14:00–18:00, пока водитель выбирает (до 13:30). Не выберет её — сразу вернётся к вам.',
    );
    expect(row.textContent).toContain(
      'Осмотры и дефекты по этому рейсу видите вы. Решение по блокирующему дефекту — тоже за вами.',
    );
    expect(row.textContent).toContain('Что откроется Север Логистик');
    expect(row.textContent).toContain('Имя и телефон водителя до 18:00');
    expect(row.textContent).toContain('По машине: модель, номер, габариты, осмотры этого рейса');
    expect(row.textContent).toContain('Начисления, история рейсов, другие машины Юг Транс');
    expect(
      within(row)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Одобрить с машиной', 'Только водителя', 'Отклонить']);
    expect(row.textContent).toContain(
      'Отклонить можно только с причиной. Начисления по рейсу ведутся отдельной записью, Юг Транс их не получает автоматически.',
    );
  });

  it('«Отклонить» без причины — сообщение, запрос не уходит; с причиной — отклонён (Q-W2.70-8)', async () => {
    const { a, row } = await ownerRequested();
    fireEvent.click(within(row).getByRole('button', { name: 'Отклонить' }));
    expect((await within(row).findByRole('alert', undefined, SLOW)).textContent).toContain(
      'Укажите причину отказа',
    );
    expect(poolOf(a.scenario).transfers[0]?.status).toBe('requested');
    // Сообщение связано с полем (aria-describedby), фокус — в поле причины.
    const field = within(row).getByLabelText('Причина отказа');
    const alert = within(row).getByRole('alert');
    expect(alert.id).not.toBe('');
    expect(field.getAttribute('aria-describedby')?.split(' ')).toContain(alert.id);
    expect(document.activeElement).toBe(field);
    fireEvent.change(within(row).getByLabelText('Причина отказа'), {
      target: { value: 'Машина нужна на своём рейсе' },
    });
    expect(within(row).queryByRole('alert')).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Отклонить' }));
    await waitFor(() => expect(toast()).toBe('Фирма Юг Транс отклонила запрос'), SLOW);
    expect(poolOf(a.scenario).transfers[0]).toMatchObject({
      status: 'rejected',
      decisionComment: 'Машина нужна на своём рейсе',
    });
  });

  // Возврат 3 (ревью r3, minor): сообщение о причине относится только к «Отклонить» — другое решение его снимает.
  it.each(['Одобрить с машиной', 'Только водителя'])(
    '«Отклонить» без причины, затем «%s» — сообщение «Укажите причину отказа» снято',
    async (name) => {
      const { a, row } = await ownerRequested();
      a.scenario.setScenario('decideDriverTransfer=offline');
      fireEvent.click(within(row).getByRole('button', { name: 'Отклонить' }));
      expect((await within(row).findByRole('alert', undefined, SLOW)).textContent).toContain(
        'Укажите причину отказа',
      );
      fireEvent.click(within(row).getByRole('button', { name }));
      expect(within(row).queryByRole('alert')).toBeNull();
      expect(within(row).getByLabelText('Причина отказа').getAttribute('aria-invalid')).toBeNull();
      await waitFor(
        () => expect(toast()).toBe('Нет связи с сервером. Операция не выполнена.'),
        SLOW,
      );
      expect(within(row).queryByRole('alert')).toBeNull();
    },
  );
});

describe('1f · итог запроса у логиста', () => {
  it('«Одобрить с машиной»: брони до выбора, журнал, сноска; «Оставить Ford Transit» — выбрана, освобождена', async () => {
    const { a, row } = await ownerRequested();
    fireEvent.click(within(row).getByRole('button', { name: 'Одобрить с машиной' }));
    await waitFor(() => expect(toast()).toBe('Фирма Юг Транс одобрила запрос'), SLOW);
    const c = await card('Водитель #104');
    await waitFor(() => expect(c.textContent).toContain('Машины рейса'), SLOW);
    expect(c.querySelector('.ox-pl-chip')?.textContent).toContain('Временно назначен');
    expect(dd(c, 'Рейс')).toBe('Р-211 · Охлаждённая продукция · 14:00–18:00');
    expect(dd(c, 'Доступ')).toBe('До 18:00, только этот рейс');
    const rows = () =>
      [...c.querySelectorAll('.ox-pl-trip-car')].map((r) => r.textContent?.replace(/\s+/g, ' '));
    expect(rows()).toEqual([
      'ac_unitHyundai HD-35 · Н 384 ТК 77Юг Транс · обычная машина водителяhourglass_topБронь до выбора',
      'ac_unitFord Transit · М 608 КТ 77Север Логистик · нашаhourglass_topБронь до выбора',
    ]);
    const journal = () =>
      [...c.querySelectorAll('.ox-pl-journal li')].map((li) =>
        [...li.children].map((x) => x.textContent).join(' '),
      );
    expect(journal()).toEqual([
      '10:30 Вы запросили водителя. Машина: наша Ford Transit, можно свою обычную.',
      '10:30 Юг Транс одобрил водителя с машиной.',
      '10:30 Брони до выбора на 14:00–18:00: Ford Transit и Hyundai HD-35.',
    ]);
    expect(c.textContent).toContain(
      'Если водитель не выбирает до 13:30, остаётся Ford Transit, а Hyundai HD-35 возвращается в Юг Транс.',
    );
    fireEvent.click(within(c).getByRole('button', { name: 'Оставить Ford Transit' }));
    await waitFor(
      () =>
        expect(rows()).toEqual([
          'ac_unitHyundai HD-35 · Н 384 ТК 77Юг Транс · обычная машина водителяevent_busyОсвобождена · 10:30',
          'ac_unitFord Transit · М 608 КТ 77Север Логистик · нашаcheck_circleВыбрана · 10:30',
        ]),
      SLOW,
    );
    expect(journal().at(-1)).toBe('10:30 Вы оставили Ford Transit. Hyundai HD-35 освобождена.');
    expect(within(c).queryByRole('button', { name: 'Оставить Ford Transit' })).toBeNull();
    const host = poolOf(a.scenario).reservations.find((r) => r.offerKind === 'host');
    expect(host).toMatchObject({ state: 'confirmed' });
  });

  it('«Только водителя» при «Наша + можно свою»: одна машина — Ford Transit «Назначена на Р-211»', async () => {
    const { row } = await ownerRequested();
    fireEvent.click(within(row).getByRole('button', { name: 'Только водителя' }));
    await waitFor(() => expect(toast()).toBe('Фирма Юг Транс одобрила запрос'), SLOW);
    const c = await card('Водитель #104');
    await waitFor(() => expect(c.textContent).toContain('Назначена на Р-211'), SLOW);
    expect(c.textContent).toContain('Юг Транс одобрил только водителя, без машины.');
    expect(c.textContent).toContain('Бронь Ford Transit на 14:00–18:00.');
    expect(c.querySelectorAll('.ox-pl-trip-car')).toHaveLength(1);
  });

  it('«Своя машина водителя» → «Только водителя»: «Машины нет…»; «Поставить машину» → «Рабочее место логиста» ?trip=', async () => {
    const { a, row } = await ownerRequested(true);
    expect(dd(row, 'Машина')).toBe('Ваша Hyundai HD-35 · Н 384 ТК 77');
    expect(row.textContent).toContain('Занята на 14:00–18:00 рейсом Р-211 Север Логистик.');
    fireEvent.click(within(row).getByRole('button', { name: 'Только водителя' }));
    await waitFor(() => expect(toast()).toBe('Фирма Юг Транс одобрила запрос'), SLOW);
    const c = await card('Водитель #104');
    await waitFor(
      () =>
        expect(c.textContent).toContain('Машины нет: Юг Транс выдал водителя без обычной машины.'),
      SLOW,
    );
    expect(c.textContent).toContain('Машины нет, рейс попал в «Требует решения».');
    const trip = poolOf(a.scenario).trips.find((t) => t.number === 'Р-211');
    fireEvent.click(within(c).getByRole('button', { name: 'Поставить машину' }));
    await waitFor(() => expect(a.router.state.location.pathname).toMatch(/\/fleet$/), SLOW);
    expect(a.router.state.location.search).toMatchObject({ trip: trip?.id });
  });
});
