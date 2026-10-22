// W4.22 · Экранные тесты «Форм и опросов»: список форм (dc:28–84) — плитки и «Все шаблоны», группы, фильтры, меню
// строки, пустые состояния, ошибки. Сеть — сценарный сервер W4.05 (тег Forms поверх домена W4.20, сид «Альты»).
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const A = (id: string) => seedUuid('t-alta', id);
const SLOW = { timeout: 8_000 };
const BASE = `/t/${ALTA}/forms`;

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (
  o: Parameters<typeof renderMockApp>[1] & { search?: string } = {},
): Promise<MockApp> => {
  app = await renderMockApp(`${BASE}${o.search ?? ''}`, { persona: 'owner', ...o });
  return app;
};
/** Организация без форм: срез «Форм» сценарного сервера пустой. */
const noForms = (s: MockApp['scenario']) => {
  const org = (s.state() as unknown as { orgs: Record<string, Record<string, unknown>> }).orgs[
    ALTA
  ];
  if (org) org.formsData = { forms: [], rules: [], responses: [], groups: [], seq: 0 };
};
const rows = () => [...document.querySelectorAll<HTMLElement>('.ox-fm-row')];
const rowNames = () => rows().map((r) => r.querySelector('strong')?.textContent);
const row = (name: string) =>
  rows().find((r) => r.querySelector('strong')?.textContent === name) as HTMLElement;
const listReady = async () => {
  await screen.findByRole('heading', { level: 1, name: 'Формы и опросы' }, SLOW);
  await waitFor(() => expect(rows().length).toBeGreaterThan(0), SLOW);
};
const toast = () => document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const search = () => {
  const s = (app?.router.state.location.search ?? {}) as Record<string, unknown>;
  return { get: (k: string) => (typeof s[k] === 'string' ? (s[k] as string) : null) };
};
const rowMenu = (name: string) =>
  within(row(name)).getByRole('button', { name: `Действия с формой «${name}»` });

describe('«Формы и опросы»: список форм', () => {
  it('владелец: крошка, заголовок, подзаголовок, пять плиток, «Все шаблоны · 15», строки форм', async () => {
    await open();
    await listReady();
    expect(document.querySelector('.ox-fm-crumb')?.textContent).toBe('Альта Групп / Общие модули');
    expect(
      screen.getByText(
        'Анкеты, заявки, опросы, тесты и рабочие отчёты. Опубликованная версия неизменяема: каждый ответ привязан к своей версии.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Создание формы' })).toBeTruthy();
    await waitFor(
      () =>
        expect(
          [...document.querySelectorAll('.ox-fm-tile-name')].map((x) => x.textContent),
        ).toEqual([
          'Создать пустую форму',
          'Анкета',
          'Форма обратной связи',
          'Заявка на услугу или работу',
          'Регистрация на обучение',
        ]),
      SLOW,
    );
    expect(screen.getByRole('button', { name: /Все шаблоны · 15/ })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Формы и группы' })).toBeTruthy();
    expect(new Set(rowNames())).toEqual(new Set(['Осмотр машины', 'Ежедневный отчёт прораба']));
    const insp = row('Осмотр машины');
    expect(insp.textContent).toContain('Логистика · Дарья Зимина · изменена 24.09');
    expect(insp.textContent).toContain('Принимает ответы · v3');
    expect(insp.textContent).toContain('2 ответа');
    const fm = row('Ежедневный отчёт прораба');
    expect(fm.textContent).toContain('Ремонт и стройка · Дарья Зимина');
    expect(fm.querySelector('.ox-fm-chip')?.textContent).toBe('edit_noteЧерновик');
    expect(fm.textContent).toContain('0 ответов');
  });

  it('«Все шаблоны»: разделы, мета, недоступный модуль, поиск и «Шаблон не найден»', async () => {
    await open();
    await listReady();
    fireEvent.click(await screen.findByRole('button', { name: /Все шаблоны · 15/ }, SLOW));
    const pop = document.querySelector('.ox-fm-tpl-pop') as HTMLElement;
    expect([...pop.querySelectorAll('.ox-fm-tpl-cat')].map((x) => x.textContent)).toEqual([
      'Основные',
      'Опросы и оценка',
      'Сотрудники',
      'Тесты',
      'Отраслевые',
    ]);
    const insp = [...pop.querySelectorAll<HTMLButtonElement>('.ox-fm-tpl-item')].find((b) =>
      b.textContent?.includes('Круговой осмотр машины'),
    ) as HTMLButtonElement;
    expect(insp.textContent).toContain('Логистика · 7 вопросов · 3 страницы · модуль не подключён');
    expect(insp.disabled).toBe(true);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск шаблона' }), {
      target: { value: 'nps' },
    });
    expect(pop.querySelectorAll('.ox-fm-tpl-item')).toHaveLength(1);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск шаблона' }), {
      target: { value: 'нет такого' },
    });
    expect(screen.getByText('Шаблон не найден')).toBeTruthy();
    // Escape закрывает список шаблонов.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.ox-fm-tpl-pop')).toBeNull());
  });

  it('плитка «Анкета» → черновик «Анкета», тост, редактор формы; повтор — «Анкета · 2»', async () => {
    await open();
    await listReady();
    const tile = await screen.findByRole('button', { name: 'Анкета' }, SLOW);
    fireEvent.click(tile);
    await waitFor(() => expect(toast()).toBe('Создан черновик «Анкета»'), SLOW);
    await waitFor(() => expect(search().get('form')).toBeTruthy(), SLOW);
    expect(
      ((await screen.findByRole('textbox', { name: 'Название формы' }, SLOW)) as HTMLInputElement)
        .value,
    ).toBe('Анкета');
    fireEvent.click(screen.getByRole('button', { name: 'Все формы' }));
    await listReady();
    fireEvent.click(await screen.findByRole('button', { name: 'Анкета' }, SLOW));
    await waitFor(() => expect(toast()).toBe('Создан черновик «Анкета · 2»'), SLOW);
  });

  it('группы: ошибки имени, создание, «По группам», перемещение, удаление пустой', async () => {
    await open();
    await listReady();
    fireEvent.click(screen.getByRole('button', { name: 'Создать группу' }));
    const name = screen.getByRole('textbox', { name: 'Название группы' });
    expect(name.getAttribute('placeholder')).toBe('Название группы, например «Опросы клиентов»');
    fireEvent.change(name, { target: { value: 'А' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Название группы — от 2 символов');
    fireEvent.change(name, { target: { value: 'Логистика и машины' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(
      () =>
        expect(toast()).toBe(
          'Группа «Логистика и машины» создана. Переместите в неё формы через меню «…»',
        ),
      SLOW,
    );
    // «По группам» включён: группа пустая — корзина и текст.
    expect(screen.getByRole('button', { name: 'По группам' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await screen.findByText(
      'В группе пока нет форм — переместите сюда форму через меню «…».',
      {},
      SLOW,
    );
    expect(screen.getByRole('button', { name: 'Удалить пустую группу' })).toBeTruthy();
    // Повтор имени — ошибка сервера.
    fireEvent.click(screen.getByRole('button', { name: 'Создать группу' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Название группы' }), {
      target: { value: 'логистика и машины' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Такая группа уже есть');
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    // Переместить «Осмотр машины» в группу.
    fireEvent.click(rowMenu('Осмотр машины'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Переместить в группу' }));
    expect(screen.getByRole('menu').textContent).toContain('Переместить в группу');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Логистика и машины' }));
    await waitFor(() => {
      const heads = [...document.querySelectorAll('.ox-fm-block-head')].map((x) => x.textContent);
      expect(heads).toEqual(['folderЛогистика и машины1', 'folderБез группы1']);
    }, SLOW);
    expect(screen.queryByRole('button', { name: 'Удалить пустую группу' })).toBeNull();
    // Без «По группам» — «группа «…»» в мете строки.
    fireEvent.click(screen.getByRole('button', { name: 'По группам' }));
    expect(row('Осмотр машины').textContent).toContain(
      'Логистика · группа «Логистика и машины» · Дарья Зимина',
    );
    // Обратно «Без группы» — группа пустеет, корзина удаляет её.
    fireEvent.click(rowMenu('Осмотр машины'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Переместить в группу' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Без группы' }));
    fireEvent.click(screen.getByRole('button', { name: 'По группам' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить пустую группу' }, SLOW));
    await waitFor(
      () =>
        expect(
          [...document.querySelectorAll('.ox-fm-block-head')].map((x) => x.textContent),
        ).toEqual(['folderБез группы2']),
      SLOW,
    );
  });

  it('фильтры: поиск, статус, «Мои формы»; «Ничего не найдено» и «Сбросить фильтры»', async () => {
    await open();
    await listReady();
    fireEvent.change(screen.getByRole('combobox', { name: 'Статус' }), {
      target: { value: 'draft' },
    });
    expect(rowNames()).toEqual(['Ежедневный отчёт прораба']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Статус' }), {
      target: { value: 'open' },
    });
    expect(rowNames()).toEqual(['Осмотр машины']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск формы' }), {
      target: { value: 'прораб' },
    });
    expect(rows()).toHaveLength(0);
    expect(screen.getByText('Ничего не найдено')).toBeTruthy();
    expect(screen.getByText('Измените поиск или фильтры.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.change(screen.getByRole('combobox', { name: 'Владелец' }), {
      target: { value: 'mine' },
    });
    await waitFor(() => expect(rows()).toHaveLength(2), SLOW);
  });

  it('меню строки: «Открыть», «Ответы · 2», «Дублировать», «Закрыть / Возобновить приём ответов»', async () => {
    await open();
    await listReady();
    fireEvent.click(rowMenu('Осмотр машины'));
    expect(screen.getAllByRole('menuitem').map((x) => x.textContent)).toEqual([
      'editОткрыть',
      'inboxОтветы · 2',
      'content_copyДублировать',
      'drive_file_moveПереместить в группу',
      'blockЗакрыть приём ответов',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Закрыть приём ответов' }));
    await waitFor(() => expect(toast()).toBe('Приём ответов закрыт: «Осмотр машины»'), SLOW);
    await waitFor(
      () => expect(row('Осмотр машины').textContent).toContain('Приём закрыт · v3'),
      SLOW,
    );
    fireEvent.click(rowMenu('Осмотр машины'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Возобновить приём ответов' }));
    await waitFor(() => expect(toast()).toBe('Приём ответов возобновлён: «Осмотр машины»'), SLOW);
    fireEvent.click(rowMenu('Осмотр машины'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Дублировать' }));
    await waitFor(() => expect(toast()).toBe('Создана копия «Осмотр машины · копия»'), SLOW);
    await waitFor(() => expect(rowNames()).toContain('Осмотр машины · копия'), SLOW);
    // Черновик: без «Закрыть приём ответов».
    fireEvent.click(rowMenu('Ежедневный отчёт прораба'));
    expect(screen.queryByRole('menuitem', { name: 'Закрыть приём ответов' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ответы · 0' }));
    await waitFor(() => expect(search().get('tab')).toBe('responses'), SLOW);
    expect(search().get('form')).toBe(A('fm-foreman'));
  });

  it('меню строки → «Открыть» и «Ответы · 2»: меню и подложка «Закрыть меню» сняты в редакторе', async () => {
    await open();
    await listReady();
    fireEvent.click(rowMenu('Осмотр машины'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Открыть' }));
    await screen.findByRole('tab', { name: 'Конструктор' }, SLOW);
    // Подложка меню (position: fixed; inset: 0) не перехватывает первый клик редактора (open() эталона dc:624).
    expect(document.querySelector('.ox-fm-backdrop')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Все формы' }));
    await listReady();
    fireEvent.click(rowMenu('Осмотр машины'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ответы · 2' }));
    await waitFor(() => expect(search().get('tab')).toBe('responses'), SLOW);
    await screen.findByRole('tab', { name: /Ответы/ }, SLOW);
    expect(document.querySelector('.ox-fm-backdrop')).toBeNull();
  });

  it('меню строки: Escape закрывает меню и возвращает фокус кнопке «…»', async () => {
    await open();
    await listReady();
    const btn = rowMenu('Осмотр машины');
    btn.focus();
    fireEvent.click(btn);
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('menuitem'));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(rowMenu('Осмотр машины'));
  });

  it('организация только для чтения (пробный период закончился): без плиток, групп и правки в меню', async () => {
    await open({ preset: 'trial-ended' });
    await listReady();
    expect(screen.queryByRole('heading', { level: 2, name: 'Создание формы' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Создать группу' })).toBeNull();
    fireEvent.click(rowMenu('Осмотр машины'));
    expect(screen.getAllByRole('menuitem').map((x) => x.textContent)).toEqual([
      'editОткрыть',
      'inboxОтветы · 2',
    ]);
  });

  it('ошибка загрузки списка — «Не удалось загрузить данные…» и «Повторить»', async () => {
    const a = await open({ scenario: 'listForms=rate_limited' });
    await screen.findByRole('heading', { level: 1, name: 'Формы и опросы' }, SLOW);
    expect((await screen.findByRole('alert', {}, SLOW)).textContent).toContain(
      'Не удалось загрузить данные: Слишком много запросов.',
    );
    a.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await listReady();
  });

  it('форм нет: «Форм пока нет» и «Создать пустую форму» → черновик «Новая форма»', async () => {
    await open({ setup: noForms });
    await screen.findByText('Форм пока нет', {}, SLOW);
    expect(screen.getByText('Создайте первую форму с нуля или из шаблона выше.')).toBeTruthy();
    const blank = await waitFor(() => {
      const b = [...document.querySelectorAll<HTMLButtonElement>('.ox-fm-empty button')].find(
        (x) => x.textContent === 'Создать пустую форму',
      );
      expect(b).toBeTruthy();
      return b as HTMLButtonElement;
    }, SLOW);
    fireEvent.click(blank);
    await waitFor(() => expect(toast()).toBe('Создан черновик «Новая форма»'), SLOW);
  });
});
