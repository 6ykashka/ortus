// W4.62 · Экранные тесты «Оформления» на MSW-сценарном сервере (контракт 0.8.0-stage4, тег Branding): исходные
// «Альты» и «Лотоса», правка и «Сохранить для всех» (If-Match) → версия и тема оболочки (акцент :root, шапка,
// меню), загрузка файлов, загрузка и ошибка, нет связи, конфликт версии, ошибка сервера.
import { seedUuid } from '@ortus/domain/seed';
import { errors } from '@ortus/texts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const LOTOS = seedUuid('platform', 't-lotos');
const SLOW = { timeout: 8_000 };

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
  document.documentElement.removeAttribute('style');
});

const open = async (
  o: MockAppOptions & { tenant?: string } = {},
  ready = true,
): Promise<MockApp> => {
  app = await renderMockApp(`/t/${o.tenant ?? ALTA}/branding`, { persona: 'owner', ...o });
  await screen.findByRole('heading', { level: 1, name: 'Оформление' }, SLOW);
  if (ready) await screen.findByRole('radiogroup', { name: 'Палитра' }, SLOW);
  return app;
};

const main = (): HTMLElement => screen.getByRole('main');
const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const field = (label: RegExp | string): HTMLInputElement =>
  within(main()).getByLabelText(label) as HTMLInputElement;
const button = (name: string | RegExp): HTMLButtonElement =>
  within(main()).getByRole('button', { name }) as HTMLButtonElement;
const radio = (name: string): HTMLElement =>
  within(screen.getByRole('radiogroup', { name: 'Палитра' })).getByRole('radio', { name });
const type = (el: HTMLElement, value: string): void => {
  fireEvent.change(el, { target: { value } });
};
const accentVar = (): string =>
  document.documentElement.style.getPropertyValue('--ox-accent').trim();
const preview = (): HTMLElement => screen.getByRole('complementary', { name: 'Предпросмотр' });
const sidebar = (): HTMLElement => screen.getByRole('navigation', { name: 'Основная навигация' });
const navTitles = (): (string | null)[] =>
  within(sidebar())
    .getAllByRole('button')
    .map((b) => b.getAttribute('title'));
const sent = (a: MockApp, method: string, suffix: string) =>
  a.responses().filter((r) => r.method === method && r.path.endsWith(suffix));

/** PNG w×h: сигнатура и IHDR (MSW читает размеры по заголовку). */
function png(w: number, h: number, name = 'mark.png'): File {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, w);
  view.setUint32(20, h);
  return new File([bytes], name, { type: 'image/png' });
}

/** Скрытый `input[type=file]` внутри `label` «Загрузить» карточки (0 — логотип, 1 — знак). */
const fileInput = (i: 0 | 1): HTMLInputElement => {
  const inputs = main().querySelectorAll<HTMLInputElement>('input[type=file]');
  const el = inputs[i];
  if (!el) throw new Error('нет поля файла');
  return el;
};
const upload = (i: 0 | 1, file: File): void => {
  fireEvent.change(fileInput(i), { target: { files: [file] } });
};

describe('«Оформление»: исходное «Альты»', () => {
  it('крошка «Компания», заголовок, пояснение, «Версия 1 · стандартное оформление»', async () => {
    await open();
    const m = within(main());
    expect(main().querySelector('.ox-br-crumb')?.textContent).toBe('Компания');
    expect(m.getByText(/^Название, логотип, цвет, термины и меню действуют/)).toBeTruthy();
    expect(m.getByText('Версия 1 · стандартное оформление')).toBeTruthy();
    expect(main().querySelector('[data-screen-label="Владелец · оформление"]')).toBeTruthy();
  });

  it('название, пустое короткое имя «0 / 16», буква «А», «Ортус» выбран, контраст 6,4:1', async () => {
    await open();
    expect(field(/^Название организации/).value).toBe('Альта Групп');
    expect(field(/^Короткое имя/).value).toBe('');
    expect(within(main()).getByText('0 / 16')).toBeTruthy();
    expect(radio('Ортус').getAttribute('aria-checked')).toBe('true');
    expect(field('Свой цвет в формате HEX').value).toBe('#1F6B52');
    expect(
      within(main())
        .getByText('Контраст с белым текстом 6,4:1: подходит для кнопок и ссылок.')
        .closest('[role=status]'),
    ).toBeTruthy();
    expect(within(main()).getByText('Изменений нет')).toBeTruthy();
    expect(button('Сохранить для всех').disabled).toBe(true);
    expect(button('Отменить').disabled).toBe(true);
    expect(within(preview()).getAllByText('А').length).toBeGreaterThan(0);
  });

  it('меню и иконки: «всегда виден» у разделов управления, «Показан» у остальных', async () => {
    await open();
    expect(within(main()).getAllByText('всегда виден')).toHaveLength(5);
    expect(button('Сменить иконку: Главная').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button('Сменить иконку: Главная'));
    const icons = screen.getByRole('radiogroup', { name: 'Иконка пункта' });
    expect(
      within(icons)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(['home', 'dashboard', 'space_dashboard']);
  });
});

describe('«Оформление»: «Лотос»', () => {
  it('своя версия, короткое имя, «Сливовый», термин «Визит» — «сеанс»', async () => {
    await open({ persona: 'owner@t-lotos', tenant: LOTOS });
    expect(within(main()).getByText('Версия 3 · изменено 24.09 12:10, Ирина Белова')).toBeTruthy();
    expect(field(/^Короткое имя/).value).toBe('Лотос');
    expect(radio('Сливовый').getAttribute('aria-checked')).toBe('true');
    expect(within(main()).getByText('1 сеанс · 2 сеанса · 5 сеансов')).toBeTruthy();
    await waitFor(() => expect(accentVar()).toBe('#7A3E79'));
    expect(document.querySelector('.ox-brand-name')?.textContent).toBe('Лотос');
  });
});

describe('«Оформление»: черновик и сохранение', () => {
  it('«Сливовый» — черновик и предпросмотр; оболочка остаётся в сохранённом цвете', async () => {
    await open();
    fireEvent.click(radio('Сливовый'));
    expect(field('Свой цвет в формате HEX').value).toBe('#7A3E79');
    expect(within(main()).getByText('Есть несохранённые изменения')).toBeTruthy();
    expect(button('Сохранить для всех').disabled).toBe(false);
    expect(accentVar()).toBe('#1F6B52');
  });

  it('«Сохранить для всех»: тост, версия 2, шапка «Альта», акцент и меню без скрытого пункта', async () => {
    const a = await open();
    type(field(/^Короткое имя/), 'Альта');
    fireEvent.click(radio('Синий'));
    const spaRow = field('Название пункта «Салон и SPA»').closest('.ox-br-row');
    if (!(spaRow instanceof HTMLElement)) throw new Error('нет строки «Салон и SPA»');
    fireEvent.click(within(spaRow).getByRole('button', { name: 'Показан' }));
    fireEvent.click(button('Сохранить для всех'));
    await waitFor(
      () => expect(toast()).toBe('Оформление сохранено и видно всем сотрудникам'),
      SLOW,
    );
    expect(
      within(main()).getByText(/^Версия 2 · изменено (\d\d\.\d\d )?\d\d:\d\d, Дарья Зимина$/),
    ).toBeTruthy();
    expect(within(main()).getByText('Изменений нет')).toBeTruthy();
    await waitFor(() => expect(accentVar()).toBe('#2B5479'), SLOW);
    expect(document.querySelector('.ox-brand-name')?.textContent).toBe('Альта');
    await waitFor(() => expect(navTitles()).not.toContain('Салон и SPA'), SLOW);
    expect(navTitles()).toContain('Оформление');
    const put = sent(a, 'PUT', '/branding');
    expect(put.map((r) => r.status)).toEqual([200]);
  });

  it('«Стандартное оформление» оставляет название; «Отменить» возвращает сохранённое', async () => {
    await open({ persona: 'owner@t-lotos', tenant: LOTOS });
    fireEvent.click(button('Стандартное оформление'));
    expect(field('Свой цвет в формате HEX').value).toBe('#1F6B52');
    expect(field(/^Короткое имя/).value).toBe('');
    expect(field(/^Название организации/).value).toBe('SPA «Лотос»');
    fireEvent.click(button('Отменить'));
    expect(field('Свой цвет в формате HEX').value).toBe('#7A3E79');
    expect(within(main()).getByText('Изменений нет')).toBeTruthy();
  });

  it('ошибки черновика: список в панели, сохранить нельзя', async () => {
    await open();
    type(field(/^Название организации/), '');
    type(field('Свой цвет в формате HEX'), 'zzz');
    const alert = within(main())
      .getAllByRole('alert')
      .map((x) => x.textContent ?? '');
    expect(alert.join('|')).toContain('Введите цвет в формате #RRGGBB, например #2B5479');
    expect(alert.join('|')).toContain('· Укажите название организации');
    expect(alert.join('|')).toContain('· Цвет — в формате #RRGGBB');
    expect(button('Сохранить для всех').disabled).toBe(true);
  });
});

describe('«Оформление»: логотип и знак', () => {
  it('неверный тип и больше 1 МБ — тост до отправки', async () => {
    const a = await open();
    upload(0, new File(['x'], 'a.txt', { type: 'text/plain' }));
    await waitFor(() => expect(toast()).toBe('Нужен PNG, SVG, JPG или WebP'));
    upload(1, new File([new Uint8Array(1024 * 1024 + 1)], 'big.png', { type: 'image/png' }));
    await waitFor(() => expect(toast()).toBe('Файл больше 1 МБ'));
    expect(sent(a, 'POST', '/branding/assets')).toEqual([]);
  });

  it('знак 512×512 загружается: картинка «Знак» и «Убрать»; «Убрать» возвращает букву', async () => {
    const a = await open();
    upload(1, png(512, 512));
    await within(main()).findByRole('img', { name: 'Знак' }, SLOW);
    expect(sent(a, 'POST', '/branding/assets').map((r) => r.status)).toEqual([201]);
    fireEvent.click(button('Убрать'));
    expect(within(main()).queryByRole('img', { name: 'Знак' })).toBeNull();
  });

  it('знак 100×100 — ответ сервера тостом', async () => {
    await open();
    upload(1, png(100, 100));
    await waitFor(() => expect(toast()).toBe('Знак — квадрат не меньше 512×512'), SLOW);
  });
});

describe('«Оформление»: состояния', () => {
  it('загрузка: «Загрузка» под заголовком, затем форма', async () => {
    await open({ scenario: 'getTenantBranding=delay=400' }, false);
    expect(within(main()).getByRole('status', { name: 'Загрузка' })).toBeTruthy();
    await screen.findByRole('radiogroup', { name: 'Палитра' }, SLOW);
  });

  it('ошибка загрузки: alert и «Повторить» перечитывает', async () => {
    const a = await open({ scenario: 'getTenantBranding=rate_limited' }, false);
    const alert = await within(main()).findByText(
      /^Не удалось загрузить оформление/,
      undefined,
      SLOW,
    );
    expect(alert).toBeTruthy();
    a.scenario.setScenario(null);
    fireEvent.click(button('Повторить'));
    await screen.findByRole('radiogroup', { name: 'Палитра' }, SLOW);
  });

  it('нет связи: тост «Нет связи…», черновик остаётся', async () => {
    const a = await open();
    fireEvent.click(radio('Сливовый'));
    a.scenario.setScenario('updateTenantBranding=offline', true);
    fireEvent.click(button('Сохранить для всех'));
    await waitFor(() => expect(toast()).toBe(errors.client.offline), SLOW);
    expect(within(main()).getByText('Есть несохранённые изменения')).toBeTruthy();
    expect(within(main()).getByText('Версия 1 · стандартное оформление')).toBeTruthy();
  });

  it('конфликт версии: тост контракта, черновик остаётся', async () => {
    const a = await open();
    fireEvent.click(radio('Сливовый'));
    a.scenario.setScenario('updateTenantBranding=revision_mismatch', true);
    fireEvent.click(button('Сохранить для всех'));
    await waitFor(
      () => expect(toast()).toBe('Данные изменились. Обновите оформление и повторите.'),
      SLOW,
    );
    expect(within(main()).getByText('Есть несохранённые изменения')).toBeTruthy();
  });
});
