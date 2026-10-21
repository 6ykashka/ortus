// W4.32 · Экранные тесты «Базы знаний»: список пространств (М:29–59) и пространство (М:61–197). Сеть — сценарный
// сервер W4.04 (тег Knowledge поверх домена W4.30, сид «Базы знаний» «Альты»).
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const A = (id: string) => seedUuid('t-alta', id);
const SLOW = { timeout: 8_000 };
const BASE = `/t/${ALTA}/knowledge`;

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
const listReady = async () => {
  await screen.findByRole('heading', { level: 1, name: 'База знаний' }, SLOW);
  await waitFor(() => expect(cards().length).toBeGreaterThan(0), SLOW);
};
const cards = () => [...document.querySelectorAll<HTMLElement>('.ox-kb-card')];
const card = (name: string) =>
  cards().find((c) => c.querySelector('strong')?.textContent === name) as HTMLElement;
const space = (name: string) =>
  document.querySelector<HTMLElement>(`section.ox-kb-space[aria-label="${name}"]`);
const tree = () => screen.getByRole('navigation', { name: 'Дерево пространства' });
const rowTitles = () =>
  [...tree().querySelectorAll('.ox-kb-node-title')].map((x) => x.textContent ?? '');
const pageTitle = () => document.querySelector('article.ox-kb-article h2')?.textContent;
const toast = () => document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const search = () => {
  const s = (app?.router.state.location.search ?? {}) as Record<string, unknown>;
  return { get: (k: string) => (typeof s[k] === 'string' ? (s[k] as string) : null) };
};

describe('«База знаний»: список пространств', () => {
  it('владелец: заголовок, подзаголовок, «Новое пространство», пять карточек с подписями эталона', async () => {
    await open();
    await listReady();
    expect(screen.getByText('Пространства и страницы, доступные вам по ролям')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Новое пространство' })).toBeTruthy();
    expect(cards().map((c) => c.querySelector('strong')?.textContent)).toEqual([
      'Логистика',
      'Салон и SPA',
      'Руководство',
      'Ремонт и стройка',
      'Общее',
    ]);
    const log = card('Логистика');
    expect(log.textContent).toContain('Фирма «Север Логистик»');
    expect(log.textContent).toContain('Ограниченное');
    expect(log.textContent).toContain('16 страниц');
    expect(log.textContent).toContain('Руководитель: Марина Котова');
    expect(log.textContent).toContain('Вы: владелец бизнеса');
    expect(log.textContent).toContain('Обновлено: «');
    expect(log.textContent).toContain('», 24.09.2026');
    expect(card('Салон и SPA').textContent).toContain('Руководитель: владелец бизнеса');
    expect(card('Руководство').textContent).toContain('Закрытое');
    expect(card('Руководство').textContent).toContain('2 страницы');
    expect(document.body.textContent).toContain(
      'Пространство — область в «Пользователях и ролях». Доступ дают роли с областью организации, региона, фирмы или самого пространства. Подстраница получает доступ родителя и может только сузить круг читателей.',
    );
  });

  it('массажист: видит «Салон и SPA», «Ремонт и стройка», «Общее»; без «Нового пространства»', async () => {
    await open({ persona: 'therapist' });
    await listReady();
    expect(cards().map((c) => c.querySelector('strong')?.textContent)).toEqual([
      'Салон и SPA',
      'Ремонт и стройка',
      'Общее',
    ]);
    expect(screen.queryByRole('button', { name: 'Новое пространство' })).toBeNull();
  });

  it('поиск по доступным страницам: от двух символов, путь и выдержка, пусто, переход', async () => {
    await open();
    await listReady();
    const q = screen.getByRole('searchbox', { name: 'Поиск по базе знаний' });
    fireEvent.change(q, { target: { value: 'о' } });
    expect(document.querySelector('.ox-kb-hits')).toBeNull();
    fireEvent.change(q, { target: { value: 'одометр' } });
    const hit = await waitFor(() => {
      const h = [...document.querySelectorAll<HTMLElement>('.ox-kb-hit')].find((x) =>
        x.textContent?.includes('Чек-лист приёмки'),
      );
      expect(h).toBeTruthy();
      return h as HTMLElement;
    }, SLOW);
    expect(hit.querySelector('.ox-kb-hit-where')?.textContent).toBe(
      'Логистика › Регламенты › Регламент приёмки смены',
    );
    fireEvent.change(q, { target: { value: 'несуществующее слово' } });
    await screen.findByText('Среди доступных вам страниц ничего не нашлось', {}, SLOW);
    fireEvent.change(q, { target: { value: 'одометр' } });
    await waitFor(
      () => expect(document.querySelectorAll('.ox-kb-hit').length).toBeGreaterThan(0),
      SLOW,
    );
    fireEvent.click(
      [...document.querySelectorAll<HTMLElement>('.ox-kb-hit')].find((x) =>
        x.textContent?.includes('Чек-лист приёмки'),
      ) as HTMLElement,
    );
    await waitFor(() => expect(pageTitle()).toBe('Чек-лист приёмки'), SLOW);
    expect(search().get('space')).toBe(A('sp-log'));
    expect(search().get('page')).toBe(A('kb-1a'));
    // Путь к странице раскрыт в дереве.
    expect(rowTitles()).toContain('Чек-лист приёмки');
  });

  it('ошибка загрузки — «Повторить»; загрузка — скелетон', async () => {
    await open({ scenario: 'listKnowledgeSpaces=rate_limited' });
    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(alert.textContent).toBe(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    app?.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await listReady();
  });

  it('«Новое пространство»: шаблон, отмеченные подстраницы, «Пространство создано» и вход в него', async () => {
    await open();
    await listReady();
    fireEvent.click(screen.getByRole('button', { name: 'Новое пространство' }));
    const dlg = await screen.findByRole('dialog', { name: 'Новое пространство' }, SLOW);
    expect(dlg.textContent).toContain('Область и уровень доступа можно поменять позже');
    const ok = within(dlg).getByRole('button', { name: 'Создать пространство' });
    expect((ok as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dlg).getByLabelText('Название'), { target: { value: 'Охрана труда' } });
    await waitFor(() =>
      expect(
        within(dlg)
          .getAllByRole('checkbox')
          .map((x) => x.textContent),
      ).toContain('check_boxdescriptionВводный инструктажОзнакомиться: все'),
    );
    fireEvent.click(within(dlg).getByRole('button', { name: /Регламенты подразделения/ }));
    await waitFor(() => expect(within(dlg).getAllByRole('checkbox')).toHaveLength(5));
    // Папка снимает подстраницы.
    fireEvent.click(within(dlg).getByRole('checkbox', { name: /Регламенты/ }));
    expect(
      within(dlg)
        .getAllByRole('checkbox')
        .map((x) => x.getAttribute('aria-checked')),
    ).toEqual(['true', 'false', 'false', 'true', 'true']);
    expect((ok as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(ok);
    await waitFor(() => expect(space('Охрана труда')).toBeTruthy(), SLOW);
    expect(toast()).toBe('Пространство создано');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(pageTitle()).toBe('Обзор'), SLOW);
    expect(rowTitles()).toEqual(['Обзор', 'Чек-листы', 'Журнал изменений']);
  });
});

describe('«База знаний»: пространство', () => {
  it('шапка, вкладки владельца, уровень; «Обзор» и дерево со свёрнутыми папками', async () => {
    await open();
    await listReady();
    fireEvent.click(card('Логистика'));
    await waitFor(() => expect(space('Логистика')).toBeTruthy(), SLOW);
    const s = space('Логистика') as HTMLElement;
    expect(s.textContent).toContain('База знаний · Владелец бизнеса');
    expect(s.textContent).toContain('Ограниченное · фирма «Север Логистик»');
    const tabs = within(
      screen.getByRole('navigation', { name: 'Разделы пространства' }),
    ).getAllByRole('button');
    expect(tabs.map((t) => [t.textContent, t.getAttribute('aria-current')])).toEqual([
      ['Страницы', 'page'],
      ['Участники и доступ', 'false'],
      ['Автоматизация', 'false'],
      ['Архив', 'false'],
    ]);
    await waitFor(() => expect(pageTitle()).toBe('Обзор'), SLOW);
    expect(rowTitles()).toEqual([
      'Обзор',
      'Регламенты',
      'Журнал осмотров машин',
      'Схема сдачи смены',
      'Водителям',
      'Тарифы и начисления',
      'Договор аренды стоянки.pdf',
      'Форма «Осмотр машины»',
    ]);
    const art = document.querySelector('article.ox-kb-article') as HTMLElement;
    expect(art.textContent).toContain('Действует · v1');
    expect(art.textContent).toContain(
      'Страница · владелец Дарья Зимина · обновлено 20.09.2026, Дарья Зимина',
    );
    const aside = screen.getByRole('complementary', { name: 'О странице' });
    expect(aside.textContent).toContain(
      'Как у пространства: все в области читают, пишут участники.',
    );
    expect(aside.textContent).toContain('Вы можете читать и править.');
    expect(within(aside).getByRole('button', { name: 'Настроить доступ' })).toBeTruthy();
    expect(aside.textContent).toContain('v120.09.2026 · Дарья Зимина');
    // Значки финансовой страницы и своего доступа.
    const fin = [...tree().querySelectorAll('[role="treeitem"]')].find((x) =>
      x.textContent?.includes('Тарифы и начисления'),
    ) as HTMLElement;
    expect(fin.querySelector('[title="Финансовая страница"]')).toBeTruthy();
    expect(fin.querySelector('[title="Свой доступ"]')).toBeTruthy();
  });

  it('дерево: развернуть, чип «на проверке», выбор страницы и ссылка ?space=&page=; «К списку пространств»', async () => {
    await open({ search: `?space=${A('sp-log')}` });
    await waitFor(() => expect(pageTitle()).toBe('Обзор'), SLOW);
    const reg = [...tree().querySelectorAll<HTMLElement>('[role="treeitem"]')].find((x) =>
      x.textContent?.includes('Регламенты'),
    ) as HTMLElement;
    fireEvent.click(within(reg).getByRole('button', { name: 'Развернуть' }));
    expect(rowTitles()).toContain('Регламент приёмки смены');
    const review = [...tree().querySelectorAll<HTMLElement>('[role="treeitem"]')].find((x) =>
      x.textContent?.includes('Выезд при критическом дефекте'),
    ) as HTMLElement;
    expect(review.querySelector('.ox-kb-st')?.textContent).toBe('на проверке');
    fireEvent.click(within(review).getByText('Выезд при критическом дефекте'));
    await waitFor(() => expect(pageTitle()).toBe('Выезд при критическом дефекте'), SLOW);
    expect(search().get('page')).toBe(A('kb-6'));
    expect(review.getAttribute('aria-selected')).toBe('true');
    const path = screen.getByRole('navigation', { name: 'Путь' });
    expect(
      within(path)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Логистика', 'Регламенты', 'Выезд при критическом дефекте']);
    fireEvent.click(within(reg).getByRole('button', { name: 'Свернуть' }));
    expect(rowTitles()).not.toContain('Регламент приёмки смены');
    fireEvent.click(screen.getByRole('button', { name: 'К списку пространств' }));
    await listReady();
    expect(search().get('space')).toBeNull();
  });

  it('поиск в пространстве: совпадения с путём, пусто', async () => {
    await open({ search: `?space=${A('sp-log')}` });
    await waitFor(() => expect(pageTitle()).toBe('Обзор'), SLOW);
    const q = within(tree()).getByRole('searchbox', { name: 'Найти в пространстве' });
    fireEvent.change(q, { target: { value: 'ставки' } });
    await waitFor(() => expect(rowTitles()).toEqual(['Ставки по маршрутам']), SLOW);
    expect(tree().querySelector('.ox-kb-node-where')?.textContent).toBe('Тарифы и начисления');
    fireEvent.change(q, { target: { value: 'ничего такого нет' } });
    await screen.findByText('Ничего не нашлось среди доступных страниц', {}, SLOW);
  });

  it('скрытое пространство по ссылке — баннер текстом сервера и список; «Скрыть» убирает баннер', async () => {
    await open({ persona: 'therapist', search: `?space=${A('sp-log')}` });
    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(alert.textContent).toContain('Пространство не найдено');
    await listReady();
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть' }));
    expect(document.querySelector('.ox-kb-err')).toBeNull();
  });

  it('водитель: две вкладки, «Тарифы и начисления» скрыты функцией', async () => {
    await open({ persona: 'driver', search: `?space=${A('sp-log')}` });
    await waitFor(() => expect(pageTitle()).toBe('Обзор'), SLOW);
    const tabs = within(
      screen.getByRole('navigation', { name: 'Разделы пространства' }),
    ).getAllByRole('button');
    expect(tabs.map((t) => t.textContent)).toEqual(['Страницы', 'Участники и доступ']);
    expect(rowTitles()).not.toContain('Тарифы и начисления');
    expect(space('Логистика')?.textContent).toContain('База знаний · ');
    expect(screen.queryByRole('button', { name: 'Править' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Кто видит и почему' })).toBeTruthy();
  });
});
