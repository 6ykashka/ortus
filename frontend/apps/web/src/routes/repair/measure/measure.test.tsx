// W6.21 · Экранные тесты вкладки «Замер» на сценарном сервере MSW W6.00 (пресет repairs-ready): таблица помещений
// кв. 42, итоги (контрольные числа DoR repair.md §2.6: пол 46,82 и стены 134,24 м²), правка и сохранение новой
// версией, «Добавить помещение», запятая, права, сданный объект, ошибка и «Повторить», конфликт версии.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { MockApp } from '../../../app/testing.tsx';
import { OBJ27, OBJ42, openTab, SLOW, sectionOf, sent, toast } from './fixtures.test-util.ts';

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (o: Parameters<typeof openTab>[0] = {}): Promise<MockApp> => {
  app = await openTab({ tab: 'measure', ...o });
  await screen.findByRole('heading', { level: 2, name: 'Замер' }, SLOW);
  return app;
};

const section = (): HTMLElement => sectionOf('h-meas');
const rowOf = (name: string): HTMLElement => {
  const cell = within(section()).getByRole('cell', { name });
  const row = cell.closest('tr');
  if (!row) throw new Error(`нет строки «${name}»`);
  return row;
};
const input = (label: string): HTMLInputElement =>
  within(section()).getByRole('textbox', { name: label });
const totalRow = (): HTMLElement => {
  const row = within(section()).getByRole('cell', { name: 'Итого' }).closest('tr');
  if (!row) throw new Error('нет итога');
  return row;
};
const cells = (row: HTMLElement): string[] =>
  [...row.querySelectorAll('td')].map((c) => c.textContent ?? '');

describe('«Замер»: таблица помещений кв. 42', () => {
  it('заголовок, пояснение, колонки и подписи эталона', async () => {
    await open();
    expect(
      within(section()).getByText(
        'Замерщик или прораб заполняет на объекте с телефона. Площади пола и стен за вычетом проёмов пересчитывают объёмы в черновике сметы; согласованная версия не меняется.',
      ),
    ).toBeTruthy();
    const heads = within(section())
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(heads).toEqual([
      'Помещение',
      'Длина, м',
      'Ширина, м',
      'Высота, м',
      'Проёмы, м²',
      'Пол, м²',
      'Стены, м²',
    ]);
    expect(
      within(section()).getByText('Фото и план помещения прикладываются к замеру через «Файлы».'),
    ).toBeTruthy();
  });

  it('четыре помещения; пол и стены по помещению; итого 46,8 и 134,2', async () => {
    await open();
    const names = within(section())
      .getAllByRole('row')
      .slice(1, -1)
      .map((r) => r.querySelector('td')?.textContent);
    expect(names).toEqual(['Гостиная', 'Спальня', 'Кухня', 'Санузел']);
    expect(input('Длина: Гостиная').value).toBe('5,2');
    expect(input('Проёмы: Гостиная').value).toBe('3,6');
    const living = cells(rowOf('Гостиная'));
    expect(living.slice(-2)).toEqual(['19,8', '45']);
    expect(cells(totalRow()).slice(-2)).toEqual(['46,8', '134,2']);
  });
});

describe('«Замер»: правка', () => {
  it('размер → пол, стены и итоги пересчитываются сразу; по уходу из поля — новая версия замера', async () => {
    const a = await open();
    const len = input('Длина: Кухня');
    fireEvent.change(len, { target: { value: '4' } });
    expect(cells(rowOf('Кухня')).slice(-2)).toEqual(['12', '35,8']);
    expect(cells(totalRow()).slice(-2)).toEqual(['48,6', '137,5']);
    expect(sent(a, 'PUT', '/measurement')).toHaveLength(0);
    fireEvent.blur(len);
    await waitFor(() => expect(sent(a, 'PUT', '/measurement')).toHaveLength(1), SLOW);
    expect(sent(a, 'PUT', '/measurement')[0]?.status).toBe(200);
    await waitFor(() => expect(input('Длина: Кухня').value).toBe('4'), SLOW);
    expect(cells(totalRow()).slice(-2)).toEqual(['48,6', '137,5']);
  });

  it('запятая как десятичный разделитель; сохраняется точкой', async () => {
    const a = await open();
    const w = input('Ширина: Спальня');
    fireEvent.change(w, { target: { value: '3,6' } });
    expect(w.value).toBe('3,6');
    expect(cells(rowOf('Спальня'))[5]).toBe('14,8');
    fireEvent.blur(w);
    await waitFor(() => expect(sent(a, 'PUT', '/measurement')).toHaveLength(1), SLOW);
    await waitFor(() => expect(input('Ширина: Спальня').value).toBe('3,6'), SLOW);
  });

  it('правка второго поля во время сохранения первого не теряется: две версии замера подряд', async () => {
    const a = await open();
    const w = input('Ширина: Спальня');
    fireEvent.change(w, { target: { value: '3,6' } });
    fireEvent.blur(w);
    const h = input('Высота: Санузел');
    fireEvent.change(h, { target: { value: '3' } });
    fireEvent.blur(h);
    await waitFor(() => expect(sent(a, 'PUT', '/measurement')).toHaveLength(2), SLOW);
    await waitFor(() => expect(input('Высота: Санузел').value).toBe('3'), SLOW);
    expect(input('Ширина: Спальня').value).toBe('3,6');
    expect(sent(a, 'PUT', '/measurement').map((r) => r.status)).toEqual([200, 200]);
  });
  it('нечисло в поле считается нулём и не ломает замер', async () => {
    await open();
    fireEvent.change(input('Высота: Санузел'), { target: { value: 'abc' } });
    expect(cells(rowOf('Санузел')).slice(-2)).toEqual(['3,7', '0']);
  });

  it('поле не менялось — запроса нет', async () => {
    const a = await open();
    const len = input('Длина: Кухня');
    fireEvent.focus(len);
    fireEvent.blur(len);
    await new Promise((r) => setTimeout(r, 200));
    expect(sent(a, 'PUT', '/measurement')).toHaveLength(0);
  });

  it('«Добавить помещение» добавляет «Коридор» 3,0 × 1,4 × 2,7 и сохраняет сразу', async () => {
    const a = await open();
    fireEvent.click(within(section()).getByRole('button', { name: 'Добавить помещение' }));
    await waitFor(() => expect(sent(a, 'PUT', '/measurement')).toHaveLength(1), SLOW);
    expect(await within(section()).findByRole('cell', { name: 'Коридор' }, SLOW)).toBeTruthy();
    expect(input('Длина: Коридор').value).toBe('3');
    expect(input('Ширина: Коридор').value).toBe('1,4');
    expect(input('Высота: Коридор').value).toBe('2,7');
    expect(input('Проёмы: Коридор').value).toBe('3,2');
    expect(cells(rowOf('Коридор')).slice(-2)).toEqual(['4,2', '20,6']);
  });
});

describe('«Замер»: переход к смете и права', () => {
  it('«Открыть смету» ведёт на вкладку «Смета»', async () => {
    const a = await open();
    fireEvent.click(within(section()).getByRole('button', { name: 'Открыть смету' }));
    await screen.findByRole('heading', { level: 2, name: 'Смета' }, SLOW);
    expect(a.router.state.location.searchStr).toContain('tab=estimate');
  });

  it('прораб: правит замер, кнопки «Открыть смету» нет (нет права на финансы)', async () => {
    await open({ persona: 'foreman' });
    expect(input('Длина: Кухня').disabled).toBe(false);
    expect(within(section()).queryByRole('button', { name: 'Открыть смету' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Смета' })).toBeNull();
  });

  it('сданный объект: поля — текст, добавить нельзя, подсказка', async () => {
    await open({ obj: OBJ27 });
    expect(
      await within(section()).findByText('Объект сдан: замер закрыт для правки.'),
    ).toBeTruthy();
    expect(within(section()).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(section()).queryByRole('button', { name: 'Добавить помещение' })).toBeNull();
  });
});

describe('«Замер»: состояния', () => {
  it('ошибка загрузки: текст по коду и «Повторить»', async () => {
    app = await openTab({ tab: 'measure', scenario: 'getMeasurement=rate_limited' });
    const err = await screen.findByText(/Не удалось загрузить замер/, undefined, SLOW);
    expect(err.textContent).toBe(
      'Не удалось загрузить замер: Слишком много запросов. Подождите и повторите.',
    );
    app.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Замер' }, SLOW)).toBeTruthy();
  });

  it('нет связи при сохранении: тост, данные сервера возвращаются', async () => {
    const a = await open({ scenario: 'putMeasurement=offline' });
    const len = input('Длина: Кухня');
    fireEvent.change(len, { target: { value: '9' } });
    fireEvent.blur(len);
    await waitFor(() => expect(toast()).toBe('Нет связи с сервером. Операция не выполнена.'), SLOW);
    await waitFor(() => expect(input('Длина: Кухня').value).toBe('3,4'), SLOW);
    expect(sent(a, 'PUT', '/measurement')).toHaveLength(0);
  });

  it('конфликт версии (412): тост и перечитывание', async () => {
    await open({ scenario: 'putMeasurement=revision_mismatch' });
    const len = input('Длина: Кухня');
    fireEvent.change(len, { target: { value: '9' } });
    fireEvent.blur(len);
    await waitFor(() => expect(toast()).toBeTruthy(), SLOW);
    await waitFor(() => expect(input('Длина: Кухня').value).toBe('3,4'), SLOW);
  });

  it('объект кв. 42 открыт по прямой ссылке без ?tab — по умолчанию «Замер»', async () => {
    app = await openTab({ obj: OBJ42 });
    expect(await screen.findByRole('heading', { level: 2, name: 'Замер' }, SLOW)).toBeTruthy();
  });
});

describe('«Замер»: клик сразу после ввода, без ухода фокуса (ревью W6.21 возврат 2)', () => {
  // Настоящий щелчок: mousedown уводит фокус (blur → сохранение), и только потом mouseup и click.
  const pressAfterEdit = (button: HTMLElement, field: HTMLInputElement): void => {
    fireEvent.mouseDown(button);
    fireEvent.blur(field);
    expect(section().getAttribute('aria-busy')).toBe('true');
    fireEvent.mouseUp(button);
    fireEvent.click(button);
  };

  it('ввод в поле, затем сразу «Добавить помещение»: помещение добавляется, обе версии сохраняются', async () => {
    const a = await open();
    const len = input('Длина: Кухня');
    fireEvent.change(len, { target: { value: '4' } });
    pressAfterEdit(within(section()).getByRole('button', { name: 'Добавить помещение' }), len);
    expect(await within(section()).findByRole('cell', { name: 'Коридор' }, SLOW)).toBeTruthy();
    await waitFor(() => expect(sent(a, 'PUT', '/measurement')).toHaveLength(2), SLOW);
    expect(input('Длина: Кухня').value).toBe('4');
  });
});
