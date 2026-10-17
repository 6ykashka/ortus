// W2.20 · Экранные тесты формы «Планирование рейса» (S2-13, no-reference) на сценарном сервере: вход с рабочего места
// (?plan=new), участки при вводе, ошибки до отправки, создание (createTripPlan → тост, возврат с выбранным рейсом),
// 422 сервера по точке, нет связи (тот же Idempotency-Key — один рейс), подразделение владельца, только чтение.
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../../app/testing.tsx';
import { todayIn } from './model.ts';

const ALTA = seedUuid('platform', 't-alta');
const A = (id: string): string => seedUuid('t-alta', id);
const SLOW = { timeout: 5_000 };

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (o: MockAppOptions = {}): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/fleet?plan=new`, {
    persona: 'manager',
    preset: 'logistics-ready',
    ...o,
  });
  await screen.findByRole('heading', { level: 1, name: 'Планирование рейса' }, SLOW);
  return app;
};

const form = (): HTMLElement => screen.getByRole('form', { name: 'Планирование рейса' });
const stop = (n: number): HTMLElement => screen.getByRole('group', { name: `Точка ${n}` });
const set = (scope: HTMLElement, label: string, value: string): void => {
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
};
const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const sent = (a: MockApp, method: string, suffix: string) =>
  a.responses().filter((r) => r.method === method && r.path.endsWith(suffix));

function fill(o: { unloadMass?: string } = {}): void {
  const f = form();
  set(f, 'Название рейса', 'Вечерний развоз');
  set(f, 'Начало', '18:00');
  set(f, 'Окончание', '21:00');
  set(f, 'Что везём', 'Сухой груз · 4 паллеты');
  set(f, 'Масса груза', '0,8');
  set(f, 'Объём груза', '6');
  set(f, 'Длина кузова от', '2,5');
  set(stop(1), 'Адрес', 'Склад № 1, Лобня');
  set(stop(1), 'Время', '18:00');
  set(stop(1), 'Масса', '0,8');
  set(stop(1), 'Объём', '6');
  set(stop(2), 'Адрес', 'Химки, ул. Заводская, 8');
  set(stop(2), 'Масса', o.unloadMass ?? '0,8');
  set(stop(2), 'Объём', '6');
}

const submit = (): void => {
  fireEvent.click(within(form()).getByRole('button', { name: 'Запланировать' }));
};

describe('«Планирование рейса»: форма', () => {
  it('с рабочего места: «Запланировать рейс» → ?plan=new; «Отмена» возвращает', async () => {
    app = await renderMockApp(`/t/${ALTA}/fleet`, {
      persona: 'manager',
      preset: 'logistics-ready',
    });
    await screen.findByRole('tablist', { name: 'Рейсы' }, SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Запланировать рейс' }));
    await screen.findByRole('heading', { level: 1, name: 'Планирование рейса' }, SLOW);
    expect(app.router.state.location.search).toMatchObject({ plan: 'new' });
    expect((within(stop(1)).getByLabelText('Действие') as HTMLSelectElement).value).toBe('load');
    expect((within(stop(2)).getByLabelText('Действие') as HTMLSelectElement).value).toBe('unload');
    expect((within(form()).getByLabelText('Дата') as HTMLInputElement).value).toBe(
      todayIn(new Date(), 'Europe/Moscow'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await screen.findByRole('heading', { level: 1, name: 'Рабочее место логиста' }, SLOW);
    expect(app.router.state.location.search).toEqual({});
  });

  it('загрузка по участкам при вводе; выгрузка больше загрузки — ошибка под точкой, запроса нет', async () => {
    const a = await open();
    fill({ unloadMass: '1' });
    const legs = screen.getByRole('list', { name: 'Загрузка по участкам' });
    const items = within(legs).getAllByRole('listitem');
    expect(items[0]?.textContent).toContain('Погрузка +6 м³ · 0,8 т');
    expect(items[0]?.textContent).toContain('В кузове после точки: 6 м³ · 0,8 т');
    expect(stop(2).textContent).toContain('Выгрузка больше, чем в кузове после предыдущей точки');
    submit();
    await new Promise((r) => setTimeout(r, 50));
    expect(sent(a, 'POST', '/fleet/trip-plans')).toEqual([]);
    set(stop(2), 'Масса', '0,8');
    expect(stop(2).textContent).not.toContain('Выгрузка больше');
    expect(within(legs).getAllByRole('listitem')[1]?.textContent).toContain(
      'В кузове после точки: 0 м³ · 0 т',
    );
  });

  it('пустая форма: ошибки после «Запланировать», aria-invalid, запроса нет', async () => {
    const a = await open();
    expect(form().textContent).not.toContain('Укажите название рейса');
    submit();
    await waitFor(() => expect(form().textContent).toContain('Укажите название рейса'));
    expect(form().textContent).toContain('Опишите груз');
    expect(stop(1).textContent).toContain('Укажите адрес');
    expect(within(form()).getByLabelText('Название рейса').getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(sent(a, 'POST', '/fleet/trip-plans')).toEqual([]);
  });

  it('«Добавить точку» — выгрузка третьей точкой; «Удалить точку 3»', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить точку' }));
    expect((within(stop(3)).getByLabelText('Действие') as HTMLSelectElement).value).toBe('unload');
    fireEvent.click(screen.getByRole('button', { name: 'Удалить точку 3' }));
    expect(screen.queryByRole('group', { name: 'Точка 3' })).toBeNull();
  });

  it('«Запланировать»: рейс Р-212 создан с водителем, тост, рабочее место с выбранным рейсом', async () => {
    const a = await open();
    fill();
    const driver = within(form()).getByLabelText('Водитель') as HTMLSelectElement;
    await waitFor(() => expect([...driver.options].map((o) => o.text)).toContain('Илья Васильев'));
    expect(driver.options[0]?.text).toBe('Без водителя — назначить позже');
    fireEvent.change(driver, { target: { value: A('m-vasiliev') } });
    submit();
    await waitFor(() => expect(toast()).toBe('Рейс Р-212 запланирован'), SLOW);
    await screen.findByRole('heading', { level: 1, name: 'Рабочее место логиста' }, SLOW);
    const created = await screen.findByRole('tab', { name: /Р-212 · Вечерний развоз/ }, SLOW);
    expect(created.getAttribute('aria-selected')).toBe('true');
    expect(created.textContent).toContain('18:00–21:00 · Запланирован');
    expect(sent(a, 'POST', '/fleet/trip-plans').map((r) => r.status)).toEqual([201]);
    const org = a.scenario.state().orgs[ALTA] as unknown as {
      fleet: { trips: { number: string; orgUnitId: string; driverMemberId?: string }[] };
    };
    expect(org.fleet.trips.find((t) => t.number === 'Р-212')).toMatchObject({
      orgUnitId: A('f-msk-sever'),
      driverMemberId: A('m-vasiliev'),
    });
  });

  it('422 сервера по точке — ошибка под массой второй точки, форма открыта', async () => {
    const a = await open();
    fill();
    a.scenario.setScenario('createTripPlan=validation_failed', true);
    submit();
    await waitFor(
      () =>
        expect(stop(2).textContent).toContain(
          'Выгрузка больше, чем в кузове после предыдущей точки',
        ),
      SLOW,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Планирование рейса' })).toBeTruthy();
  });

  it('нет связи: тост, ввод сохранён; повтор с тем же ключом — один рейс', async () => {
    const a = await open();
    fill();
    a.scenario.setScenario('createTripPlan=offline', true);
    submit();
    await waitFor(() => expect(toast()).toBe('Нет связи с сервером. Операция не выполнена.'), SLOW);
    expect((within(form()).getByLabelText('Название рейса') as HTMLInputElement).value).toBe(
      'Вечерний развоз',
    );
    submit();
    await waitFor(() => expect(toast()).toBe('Рейс Р-212 запланирован'), SLOW);
    const org = a.scenario.state().orgs[ALTA] as unknown as { fleet: { trips: unknown[] } };
    expect(org.fleet.trips).toHaveLength(3);
  });

  it('владелец: «Подразделение» — фирмы, по умолчанию подразделение выбранного рейса', async () => {
    await open({ persona: 'owner' });
    const unit = (await within(form()).findByLabelText(
      'Подразделение',
      undefined,
      SLOW,
    )) as HTMLSelectElement;
    await waitFor(() => expect(unit.selectedOptions[0]?.text).toBe('Москва / Север Логистик'));
    expect([...unit.options].map((o) => o.text)).toContain('Самара / Волга Логистик');
  });

  it('модуль отключён с историей: формы нет, пояснение', async () => {
    await open({
      persona: 'owner',
      setup: (s) => {
        const m = s.state().orgs[ALTA]?.modules.fleet;
        if (m) {
          m.state = 'read_only';
          m.revision++;
        }
      },
    });
    expect(screen.queryByRole('form', { name: 'Планирование рейса' })).toBeNull();
    expect(screen.getByText('Модуль отключён: новые рейсы не планируются.')).toBeTruthy();
  });
});
