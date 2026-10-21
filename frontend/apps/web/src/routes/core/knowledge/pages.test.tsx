// W4.32 · Экранные тесты вкладки «Страницы» (М:76–197, pageVM/editVM М:505–561) и диалогов «Создать в …»,
// «Переместить …» (М:311–325): виды узлов, правка и публикация (If-Match, конфликт), старая версия и восстановление,
// создание с редактором, перенос с влиянием, «Утвердить», «В архив» и «Архив», ознакомление и запрос права правки,
// нет связи. Сеть — сценарный сервер W4.04 (сид «Базы знаний» «Альты»).
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const A = (id: string) => seedUuid('t-alta', id);
const SLOW = { timeout: 8_000 };
const BASE = `/t/${ALTA}/knowledge`;
const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

const open = async (
  page: string,
  o: Parameters<typeof renderMockApp>[1] = {},
  title?: string,
): Promise<MockApp> => {
  app = await renderMockApp(`${BASE}?space=${A('sp-log')}&page=${A(page)}`, {
    persona: 'owner',
    ...o,
  });
  if (title) await waitFor(() => expect(pageTitle()).toBe(title), SLOW);
  return app;
};
const art = () => document.querySelector('article.ox-kb-article') as HTMLElement;
const pageTitle = () => document.querySelector('article.ox-kb-article h2')?.textContent;
const toast = () => document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const aside = () => screen.getByRole('complementary', { name: 'О странице' });
const versions = () => [...aside().querySelectorAll('.ox-kb-ver strong')].map((x) => x.textContent);
const menu = async (item: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'Действия со страницей' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
};
const tree = () => screen.getByRole('navigation', { name: 'Дерево пространства' });
const rowTitles = () =>
  [...tree().querySelectorAll('.ox-kb-node-title')].map((x) => x.textContent ?? '');
const pageOf = (a: MockApp) =>
  (a.router.state.location.search as Record<string, unknown>).page as string | undefined;

describe('«Страницы»: виды узлов', () => {
  it('таблица: колонки, строки, «—» вместо пустых, подпись формы', async () => {
    await open('kb-5', {}, 'Журнал осмотров машин');
    const t = art().querySelector('table') as HTMLElement;
    expect([...t.querySelectorAll('th')].map((x) => x.textContent)).toEqual([
      'Дата',
      'Рейс',
      'Водитель',
      'Пробег, км',
      'Топливо',
      'Дефекты',
      'Ответ',
    ]);
    expect([...t.querySelectorAll('tbody tr')].map((r) => r.textContent)).toEqual([
      '27.09 09:05Рейс Р-196Илья Васильев84 210¾нетR-1012',
      '18.09 08:41Рейс Р-171Кирилл Громов83 902——R-0988',
    ]);
    expect(art().textContent).toContain('Осмотры');
    expect(art().textContent).toContain(
      'Строки добавляет форма после принятия ответа; исправления — через ответ формы.',
    );
    expect(art().textContent).toContain('Таблица · владелец Дарья Зимина');
  });

  it('схема: шаги и два исхода; файл — заглушка PDF; запись CRM — «Открыть» в модуль', async () => {
    const a = await open('kb-d1', {}, 'Схема сдачи смены');
    const fig = art().querySelector('figure') as HTMLElement;
    expect([...fig.querySelectorAll('.ox-kb-step')].map((x) => x.textContent)).toEqual([
      'Сдача смены',
      'Фото и пробег',
      'Чеки расходов',
    ]);
    expect([...fig.querySelectorAll('.ox-kb-out-box')].map((x) => x.textContent)).toEqual([
      'Принято · машина в пул',
      'Возврат по разделам',
    ]);
    fireEvent.click(within(tree()).getByText('Договор аренды стоянки.pdf'));
    await waitFor(() => expect(pageTitle()).toBe('Договор аренды стоянки.pdf'), SLOW);
    expect(art().textContent).toContain('PDF · 1,2 МБ · 4 страницы');
    expect(art().textContent).toContain(
      'В прототипе файл не хранится: здесь будет предпросмотр PDF.',
    );
    expect(art().querySelector('.ox-kb-kids')).toBeNull();
    fireEvent.click(within(tree()).getByText('Форма «Осмотр машины»'));
    await waitFor(() => expect(pageTitle()).toBe('Форма «Осмотр машины»'), SLOW);
    expect(art().textContent).toContain('Форма «Осмотр машины» · действует версия 3');
    expect(art().textContent).toContain('Запись CRM: открывается, если у вас есть доступ к ней');
    expect(screen.queryByRole('button', { name: 'Править' })).toBeNull();
    fireEvent.click(within(art()).getByRole('button', { name: 'Открыть' }));
    await waitFor(() => expect(a.path()).toBe(`/t/${ALTA}/forms`), SLOW);
  });

  it('папка: подстраницы с выдержкой и замком своего доступа, «Новая подстраница»', async () => {
    await open('kb-f-drv', {}, 'Водителям');
    const kids = within(screen.getByRole('region', { name: 'Подстраницы' }));
    await waitFor(() => {
      const texts = [...document.querySelectorAll('.ox-kb-kid .ox-kb-kid-text')].map(
        (x) => x.textContent ?? '',
      );
      const d = texts.find((x) => x.startsWith('Диспетчерская «Север Логистик» работает'));
      // Выдержка 90 символов с «…» (short М:384).
      expect(d?.length).toBe(90);
      expect(d?.endsWith('…')).toBe(true);
    }, SLOW);
    expect(
      kids.getByText('Маршруты').parentElement?.querySelector('[title="Свой доступ"]'),
    ).toBeTruthy();
    expect(art().textContent).toContain('Действует');
    expect(art().textContent).not.toContain('Действует · v');
    expect(aside().textContent).toContain('Свой доступ: только выбранные.');
    expect(aside().querySelector('.ox-kb-vers')).toBeNull();
    fireEvent.click(kids.getByRole('button', { name: /Новая подстраница/ }));
    const dlg = await screen.findByRole('dialog', { name: 'Создать в «Логистика»' }, SLOW);
    expect((within(dlg).getByLabelText('Где создать') as HTMLSelectElement).value).toBe(
      A('kb-f-drv'),
    );
    expect(dlg.textContent).toContain(
      'Внутри «Водителям». У родителя свой доступ — новая страница получит его же.',
    );
  });
});

describe('«Страницы»: правка, версии, конфликт', () => {
  it('«Править» → «Опубликовать v3»: тост, абзацы, версии; старая версия и «Восстановить как новую»', async () => {
    await open('kb-1', {}, 'Регламент приёмки смены');
    expect(versions()).toEqual(['v2', 'v1']);
    fireEvent.click(screen.getByRole('button', { name: 'Править' }));
    expect(art().textContent).toContain(
      'Основа — v2. Если страницу изменят раньше, Ортус покажет конфликт.',
    );
    // Аудитория — текст сервера audienceLabel (контракт: «роль «{роль}»»); эталон — «Роль «Водитель» · «Север
    // Логистик»» (KB.entryLabel М:557) — Q-W4.32-12, allowlist .ox-kb-ack-title.
    expect(art().textContent).toContain('Попросить ознакомиться с новой версией: роль «Водитель»');
    fireEvent.change(screen.getByLabelText('Текст · абзацы через пустую строку'), {
      target: { value: 'Новый текст.\n\nВторой абзац.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать v3' }));
    await waitFor(() => expect(toast()).toBe('Опубликована версия 3'), SLOW);
    await waitFor(() => expect(versions()).toEqual(['v3', 'v2', 'v1']), SLOW);
    expect([...art().querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'Новый текст.',
      'Второй абзац.',
    ]);
    fireEvent.click(aside().querySelectorAll<HTMLElement>('.ox-kb-ver')[2] as HTMLElement);
    await waitFor(() =>
      expect(art().textContent).toContain('Вы смотрите версию 1 от 05.09.2026. Текущая — v3.'),
    );
    expect(art().textContent).toContain('Менеджер проверяет фото до и после, пробег и расходы.');
    fireEvent.click(screen.getByRole('button', { name: 'Восстановить как новую' }));
    await waitFor(() => expect(toast()).toBe('Версия 1 восстановлена как новая'), SLOW);
    await waitFor(() => expect(versions()[0]).toBe('v4'), SLOW);
    expect(art().textContent).not.toContain('Вы смотрите версию');
  });

  it('конфликт: страницу изменили мимо экрана — баннер «Страницу уже изменили (v2)…», правка остаётся', async () => {
    const a = await open('kb-log-home', {}, 'Обзор');
    fireEvent.click(screen.getByRole('button', { name: 'Править' }));
    // Другой участник публикует версию (сценарный сервер напрямую).
    const kb = (
      a.scenario.state() as unknown as {
        orgs: Record<
          string,
          { knowledge?: { db: { knowledge: { pages: { id: string; versions: unknown[] }[] } } } }
        >;
      }
    ).orgs[ALTA]?.knowledge?.db.knowledge.pages.find((p) => p.id === 'kb-log-home');
    kb?.versions.push({ v: 2, at: '01.10.2026', by: 'Марина Котова', body: 'Правка другого.' });
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать v2' }));
    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(alert.querySelector('.ox-kb-err-text')?.textContent).toBe(
      'Страницу уже изменили (v2). Обновите и повторите правку.',
    );
    expect(screen.getByRole('button', { name: 'Опубликовать v2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('button', { name: 'Опубликовать v2' })).toBeNull();
  });
});

describe('«Страницы»: создание, перенос, статус, архив', () => {
  it('«+» → «Создать в «Логистика»»: схема, тост «Создано», редактор новой страницы', async () => {
    await open('kb-log-home', {}, 'Обзор');
    fireEvent.click(within(tree()).getByRole('button', { name: 'Создать страницу' }));
    const dlg = await screen.findByRole('dialog', { name: 'Создать в «Логистика»' }, SLOW);
    expect(dlg.textContent).toContain('Подстраница получит доступ родителя');
    expect(dlg.textContent).toContain(
      'На верхнем уровне доступ — как у пространства: все в области читают, пишут участники.',
    );
    fireEvent.click(within(dlg).getByRole('button', { name: /Схема/ }));
    fireEvent.change(within(dlg).getByLabelText('Название'), { target: { value: 'Ночная смена' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(toast()).toBe('Создано'), SLOW);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Опубликовать v2' })).toBeTruthy(),
      SLOW,
    );
    expect(
      (screen.getByLabelText('Шаги схемы — по одному в строке') as HTMLTextAreaElement).value,
    ).toBe('Начало\nШаг\nГотово');
    expect(rowTitles()).toContain('Ночная смена');
  });

  it('«Переместить…»: выбор родителя, кто потеряет доступ, «Страница перенесена»', async () => {
    const a = await open('kb-2', {}, 'Как фотографировать машину при осмотре');
    await menu('Переместить…');
    const dlg = await screen.findByRole('dialog', {
      name: 'Переместить «Как фотографировать машину при осмотре»',
    });
    expect(dlg.textContent).toContain(
      'Выберите нового родителя — здесь появится, кто получит или потеряет доступ.',
    );
    const ok = within(dlg).getByRole('button', { name: 'Переместить' }) as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    const sel = within(dlg).getByLabelText('Новый родитель') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toContain('Тарифы и начисления');
    fireEvent.change(sel, { target: { value: A('kb-fin') } });
    await waitFor(
      () => expect(dlg.textContent).toContain('Переносится 1 страница вместе с подстраницами.'),
      SLOW,
    );
    expect(dlg.textContent).toContain('Потеряют чтение (страниц): Илья Васильев · 1');
    fireEvent.click(ok);
    await waitFor(() => expect(toast()).toBe('Страница перенесена'), SLOW);
    expect(pageOf(a)).toBe(A('kb-2'));
    await waitFor(() => {
      const path = screen.getByRole('navigation', { name: 'Путь' });
      expect(
        within(path)
          .getAllByRole('button')
          .map((b) => b.textContent),
      ).toEqual(['Логистика', 'Тарифы и начисления', 'Как фотографировать машину при осмотре']);
    }, SLOW);
  });

  it('«Утвердить», «В архив», вкладка «Архив» и «Восстановить»', async () => {
    const a = await open('kb-6', {}, 'Выезд при критическом дефекте');
    expect(art().textContent).toContain('На проверке · v1');
    await menu('Утвердить');
    await waitFor(() => expect(toast()).toBe('Страница утверждена'), SLOW);
    await waitFor(() => expect(art().textContent).toContain('Действует · v1'), SLOW);
    await menu('В архив');
    await waitFor(() => expect(toast()).toBe('Перенесено в архив'), SLOW);
    await waitFor(() => expect(pageOf(a)).toBe(A('kb-f-reg')), SLOW);
    await waitFor(() => expect(rowTitles()).not.toContain('Выезд при критическом дефекте'), SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Архив' }));
    const row = await waitFor(() => {
      const r = document.querySelector<HTMLElement>('.ox-kb-arch-row');
      expect(r).toBeTruthy();
      return r as HTMLElement;
    }, SLOW);
    expect(document.querySelector('.ox-kb-arch')?.textContent).toContain(
      'Страницы в архиве не видны в дереве и поиске. Восстановление возвращает ветку на прежнее место.',
    );
    expect(row.textContent).toContain('Выезд при критическом дефекте');
    expect(row.textContent).toContain('1 страница в ветке');
    fireEvent.click(within(row).getByRole('button', { name: 'Восстановить' }));
    await waitFor(() => expect(toast()).toBe('Восстановлено'), SLOW);
    await screen.findByText('В архиве ничего нет', {}, SLOW);
  });

  it('у главной страницы нет «Переместить…» и «В архив»', async () => {
    await open('kb-log-home', {}, 'Обзор');
    fireEvent.click(screen.getByRole('button', { name: 'Действия со страницей' }));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'note_addНовая подстраница',
    ]);
  });
});

describe('«Страницы»: ознакомление и запрос права правки', () => {
  it('водитель: «Ознакомлен» → «Спасибо, отметили»; «Запросить право правки» → «Запрос отправлен»', async () => {
    await open('kb-1', { persona: 'driver' }, 'Регламент приёмки смены');
    // Аудитория — текст сервера audienceLabel (Q-W4.32-12; эталон М:527 — KB.entryLabel).
    expect(art().textContent).toContain('Ознакомление с версией 2 · роль «Водитель»');
    expect(art().textContent).toContain('Подтвердите, что прочитали эту версию.');
    fireEvent.click(within(art()).getByRole('button', { name: 'Ознакомлен' }));
    await waitFor(() => expect(toast()).toBe('Спасибо, отметили'), SLOW);
    await waitFor(
      () => expect(art().textContent).toContain('Вы подтвердили, что ознакомились с этой версией'),
      SLOW,
    );
    expect(aside().textContent).toContain('Вы можете читать.');
    fireEvent.click(screen.getByRole('button', { name: 'Запросить право правки' }));
    await waitFor(() => expect(toast()).toBe('Запрос отправлен руководителю пространства'), SLOW);
    const sent = await screen.findByRole('button', { name: 'Запрос отправлен' }, SLOW);
    expect((sent as HTMLButtonElement).disabled).toBe(true);
  });

  it('руководитель: статистика ознакомления «0 из 1 ознакомились. Ждём: Илья Васильев»', async () => {
    await open('kb-1', {}, 'Регламент приёмки смены');
    expect(art().textContent).toContain('0 из 1 ознакомились. Ждём: Илья Васильев');
    expect(within(art()).queryByRole('button', { name: 'Ознакомлен' })).toBeNull();
  });

  it('нет связи: тост «Нет связи…», повтор с тем же Idempotency-Key', async () => {
    const seen: string[] = [];
    await open(
      'kb-1',
      {
        persona: 'driver',
        setup: () => {
          const through = globalThis.fetch;
          let fail = true;
          vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const req = new Request(input, init);
            if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/ack')) {
              seen.push(req.headers.get('Idempotency-Key') ?? '');
              if (fail) {
                fail = false;
                throw new TypeError('Failed to fetch');
              }
            }
            return through(req);
          });
        },
      },
      'Регламент приёмки смены',
    );
    fireEvent.click(within(art()).getByRole('button', { name: 'Ознакомлен' }));
    await waitFor(() => expect(toast()).toBe(OFFLINE), SLOW);
    fireEvent.click(within(art()).getByRole('button', { name: 'Ознакомлен' }));
    await waitFor(() => expect(toast()).toBe('Спасибо, отметили'), SLOW);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it('недоступная страница по ссылке — баннер «Страница не найдена или недоступна» и главная', async () => {
    const a = await open('kb-fin', { persona: 'driver' });
    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(alert.textContent).toContain('Страница не найдена или недоступна');
    await waitFor(() => expect(pageTitle()).toBe('Обзор'), SLOW);
    expect(pageOf(a)).toBeUndefined();
  });
});
