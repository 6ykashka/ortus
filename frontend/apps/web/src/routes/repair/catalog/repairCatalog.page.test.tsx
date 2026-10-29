// W6.22 · Экранные тесты страницы «Шаблоны и расценки» (`repair-catalog`) на сценарном сервере (MSW repairs W6.00,
// пресет repairs-ready: 4 шаблона, 23 позиции справочника). Эталон :614–721: «Шаблоны» (карточка, технология,
// документы, материалы, чек-лист, «Сделать копию», правка формул) и «Справочник расценок» (поиск, тип, цена в строке,
// «Новая позиция»).
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const SLOW = { timeout: 5_000 };
const H1 = 'Шаблоны и расценки';

let app: MockApp | undefined;

afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (path = 'repair-catalog', o: MockAppOptions = {}): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/${path}`, {
    persona: 'owner',
    preset: 'repairs-ready',
    ...o,
  });
  await screen.findByRole('heading', { level: 1, name: H1 }, SLOW);
  return app;
};

const note = (): string | null | undefined =>
  document.querySelector('.ox-rps-note .ox-rps-note-text')?.textContent;

const card = async (): Promise<HTMLElement> =>
  (
    await screen.findByRole('heading', { level: 2, name: 'Капитальный ремонт квартиры' }, SLOW)
  ).closest('.ox-rc-detail') as HTMLElement;

describe('«Шаблоны и расценки»: каркас', () => {
  it('крошка, h1, описание, вкладки со счётчиками', async () => {
    await open();
    expect(document.querySelector('.ox-rps-crumb')?.textContent).toBe('Ремонт и стройка');
    expect(screen.getByText(/^Шаблон задаёт, что объект получает при создании:/)).toBeTruthy();
    const tabs = screen.getByRole('tablist', { name: 'Шаблоны и расценки' });
    expect(await within(tabs).findByRole('tab', { name: 'Шаблоны · 4' }, SLOW)).toBeTruthy();
    expect(within(tabs).getByRole('tab', { name: 'Справочник расценок · 23' })).toBeTruthy();
    expect(
      within(tabs).getByRole('tab', { name: 'Шаблоны · 4' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('прораб: оболочка закрывает страницу гейтом', async () => {
    app = await renderMockApp(`/t/${ALTA}/repair-catalog`, {
      persona: 'foreman',
      preset: 'repairs-ready',
    });
    expect(
      await screen.findByText(/Нет доступа к разделу «Ремонт и стройка»/, undefined, SLOW),
    ).toBeTruthy();
  });

  it('ошибка загрузки: текст и «Повторить»', async () => {
    await open('repair-catalog', { scenario: 'listTemplates=rate_limited' });
    expect(
      await screen.findByText(
        'Не удалось загрузить шаблоны и расценки: Слишком много запросов. Подождите и повторите.',
        undefined,
        SLOW,
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });
});

describe('«Шаблоны»', () => {
  it('список шаблонов: названия, метки происхождения, «… · объектов: N»', async () => {
    await open();
    const list = await screen.findByRole('button', { name: /Капитальный ремонт квартиры/ }, SLOW);
    expect(list.getAttribute('aria-pressed')).toBe('true');
    expect(list.textContent).toContain('Ортус · копия организации');
    expect(list.textContent).toContain('5 разделов · 14 строк · 10 из замера · объектов: 2');
    for (const name of [
      'Косметический ремонт',
      'Ремонт под ключ · дом',
      'Коммерческое помещение',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeTruthy();
    }
  });

  it('карточка: вид ремонта, дата, происхождение, таблица, технология, документы, материалы, чек-лист', async () => {
    await open();
    const c = await card();
    expect(c.textContent).toContain(
      'Вид ремонта: капитальный ремонт · изменён 12.09 · объектов по шаблону: 2',
    );
    expect(c.textContent).toContain(
      'Стартовый шаблон Ортуса, скопирован в организацию. Правки остаются у вас и не меняют уже созданные объекты.',
    );
    const heads = within(c)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(heads.slice(0, 3)).toEqual([
      'Работа или материал',
      'Объём в шаблоне',
      'Цена в справочнике',
    ]);
    expect(within(c).getAllByText('из замера: площадь пола').length).toBeGreaterThan(0);
    expect(within(c).getByText('фиксированно: 30 шт')).toBeTruthy();
    expect(
      screen.getByText(
        'Объёмы считаются из замера объекта при сборке черновика, цены берутся из справочника на дату сборки. Правка шаблона не меняет уже созданные сметы.',
      ),
    ).toBeTruthy();
    for (const h of [
      'Технология графика',
      'Комплект документов',
      'Материалы для снабжения',
      'Чек-лист приёмки',
    ]) {
      expect(screen.getByRole('heading', { level: 3, name: h })).toBeTruthy();
    }
    expect(screen.getByText('Договор подряда — из согласованной версии сметы')).toBeTruthy();
    expect(screen.getByText('Гарантийный паспорт · 24 месяца')).toBeTruthy();
    expect(screen.getByText('Стены: отклонение не больше 2 мм на 2 м')).toBeTruthy();
  });

  it('выбор другого шаблона меняет карточку', async () => {
    await open();
    fireEvent.click(await screen.findByRole('button', { name: /Косметический ремонт/ }, SLOW));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Косметический ремонт' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Косметический ремонт/ }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('«Сделать копию» → «Свой · копия», режим правки, сообщение', async () => {
    await open();
    fireEvent.click(await within(await card()).findByRole('button', { name: 'Сделать копию' }));
    await waitFor(
      () =>
        expect(note()).toBe(
          'Копия «Капитальный ремонт квартиры» создана — настройте её под свой вид работ.',
        ),
      SLOW,
    );
    const name = 'Капитальный ремонт квартиры · копия';
    const copy = (await screen.findByRole('heading', { level: 2, name }, SLOW)).closest(
      '.ox-rc-detail',
    ) as HTMLElement;
    expect(copy.textContent).toContain('Свой · копия');
    expect(copy.textContent).toContain(
      'Копия шаблона «Капитальный ремонт квартиры». Правки не меняют уже созданные объекты.',
    );
    expect(within(copy).getByRole('button', { name: 'Готово' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Шаблоны · 5' })).toBeTruthy();
  });

  it('правка: формула → фиксированное количество, коэффициент, строка из справочника, убрать; «Готово» сохраняет', async () => {
    await open();
    const c = await card();
    expect(within(c).queryByRole('button', { name: 'Готово' })).toBeNull();
    fireEvent.click(within(c).getByRole('button', { name: 'Изменить смету шаблона' }));
    expect(within(c).getByRole('button', { name: 'Готово' })).toBeTruthy();
    const how = within(c).getByLabelText(
      'Как считать объём: Демонтаж напольного покрытия',
    ) as HTMLSelectElement;
    expect([...how.options].map((o) => o.textContent)).toEqual([
      'Фиксированное количество',
      'Из замера: площадь пола',
      'Из замера: пол без санузлов',
      'Из замера: площадь стен',
      'Из замера: стены без санузлов',
      'Из замера: санузлы: пол и стены',
      'Из замера: периметр',
      'Из замера: периметр без санузлов',
    ]);
    fireEvent.change(how, { target: { value: '' } });
    fireEvent.change(within(c).getByLabelText('Количество: Демонтаж напольного покрытия'), {
      target: { value: '40' },
    });
    fireEvent.change(within(c).getByLabelText('Коэффициент: Штукатурка по маякам'), {
      target: { value: '1,1' },
    });
    fireEvent.click(within(c).getByRole('button', { name: 'Убрать из шаблона: Вывоз мусора' }));
    expect(within(c).queryByLabelText('Количество: Вывоз мусора')).toBeNull();
    const add = within(c).getAllByRole('button', {
      name: 'Строка из справочника',
    })[0] as HTMLElement;
    fireEvent.click(add);
    expect(add.getAttribute('aria-expanded')).toBe('true');
    fireEvent.change(within(c).getByLabelText('Поиск по справочнику расценок'), {
      target: { value: 'перегородок' },
    });
    fireEvent.click(await within(c).findByRole('button', { name: /Демонтаж перегородок/ }));
    expect(within(c).getByLabelText('Количество: Демонтаж перегородок')).toBeTruthy();
    fireEvent.click(within(c).getByRole('button', { name: 'Готово' }));
    await waitFor(
      () => expect(within(c).queryByRole('button', { name: 'Готово' })).toBeNull(),
      SLOW,
    );
    expect(await within(c).findByText('фиксированно: 40 м²')).toBeTruthy();
    expect(within(c).getByText('из замера: стены без санузлов × 1,1')).toBeTruthy();
    expect(within(c).queryByText('Вывоз мусора')).toBeNull();
    expect(within(c).getByText('Демонтаж перегородок')).toBeTruthy();
  });
});

describe('«Справочник расценок»', () => {
  const price = async (): Promise<HTMLElement> => {
    fireEvent.click(await screen.findByRole('tab', { name: 'Справочник расценок · 23' }, SLOW));
    return (await screen.findByRole('heading', { level: 3, name: 'Новая позиция' }, SLOW)).closest(
      'div.ox-rps-card-sel',
    ) as HTMLElement;
  };

  it('таблица по разделам: колонки, счётчик, тип и единица', async () => {
    await open('repair-catalog?tab=price');
    await screen.findByLabelText('Цена: Электромонтаж, точка', undefined, SLOW);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Позиция',
      'Тип',
      'Ед.',
      'Цена, ₽',
      'В шаблонах',
    ]);
    expect(screen.getByText('23 из 23')).toBeTruthy();
    for (const section of ['Демонтаж', 'Электрика', 'Стены', 'Полы', 'Сантехника', 'Материалы']) {
      expect(screen.getByRole('cell', { name: section })).toBeTruthy();
    }
    const row = (await screen.findByLabelText('Цена: Электромонтаж, точка')).closest(
      'tr',
    ) as HTMLElement;
    expect(row.textContent).toContain('Работа');
    expect(row.textContent).toContain('шт');
    expect(
      (within(row).getByLabelText('Цена: Электромонтаж, точка') as HTMLInputElement).value,
    ).toBe('1200');
  });

  it('поиск и тип: «N из 23», «Ничего не найдено.»', async () => {
    await open('repair-catalog?tab=price');
    await screen.findByLabelText('Цена: Электромонтаж, точка', undefined, SLOW);
    fireEvent.change(screen.getByLabelText('Поиск по справочнику'), {
      target: { value: 'ламинат' },
    });
    expect(screen.getByText('3 из 23')).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Тип позиции' })).getByRole('button', {
        name: 'Работы',
      }),
    );
    expect(screen.getByText('1 из 23')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Поиск по справочнику'), {
      target: { value: 'нет такого' },
    });
    expect(screen.getByText('Ничего не найдено.')).toBeTruthy();
  });

  it('цена в строке сохраняется по выходу из поля; неверная цена не сохраняется', async () => {
    await open('repair-catalog?tab=price');
    const input = (await screen.findByLabelText(
      'Цена: Электромонтаж, точка',
      undefined,
      SLOW,
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1 350' } });
    fireEvent.blur(input);
    await waitFor(
      () =>
        expect(
          (screen.getByLabelText('Цена: Электромонтаж, точка') as HTMLInputElement).value,
        ).toBe('1350'),
      SLOW,
    );
    const again = screen.getByLabelText('Цена: Электромонтаж, точка');
    fireEvent.change(again, { target: { value: '0' } });
    fireEvent.blur(again);
    expect(await screen.findByText('Укажите цену больше нуля', undefined, SLOW)).toBeTruthy();
    await waitFor(
      () =>
        expect(
          (screen.getByLabelText('Цена: Электромонтаж, точка') as HTMLInputElement).value,
        ).toBe('1350'),
      SLOW,
    );
  });

  it('«Новая позиция»: ошибки эталона, успех и сообщение, дубликат', async () => {
    await open('repair-catalog?tab=price');
    const form = await price();
    const name = within(form).getByLabelText('Название') as HTMLInputElement;
    expect(name.placeholder).toBe('Например, «Монтаж дверного блока»');
    fireEvent.click(within(form).getByRole('button', { name: 'Добавить' }));
    expect(within(form).getByRole('alert').textContent).toBe('Укажите название позиции');
    fireEvent.change(name, { target: { value: 'Монтаж дверного блока' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Добавить' }));
    expect(within(form).getByRole('alert').textContent).toBe('Укажите цену больше нуля');
    fireEvent.change(within(form).getByLabelText('Цена, ₽'), { target: { value: '4 500' } });
    fireEvent.change(within(form).getByLabelText('Раздел'), { target: { value: 'Сантехника' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Добавить' }));
    await waitFor(
      () =>
        expect(note()).toBe(
          '«Монтаж дверного блока» добавлена в справочник: её можно выбрать в сметах и шаблонах.',
        ),
      SLOW,
    );
    expect(await screen.findByText('24 из 24', undefined, SLOW)).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Справочник расценок · 24' })).toBeTruthy();
    expect(screen.getByLabelText('Цена: Монтаж дверного блока')).toBeTruthy();
    expect((within(form).getByLabelText('Название') as HTMLInputElement).value).toBe('');
    fireEvent.change(within(form).getByLabelText('Название'), {
      target: { value: 'ламинат 33 класс' },
    });
    fireEvent.change(within(form).getByLabelText('Цена, ₽'), { target: { value: '100' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Добавить' }));
    expect(within(form).getByRole('alert').textContent).toBe(
      'Такая позиция уже есть в справочнике',
    );
  });
});

describe('переключение вкладок «Шаблоны» и «Справочник расценок»', () => {
  it('выбранный шаблон и режим правки сохраняются, строка-статус не переходит на другую вкладку', async () => {
    await open();
    fireEvent.click(await screen.findByRole('button', { name: /Косметический ремонт/ }, SLOW));
    const sel = (
      await screen.findByRole('heading', { level: 2, name: 'Косметический ремонт' })
    ).closest('.ox-rc-detail') as HTMLElement;
    fireEvent.click(within(sel).getByRole('button', { name: 'Сделать копию' }));
    await waitFor(() => expect(note()).toContain('Копия «Косметический ремонт» создана'), SLOW);
    fireEvent.click(await screen.findByRole('tab', { name: 'Справочник расценок · 23' }, SLOW));
    await screen.findByRole('heading', { level: 3, name: 'Новая позиция' }, SLOW);
    expect(note()).toBeUndefined();
    fireEvent.click(screen.getByRole('tab', { name: 'Шаблоны · 5' }));
    const back = (
      await screen.findByRole('heading', { level: 2, name: 'Косметический ремонт · копия' }, SLOW)
    ).closest('.ox-rc-detail') as HTMLElement;
    expect(within(back).getByRole('button', { name: 'Готово' })).toBeTruthy();
  });
});
