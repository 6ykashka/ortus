// W4.22 · Экранные тесты редактора «Форм и опросов»: шапка (dc:85–106), «Конструктор» (dc:143–286) — страницы,
// выбор типа, карточка вопроса, условия, идентификатор, удаление и «Восстановить», «До публикации исправьте»,
// автосохранение и конфликт двух редакторов, «Ещё» (отмена изменений, CSV), только просмотр. Сеть — сценарный
// сервер W4.05 (сид «Альты»: «Осмотр машины» v3, черновик «Ежедневного отчёта прораба»).
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
const page = (i: number) => document.querySelectorAll<HTMLElement>('.ox-fm-page')[i] as HTMLElement;
const qrow = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('.ox-fm-q-row')].find((b) =>
    b.querySelector('.ox-fm-q-label')?.textContent?.startsWith(label),
  ) as HTMLElement;
const card = () => document.querySelector<HTMLElement>('.ox-fm-qe') as HTMLElement;
const saved = () => waitFor(() => expect(screen.getByText('Черновик сохранён')).toBeTruthy(), SLOW);
type Org = {
  formsData: { forms: { proto: string; draft: { revision: number }; status: string }[] };
};
const orgOf = (a: MockApp) =>
  (a.scenario.state() as unknown as { orgs: Record<string, Org> }).orgs[ALTA] as Org;

describe('«Формы и опросы»: шапка редактора', () => {
  it('«Осмотр машины»: «Все формы», название, чип, мета, кнопки, пять вкладок со счётчиками', async () => {
    await open(INSP);
    expect(screen.getByRole('button', { name: 'Все формы' })).toBeTruthy();
    expect(
      (screen.getByRole('textbox', { name: 'Название формы' }) as HTMLInputElement).value,
    ).toBe('Осмотр машины');
    const meta = document.querySelector('.ox-fm-ed-meta') as HTMLElement;
    expect(meta.textContent).toContain('Принимает ответы · v3');
    expect(meta.textContent).toContain('Логистика · вся организация · владелец Дарья Зимина');
    expect(screen.getByRole('button', { name: 'Предпросмотр' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Поделиться' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ещё действия с формой' })).toBeTruthy();
    const pub = screen.getByRole('button', { name: 'Опубликовано' }) as HTMLButtonElement;
    expect(pub.disabled).toBe(true);
    expect(
      within(screen.getByRole('tablist', { name: 'Разделы формы' }))
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['Конструктор', 'Настройки', 'Действия после ответа2', 'Ответы2', 'Версии3']);
    expect(screen.getByRole('tab', { name: 'Конструктор' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('заголовок первого уровня — название формы (поле названия, как у эталона, h1 скрыт визуально)', async () => {
    await open(INSP);
    const h = screen.getByRole('heading', { level: 1, name: 'Осмотр машины' });
    expect(h.closest('.ox-fm-editor')).toBeTruthy();
  });

  it('название: Enter сохраняет («Форма переименована»), Escape отменяет, короткое — ошибка под полем', async () => {
    await open(INSP);
    const name = screen.getByRole('textbox', { name: 'Название формы' }) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Ос' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    fireEvent.blur(name);
    expect((await screen.findByRole('alert', {}, SLOW)).textContent).toBe(
      'Название формы — не короче 3 символов',
    );
    fireEvent.change(name, { target: { value: 'Черновое' } });
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(name.value).toBe('Осмотр машины');
    fireEvent.change(name, { target: { value: 'Осмотр машины перед рейсом' } });
    fireEvent.blur(name);
    await waitFor(() => expect(toast()).toBe('Форма переименована'), SLOW);
    await waitFor(() => expect(name.value).toBe('Осмотр машины перед рейсом'), SLOW);
  });

  it('черновик прораба: «Черновик · не опубликована», «Опубликовать», «Ещё» — без отмены и закрытия', async () => {
    await open(FOREMAN);
    expect(document.querySelector('.ox-fm-ed-meta')?.textContent).toContain(
      'Черновик · не опубликована',
    );
    expect(document.querySelector('.ox-fm-ed-meta')?.textContent).toContain('Ремонт и стройка');
    expect(
      (screen.getByRole('button', { name: 'Опубликовать' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Ещё действия с формой' }));
    expect(screen.getAllByRole('menuitem').map((x) => x.textContent)).toEqual([
      'content_copyДублировать форму',
      'downloadВыгрузить ответы в CSV',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Выгрузить ответы в CSV' }));
    await waitFor(() => expect(toast()).toBe('Ответов пока нет'), SLOW);
  });

  it('вкладка в адресе: «Ответы» — `&tab=responses`, «Конструктор» — без `tab`', async () => {
    const a = await open(INSP);
    fireEvent.click(screen.getByRole('tab', { name: /Ответы/ }));
    await waitFor(() =>
      expect((a.router.state.location.search as Record<string, string>).tab).toBe('responses'),
    );
    expect(document.querySelector('.ox-fm-page')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Конструктор' }));
    await waitFor(() =>
      expect((a.router.state.location.search as Record<string, string>).tab).toBeUndefined(),
    );
    await waitFor(() => expect(document.querySelector('.ox-fm-page')).toBeTruthy(), SLOW);
  });
});

describe('«Формы и опросы»: «Конструктор»', () => {
  it('«Содержание», страницы, свёрнутые вопросы с метой и условием', async () => {
    await open(INSP);
    const nav = screen.getByRole('navigation', { name: 'Содержание формы' });
    expect(nav.textContent).toContain('4 стр. · 7 вопросов');
    expect([...nav.querySelectorAll('.ox-fm-outline-title')].map((x) => x.textContent)).toEqual([
      'Фото',
      'Показания',
      'Проверка',
      'Дефекты',
    ]);
    expect(page(1).getAttribute('aria-label')).toBe('Страница 2 из 4');
    expect(qrow('Уровень топлива').textContent).toContain(
      'Один вариант · обязательный · 4 варианта',
    );
    expect(qrow('Описание дефекта').textContent).toContain(
      'Короткий текст · обязательный · если «Есть дефекты?» = да',
    );
  });

  it('карточка вопроса: тип, текст, «Обязательный», варианты, флаг «Изменено», заметка, автосохранение', async () => {
    await open(INSP);
    fireEvent.click(qrow('Уровень топлива'));
    const c = card();
    expect(
      (within(c).getByRole('combobox', { name: 'Тип вопроса' }) as HTMLSelectElement).value,
    ).toBe('choice');
    const opts = within(c).getAllByRole('textbox', { name: /^Вариант \d$/ }) as HTMLInputElement[];
    expect(opts.map((x) => x.value)).toEqual(['¼', '½', '¾', 'Полный']);
    fireEvent.click(within(c).getByRole('button', { name: 'Добавить вариант' }));
    expect(
      (within(c).getAllByRole('textbox', { name: /^Вариант \d$/ }) as HTMLInputElement[]).at(-1)
        ?.value,
    ).toBe('Вариант 5');
    expect(screen.getByText('Сохраняем черновик…')).toBeTruthy();
    await saved();
    fireEvent.change(within(c).getByRole('textbox', { name: 'Вопрос' }), {
      target: { value: 'Топливо в баке' },
    });
    expect(c.textContent).toContain(
      'Смена текста не меняет идентификатор: старые ответы и отчёты остаются связаны.',
    );
    expect(document.querySelector('.ox-fm-ed-meta')?.textContent).toContain(
      'Действует v3 · есть неопубликованные изменения',
    );
    await saved();
    expect(screen.getByRole('button', { name: 'Опубликовать v4' })).toBeTruthy();
    fireEvent.click(within(c).getByRole('button', { name: 'Свернуть вопрос' }));
    expect(qrow('Топливо в баке').textContent).toContain('Изменено');
  });

  it('смена типа: «Новый тип», заметка о новом поле; идентификатор у опубликованного заблокирован', async () => {
    await open(INSP);
    fireEvent.click(qrow('Пробег по одометру, км'));
    const c = card();
    const id = within(c).getByRole('textbox', {
      name: 'Идентификатор вопроса',
    }) as HTMLInputElement;
    expect(id.disabled).toBe(true);
    expect(c.textContent).toContain(
      'Идентификатор нельзя изменить: вопрос есть в опубликованной версии.',
    );
    fireEvent.change(within(c).getByRole('combobox', { name: 'Тип вопроса' }), {
      target: { value: 'int' },
    });
    expect(c.textContent).toContain(
      'Смена типа создаёт новое поле: ответы прошлых версий сохранят значение «Число» под старым идентификатором.',
    );
    expect(
      [...(within(c).getByRole('combobox', { name: 'Тип вопроса' }) as HTMLSelectElement).options]
        .filter((o) => o.disabled)
        .map((o) => o.textContent),
    ).toEqual(['Серия вопросов — недоступно', 'Оплата — недоступно']);
    fireEvent.click(within(c).getByRole('button', { name: 'Свернуть вопрос' }));
    expect(qrow('Пробег по одометру, км').textContent).toContain('Новый тип');
  });

  it('выбор типа: частые и все вопросы, недоступные с причиной; новый вопрос — правило идентификатора', async () => {
    await open(FOREMAN);
    fireEvent.click(within(page(0)).getByRole('button', { name: 'Добавить вопрос' }));
    expect(screen.getByText('Выберите вопрос')).toBeTruthy();
    const pick = document.querySelector('.ox-fm-pick') as HTMLElement;
    expect(pick.querySelectorAll('.ox-fm-pick-item')).toHaveLength(9);
    fireEvent.click(within(pick).getByRole('button', { name: 'Показать все вопросы' }));
    expect([...pick.querySelectorAll('.ox-fm-pick-gtitle')].map((x) => x.textContent)).toEqual([
      'Текст и числа',
      'Выбор',
      'Данные CRM',
      'Другие',
    ]);
    expect(pick.querySelectorAll('.ox-fm-pick-item')).toHaveLength(23);
    expect(pick.textContent).toContain(
      'Форма не принимает деньги: оплату проводит касса (FORM-05)',
    );
    fireEvent.click(within(pick).getByRole('button', { name: /^Почта$/ }));
    const c = card();
    expect(
      (within(c).getByRole('combobox', { name: 'Тип вопроса' }) as HTMLSelectElement).value,
    ).toBe('email');
    const id = within(c).getByRole('textbox', {
      name: 'Идентификатор вопроса',
    }) as HTMLInputElement;
    expect(id.value).toMatch(/^q-email-[a-z0-9]{1,4}$/);
    fireEvent.change(id, { target: { value: '1' } });
    expect(within(c).getByRole('alert').textContent).toBe(
      'Латиница, цифры, «_» и «-», с буквы, от 2 символов',
    );
    fireEvent.change(id, { target: { value: 'q-volume' } });
    expect(within(c).getByRole('alert').textContent).toBe('Такой идентификатор уже есть');
    fireEvent.change(id, { target: { value: 'contact_email' } });
    expect(within(card()).queryByRole('alert')).toBeNull();
    expect(
      (within(card()).getByRole('textbox', { name: 'Идентификатор вопроса' }) as HTMLInputElement)
        .value,
    ).toBe('contact_email');
  });

  it('условия «И / ИЛИ»: добавить, режим, «не равно», удалить; без вопросов выше — подсказка', async () => {
    await open(INSP);
    fireEvent.click(qrow('Фото: спереди'));
    expect(card().textContent).toContain('Выше нет вопросов, от которых может зависеть показ.');
    fireEvent.click(within(card()).getByRole('button', { name: 'Свернуть вопрос' }));
    fireEvent.click(qrow('Описание дефекта'));
    const c = card();
    const vals = within(c).getByRole('combobox', { name: 'Значение' }) as HTMLSelectElement;
    expect([...vals.options].map((o) => o.textContent)).toEqual(['Да', 'Нет']);
    expect(vals.value).toBe('true');
    fireEvent.click(within(c).getByRole('button', { name: 'Добавить условие' }));
    const mode = within(card()).getByRole('combobox', { name: 'Как сочетать условия' });
    expect([...(mode as HTMLSelectElement).options].map((o) => o.textContent)).toEqual([
      'Все условия выполнены (И)',
      'Любое из условий (ИЛИ)',
    ]);
    fireEvent.change(mode, { target: { value: 'any' } });
    const fields = within(card()).getAllByRole('combobox', { name: 'Вопрос условия' });
    fireEvent.change(fields[1] as HTMLElement, { target: { value: 'q-fuel' } });
    fireEvent.change(
      within(card()).getAllByRole('combobox', { name: 'Сравнение' })[1] as HTMLElement,
      {
        target: { value: 'not_equals' },
      },
    );
    fireEvent.change(
      within(card()).getAllByRole('combobox', { name: 'Значение' })[1] as HTMLElement,
      {
        target: { value: 'o4' },
      },
    );
    fireEvent.click(within(card()).getByRole('button', { name: 'Свернуть вопрос' }));
    expect(qrow('Описание дефекта').textContent).toContain(
      'если «Есть дефекты?» = да или «Уровень топлива» ≠ Полный',
    );
    fireEvent.click(qrow('Описание дефекта'));
    fireEvent.click(
      within(card()).getAllByRole('button', { name: 'Удалить условие' })[0] as HTMLElement,
    );
    fireEvent.click(within(card()).getByRole('button', { name: 'Удалить условие' }));
    expect(within(card()).getByRole('button', { name: 'Показывать при условии' })).toBeTruthy();
    expect(card().textContent).toContain('Условие может зависеть только от вопросов выше.');
  });

  it('скрытый вопрос: меню, «Скрытый», заметка, «До публикации исправьте» после правки', async () => {
    await open(INSP);
    fireEvent.click(qrow('Описание дефекта'));
    fireEvent.click(within(card()).getByRole('button', { name: 'Действия с вопросом' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Сделать скрытым' }));
    expect(card().textContent).toContain(
      'Скрытый вопрос не показывается. Значение — по умолчанию или из параметра ссылки ?q-defect-text=…',
    );
    expect(document.querySelector('.ox-fm-issues')?.textContent).toContain(
      '«Описание дефекта»: скрытый обязательный вопрос без значения по умолчанию',
    );
    fireEvent.click(within(card()).getByRole('button', { name: 'Значение по умолчанию' }));
    fireEvent.change(within(card()).getByRole('textbox', { name: 'Значение по умолчанию' }), {
      target: { value: 'нет' },
    });
    expect(document.querySelector('.ox-fm-issues')).toBeNull();
    fireEvent.click(within(card()).getByRole('button', { name: 'Свернуть вопрос' }));
    expect(qrow('Описание дефекта').textContent).toContain('Скрытый');
    const nav = screen.getByRole('navigation', { name: 'Содержание формы' });
    expect(within(nav).getAllByRole('img', { name: 'Скрытый' })).toHaveLength(1);
  });

  it('удаление вопроса и страницы с «Восстановить»; перемешивание, страница выше; «Добавить страницу»', async () => {
    await open(INSP);
    fireEvent.click(qrow('Пробег по одометру, км'));
    fireEvent.click(within(card()).getByRole('button', { name: 'Действия с вопросом' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));
    expect(screen.getByText('Вопрос «Пробег по одометру, км» удалён')).toBeTruthy();
    expect(qrow('Пробег по одометру, км')).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Восстановить' }));
    expect(qrow('Пробег по одометру, км')).toBeTruthy();
    fireEvent.click(within(page(3)).getByRole('button', { name: 'Действия со страницей' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Перемешивать вопросы для каждого' }));
    expect(within(page(3)).getByRole('img', { name: 'Вопросы перемешиваются' })).toBeTruthy();
    fireEvent.click(within(page(3)).getByRole('button', { name: 'Действия со страницей' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить страницу' }));
    expect(screen.getByText('«Дефекты» удалена вместе с 3 вопросами')).toBeTruthy();
    expect(document.querySelectorAll('.ox-fm-page')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть' }));
    expect(screen.queryByText('«Дефекты» удалена вместе с 3 вопросами')).toBeNull();
    fireEvent.click(within(page(1)).getByRole('button', { name: 'Страницу выше' }));
    expect(page(0).querySelector<HTMLInputElement>('.ox-fm-page-title')?.value).toBe('Показания');
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Добавить страницу' }).at(-1) as HTMLElement,
    );
    expect(document.querySelectorAll('.ox-fm-page')).toHaveLength(4);
    expect(page(3).querySelector<HTMLInputElement>('.ox-fm-page-title')?.value).toBe('Страница 4');
    expect(screen.getByText('Выберите вопрос')).toBeTruthy();
    expect(within(page(3)).getByText('На странице пока нет вопросов.')).toBeTruthy();
    await saved();
  });

  it('конфликт двух редакторов: «Черновик не сохранён: Черновик изменил другой редактор — обновите страницу»', async () => {
    const a = await open(INSP);
    const f = orgOf(a).formsData.forms.find((x) => x.proto === 'fm-insp');
    if (f) f.draft.revision += 1;
    fireEvent.click(qrow('Уровень топлива'));
    fireEvent.change(within(card()).getByRole('textbox', { name: 'Вопрос' }), {
      target: { value: 'Топливо' },
    });
    await waitFor(
      () =>
        expect(screen.getByText(/Черновик не сохранён:/).textContent).toBe(
          'errorЧерновик не сохранён: Черновик изменил другой редактор — обновите страницу',
        ),
      SLOW,
    );
  });

  it('«Отменить неопубликованные изменения»: тост «Изменения отменены: действует v3», черновик — v3', async () => {
    await open(INSP);
    fireEvent.click(qrow('Уровень топлива'));
    fireEvent.change(within(card()).getByRole('textbox', { name: 'Вопрос' }), {
      target: { value: 'Топливо' },
    });
    await saved();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё действия с формой' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Отменить неопубликованные изменения' }));
    await waitFor(() => expect(toast()).toBe('Изменения отменены: действует v3'), SLOW);
    await waitFor(() => expect(qrow('Уровень топлива')).toBeTruthy(), SLOW);
    expect(screen.getByRole('button', { name: 'Опубликовано' })).toBeTruthy();
  });

  it('только просмотр (менеджер логистики): плашка, без правки, без «Опубликовать» и «Добавить»', async () => {
    await open(INSP, { persona: 'manager', preset: 'logistics-ready' });
    expect(screen.getByText('Только просмотр · нет права «Настраивать» формы')).toBeTruthy();
    expect(
      (screen.getByRole('textbox', { name: 'Название формы' }) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole('button', { name: /^Опубликова/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Добавить вопрос' })).toBeNull();
    fireEvent.click(qrow('Уровень топлива'));
    expect(
      (within(card()).getByRole('textbox', { name: 'Вопрос' }) as HTMLTextAreaElement).disabled,
    ).toBe(true);
    expect(within(card()).queryByRole('button', { name: 'Добавить вариант' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё действия с формой' }));
    expect(screen.getAllByRole('menuitem').map((x) => x.textContent)).toEqual([
      'downloadВыгрузить ответы в CSV',
    ]);
  });

  it('форма по ссылке не найдена: баннер «Форма не найдена» и список', async () => {
    app = await renderMockApp(`/t/${ALTA}/forms?form=${A('fm-none')}`, { persona: 'owner' });
    expect((await screen.findByRole('alert', {}, SLOW)).textContent).toContain('Форма не найдена');
    await screen.findByRole('heading', { level: 1, name: 'Формы и опросы' }, SLOW);
  });
});
