// W4.22 · Экранные тесты «Предпросмотра» (dc:107–142) и диалога «Опубликовать» (dc:457–466): устройства, проверки
// ввода, условия, страницы, «Спасибо», баллы теста; ошибки до публикации, публикация vN, Escape. Сеть — сценарный
// сервер W4.05 (сид «Альты»).
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const A = (id: string) => seedUuid('t-alta', id);
const SLOW = { timeout: 8_000 };
const INSP = A('fm-insp');
const FOREMAN = A('fm-foreman');

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (formId: string, o: Parameters<typeof renderMockApp>[1] = {}) => {
  app = await renderMockApp(`/t/${ALTA}/forms?form=${formId}`, { persona: 'owner', ...o });
  await screen.findByRole('tab', { name: 'Конструктор' }, SLOW);
  await waitFor(
    () => expect(document.querySelectorAll('.ox-fm-page').length).toBeGreaterThan(0),
    SLOW,
  );
  return app;
};
const toast = () => document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const pv = () => document.querySelector<HTMLElement>('.ox-fm-pv-card') as HTMLElement;
const next = () =>
  fireEvent.click(within(pv()).getByRole('button', { name: /^(Далее|Отправить)$/ }));
const qrow = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('.ox-fm-q-row')].find((b) =>
    b.querySelector('.ox-fm-q-label')?.textContent?.startsWith(label),
  ) as HTMLElement;
const card = () => document.querySelector<HTMLElement>('.ox-fm-qe') as HTMLElement;
const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';
const KB_LINK = /^Ответ появится на странице «.+» в Базе знаний$/;

type FormsOrg = {
  formsData: {
    forms: { proto: string; settings: { access: string } }[];
    rules: { proto: string; kind: string; kb?: { showLink: boolean } }[];
  };
};
/**
 * «Осмотр машины» с правилом «В базу знаний» и «Показать ссылку» (dc:906); `access` — доступ формы. Срез «Форм»
 * сценарного сервера создаётся при первом запросе — правка после загрузки списка, затем строка списка.
 */
const openKbLink = async (access?: 'public') => {
  app = await renderMockApp(`/t/${ALTA}/forms`, { persona: 'owner' });
  await waitFor(() => expect(document.querySelector('.ox-fm-row')).toBeTruthy(), SLOW);
  const org = (app.scenario.state() as unknown as { orgs: Record<string, FormsOrg> }).orgs[ALTA];
  const rule = org?.formsData.rules.find((r) => r.proto === 'au-2');
  if (rule?.kb) rule.kb.showLink = true;
  const f = org?.formsData.forms.find((x) => x.proto === 'fm-insp');
  if (f && access) f.settings.access = access;
  const row = [...document.querySelectorAll<HTMLElement>('.ox-fm-row')].find(
    (r) => r.querySelector('strong')?.textContent === 'Осмотр машины',
  );
  fireEvent.click(row?.querySelector('.ox-fm-row-open') as HTMLElement);
  await waitFor(() => expect(qrow('Уровень топлива')).toBeTruthy(), SLOW);
};
/** Пройти «Осмотр машины» в предпросмотре до «Спасибо» (без дефектов). */
const submitInspection = () => {
  fireEvent.click(within(pv()).getByRole('button', { name: 'Демо: прикрепить файл' }));
  next();
  fireEvent.change(within(pv()).getByRole('textbox', { name: 'Пробег по одометру, км' }), {
    target: { value: '84210' },
  });
  fireEvent.click(within(pv()).getByRole('radio', { name: /Полный/ }));
  next();
  fireEvent.click(within(pv()).getByRole('checkbox', { name: /кузов/ }));
  next();
  fireEvent.click(within(pv()).getByRole('radio', { name: /Нет/ }));
  fireEvent.click(within(pv()).getByRole('button', { name: 'Отправить' }));
  expect(pv().textContent).toContain('Спасибо! Ответ отправлен.');
};
/** «Ежедневный отчёт прораба» без ошибок: вариант у «Явки бригады», черновик сохранён. */
const foremanReady = async () => {
  const a = await open(FOREMAN);
  fireEvent.click(qrow('Явка бригады'));
  fireEvent.click(within(card()).getByRole('button', { name: 'Добавить вариант' }));
  await waitFor(() => expect(screen.getByText('Черновик сохранён')).toBeTruthy(), SLOW);
  return a;
};

describe('«Формы и опросы»: «Предпросмотр»', () => {
  it('панель: «Телефон / Компьютер», заметка, «Заново», «Закрыть предпросмотр»; вкладки не выбраны', async () => {
    await open(INSP);
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
    expect(screen.getByRole('button', { name: 'Предпросмотр' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByText('Предпросмотр черновика. Ответ не сохраняется.')).toBeTruthy();
    const devices = screen.getByRole('group', { name: 'Устройство' });
    expect(
      within(devices).getByRole('button', { name: 'Телефон' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(pv().getAttribute('data-device')).toBe('phone');
    fireEvent.click(within(devices).getByRole('button', { name: 'Компьютер' }));
    expect(pv().getAttribute('data-device')).toBe('desktop');
    expect(
      within(screen.getByRole('tablist', { name: 'Разделы формы' }))
        .getAllByRole('tab')
        .every((t) => t.getAttribute('aria-selected') === 'false'),
    ).toBe(true);
    expect(pv().textContent).toContain('Альта Групп');
    expect(within(pv()).getByRole('heading', { level: 2, name: 'Осмотр машины' })).toBeTruthy();
    expect(pv().textContent).toContain('Страница 1 из 4');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть предпросмотр' }));
    await waitFor(() => expect(document.querySelector('.ox-fm-pv-card')).toBeNull());
    expect(document.querySelectorAll('.ox-fm-page')).toHaveLength(4);
  });

  it('проверки и страницы: «Обязательный вопрос», файл, выбор, «Нужно число», условие «Есть дефекты?», «Спасибо»', async () => {
    await open(INSP);
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
    next();
    expect(within(pv()).getByRole('alert').textContent).toBe('Обязательный вопрос');
    expect(pv().textContent).toContain('Файлы не выбраны · до 5 шт., до 20 МБ');
    fireEvent.click(within(pv()).getByRole('button', { name: 'Демо: прикрепить файл' }));
    expect(pv().textContent).toContain('1 файл из 5');
    next();
    expect(within(pv()).getByRole('heading', { level: 3, name: 'Показания' })).toBeTruthy();
    fireEvent.change(within(pv()).getByRole('textbox', { name: 'Пробег по одометру, км' }), {
      target: { value: 'много' },
    });
    fireEvent.click(within(pv()).getByRole('radio', { name: /Полный/ }));
    next();
    expect(within(pv()).getByRole('alert').textContent).toBe('Нужно число');
    fireEvent.change(within(pv()).getByRole('textbox', { name: 'Пробег по одометру, км' }), {
      target: { value: '84 210' },
    });
    next();
    fireEvent.click(within(pv()).getByRole('checkbox', { name: /кузов/ }));
    next();
    expect(within(pv()).queryByRole('textbox', { name: 'Описание дефекта' })).toBeNull();
    fireEvent.click(within(pv()).getByRole('radio', { name: /Да/ }));
    expect(within(pv()).getByRole('textbox', { name: 'Описание дефекта' })).toBeTruthy();
    fireEvent.click(within(pv()).getByRole('button', { name: 'Назад' }));
    expect(within(pv()).getByRole('heading', { level: 3, name: 'Проверка' })).toBeTruthy();
    next();
    next();
    expect(
      within(pv())
        .getAllByRole('alert')
        .map((x) => x.textContent),
    ).toEqual(['Обязательный вопрос']);
    fireEvent.change(within(pv()).getByRole('textbox', { name: 'Описание дефекта' }), {
      target: { value: 'Скол на лобовом' },
    });
    fireEvent.click(within(pv()).getByRole('button', { name: 'Отправить' }));
    expect(pv().textContent).toContain('Спасибо! Ответ отправлен.');
    fireEvent.click(within(pv()).getByRole('button', { name: 'Пройти ещё раз' }));
    expect(pv().textContent).toContain('Страница 1 из 4');
  });

  it('тест с баллами: «Тест знаний с баллами» — результат и зачёт', async () => {
    app = await renderMockApp(`/t/${ALTA}/forms`, { persona: 'owner' });
    fireEvent.click(await screen.findByRole('button', { name: /Все шаблоны · 15/ }, SLOW));
    fireEvent.click(await screen.findByRole('button', { name: /Тест знаний с баллами/ }, SLOW));
    await screen.findByRole('tab', { name: 'Конструктор' }, SLOW);
    await waitFor(
      () => expect(document.querySelectorAll('.ox-fm-page').length).toBeGreaterThan(0),
      SLOW,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
    // Ответы с максимумом баллов на каждой странице.
    for (let guard = 0; guard < 6 && !pv().textContent?.includes('Результат:'); guard++) {
      const q = pv();
      for (const g of within(q).queryAllByRole('radiogroup')) {
        const opts = within(g).getAllByRole('radio');
        fireEvent.click(opts[0] as HTMLElement);
      }
      const box0 = within(q).queryAllByRole('checkbox')[1];
      if (box0) fireEvent.click(box0);
      for (const box of within(q).queryAllByRole('textbox')) {
        fireEvent.change(box, { target: { value: 'Иван Петров' } });
      }
      next();
    }
    // Первые варианты: 0 + 0 + «Одометр» 1 + 0 = 1 из 5, проходной 4 (settings шаблона).
    expect(pv().textContent).toContain('Результат: 1 из 5 баллов · нужно 4 для зачёта');
  });

  it('«Спасибо»: ссылка «Ответ появится на странице «…» в Базе знаний» у правила с «Показать ссылку»', async () => {
    await openKbLink();
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
    submitInspection();
    await waitFor(
      () => expect(pv().querySelector('.ox-fm-pv-kb')?.textContent).toMatch(/^menu_book/),
      SLOW,
    );
    expect(
      pv()
        .querySelector('.ox-fm-pv-kb')
        ?.textContent?.replace(/^menu_book/, ''),
    ).toMatch(KB_LINK);
  });

  it('«Спасибо» публичной формы — без ссылки на Базу знаний (гость её не откроет)', async () => {
    await openKbLink('public');
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
    submitInspection();
    // Правила успевают загрузиться (у формы организации ссылка появляется сразу) — ссылки всё равно нет.
    await new Promise((r) => setTimeout(r, 500));
    expect(pv().querySelector('.ox-fm-pv-kb')).toBeNull();
    expect(pv().textContent).not.toContain('в Базе знаний');
  });

  it('пустая форма: «В форме нет вопросов для показа.»', async () => {
    app = await renderMockApp(`/t/${ALTA}/forms`, { persona: 'owner' });
    fireEvent.click(await screen.findByRole('button', { name: 'Создать пустую форму' }, SLOW));
    await screen.findByRole('tab', { name: 'Конструктор' }, SLOW);
    await waitFor(() => expect(qrow('Вопрос 1')).toBeTruthy(), SLOW);
    fireEvent.click(qrow('Вопрос 1'));
    fireEvent.click(within(card()).getByRole('button', { name: 'Действия с вопросом' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
    expect(pv().textContent).toContain('В форме нет вопросов для показа.');
  });
});

describe('«Формы и опросы»: диалог «Опубликовать»', () => {
  it('с ошибками: «Сначала исправьте форму», список, «Перейти к конструктору»; Escape закрывает', async () => {
    await open(FOREMAN);
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    const dlg = screen.getByRole('dialog', { name: 'Сначала исправьте форму' });
    expect(dlg.textContent).toContain('Найдено ошибок: 1. Исправьте их в конструкторе.');
    expect(dlg.textContent).toContain('«Явка бригады»: нет вариантов ответа');
    fireEvent.keyDown(dlg, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Перейти к конструктору' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('первая версия: пункт о приёме ответов; «Опубликовать v1» — тост, чип, кнопка «Опубликовано»', async () => {
    await open(FOREMAN);
    fireEvent.click(qrow('Явка бригады'));
    fireEvent.click(within(card()).getByRole('button', { name: 'Добавить вариант' }));
    await waitFor(() => expect(screen.getByText('Черновик сохранён')).toBeTruthy(), SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    const dlg = screen.getByRole('dialog', { name: 'Опубликовать «Ежедневный отчёт прораба» v1?' });
    expect(dlg.textContent).toContain(
      'Будет создана новая неизменяемая версия. Новые ответы пойдут по v1.',
    );
    expect(dlg.textContent).toContain(
      'Форма начнёт принимать ответы. Кто может ответить: сотрудники организации.',
    );
    fireEvent.click(within(dlg).getByRole('button', { name: 'Опубликовать v1' }));
    await waitFor(
      () => expect(toast()).toBe('Опубликована версия v1 формы «Ежедневный отчёт прораба»'),
      SLOW,
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW);
    await waitFor(
      () =>
        expect(document.querySelector('.ox-fm-ed-meta')?.textContent).toContain(
          'Принимает ответы · v1',
        ),
      SLOW,
    );
    expect(screen.getByRole('button', { name: 'Опубликовано' })).toBeTruthy();
  });

  it('новая версия: пункты об ответах, новых обязательных, смене типа, убранных, правилах; v4', async () => {
    await open(INSP);
    fireEvent.click(qrow('Пробег по одометру, км'));
    fireEvent.change(within(card()).getByRole('combobox', { name: 'Тип вопроса' }), {
      target: { value: 'int' },
    });
    fireEvent.click(within(card()).getByRole('button', { name: 'Свернуть вопрос' }));
    fireEvent.click(qrow('Дефект критический'));
    fireEvent.click(within(card()).getByRole('button', { name: 'Действия с вопросом' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));
    await waitFor(() => expect(screen.getByText('Черновик сохранён')).toBeTruthy(), SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать v4' }));
    const dlg = screen.getByRole('dialog', { name: 'Опубликовать «Осмотр машины» v4?' });
    await waitFor(
      () =>
        expect(dlg.textContent).toContain(
          'Действия после ответа продолжают работать по своей версии правила',
        ),
      SLOW,
    );
    expect(dlg.textContent).toContain(
      '2 ответа остаются привязаны к своим версиям и показываются по их структуре',
    );
    expect(dlg.textContent).toContain(
      'Смена типа создаст новые поля: «Пробег по одометру, км». Старые значения не переписываются',
    );
    expect(dlg.textContent).toContain(
      'Убраны вопросы «Дефект критический»: их ответы остаются в прошлых версиях',
    );
    expect(dlg.textContent).toContain(
      'База знаний: «Пробег, км» — вопрос удалён или сменил тип, поле останется пустым. Обновите действие после публикации',
    );
    fireEvent.click(within(dlg).getByRole('button', { name: 'Опубликовать v4' }));
    await waitFor(() => expect(toast()).toBe('Опубликована версия v4 формы «Осмотр машины»'), SLOW);
    await waitFor(
      () => expect(screen.getByRole('tab', { name: /Версии/ }).textContent).toBe('Версии4'),
      SLOW,
    );
    // Сменивший тип вопрос — новый ключ `{key}-v4` (ответы прошлых версий — под старым).
    fireEvent.click(qrow('Пробег по одометру, км'));
    expect(
      (within(card()).getByRole('textbox', { name: 'Идентификатор вопроса' }) as HTMLInputElement)
        .value,
    ).toBe('q-odo-v4');
  });

  it('ошибка сервера — первым пунктом диалога', async () => {
    const a = await open(FOREMAN);
    fireEvent.click(qrow('Явка бригады'));
    fireEvent.click(within(card()).getByRole('button', { name: 'Добавить вариант' }));
    await waitFor(() => expect(screen.getByText('Черновик сохранён')).toBeTruthy(), SLOW);
    a.scenario.setScenario('publishForm=forbidden_action');
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Опубликовать v1' }),
    );
    const alert = await within(screen.getByRole('dialog')).findByRole('alert', {}, SLOW);
    expect(alert.textContent).toMatch(/^error.+/);
  });

  it('ошибка сервера: «Опубликовать v1» не теряет фокус, Escape и Tab работают и без фокуса в диалоге', async () => {
    const a = await foremanReady();
    a.scenario.setScenario('publishForm=revision_mismatch');
    const head = screen.getByRole('button', { name: 'Опубликовать' });
    head.focus();
    fireEvent.click(head);
    const dlg = screen.getByRole('dialog');
    const confirm = within(dlg).getByRole('button', { name: 'Опубликовать v1' });
    confirm.focus();
    fireEvent.click(confirm);
    // Во время команды кнопка не `disabled` (фокус не падает на BODY), повтор нажатия ничего не отправляет.
    expect(confirm.hasAttribute('disabled')).toBe(false);
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    await within(dlg).findByRole('alert', {}, SLOW);
    expect(dlg.contains(document.activeElement)).toBe(true);
    // Фокус ушёл из диалога (щелчок мимо) — Tab возвращает его внутрь, Escape закрывает.
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(dlg.contains(document.activeElement)).toBe(true);
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Опубликовать' }));
  });

  it('нет связи: текст один раз — тостом оболочки, без пункта в диалоге; диалог открыт', async () => {
    const a = await foremanReady();
    a.scenario.setScenario('publishForm=offline');
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    const dlg = screen.getByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Опубликовать v1' }));
    await waitFor(() => expect(toast()).toBe(OFFLINE), SLOW);
    expect(screen.getByRole('dialog')).toBe(dlg);
    expect(dlg.textContent).not.toContain(OFFLINE);
    expect(within(dlg).getByRole('button', { name: 'Опубликовать v1' })).toBeTruthy();
  });

  it('после публикации фокус — на заголовке формы, а не на BODY (кнопка шапки стала «Опубликовано»)', async () => {
    await foremanReady();
    const head = screen.getByRole('button', { name: 'Опубликовать' });
    head.focus();
    fireEvent.click(head);
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Опубликовать v1' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Опубликовано' })).toBeTruthy());
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 1, name: 'Ежедневный отчёт прораба' }),
    );
  });
});
