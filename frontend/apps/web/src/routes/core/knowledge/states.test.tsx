// W4.32 · Возврат 1: состояния загрузки и ошибки вкладок «Автоматизация», «Архив», «Участники и доступ» и поиска
// по базе знаний (verification-protocol §1.3, бриф §1.8), ошибки команд «Автоматизации» (баннер и тост), гонка
// «В архив» и вкладки «Архив», вкладка не руководителя в адресе, доступность диалогов (имена значков и цветов,
// ловушка фокуса, объявление ошибки, уровень заголовка). Возврат 2: шаблоны и области «Нового пространства»,
// кандидаты «Добавить в пространство», загрузка «Почему так», ключ «Проверить сроки сейчас» после «нет связи»,
// пустой результат поиска в дереве без role=tree, переключатели правил (описание, фокус во время команды), баннер
// ошибки команды в видимой области. Возврат 3: загрузка и ошибка страницы (getKnowledgeNode) в широком и узком видах,
// старой версии, диалога «Доступ · …» (доступ узла, кандидаты, «Что изменится»), поиска в дереве, областей «Нового
// пространства», фокус после «Восстановить» в «Архиве». Сеть — сценарный сервер W4.04.
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const A = (id: string) => seedUuid('t-alta', id);
const SLOW = { timeout: 8_000 };
const BASE = `/t/${ALTA}/knowledge`;
const RATE = 'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.';

const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

const open = async (
  search: string,
  o: Parameters<typeof renderMockApp>[1] = {},
): Promise<MockApp> => {
  app = await renderMockApp(`${BASE}${search}`, { persona: 'owner', ...o });
  return app;
};
const tabOf = (a: MockApp) =>
  (a.router.state.location.search as Record<string, unknown>).tab as string | undefined;
const pageOf = (a: MockApp) =>
  (a.router.state.location.search as Record<string, unknown>).page as string | undefined;
const toast = () => document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const box = (sel: string) => document.querySelector(sel) as HTMLElement;
const pageTitle = () => document.querySelector('article.ox-kb-article h2')?.textContent;

describe('«Автоматизация»: загрузка и ошибки', () => {
  it('ошибка правил и журнала — текст и «Повторить» в каждом блоке; повтор показывает данные', async () => {
    const a = await open(`?space=${A('sp-log')}&tab=auto`, {
      scenario: 'listKnowledgeRules=rate_limited,listKnowledgeRuns=rate_limited',
    });
    await waitFor(() => {
      expect(within(box('.ox-kb-auto-rules')).getByRole('alert').textContent).toBe(RATE);
      expect(within(box('.ox-kb-runs')).getByRole('alert').textContent).toBe(RATE);
    }, SLOW);
    // Подвал правил — только при загруженных правилах.
    expect(box('.ox-kb-auto-foot')).toBeNull();
    a.scenario.setScenario(null);
    fireEvent.click(within(box('.ox-kb-auto-rules')).getByRole('button', { name: 'Повторить' }));
    fireEvent.click(within(box('.ox-kb-runs')).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(document.querySelectorAll('.ox-kb-rule')).toHaveLength(2), SLOW);
    await waitFor(() => expect(box('.ox-kb-runs').textContent).toContain('24.09 18:10'), SLOW);
    expect(box('.ox-kb-auto-foot')).toBeTruthy();
  });

  it('загрузка правил и журнала — «Загрузка» (role=status) в каждом блоке', async () => {
    await open(`?space=${A('sp-log')}&tab=auto`, {
      scenario: 'listKnowledgeRules=loading,listKnowledgeRuns=loading',
    });
    await waitFor(() => {
      expect(
        within(box('.ox-kb-auto-rules')).getByRole('status', { name: 'Загрузка' }),
      ).toBeTruthy();
      expect(within(box('.ox-kb-runs')).getByRole('status', { name: 'Загрузка' })).toBeTruthy();
    }, SLOW);
    expect(box('.ox-kb-auto-foot')).toBeNull();
  });

  it('ошибки команд: 403 — баннер текстом сервера, 429 — тост; правило не меняется', async () => {
    const a = await open(`?space=${A('sp-log')}&tab=auto`);
    await waitFor(() => expect(document.querySelectorAll('.ox-kb-rule')).toHaveLength(2), SLOW);
    const sw = () => screen.getAllByRole('switch', { name: 'Правило включено' })[0] as HTMLElement;
    a.scenario.setScenario('setKnowledgeRuleEnabled=forbidden_action');
    fireEvent.click(sw());
    const alert = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.ox-kb-err[role="alert"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    }, SLOW);
    expect(alert.querySelector('.ox-kb-err-text')?.textContent).not.toBe('');
    expect(sw().getAttribute('aria-checked')).toBe('true');
    a.scenario.setScenario('runKnowledgeReviewCheck=rate_limited');
    fireEvent.click(screen.getByRole('button', { name: 'Проверить сроки сейчас' }));
    await waitFor(
      () => expect(toast()).toBe('Слишком много запросов. Подождите и повторите.'),
      SLOW,
    );
  });
});

describe('«Архив»: загрузка, ошибка, гонка с «В архив»', () => {
  it('ошибка списка — текст и «Повторить»; повтор — «В архиве ничего нет»', async () => {
    const a = await open(`?space=${A('sp-log')}&tab=arch`, {
      scenario: 'listKnowledgeArchive=rate_limited',
    });
    const alert = await waitFor(() => within(box('.ox-kb-arch')).getByRole('alert'), SLOW);
    expect(alert.textContent).toBe(RATE);
    a.scenario.setScenario(null);
    fireEvent.click(within(box('.ox-kb-arch')).getByRole('button', { name: 'Повторить' }));
    await screen.findByText('В архиве ничего нет', {}, SLOW);
  });

  it('загрузка списка — «Загрузка» (role=status)', async () => {
    await open(`?space=${A('sp-log')}&tab=arch`, { scenario: 'listKnowledgeArchive=loading' });
    await waitFor(
      () =>
        expect(within(box('.ox-kb-arch')).getByRole('status', { name: 'Загрузка' })).toBeTruthy(),
      SLOW,
    );
  });

  it('«В архив», затем сразу вкладка «Архив» — после ответа вкладка остаётся «Архив»', async () => {
    const a = await open(`?space=${A('sp-log')}&page=${A('kb-6')}`);
    await waitFor(() => expect(pageTitle()).toBe('Выезд при критическом дефекте'), SLOW);
    a.scenario.setScenario('archiveKnowledgeNode=delay=600');
    fireEvent.click(screen.getByRole('button', { name: 'Действия со страницей' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'В архив' }));
    fireEvent.click(screen.getByRole('button', { name: 'Архив' }));
    await waitFor(() => expect(tabOf(a)).toBe('arch'), SLOW);
    await waitFor(() => expect(toast()).toBe('Перенесено в архив'), SLOW);
    await waitFor(
      () => expect(box('.ox-kb-arch').textContent).toContain('Выезд при критическом дефекте'),
      SLOW,
    );
    await new Promise((r) => setTimeout(r, 400));
    expect(tabOf(a)).toBe('arch');
    expect(box('.ox-kb-arch')).toBeTruthy();
    expect(pageOf(a)).toBe(A('kb-f-reg'));
  });

  it('«В архив», затем другая страница — после ответа выбор не перезаписывается', async () => {
    const a = await open(`?space=${A('sp-log')}&page=${A('kb-6')}`);
    await waitFor(() => expect(pageTitle()).toBe('Выезд при критическом дефекте'), SLOW);
    a.scenario.setScenario('archiveKnowledgeNode=delay=600');
    fireEvent.click(screen.getByRole('button', { name: 'Действия со страницей' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'В архив' }));
    const tree = screen.getByRole('navigation', { name: 'Дерево пространства' });
    fireEvent.click(within(tree).getByText('Журнал осмотров машин'));
    await waitFor(() => expect(pageOf(a)).toBe(A('kb-5')), SLOW);
    await waitFor(() => expect(toast()).toBe('Перенесено в архив'), SLOW);
    await new Promise((r) => setTimeout(r, 400));
    expect(pageOf(a)).toBe(A('kb-5'));
  });
});

describe('«Участники и доступ»: загрузка и ошибки', () => {
  it('ошибка участников — текст и «Повторить»; повтор — карточки ролей', async () => {
    const a = await open(`?space=${A('sp-log')}&tab=people`, {
      scenario: 'listKnowledgeSpaceMembers=rate_limited',
    });
    const alert = await waitFor(() => within(box('.ox-kb-people')).getAllByRole('alert')[0], SLOW);
    expect(alert?.textContent).toBe(RATE);
    a.scenario.setScenario(null);
    fireEvent.click(
      within(box('.ox-kb-people')).getAllByRole('button', { name: 'Повторить' })[0] as HTMLElement,
    );
    await waitFor(() => expect(document.querySelectorAll('.ox-kb-role')).toHaveLength(4), SLOW);
  });

  it('загрузка участников — «Загрузка» (role=status)', async () => {
    await open(`?space=${A('sp-log')}&tab=people`, {
      scenario: 'listKnowledgeSpaceMembers=loading',
    });
    await waitFor(
      () =>
        expect(
          within(box('.ox-kb-people')).getAllByRole('status', { name: 'Загрузка' }).length,
        ).toBeGreaterThan(0),
      SLOW,
    );
  });

  it('ошибка карты доступа — текст и «Повторить»; повтор — карта', async () => {
    const a = await open(`?space=${A('sp-log')}&tab=people`, {
      scenario: 'getKnowledgeAccessMap=rate_limited',
    });
    const wrap = await waitFor(() => {
      const w = document.querySelector<HTMLElement>('.ox-kb-map-wrap');
      expect(w && within(w).getByRole('alert').textContent).toBe(RATE);
      return w as HTMLElement;
    }, SLOW);
    a.scenario.setScenario(null);
    fireEvent.click(within(wrap).getByRole('button', { name: 'Повторить' }));
    await waitFor(
      () => expect(document.querySelectorAll('.ox-kb-map .ox-kb-cell').length).toBeGreaterThan(0),
      SLOW,
    );
  });

  it('загрузка карты доступа — «Загрузка» (role=status)', async () => {
    await open(`?space=${A('sp-log')}&tab=people`, { scenario: 'getKnowledgeAccessMap=loading' });
    await waitFor(() => {
      const w = document.querySelector<HTMLElement>('.ox-kb-map-wrap');
      expect(w && within(w).getByRole('status', { name: 'Загрузка' })).toBeTruthy();
    }, SLOW);
  });

  it('ошибка «Почему так» — текст и «Повторить» в панели; повтор — итог', async () => {
    const a = await open(`?space=${A('sp-log')}&tab=people`, {
      scenario: 'explainKnowledgeAccess=rate_limited',
    });
    const why = await screen.findByRole('complementary', { name: 'Почему так' }, SLOW);
    await waitFor(() => expect(within(why).getByRole('alert').textContent).toBe(RATE), SLOW);
    a.scenario.setScenario(null);
    fireEvent.click(within(why).getByRole('button', { name: 'Повторить' }));
    await waitFor(
      () => expect(why.querySelector('.ox-kb-res')?.textContent).toContain('Читает и правит.'),
      SLOW,
    );
  });
});

describe('Поиск по базе знаний: ошибка', () => {
  it('ошибка поиска — текст и «Повторить» вместо результатов; повтор — результаты', async () => {
    const a = await open('');
    await screen.findByRole('heading', { level: 1, name: 'База знаний' }, SLOW);
    await waitFor(() => expect(document.querySelectorAll('.ox-kb-card').length).toBe(5), SLOW);
    a.scenario.setScenario('searchKnowledge=rate_limited');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по базе знаний' }), {
      target: { value: 'одометр' },
    });
    const hits = await waitFor(() => {
      const h = document.querySelector<HTMLElement>('.ox-kb-hits');
      expect(h && within(h).getByRole('alert').textContent).toBe(RATE);
      return h as HTMLElement;
    }, SLOW);
    a.scenario.setScenario(null);
    fireEvent.click(within(hits).getByRole('button', { name: 'Повторить' }));
    await waitFor(
      () => expect(document.querySelectorAll('.ox-kb-hit').length).toBeGreaterThan(0),
      SLOW,
    );
  });

  it('нет связи при поиске — текст «Нет связи…» вместо пустого места', async () => {
    const a = await open('');
    await waitFor(() => expect(document.querySelectorAll('.ox-kb-card').length).toBe(5), SLOW);
    a.scenario.setScenario('searchKnowledge=offline');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по базе знаний' }), {
      target: { value: 'одометр' },
    });
    await waitFor(() => {
      const h = document.querySelector<HTMLElement>('.ox-kb-hits');
      expect(h && within(h).getByRole('alert').textContent).toContain(
        'Не удалось загрузить данные',
      );
    }, SLOW);
  });
});

describe('Адрес вкладки', () => {
  it('не руководитель по &tab=auto — «Страницы», адрес без tab', async () => {
    const a = await open(`?space=${A('sp-log')}&tab=auto`, { persona: 'driver' });
    await waitFor(() => expect(pageTitle()).toBe('Обзор'), SLOW);
    await waitFor(() => expect(tabOf(a)).toBeUndefined(), SLOW);
    expect(
      within(screen.getByRole('navigation', { name: 'Разделы пространства' }))
        .getByRole('button', { name: 'Страницы' })
        .getAttribute('aria-current'),
    ).toBe('page');
  });
});

describe('Диалоги: доступность', () => {
  const openSpaceDialog = async (): Promise<HTMLElement> => {
    await open('');
    await waitFor(() => expect(document.querySelectorAll('.ox-kb-card').length).toBe(5), SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Новое пространство' }));
    return screen.findByRole('dialog', { name: 'Новое пространство' }, SLOW);
  };

  it('«Новое пространство»: у значков и цветов — разные имена; заголовок диалога — h2', async () => {
    const dlg = await openSpaceDialog();
    const icons = [...dlg.querySelectorAll<HTMLElement>('.ox-kb-look-icon')];
    expect(icons).toHaveLength(8);
    const iconNames = icons.map((b) => b.getAttribute('aria-label') ?? '');
    expect(iconNames.every((n) => n.startsWith('Значок «'))).toBe(true);
    expect(new Set(iconNames).size).toBe(8);
    const colors = [...dlg.querySelectorAll<HTMLElement>('.ox-kb-look-color')];
    const colorNames = colors.map((b) => b.getAttribute('aria-label') ?? '');
    expect(colorNames.every((n) => n.startsWith('Цвет «'))).toBe(true);
    expect(new Set(colorNames).size).toBe(colors.length);
    expect(within(dlg).getByRole('heading', { level: 2, name: 'Новое пространство' })).toBeTruthy();
  });

  it('ловушка фокуса: Tab с последней цели — на первую, Shift+Tab с первой — на последнюю', async () => {
    const dlg = await openSpaceDialog();
    fireEvent.change(within(dlg).getByLabelText('Название'), { target: { value: 'Охрана труда' } });
    const first = within(dlg).getByRole('button', { name: 'Закрыть' });
    const last = within(dlg).getByRole('button', { name: 'Создать пространство' });
    await waitFor(() => expect((last as HTMLButtonElement).disabled).toBe(false));
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('«Название» пространства — не длиннее 120 символов (maxLength контракта)', async () => {
    const dlg = await openSpaceDialog();
    expect((within(dlg).getByLabelText('Название') as HTMLInputElement).maxLength).toBe(120);
  });

  it('ошибка в подвале диалога объявляется (role=alert)', async () => {
    const dlg = await openSpaceDialog();
    app?.scenario.setScenario('createKnowledgeSpace=forbidden_action');
    fireEvent.change(within(dlg).getByLabelText('Название'), { target: { value: 'Охрана труда' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Создать пространство' }));
    await waitFor(() => {
      const err = dlg.querySelector('.ox-kb-dialog-err');
      expect(err?.getAttribute('role')).toBe('alert');
      expect(err?.textContent).not.toBe('');
    }, SLOW);
  });
});

describe('Возврат 2: «Новое пространство» — шаблоны и области', () => {
  const openDlg = async (scenario?: string): Promise<HTMLElement> => {
    await open('', scenario ? { scenario } : {});
    await waitFor(() => expect(document.querySelectorAll('.ox-kb-card').length).toBe(5), SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Новое пространство' }));
    return screen.findByRole('dialog', { name: 'Новое пространство' }, SLOW);
  };
  const alerts = (el: HTMLElement) =>
    within(el)
      .getAllByRole('alert')
      .map((x) => x.textContent);
  const okBtn = (dlg: HTMLElement) =>
    within(dlg).getByRole('button', { name: 'Создать пространство' }) as HTMLButtonElement;

  it('ошибка шаблонов — текст и «Повторить», «Создать пространство» недоступна; повтор — шаблоны', async () => {
    const dlg = await openDlg('listKnowledgeSpaceTemplates=rate_limited');
    fireEvent.change(within(dlg).getByLabelText('Название'), { target: { value: 'Охрана труда' } });
    await waitFor(() => expect(alerts(dlg)).toContain(RATE), SLOW);
    expect(okBtn(dlg).disabled).toBe(true);
    app?.scenario.setScenario(null);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Повторить' }));
    await within(dlg).findByRole('button', { name: /Регламенты подразделения/ }, SLOW);
    await waitFor(() => expect(okBtn(dlg).disabled).toBe(false), SLOW);
  });

  it('загрузка шаблонов — «Загрузка» (role=status), «Создать пространство» недоступна', async () => {
    const dlg = await openDlg('listKnowledgeSpaceTemplates=loading');
    fireEvent.change(within(dlg).getByLabelText('Название'), { target: { value: 'Охрана труда' } });
    await waitFor(
      () => expect(within(dlg).getByRole('status', { name: 'Загрузка' })).toBeTruthy(),
      SLOW,
    );
    expect(okBtn(dlg).disabled).toBe(true);
  });

  it('ошибка областей — текст и «Повторить» у «Область — чьи роли действуют»', async () => {
    const dlg = await openDlg('listOrgUnits=rate_limited');
    await waitFor(() => expect(alerts(dlg)).toContain(RATE), SLOW);
    expect(within(dlg).getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });
});

describe('Возврат 2: «Участники и доступ» — кандидаты и «Почему так»', () => {
  const add = () => box('.ox-kb-add');

  it('ошибка кандидатов — текст и «Повторить» в «Добавить в пространство»; повтор — сотрудники', async () => {
    const a = await open(`?space=${A('sp-log')}&tab=people`, {
      scenario: 'listKnowledgeAccessCandidates=rate_limited',
    });
    await waitFor(() => expect(within(add()).getByRole('alert').textContent).toBe(RATE), SLOW);
    a.scenario.setScenario(null);
    fireEvent.click(within(add()).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => {
      const who = within(add()).getByRole('combobox', { name: 'Сотрудник' });
      expect(who.querySelectorAll('option').length).toBeGreaterThan(1);
    }, SLOW);
  });

  it('загрузка кандидатов — «Загрузка» (role=status) в «Добавить в пространство»', async () => {
    await open(`?space=${A('sp-log')}&tab=people`, {
      scenario: 'listKnowledgeAccessCandidates=loading',
    });
    await waitFor(
      () => expect(within(add()).getByRole('status', { name: 'Загрузка' })).toBeTruthy(),
      SLOW,
    );
  });

  it('загрузка «Почему так» — «Загрузка» (role=status), не «Выберите ячейку карты»', async () => {
    await open(`?space=${A('sp-log')}&tab=people`, { scenario: 'explainKnowledgeAccess=loading' });
    const why = await screen.findByRole('complementary', { name: 'Почему так' }, SLOW);
    await waitFor(
      () => expect(within(why).getByRole('status', { name: 'Загрузка' })).toBeTruthy(),
      SLOW,
    );
    expect(why.querySelector('.ox-kb-res')).toBeNull();
  });
});

describe('Возврат 2: «Автоматизация» — ключ, переключатели, баннер', () => {
  it('«Проверить сроки сейчас»: повтор после «нет связи» — тот же Idempotency-Key', async () => {
    const seen: string[] = [];
    await open(`?space=${A('sp-log')}&tab=auto`, {
      setup: () => {
        const through = globalThis.fetch;
        let fail = true;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
          const req = new Request(input, init);
          if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/review-check')) {
            seen.push(req.headers.get('Idempotency-Key') ?? '');
            if (fail) {
              fail = false;
              throw new TypeError('Failed to fetch');
            }
          }
          return through(req);
        });
      },
    });
    const check = await screen.findByRole('button', { name: 'Проверить сроки сейчас' }, SLOW);
    fireEvent.click(check);
    await waitFor(() => expect(toast()).toBe(OFFLINE), SLOW);
    await waitFor(() => expect(check.getAttribute('aria-disabled')).not.toBe('true'), SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Проверить сроки сейчас' }));
    await waitFor(() => expect(toast()).toBe('Проверка выполнена'), SLOW);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it('переключатели правил описаны названием своего правила (aria-describedby)', async () => {
    await open(`?space=${A('sp-log')}&tab=auto`);
    await waitFor(() => expect(document.querySelectorAll('.ox-kb-rule')).toHaveLength(2), SLOW);
    const desc = screen.getAllByRole('switch', { name: 'Правило включено' }).map((s) => {
      const id = s.getAttribute('aria-describedby') ?? '';
      return id ? document.getElementById(id)?.textContent : undefined;
    });
    expect(desc).toEqual([
      'Новая версия регламента → попросить ознакомиться заново',
      'Пора пересмотреть страницу → уведомить владельца',
    ]);
  });

  it('во время команды переключатель остаётся в фокусе (aria-disabled, не disabled)', async () => {
    const a = await open(`?space=${A('sp-log')}&tab=auto`);
    await waitFor(() => expect(document.querySelectorAll('.ox-kb-rule')).toHaveLength(2), SLOW);
    const sw = screen.getAllByRole('switch', { name: 'Правило включено' })[0] as HTMLButtonElement;
    a.scenario.setScenario('setKnowledgeRuleEnabled=delay=600');
    sw.focus();
    fireEvent.click(sw);
    await waitFor(() => expect(sw.getAttribute('aria-disabled')).toBe('true'), SLOW);
    expect(sw.disabled).toBe(false);
    expect(document.activeElement).toBe(sw);
    // Повторное нажатие во время команды ничего не отправляет.
    fireEvent.click(sw);
    await waitFor(() => expect(toast()).toBe('Правило выключено'), SLOW);
    await waitFor(() => expect(sw.getAttribute('aria-disabled')).not.toBe('true'), SLOW);
    expect(sw.getAttribute('aria-checked')).toBe('false');
  });

  it('баннер ошибки команды прокручивается в видимую область', async () => {
    const spy = vi.fn();
    const had = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    Element.prototype.scrollIntoView = spy;
    try {
      const a = await open(`?space=${A('sp-log')}&tab=auto`);
      await waitFor(() => expect(document.querySelectorAll('.ox-kb-rule')).toHaveLength(2), SLOW);
      a.scenario.setScenario('setKnowledgeRuleEnabled=forbidden_action');
      fireEvent.click(
        screen.getAllByRole('switch', { name: 'Правило включено' })[0] as HTMLElement,
      );
      const el = await waitFor(() => {
        const b = document.querySelector('.ox-kb-err[role="alert"]');
        expect(b).toBeTruthy();
        return b;
      }, SLOW);
      await waitFor(() => expect(spy.mock.contexts).toContain(el), SLOW);
    } finally {
      if (had) Object.defineProperty(Element.prototype, 'scrollIntoView', had);
      else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});

describe('Возврат 2: поиск в дереве', () => {
  it('пустой результат — текст «Ничего не нашлось…» вне role=tree (tree без treeitem — axe critical)', async () => {
    await open(`?space=${A('sp-log')}`);
    await waitFor(() => expect(pageTitle()).toBe('Обзор'), SLOW);
    const nav = screen.getByRole('navigation', { name: 'Дерево пространства' });
    expect(within(nav).getByRole('tree')).toBeTruthy();
    fireEvent.change(within(nav).getByRole('searchbox', { name: 'Найти в пространстве' }), {
      target: { value: 'ничего такого' },
    });
    await waitFor(
      () => expect(nav.textContent).toContain('Ничего не нашлось среди доступных страниц'),
      SLOW,
    );
    expect(within(nav).queryByRole('tree')).toBeNull();
  });
});

/** Узкий вид (< 860 px): ResizeObserver отдаёт ширину контейнера 500 px после монтирования. */
function narrowView(): void {
  class NarrowObserver {
    private readonly cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(): void {
      setTimeout(
        () =>
          this.cb(
            [{ contentRect: { width: 500 } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          ),
        0,
      );
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', NarrowObserver);
}

describe('Возврат 3: страница — загрузка и ошибка getKnowledgeNode', () => {
  afterEach(() => vi.unstubAllGlobals());
  const pages = () => box('.ox-kb-pages');
  const tree = () => screen.queryByRole('navigation', { name: 'Дерево пространства' });

  it('ошибка страницы — текст и «Повторить» справа от дерева; повтор — страница', async () => {
    const a = await open(`?space=${A('sp-log')}&page=${A('kb-fin')}`, {
      scenario: 'getKnowledgeNode=rate_limited',
    });
    const col = await waitFor(() => {
      const c = pages()?.querySelector<HTMLElement>('.ox-kb-pagecol');
      expect(c && within(c).getByRole('alert').textContent).toBe(RATE);
      return c as HTMLElement;
    }, SLOW);
    expect(tree()).toBeTruthy();
    a.scenario.setScenario(null);
    fireEvent.click(within(col).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(pageTitle()).toBe('Тарифы и начисления'), SLOW);
    expect(within(pages()).queryByRole('alert')).toBeNull();
  });

  it('загрузка страницы — «Загрузка» (role=status) справа от дерева', async () => {
    await open(`?space=${A('sp-log')}&page=${A('kb-fin')}`, {
      scenario: 'getKnowledgeNode=loading',
    });
    await waitFor(() => {
      const c = pages()?.querySelector<HTMLElement>('.ox-kb-pagecol');
      expect(c && within(c).getByRole('status', { name: 'Загрузка' })).toBeTruthy();
    }, SLOW);
    expect(tree()).toBeTruthy();
  });

  it('узкий вид: ошибка — страница с «Дерево», текстом и «Повторить»; нажатие на узел показывает ошибку, а не дерево', async () => {
    narrowView();
    const a = await open(`?space=${A('sp-log')}&page=${A('kb-fin')}`, {
      scenario: 'getKnowledgeNode=rate_limited',
    });
    await waitFor(() => expect(pages().hasAttribute('data-narrow')).toBe(true), SLOW);
    await waitFor(() => expect(within(pages()).getByRole('alert').textContent).toBe(RATE), SLOW);
    expect(tree()).toBeNull();
    fireEvent.click(within(pages()).getByRole('button', { name: 'Дерево' }));
    const nav = await waitFor(() => {
      const t = tree();
      expect(t).toBeTruthy();
      return t as HTMLElement;
    }, SLOW);
    fireEvent.click(within(nav).getByText('Журнал осмотров машин'));
    await waitFor(() => expect(pageOf(a)).toBe(A('kb-5')), SLOW);
    await waitFor(() => expect(within(pages()).getByRole('alert').textContent).toBe(RATE), SLOW);
    expect(tree()).toBeNull();
    a.scenario.setScenario(null);
    fireEvent.click(within(pages()).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(pageTitle()).toBe('Журнал осмотров машин'), SLOW);
  });

  it('узкий вид: загрузка — «Загрузка» (role=status) вместо дерева', async () => {
    narrowView();
    await open(`?space=${A('sp-log')}&page=${A('kb-fin')}`, {
      scenario: 'getKnowledgeNode=loading',
    });
    await waitFor(() => expect(pages().hasAttribute('data-narrow')).toBe(true), SLOW);
    await waitFor(
      () => expect(within(pages()).getByRole('status', { name: 'Загрузка' })).toBeTruthy(),
      SLOW,
    );
    expect(tree()).toBeNull();
  });
});

describe('Возврат 3: старая версия — загрузка и ошибка getKnowledgeNodeVersion', () => {
  const art = () => box('article.ox-kb-article');
  const ver = (i: number) =>
    box('aside.ox-kb-aside').querySelectorAll<HTMLElement>('.ox-kb-ver')[i] as HTMLElement;

  it('ошибка версии — текст и «Повторить» в просмотре, v1 выбрана; повтор — старая версия', async () => {
    const a = await open(`?space=${A('sp-log')}&page=${A('kb-1')}`);
    await waitFor(() => expect(pageTitle()).toBe('Регламент приёмки смены'), SLOW);
    a.scenario.setScenario('getKnowledgeNodeVersion=rate_limited');
    fireEvent.click(ver(1));
    await waitFor(() => expect(within(art()).getByRole('alert').textContent).toBe(RATE), SLOW);
    expect(ver(1).getAttribute('aria-pressed')).toBe('true');
    expect(ver(0).getAttribute('aria-pressed')).toBe('false');
    a.scenario.setScenario(null);
    fireEvent.click(within(art()).getByRole('button', { name: 'Повторить' }));
    await waitFor(
      () =>
        expect(art().textContent).toContain('Вы смотрите версию 1 от 05.09.2026. Текущая — v2.'),
      SLOW,
    );
    expect(within(art()).queryByRole('alert')).toBeNull();
  });

  it('загрузка версии — «Загрузка» (role=status) в просмотре', async () => {
    const a = await open(`?space=${A('sp-log')}&page=${A('kb-1')}`);
    await waitFor(() => expect(pageTitle()).toBe('Регламент приёмки смены'), SLOW);
    a.scenario.setScenario('getKnowledgeNodeVersion=loading');
    fireEvent.click(ver(1));
    await waitFor(
      () => expect(within(art()).getByRole('status', { name: 'Загрузка' })).toBeTruthy(),
      SLOW,
    );
  });
});

describe('Возврат 3: «Доступ · …» — загрузка и ошибки', () => {
  const NAME = 'Доступ · Тарифы и начисления';
  const openPage = async (): Promise<MockApp> => {
    const a = await open(`?space=${A('sp-log')}&page=${A('kb-fin')}`);
    await waitFor(() => expect(pageTitle()).toBe('Тарифы и начисления'), SLOW);
    return a;
  };
  const clickAccess = () =>
    fireEvent.click(screen.getAllByRole('button', { name: 'Доступ' })[0] as HTMLElement);
  const alerts = (el: HTMLElement) =>
    within(el)
      .queryAllByRole('alert')
      .map((x) => x.textContent);

  /** Диалог открывается сразу с «Загрузка» — ждём загруженный доступ узла (цепочку). */
  const loaded = () =>
    waitFor(() => {
      const d = screen.getByRole('dialog', { name: NAME });
      expect(d.querySelector('.ox-kb-chain-row')).toBeTruthy();
      return d;
    }, SLOW);
  it('ошибка доступа узла — диалог с текстом и «Повторить»; повтор — записи', async () => {
    const a = await openPage();
    a.scenario.setScenario('getKnowledgeNodeAccess=rate_limited');
    clickAccess();
    const dlg = await screen.findByRole('dialog', { name: NAME }, SLOW);
    await waitFor(() => expect(alerts(dlg)).toContain(RATE), SLOW);
    expect(within(dlg).getAllByRole('button', { name: 'Закрыть' }).length).toBeGreaterThan(0);
    a.scenario.setScenario(null);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => {
      const d = screen.getByRole('dialog', { name: NAME });
      expect(d.textContent).toContain('Марина Котова');
      expect(alerts(d)).not.toContain(RATE);
    }, SLOW);
  });

  it('загрузка доступа узла — диалог с «Загрузка» (role=status); Escape закрывает', async () => {
    const a = await openPage();
    a.scenario.setScenario('getKnowledgeNodeAccess=loading');
    clickAccess();
    const dlg = await screen.findByRole('dialog', { name: NAME }, SLOW);
    expect(within(dlg).getByRole('status', { name: 'Загрузка' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW);
  });

  it('ошибка кандидатов — текст и «Повторить» у «Кого добавить»; повтор — варианты', async () => {
    const a = await openPage();
    a.scenario.setScenario('listKnowledgeAccessCandidates=rate_limited');
    clickAccess();
    const dlg = await loaded();
    await waitFor(() => expect(alerts(dlg)).toContain(RATE), SLOW);
    a.scenario.setScenario(null);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => {
      const who = within(dlg).getByRole('combobox', { name: 'Кого добавить' });
      expect(who.querySelectorAll('option').length).toBeGreaterThan(1);
    }, SLOW);
    expect(alerts(dlg)).not.toContain(RATE);
  });

  it('загрузка кандидатов — «Загрузка» (role=status) у «Кого добавить»', async () => {
    const a = await openPage();
    a.scenario.setScenario('listKnowledgeAccessCandidates=loading');
    clickAccess();
    const dlg = await loaded();
    await waitFor(
      () => expect(within(dlg).getByRole('status', { name: 'Загрузка' })).toBeTruthy(),
      SLOW,
    );
  });

  it('ошибка «Что изменится» (dryRun) — текст и «Повторить» в панели; повтор — строки влияния', async () => {
    const a = await openPage();
    clickAccess();
    const dlg = await loaded();
    await within(dlg).findByRole('combobox', { name: 'Кого добавить' }, SLOW);
    a.scenario.setScenario('setKnowledgeNodeAccess=rate_limited');
    fireEvent.click(within(dlg).getByRole('button', { name: /Как у пространства/ }));
    const side = () => dlg.querySelector('.ox-kb-acc-side') as HTMLElement;
    await waitFor(() => expect(alerts(side())).toContain(RATE), SLOW);
    a.scenario.setScenario(null);
    fireEvent.click(within(side()).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => {
      expect(alerts(side())).not.toContain(RATE);
      expect(side().querySelectorAll('.ox-kb-impact').length).toBeGreaterThan(0);
    }, SLOW);
  });

  it('загрузка «Что изменится» — «Загрузка» (role=status) в панели', async () => {
    const a = await openPage();
    clickAccess();
    const dlg = await loaded();
    await within(dlg).findByRole('combobox', { name: 'Кого добавить' }, SLOW);
    a.scenario.setScenario('setKnowledgeNodeAccess=loading');
    fireEvent.click(within(dlg).getByRole('button', { name: /Как у пространства/ }));
    const side = dlg.querySelector('.ox-kb-acc-side') as HTMLElement;
    await waitFor(
      () => expect(within(side).getByRole('status', { name: 'Загрузка' })).toBeTruthy(),
      SLOW,
    );
  });
});

describe('Возврат 3: поиск в дереве, области, «Архив»', () => {
  it('ошибка поиска «Найти в пространстве» — текст, «Повторить» и пометка о совпадениях по названию', async () => {
    const a = await open(`?space=${A('sp-log')}`);
    await waitFor(() => expect(pageTitle()).toBe('Обзор'), SLOW);
    a.scenario.setScenario('searchKnowledge=rate_limited');
    const nav = screen.getByRole('navigation', { name: 'Дерево пространства' });
    fireEvent.change(within(nav).getByRole('searchbox', { name: 'Найти в пространстве' }), {
      target: { value: 'одометр' },
    });
    await waitFor(() => expect(within(nav).getByRole('alert').textContent).toBe(RATE), SLOW);
    expect(nav.textContent).toContain('Показаны только совпадения по названию.');
    a.scenario.setScenario(null);
    fireEvent.click(within(nav).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(within(nav).queryByRole('alert')).toBeNull(), SLOW);
    expect(nav.textContent).not.toContain('Показаны только совпадения по названию.');
  });

  it('«Новое пространство»: загрузка областей — «Загрузка» (role=status) у «Область»', async () => {
    await open('', { scenario: 'listOrgUnits=loading' });
    await waitFor(() => expect(document.querySelectorAll('.ox-kb-card').length).toBe(5), SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Новое пространство' }));
    const dlg = await screen.findByRole('dialog', { name: 'Новое пространство' }, SLOW);
    await within(dlg).findByRole('button', { name: /Регламенты подразделения/ }, SLOW);
    expect(within(dlg).getByRole('status', { name: 'Загрузка' })).toBeTruthy();
  });

  it('«Архив»: после «Восстановить» фокус остаётся в списке архива, а не на body', async () => {
    const a = await open(`?space=${A('sp-log')}&page=${A('kb-6')}`);
    await waitFor(() => expect(pageTitle()).toBe('Выезд при критическом дефекте'), SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Действия со страницей' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'В архив' }));
    await waitFor(() => expect(toast()).toBe('Перенесено в архив'), SLOW);
    fireEvent.click(screen.getByRole('button', { name: 'Архив' }));
    await waitFor(() => expect(tabOf(a)).toBe('arch'), SLOW);
    const restore = await within(box('.ox-kb-arch')).findByRole(
      'button',
      { name: 'Восстановить' },
      SLOW,
    );
    restore.focus();
    fireEvent.click(restore);
    await waitFor(() => expect(toast()).toBe('Восстановлено'), SLOW);
    await waitFor(
      () => expect(box('.ox-kb-arch').textContent).toContain('В архиве ничего нет'),
      SLOW,
    );
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
      expect(box('.ox-kb-arch').contains(document.activeElement)).toBe(true);
    }, SLOW);
  });
});
