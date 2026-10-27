// W6.23 · Экранные тесты «Графика» объекта на сценарном сервере (MSW repairs W6.00, пресет repairs-ready, «сегодня»
// 20.10.2026): шапка, диаграмма, панель этапа, предпросмотр и сохранение с причиной, «Ближайшие 3 недели», гейт, ошибки.
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../../app/testing.tsx';

const SLOW = { timeout: 8_000 };
const ALTA = seedUuid('platform', 't-alta');
const A = (id: string): string => seedUuid('t-alta', id);
const H1 = 'График работ';

let app: MockApp | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T12:00:00+03:00'));
});
afterEach(() => {
  app?.close();
  app = undefined;
  vi.useRealTimers();
});

const open = async (project = 'obj-42', o: MockAppOptions = {}): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/repair/${A(project)}/schedule`, {
    persona: 'owner',
    preset: 'repairs-ready',
    ...o,
  });
  return app;
};

const loaded = async (): Promise<void> => {
  await screen.findByRole('heading', { level: 1, name: H1 }, SLOW);
  await screen.findByRole('img', { name: /^Демонтаж: / }, SLOW);
};

describe('график объекта: чтение', () => {
  it('заголовок, крошка, чипы «По договору» и «Прогноз», вступление с договором и «сегодня»', async () => {
    await open();
    await loaded();
    expect(screen.getByText('По договору 27.11, пт')).toBeTruthy();
    expect(screen.getByText('Прогноз 01.12, вт · +2 раб. дня')).toBeTruthy();
    expect(
      screen.getByText(/базовый план, утверждённый вместе с договором № 42\. Сегодня 20 октября\./),
    ).toBeTruthy();
    const crumb = screen.getByRole('navigation', { name: 'Крошка' });
    await within(crumb).findByText('ЖК Речной · квартира 42', undefined, SLOW);
    expect(crumb.textContent).toContain('Ремонт и стройка');
  });

  it('диаграмма: полосы этапов с датами и рабочими днями, веха, разделы, связи', async () => {
    await open();
    await loaded();
    expect(
      screen.getByRole('img', { name: 'Демонтаж: 05.10, пн – 09.10, пт, 5 раб. дней' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('img', {
        name: /^Электрика · черновая: 12\.10, пн – 23\.10, пт, 10 раб\. дней/,
      }),
    ).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Сдача объекта: 01.12, вт' })).toBeTruthy();
    for (const phase of ['Черновые работы', 'Чистовые работы', 'Сдача']) {
      expect(screen.getAllByText(phase).length).toBeGreaterThan(0);
    }
    expect(document.querySelectorAll('[data-link]').length).toBe(12);
  });

  it('сводка: «Сдача объекта», критический путь, «Требует внимания», история с причиной, «Как собран график»', async () => {
    await open();
    await loaded();
    const aside = screen.getByRole('complementary', { name: 'Сводка графика и этап' });
    expect(within(aside).getByRole('heading', { name: 'Сдача объекта' })).toBeTruthy();
    expect(within(aside).getByText('Позже договора на 2 раб. дня')).toBeTruthy();
    expect(
      within(aside).getByText(
        'Чтобы вернуть 27.11, нужно отыграть 2 раб. дня на критическом пути. Сократите один из этапов:',
      ),
    ).toBeTruthy();
    expect(within(aside).getByRole('heading', { name: 'Требует внимания' })).toBeTruthy();
    expect(within(aside).getByText(/«Плитка в санузле»: не назначен исполнитель/)).toBeTruthy();
    expect(within(aside).getByRole('heading', { name: 'История изменений' })).toBeTruthy();
    expect(within(aside).getByText('Причина: Задержка подрядчика')).toBeTruthy();
    expect(within(aside).getByRole('heading', { name: 'Как собран график' })).toBeTruthy();
  });

  it('«Как собран график»: первая строка дословно эталона — с шаблоном «Капитальный ремонт квартиры»', async () => {
    await open();
    await loaded();
    const aside = screen.getByRole('complementary', { name: 'Сводка графика и этап' });
    expect(
      within(aside).getByText(
        'Этапы взяты из разделов сметы и шаблона «Капитальный ремонт квартиры». Порядок — по технологии, а не по строкам сметы.',
      ),
    ).toBeTruthy();
  });

  it('подписи шкалы: «Октябрь 2026», «Ноябрь», «Декабрь» — без года и точек сверх эталона', async () => {
    await open();
    await loaded();
    const labels = [...document.querySelectorAll('[data-month]')].map((e) => e.textContent ?? '');
    expect(labels.length).toBeGreaterThanOrEqual(3);
    // Год — только у первого месяца; сокращения — с точкой, как в эталоне (нояб., дек.).
    expect(labels.slice(1).some((l) => /\d/.test(l))).toBe(false);
    expect(labels.filter((l) => /^(ноя|дек|окт)$/.test(l))).toEqual([]);
    expect(labels[0]).toMatch(/^(Октябрь 2026|окт\.)$/);
  });

  it('«Ближайшие 3 недели»: три окна, праздник 4 ноября', async () => {
    await open();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Ближайшие 3 недели' }));
    expect(
      await screen.findByRole('heading', { level: 3, name: 'Эта неделя · 19–23 октября' }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: /^Следующая неделя · / })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: /^Через неделю · / })).toBeTruthy();
    expect(screen.getByText('4 ноября — выходной')).toBeTruthy();
    expect(screen.queryByRole('img', { name: /^Демонтаж: / })).toBeNull();
  });
});

describe('график объекта: правка и сохранение', () => {
  const pickStage = async (name: string): Promise<HTMLElement> => {
    // Первая кнопка с этим названием — строка диаграммы (дальше идут кнопки сводки справа).
    fireEvent.click(
      screen.getAllByRole('button', { name: new RegExp('^' + name) })[0] as HTMLElement,
    );
    const h = await screen.findByRole('heading', { level: 3, name }, SLOW);
    return h.closest('div.ox-gt-card') as HTMLElement;
  };

  it('панель этапа: сроки, «По договору», связи, исполнитель; «Сводка графика» возвращает сводку', async () => {
    await open();
    await loaded();
    const panel = await pickStage('Штукатурка стен');
    expect(within(panel).getByText('Длительность')).toBeTruthy();
    expect(within(panel).getByText('После «Электрика · черновая»')).toBeTruthy();
    expect(within(panel).getByText('Следом:')).toBeTruthy();
    expect(within(panel).getByText(/^По договору: /)).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Сводка графика' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Сдача объекта' })).toBeTruthy();
  });

  it('длительность +1: предпросмотр, без причины сохранить нельзя; причина → «График сохранён.» и запись в истории', async () => {
    await open();
    await loaded();
    const panel = await pickStage('Штукатурка стен');
    fireEvent.click(within(panel).getByRole('button', { name: 'Продлить на рабочий день' }));
    const region = await screen.findByRole('region', { name: 'Несохранённое изменение графика' });
    expect(region.textContent).toContain('«Штукатурка стен»: длительность 10 → 11 раб. дней.');
    expect(region.textContent).toContain('Причина попадёт в историю графика и в уведомления.');
    // «Уведомим» дословно эталона: исполнители, затем «; заказчика <имя в винительном> — меняется дата сдачи.»
    await waitFor(
      () =>
        expect(region.textContent).toMatch(
          /Уведомим: [^;]*; заказчика Ольгу Смирнову — меняется дата сдачи\./,
        ),
      SLOW,
    );
    expect(region.textContent).not.toContain('Заказчик.');
    const save = within(region).getByRole('button', {
      name: 'Сохранить и уведомить',
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(region).getByLabelText('Причина'), {
      target: { value: 'material_delay' },
    });
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await screen.findByText(/^График сохранён\./, undefined, SLOW);
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Несохранённое изменение графика' })).toBeNull(),
    );
    expect(screen.getByRole('img', { name: /^Штукатурка стен: .*, 11 раб\. дней/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сводка графика' }));
    const aside = screen.getByRole('complementary', { name: 'Сводка графика и этап' });
    expect(
      await within(aside).findByText('Причина: Поставка материалов', undefined, SLOW),
    ).toBeTruthy();
  });

  it('«Отменить» сбрасывает предпросмотр; начало ± по рабочим дням; пауза по связи', async () => {
    await open();
    await loaded();
    const panel = await pickStage('Стяжка пола');
    fireEvent.click(within(panel).getByRole('button', { name: 'Начать на рабочий день позже' }));
    const region = await screen.findByRole('region', { name: 'Несохранённое изменение графика' });
    expect(region.textContent).toMatch(/«Стяжка пола»: начало \d\d\.\d\d → \d\d\.\d\d\./);
    fireEvent.click(within(region).getByRole('button', { name: 'Отменить' }));
    expect(screen.queryByRole('region', { name: 'Несохранённое изменение графика' })).toBeNull();
  });

  it('исполнитель этапа меняется без причины: тост и запись в истории', async () => {
    await open();
    await loaded();
    const panel = await pickStage('Плитка в санузле');
    const select = within(panel).getByLabelText('Исполнитель') as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(1), SLOW);
    const option = [...select.options].find((o) => o.value && o.value !== '__keep');
    expect(option).toBeTruthy();
    fireEvent.change(select, { target: { value: option?.value } });
    await waitFor(
      () =>
        expect(document.querySelector('.ox-toast .ox-toast-text')?.textContent).toBe(
          'Исполнитель изменён.',
        ),
      SLOW,
    );
  });

  it('устаревший график (412): тост, предпросмотр сброшен, данные перечитаны', async () => {
    await open('obj-42', { scenario: 'applyScheduleChange=revision_mismatch' });
    await loaded();
    const panel = await pickStage('Штукатурка стен');
    fireEvent.click(within(panel).getByRole('button', { name: 'Продлить на рабочий день' }));
    const region = await screen.findByRole('region', { name: 'Несохранённое изменение графика' });
    fireEvent.change(within(region).getByLabelText('Причина'), { target: { value: 'other' } });
    fireEvent.click(within(region).getByRole('button', { name: 'Сохранить и уведомить' }));
    await waitFor(
      () =>
        expect(document.querySelector('.ox-toast .ox-toast-text')?.textContent).toBe(
          'График изменили в другом окне: данные обновлены, повторите правку.',
        ),
      SLOW,
    );
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Несохранённое изменение графика' })).toBeNull(),
    );
  });
});

describe('график объекта: состояния', () => {
  it('нет графика у объекта-черновика: «Графика ещё нет», сборка без согласованной сметы — ошибка сервера в тосте', async () => {
    await open('obj-50');
    expect(await screen.findByText('Графика ещё нет', undefined, SLOW)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Собрать график по смете' }));
    await waitFor(
      () => expect(document.querySelector('.ox-toast .ox-toast-text')?.textContent).toBeTruthy(),
      SLOW,
    );
  });

  it('ошибка загрузки — «Повторить»', async () => {
    await open('obj-42', { scenario: 'getSchedule=rate_limited' });
    expect(
      await screen.findByText(
        'Не удалось загрузить график: Слишком много запросов. Подождите и повторите.',
        undefined,
        SLOW,
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });

  it('роль без доступа к «Ремонту и стройке»: «Нет роли с доступом к графику объекта»', async () => {
    await open('obj-42', { persona: 'driver' });
    expect(
      await screen.findByText('Нет роли с доступом к графику объекта', undefined, SLOW),
    ).toBeTruthy();
  });

  it('чужая организация — «Страница не найдена»', async () => {
    app = await renderMockApp(`/t/${A('no-such')}/repair/${A('obj-42')}/schedule`, {
      persona: 'owner',
      preset: 'repairs-ready',
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Страница не найдена' }, SLOW),
    ).toBeTruthy();
  });
});
