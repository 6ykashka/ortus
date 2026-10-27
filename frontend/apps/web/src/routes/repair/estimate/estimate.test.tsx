// W6.21 · Экранные тесты вкладки «Смета» на сценарном сервере MSW W6.00 (пресет repairs-ready, «сегодня» 20.10.2026):
// версии и сравнение кв. 42 (контрольные суммы DoR repair.md §2.6: v1 404 418 ₽, v2 438 175 ₽), допработы ДР-1
// (оценка в черновике допсоглашения +13 050 ₽, отклонение, отправка, отзыв, удаление), правка черновика, сборка по
// шаблону для дома в Истре (1 078 533 ₽ / 857 713 ₽), состояния и ошибки по кодам.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { MockApp } from '../../../app/testing.tsx';
import {
  OBJ27,
  OBJ42,
  OBJ50,
  openTab,
  SLOW,
  sectionOf,
  sent,
  toast,
} from '../measure/fixtures.test-util.ts';

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

/** Рубли с неразрывным пробелом разрядов (Intl ru-RU). */
const nb = (s: string): string => s.replace(/(\d) (\d{3})/g, '$1 $2');

const open = async (o: Parameters<typeof openTab>[0] = {}): Promise<MockApp> => {
  app = await openTab({ tab: 'estimate', ...o });
  await screen.findByRole('heading', { level: 2, name: 'Смета' }, SLOW);
  return app;
};

const section = (): HTMLElement => sectionOf('h-est');
/** Текст без лигатур иконок Material Symbols. */
const plain = (el: Element | null): string | undefined => {
  if (!el) return undefined;
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll('.material-symbols-rounded').forEach((i) => i.remove());
  return c.textContent ?? undefined;
};
const headChip = (): string | undefined =>
  plain(section().querySelector('.ox-rp-head .ox-rp-chip'));
const note = (): string | null | undefined =>
  section().querySelector('.ox-rp-note .ox-rp-note-text')?.textContent;
const versions = (): HTMLElement => within(section()).getByRole('group', { name: 'Версии сметы' });
const tile = (n: number): HTMLElement =>
  within(versions()).getByRole('button', { name: new RegExp(`^Версия ${n}\\b`) });
const btn = (name: string | RegExp): HTMLElement => within(section()).getByRole('button', { name });
const maybeBtn = (name: string | RegExp): HTMLElement | null =>
  within(section()).queryByRole('button', { name });
const rowOf = (name: string): HTMLElement => {
  const cell = within(section()).getByRole('cell', { name: new RegExp(`^${name}`) });
  const row = cell.closest('tr');
  if (!row) throw new Error(`нет строки «${name}»`);
  return row;
};
const grandTotal = (): string | null | undefined =>
  section().querySelector('tr.ox-rp-grand td:nth-child(2)')?.textContent;
const grandLabel = (): string | null | undefined =>
  section().querySelector('tr.ox-rp-grand td:first-child')?.textContent;
const clickAndWait = async (name: string | RegExp, until: () => unknown): Promise<void> => {
  fireEvent.click(btn(name));
  await waitFor(() => expect(until()).toBeTruthy(), SLOW);
};
const price = (rub: number): string => nb(`${new Intl.NumberFormat('ru-RU').format(rub)} ₽`);

describe('«Смета» кв. 42: версии', () => {
  it('заголовок, пояснение действующего объекта, чип «Версия 2 · действует»', async () => {
    await open();
    expect(
      within(section()).getByText(
        'Действует согласованная версия — основа договора. Изменения после договора проходят допсоглашением: прораб предлагает допработу, офис оценивает её в смете, заказчик подписывает кодом из SMS.',
      ),
    ).toBeTruthy();
    expect(headChip()).toBe('Версия 2 · действует');
  });

  it('плитки версий: «заменена» и «действует», суммы, договор № 42', async () => {
    await open();
    expect(tile(1).textContent).toContain('заменена');
    expect(tile(1).textContent).toContain(price(404418));
    expect(tile(2).textContent).toContain('действует');
    expect(tile(2).textContent).toContain(price(438175));
    expect(tile(2).textContent).toContain('договор № 42');
    expect(tile(2).getAttribute('aria-pressed')).toBe('true');
    expect(tile(1).getAttribute('aria-pressed')).toBe('false');
  });

  it('подпись плитки как у эталона: пробел между чипом статуса и строкой даты (возврат 1)', async () => {
    await open();
    expect(tile(1).textContent).toMatch(/заменена 25\.09 · /);
    expect(tile(2).textContent).toMatch(/действует 29\.09 · /);
  });

  it('таблица версии 2: разделы, строки с формулами замера, итого', async () => {
    await open();
    for (const s of ['Демонтаж', 'Электрика', 'Стены', 'Полы', 'Материалы']) {
      expect(within(section()).getByText(s, { selector: 'strong' })).toBeTruthy();
    }
    expect(grandLabel()).toBe('Итого по версии 2');
    expect(grandTotal()).toBe(price(438175));
    const lam = rowOf('Укладка ламината');
    expect(lam.textContent).toContain('из замера · пол без санузлов');
    expect(lam.textContent).toContain('м²');
    expect(within(section()).queryAllByRole('textbox')).toHaveLength(0);
    expect(maybeBtn('Строка из справочника')).toBeNull();
  });

  it('выбор версии 1 — таблица и итого версии 1', async () => {
    await open();
    fireEvent.click(tile(1));
    await waitFor(() => expect(grandLabel()).toBe('Итого по версии 1'));
    expect(grandTotal()).toBe(price(404418));
    expect(tile(1).getAttribute('aria-pressed')).toBe('true');
  });

  it('пояснение под плитками версии 2 — основа договора', async () => {
    await open();
    expect(
      within(section()).getByText(
        /^Согласована заказчиком в кабинете и стала основой договора № 42 · \d\d\.\d\d$/,
      ),
    ).toBeTruthy();
  });
});

describe('«Смета» кв. 42: сравнение версий', () => {
  it('«Сравнить с версией 1»: колонки, чипы, итоги и разница', async () => {
    await open();
    fireEvent.click(btn('Сравнить с версией 1'));
    const table = await within(section()).findByRole('table', { name: /Сравнение/ }, SLOW);
    const heads = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(heads).toEqual(['Строка', 'Версия 1', 'Версия 2', 'Разница']);
    expect(within(table).getByText('Сборка щитка')).toBeTruthy();
    expect(within(table).getAllByText('добавлено').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('изменено: объём').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('убрано').length).toBeGreaterThan(0);
    const total = within(table).getByText('Итого').closest('tr');
    expect(total?.textContent).toContain(price(404418));
    expect(total?.textContent).toContain(price(438175));
    expect(total?.textContent).toContain(nb('+33 757 ₽'));
    expect(btn('Показать смету')).toBeTruthy();
  });

  it('строки без изменений — по кнопке; «Показать смету» возвращает таблицу', async () => {
    await open();
    fireEvent.click(btn('Сравнить с версией 1'));
    const table = await within(section()).findByRole('table', { name: /Сравнение/ }, SLOW);
    expect(within(table).queryByText('без изменений')).toBeNull();
    fireEvent.click(btn(/^Показать строки без изменений · \d+$/));
    expect(within(table).getAllByText('без изменений').length).toBeGreaterThan(0);
    expect(btn('Скрыть строки без изменений')).toBeTruthy();
    fireEvent.click(btn('Показать смету'));
    await waitFor(() => expect(grandLabel()).toBe('Итого по версии 2'));
  });

  it('у версии 1 сравнивать не с чем — кнопки нет', async () => {
    await open();
    fireEvent.click(tile(1));
    await waitFor(() => expect(grandLabel()).toBe('Итого по версии 1'));
    expect(maybeBtn(/Сравнить с версией/)).toBeNull();
  });
});

describe('«Смета» кв. 42: допработа ДР-1', () => {
  it('блок «Допработы от прораба»: ДР-1, подпись, чип, фото, кнопки', async () => {
    await open();
    expect(within(section()).getByText('Допработы от прораба')).toBeTruthy();
    expect(
      within(section()).getByText(
        'Прораб описывает работу и прикладывает фото, цены считает офис. Подписанное допсоглашение становится новой версией сметы.',
      ),
    ).toBeTruthy();
    expect(within(section()).getByText('ДР-1')).toBeTruthy();
    expect(within(section()).getByText('Перенос розеток на кухне')).toBeTruthy();
    expect(within(section()).getByText('18.10 · 6 шт · фото: 2')).toBeTruthy();
    expect(within(section()).getByText('Ждёт оценки офиса')).toBeTruthy();
    expect(within(section()).getAllByRole('img')).toHaveLength(2);
    expect(btn('Оценить в черновике')).toBeTruthy();
    expect(btn('Отклонить')).toBeTruthy();
  });

  it('«Оценить в черновике»: черновик допсоглашения +13 050 ₽, строки подставлены, уведомление', async () => {
    const a = await open();
    await clickAndWait('Оценить в черновике', () => note());
    expect(sent(a, 'POST', '/estimates')).toHaveLength(1);
    expect(note()).toBe(
      'ДР-1 «Перенос розеток на кухне» в черновике версии 3: строки подставлены по описанию прораба. Проверьте объёмы и цены, затем отправьте допсоглашение заказчику.',
    );
    expect(headChip()).toBe('Версия 3 · черновик');
    expect(tile(3).textContent).toContain('допсоглашение № 1');
    expect(tile(3).textContent).toContain(price(451225));
    expect(grandLabel()).toBe('Итого по версии 3');
    expect(grandTotal()).toBe(price(451225));
    expect(
      within(section()).getByText(
        'Черновик допсоглашения: строки версии 2 и допработы ДР-1. Заказчик увидит изменения после отправки.',
      ),
    ).toBeTruthy();
    expect(within(section()).getByText('В черновике версии 3')).toBeTruthy();
    expect(section().textContent).toContain(nb('Версия 2: 438 175 ₽ · разница +13 050 ₽'));
    expect(rowOf('Перенос розетки или выключателя').textContent).toContain('новая');
    expect(btn('Отправить допсоглашение № 1 на подпись')).toBeTruthy();
    expect(maybeBtn('Оценить в черновике')).toBeNull();
    // Черновик уже открыт — «Открыть черновик» нет; с другой версии он появляется и возвращает к черновику.
    expect(maybeBtn('Открыть черновик')).toBeNull();
    fireEvent.click(tile(2));
    await waitFor(() => expect(grandLabel()).toBe('Итого по версии 2'));
    fireEvent.click(btn('Открыть черновик'));
    await waitFor(() => expect(grandLabel()).toBe('Итого по версии 3'));
  });

  it('отправка допсоглашения: уведомление, чип «у заказчика», «Отозвать и править»', async () => {
    const a = await open();
    await clickAndWait('Оценить в черновике', () => note());
    await clickAndWait('Отправить допсоглашение № 1 на подпись', () =>
      note()?.startsWith('Допсоглашение № 1 отправлено'),
    );
    expect(sent(a, 'POST', '/send')).toHaveLength(1);
    expect(note()).toBe(
      nb(
        'Допсоглашение № 1 отправлено в кабинет заказчика: +13 050 ₽ к договору. Подпись — кодом из SMS.',
      ),
    );
    expect(headChip()).toBe('Допсоглашение № 1 у заказчика');
    expect(tile(3).textContent).toContain('на подписи');
    expect(within(section()).getByText('В допсоглашении · у заказчика')).toBeTruthy();
    expect(btn('Отозвать и править')).toBeTruthy();
    expect(maybeBtn('Удалить черновик')).toBeNull();
    expect(maybeBtn(/Отправить допсоглашение/)).toBeNull();
    expect(within(section()).getByText(/Объёмы зафиксированы на момент отправки\.$/)).toBeTruthy();
    expect(within(section()).queryAllByRole('textbox')).toHaveLength(0);
  });

  it('отзыв и удаление: допработа снова ждёт оценки', async () => {
    await open();
    await clickAndWait('Оценить в черновике', () => note());
    await clickAndWait('Отправить допсоглашение № 1 на подпись', () =>
      headChip()?.includes('у заказчика'),
    );
    await clickAndWait('Отозвать и править', () => headChip() === 'Версия 3 · черновик');
    expect(note()).toBe(
      'Отправка отозвана: заказчик больше не видит эту версию. Черновик снова можно править.',
    );
    await clickAndWait('Удалить черновик', () => headChip() === 'Версия 2 · действует');
    expect(note()).toBe('Черновик удалён. ДР-1 снова ждёт оценки.');
    expect(within(section()).getByText('Ждёт оценки офиса')).toBeTruthy();
    expect(maybeBtn('Отозвать и править')).toBeNull();
  });

  it('пока допсоглашение у заказчика, оценить допработу нельзя — подсказка', async () => {
    await open();
    await clickAndWait('Изменить через допсоглашение', () => headChip() === 'Версия 3 · черновик');
    expect(maybeBtn('Оценить в черновике')).toBeNull();
    expect(
      within(section()).getByText(
        'Допработу можно оценить в новом черновике: отправьте или удалите текущий.',
      ),
    ).toBeTruthy();
    await clickAndWait('Отправить допсоглашение № 1 на подпись', () =>
      headChip()?.includes('у заказчика'),
    );
    expect(
      within(section()).getByText(
        'Оценить можно после подписи или отзыва отправленного допсоглашения.',
      ),
    ).toBeTruthy();
  });

  it('«Отклонить»: четыре причины, «Отмена», отклонение с причиной', async () => {
    const a = await open();
    fireEvent.click(btn('Отклонить'));
    const why = within(section()).getByRole('combobox', { name: 'Причина — прораб её увидит' });
    expect(
      within(why)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'Работа уже есть в смете',
      'Заказчик отказался',
      'Сделаем по гарантии',
      'Не согласовано с заказчиком',
    ]);
    fireEvent.click(btn('Отмена'));
    expect(within(section()).queryByRole('combobox')).toBeNull();
    fireEvent.click(btn('Отклонить'));
    fireEvent.change(within(section()).getByRole('combobox'), {
      target: { value: 'client_refused' },
    });
    await clickAndWait('Отклонить допработу', () => note());
    expect(sent(a, 'POST', '/reject')).toHaveLength(1);
    expect(note()).toBe(
      'ДР-1 отклонена: «Заказчик отказался». Прораб увидит причину во вкладке «Работы».',
    );
    expect(within(section()).getByText('Новых допработ нет.')).toBeTruthy();
    expect(
      within(section()).getByText(
        'ДР-1 «Перенос розеток на кухне»: отклонена — заказчик отказался',
      ),
    ).toBeTruthy();
  });

  it('«Скрыть сообщение» убирает уведомление', async () => {
    await open();
    await clickAndWait('Оценить в черновике', () => note());
    fireEvent.click(btn('Скрыть сообщение'));
    expect(note()).toBeUndefined();
  });
});

describe('«Смета» кв. 42: правка черновика', () => {
  const startDraft = async (): Promise<MockApp> => {
    const a = await open();
    await clickAndWait('Изменить через допсоглашение', () => headChip() === 'Версия 3 · черновик');
    return a;
  };
  const qty = (name: string): HTMLInputElement =>
    within(section()).getByRole('textbox', { name: `Объём: ${name}` });
  const prc = (name: string): HTMLInputElement =>
    within(section()).getByRole('textbox', { name: `Цена: ${name}` });

  it('черновик из действующей версии: поля, разделы, «Добавить раздел», скидка', async () => {
    await startDraft();
    expect(qty('Укладка ламината')).toBeTruthy();
    expect(
      within(section()).getByRole('textbox', { name: 'Название нового раздела' }),
    ).toBeTruthy();
    expect(within(section()).getByRole('textbox', { name: 'Скидка, процентов' })).toBeTruthy();
    expect(within(section()).getByText('скидку даёт любой, кто правит смету')).toBeTruthy();
    expect(btn('Отправить допсоглашение № 1 на подпись')).toBeTruthy();
    expect(btn('Удалить черновик')).toBeTruthy();
    expect(btn('Скачать PDF').hasAttribute('disabled')).toBe(true);
    expect(btn('Скачать PDF').getAttribute('title')).toBe('В макете не формируется');
  });

  it('объём вручную: значок и «вернуть из замера», сумма и итого пересчитываются', async () => {
    const a = await startDraft();
    const before = grandTotal();
    const field = qty('Укладка ламината');
    fireEvent.change(field, { target: { value: '50' } });
    fireEvent.blur(field);
    await waitFor(() => expect(sent(a, 'PATCH', '/3')).toHaveLength(1), SLOW);
    await waitFor(
      () => expect(rowOf('Укладка ламината').textContent).toContain('объём вручную'),
      SLOW,
    );
    expect(grandTotal()).not.toBe(before);
    fireEvent.click(
      within(rowOf('Укладка ламината')).getByRole('button', { name: 'вернуть из замера' }),
    );
    await waitFor(
      () => expect(rowOf('Укладка ламината').textContent).toContain('из замера · пол без санузлов'),
      SLOW,
    );
    expect(grandTotal()).toBe(before);
  });

  it('цена строки; удаление строки', async () => {
    const a = await startDraft();
    const field = prc('Вывоз мусора');
    fireEvent.change(field, { target: { value: '7000' } });
    fireEvent.blur(field);
    await waitFor(() => expect(sent(a, 'PATCH', '/3')).toHaveLength(1), SLOW);
    await waitFor(() => expect(rowOf('Вывоз мусора').textContent).toContain(price(14000)), SLOW);
    fireEvent.click(btn('Удалить строку: Вывоз мусора'));
    await waitFor(
      () => expect(within(section()).queryByRole('cell', { name: /^Вывоз мусора/ })).toBeNull(),
      SLOW,
    );
  });

  it('новый раздел → пустой раздел и выбор строки из справочника', async () => {
    const a = await startDraft();
    const name = within(section()).getByRole('textbox', { name: 'Название нового раздела' });
    fireEvent.change(name, { target: { value: 'Двери' } });
    fireEvent.click(btn('Добавить раздел'));
    await waitFor(
      () => expect(within(section()).getByText('Двери', { selector: 'strong' })).toBeTruthy(),
      SLOW,
    );
    expect(
      within(section()).getByText('В разделе пока нет строк — добавьте их из справочника.'),
    ).toBeTruthy();
    expect(sent(a, 'PATCH', '/3')).toHaveLength(1);
    const adds = within(section()).getAllByRole('button', { name: 'Строка из справочника' });
    fireEvent.click(adds[adds.length - 1] as HTMLElement);
    const search = await within(section()).findByRole('searchbox', {
      name: 'Поиск по справочнику расценок',
    });
    fireEvent.change(search, { target: { value: 'zzzz' } });
    expect(
      await within(section()).findByText(
        'Ничего не найдено. Новые позиции добавляют в «Шаблоны и расценки».',
      ),
    ).toBeTruthy();
    fireEvent.change(search, { target: { value: 'Грунтовка' } });
    fireEvent.click(
      await within(section()).findByRole('button', { name: /Грунтовка глубокого проникновения/ }),
    );
    await waitFor(() => expect(sent(a, 'PATCH', '/3')).toHaveLength(2), SLOW);
    expect(
      await within(section()).findByRole(
        'cell',
        { name: /^Грунтовка глубокого проникновения/ },
        SLOW,
      ),
    ).toBeTruthy();
  });

  it('скидка: строка со скидкой и «−» суммой, итого уменьшается', async () => {
    const a = await startDraft();
    const before = grandTotal();
    const field = within(section()).getByRole('textbox', { name: 'Скидка, процентов' });
    fireEvent.change(field, { target: { value: '10' } });
    fireEvent.blur(field);
    await waitFor(() => expect(sent(a, 'PATCH', '/3')).toHaveLength(1), SLOW);
    await waitFor(() => expect(grandTotal()).not.toBe(before), SLOW);
    expect(within(section()).getByText(/^−\d/)).toBeTruthy();
  });

  it('«Сохранить объект как шаблон» у действующей версии; ссылка «Открыть шаблон»', async () => {
    const a = await open();
    await clickAndWait('Сохранить объект как шаблон', () => note());
    expect(sent(a, 'POST', '/save-as-template')).toHaveLength(1);
    expect(note()).toMatch(
      /^Шаблон «По объекту «ЖК Речной · квартира 42»» сохранён: \d+ строк сметы с формулами объёмов, технология графика, документы, чек-лист и материалы\.$/,
    );
    expect(btn('Открыть шаблон')).toBeTruthy();
  });

  it('кнопка «График по этапам сметы» есть у объекта после договора', async () => {
    await open();
    expect(btn('График по этапам сметы')).toBeTruthy();
  });
});

describe('«Смета»: дом в Истре — сметы ещё нет (до договора)', () => {
  it('чип «Сметы нет», замер, шаблоны, шаблон по виду ремонта выбран', async () => {
    await open({ obj: OBJ50 });
    expect(headChip()).toBe('Сметы нет');
    await within(section()).findByRole('radiogroup', { name: 'Шаблон для черновика сметы' }, SLOW);
    expect(within(section()).getByText(/^Замер \d\d\.\d\d: 8 помещений · пол /)).toBeTruthy();
    const radios = within(section()).getAllByRole('radio');
    expect(radios).toHaveLength(4);
    const checked = radios.filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent).toContain('Ремонт под ключ · дом');
    expect(checked[0]?.textContent).toContain('Подходит к виду «ремонт под ключ»');
    expect(checked[0]?.textContent).toContain('Свой · из объекта');
  });

  it('«Что получит объект по шаблону …» и сумма: дом 1 078 533 ₽; другой шаблон — капитальный 857 713 ₽', async () => {
    await open({ obj: OBJ50 });
    await within(section()).findByRole('radiogroup', { name: 'Шаблон для черновика сметы' }, SLOW);
    expect(
      within(section()).getByRole('heading', {
        level: 3,
        name: 'Что получит объект по шаблону «Ремонт под ключ · дом»',
      }),
    ).toBeTruthy();
    expect(within(section()).getByText('Разделы и работы сметы')).toBeTruthy();
    expect(within(section()).getByText('Комплект документов')).toBeTruthy();
    expect(section().querySelector('.ox-rp-create strong')?.textContent).toBe(price(1078533));
    fireEvent.click(within(section()).getByRole('radio', { name: /Капитальный ремонт квартиры/ }));
    expect(section().querySelector('.ox-rp-create strong')?.textContent).toBe(price(857713));
    fireEvent.click(within(section()).getByRole('radio', { name: /Косметический ремонт/ }));
    expect(section().querySelector('.ox-rp-create strong')?.textContent).toBe(price(308600));
    fireEvent.click(within(section()).getByRole('radio', { name: /Коммерческое помещение/ }));
    expect(section().querySelector('.ox-rp-create strong')?.textContent).toBe(price(830345));
  });

  it('«Собрать черновик сметы»: версия 1 из шаблона, пояснение до договора, итого = сумма шаблона', async () => {
    const a = await open({ obj: OBJ50 });
    await within(section()).findByRole('radiogroup', { name: 'Шаблон для черновика сметы' }, SLOW);
    await clickAndWait('Собрать черновик сметы', () => note());
    expect(sent(a, 'POST', '/estimate-drafts')).toHaveLength(1);
    expect(note()).toMatch(
      /^Черновик собран по шаблону «Ремонт под ключ · дом»: \d+ строк, \d+ объёмов из замера\. Технология графика, документы, чек-лист приёмки и материалы подключены к объекту\.$/,
    );
    expect(headChip()).toBe('Версия 1 · черновик');
    expect(
      within(section()).getByText(
        'До договора смета согласуется версиями: заказчик видит отправленную версию в кабинете и согласует её. Согласованная версия не меняется, правка — новая версия.',
      ),
    ).toBeTruthy();
    expect(
      within(section()).getByText(
        'Собрана по шаблону «Ремонт под ключ · дом». Объёмы с пометкой «из замера» пересчитываются при изменении замера.',
      ),
    ).toBeTruthy();
    expect(grandTotal()).toBe(price(1078533));
    expect(tile(1).textContent).toContain('из шаблона');
    expect(within(section()).queryByText('Допработы от прораба')).toBeNull();
    expect(maybeBtn('График по этапам сметы')).toBeNull();
  });

  it('отправка в кабинет и отзыв (до договора)', async () => {
    await open({ obj: OBJ50 });
    await within(section()).findByRole('radiogroup', { name: 'Шаблон для черновика сметы' }, SLOW);
    await clickAndWait('Собрать черновик сметы', () => headChip() === 'Версия 1 · черновик');
    expect(
      within(section()).getByText(
        'Заказчик согласует смету в кабинете. Согласованная версия станет основой договора и больше не меняется.',
      ),
    ).toBeTruthy();
    await clickAndWait(
      'Отправить заказчику в кабинет',
      () => headChip() === 'Версия 1 у заказчика',
    );
    expect(note()).toBe('Версия 1 отправлена в кабинет заказчика на согласование.');
    expect(tile(1).textContent).toContain('у заказчика');
    await clickAndWait('Отозвать и править', () => headChip() === 'Версия 1 · черновик');
    await clickAndWait('Удалить черновик', () => headChip() === 'Сметы нет');
    expect(note()).toBe('Черновик удалён.');
  });
});

describe('«Смета»: ошибки и состояния', () => {
  it('ошибка загрузки: текст по коду и «Повторить»', async () => {
    app = await openTab({ tab: 'estimate', scenario: 'listEstimates=rate_limited' });
    const err = await screen.findByText(/Не удалось загрузить смету/, undefined, SLOW);
    expect(err.textContent).toBe(
      'Не удалось загрузить смету: Слишком много запросов. Подождите и повторите.',
    );
    app.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Смета' }, SLOW)).toBeTruthy();
    expect(
      await within(section()).findByRole('group', { name: 'Версии сметы' }, SLOW),
    ).toBeTruthy();
  });

  it('нет связи при отправке: тост, версия остаётся черновиком', async () => {
    await open({ scenario: 'sendEstimate=offline' });
    await clickAndWait('Изменить через допсоглашение', () => headChip() === 'Версия 3 · черновик');
    fireEvent.click(btn('Отправить допсоглашение № 1 на подпись'));
    await waitFor(() => expect(toast()).toBe('Нет связи с сервером. Операция не выполнена.'), SLOW);
    expect(headChip()).toBe('Версия 3 · черновик');
  });

  it('версия уже зафиксирована (409 estimate_version_locked): тост и перечитывание', async () => {
    await open({ scenario: 'updateEstimateDraft=estimate_version_locked' });
    await clickAndWait('Изменить через допсоглашение', () => headChip() === 'Версия 3 · черновик');
    const field = within(section()).getByRole('textbox', { name: 'Скидка, процентов' });
    fireEvent.change(field, { target: { value: '5' } });
    fireEvent.blur(field);
    await waitFor(() => expect(toast()).toBeTruthy(), SLOW);
  });

  it('сданный объект: смета только для просмотра, правки нет; сохранить как шаблон можно', async () => {
    await open({ obj: OBJ27 });
    expect(
      await within(section()).findByRole('group', { name: 'Версии сметы' }, SLOW),
    ).toBeTruthy();
    expect(maybeBtn('Изменить через допсоглашение')).toBeNull();
    expect(maybeBtn('Отправить заказчику в кабинет')).toBeNull();
    expect(btn('Сохранить объект как шаблон')).toBeTruthy();
  });

  it('объект кв. 42 открыт по ссылке без ?tab — по умолчанию «Замер», вкладка «Смета» есть', async () => {
    app = await openTab({ obj: OBJ42, tab: 'measure' });
    expect(await screen.findByRole('tab', { name: /^Смета/ }, SLOW)).toBeTruthy();
  });
});

describe('«Смета» кв. 42: клик сразу после ввода, без ухода фокуса (ревью W6.21 возврат 2)', () => {
  it('объём, затем сразу «Отправить допсоглашение»: правка сохранена, смета отправлена одним щелчком', async () => {
    const a = await open();
    await clickAndWait('Изменить через допсоглашение', () => headChip() === 'Версия 3 · черновик');
    const field = within(section()).getByRole('textbox', { name: 'Объём: Укладка ламината' });
    fireEvent.change(field, { target: { value: '50' } });
    const send = btn('Отправить допсоглашение № 1 на подпись');
    fireEvent.mouseDown(send);
    fireEvent.blur(field);
    fireEvent.mouseUp(send);
    fireEvent.click(send);
    await waitFor(() => expect(headChip()).toBe('Допсоглашение № 1 у заказчика'), SLOW);
    expect(sent(a, 'PATCH', '/3')).toHaveLength(1);
    expect(sent(a, 'POST', '/send')).toHaveLength(1);
    expect(sent(a, 'POST', '/send')[0]?.status).toBe(200);
  });
});
