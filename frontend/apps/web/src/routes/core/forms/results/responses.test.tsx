// W4.23 · Экранные тесты «Ответов» (dc:411–439) и «Версий» (dc:440–454) формы «Осмотр машины» «Альты»: сводка, лента
// с журналом действий и «Повторить», таблица, CSV, проверка ответа (no-reference, Q-W4.00-forms-18), версии и отличия.
// Сеть — сценарный сервер W4.05.
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, renderMockApp } from '../../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const A = (id: string) => seedUuid('t-alta', id);
const INSP = A('fm-insp');
const FOREMAN = A('fm-foreman');
const SLOW = { timeout: 8_000 };

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (
  form: string,
  tab: string,
  o: { persona?: string; extra?: string; scenario?: string } = {},
): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/forms?form=${form}&tab=${tab}${o.extra ?? ''}`, {
    persona: o.persona ?? 'owner',
    preset: 'logistics-ready',
    ...(o.scenario ? { scenario: o.scenario } : {}),
  });
  await screen.findByRole('tablist', { name: 'Разделы формы' }, SLOW);
  return app;
};
const rs = () => document.querySelector<HTMLElement>('.ox-fr-rs') as HTMLElement;
const view = (name: string) =>
  within(screen.getByRole('group', { name: 'Вид ответов' })).getByRole('button', { name });
const card = () => document.querySelector<HTMLElement>('.ox-fr-resp') as HTMLElement;
const journal = () => document.querySelector<HTMLElement>('.ox-fr-journal') as HTMLElement;
const feedRows = () => [...document.querySelectorAll<HTMLElement>('.ox-fr-feed > button')];
const sp = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ');

describe('«Ответы»', () => {
  it('«Сводка»: «2 ответа», карточки вопросов всех версий — полосы, среднее, тексты', async () => {
    await open(INSP, 'responses');
    await waitFor(() => expect(document.querySelectorAll('.ox-fr-stat').length).toBe(8), SLOW);
    expect(view('Сводка').getAttribute('aria-pressed')).toBe('true');
    expect(rs().textContent).toContain('2 ответа');
    const stats = [...document.querySelectorAll<HTMLElement>('.ox-fr-stat')];
    expect(stats.map((s) => s.querySelector('strong')?.textContent)).toEqual([
      'Фото: спереди, сзади, слева, справа, одометр',
      'Пробег по одометру, км',
      'Уровень топлива',
      'Чек-лист: кузов, шины, документы',
      'Есть дефекты?',
      'Описание дефекта',
      'Дефект критический',
      'Уровень топлива',
    ]);
    expect(stats[1]?.textContent).toContain('Число · ответили 2 из 2');
    expect(sp(stats[1]?.querySelector('.ox-fr-stat-num')?.textContent)).toBe(
      'Среднее 84 056 · мин 83 902 · макс 84 210',
    );
    expect(
      [...(stats[2]?.querySelectorAll('.ox-fr-bar-head') ?? [])].map((b) => b.textContent),
    ).toEqual(['¼0 · 0%', '½0 · 0%', '¾1 · 100%', 'Полный0 · 0%']);
    expect(
      [...(stats[4]?.querySelectorAll('.ox-fr-bar-head') ?? [])].map((b) => b.textContent),
    ).toEqual(['да0 · 0%', 'нет1 · 100%']);
    expect(stats[5]?.textContent).toContain('Пока без ответов');
    expect(stats[7]?.textContent).toContain('почти полный');
  });

  it('«Лента»: R-1012 первым и выбран; строки по версии; журнал; R-0988 — «(действует v3)»', async () => {
    await open(INSP, 'responses');
    fireEvent.click(await screen.findByRole('button', { name: 'Лента' }, SLOW));
    await waitFor(() => expect(feedRows()).toHaveLength(2), SLOW);
    expect(feedRows()[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(feedRows()[0]?.textContent).toBe('R-1012 · Рейс Р-196Илья Васильев · 27.09 09:05v3');
    expect(card().querySelector('h3')?.textContent).toBe('R-1012 · Рейс Р-196');
    expect(card().querySelector('.ox-fr-resp-status')?.textContent).toBe('Принят');
    expect(card().textContent).toContain(
      'Илья Васильев · 27.09 09:05 · показан по структуре версии v3',
    );
    const rows = [...card().querySelectorAll('.ox-fr-resp-row')].map((r) => sp(r.textContent));
    expect(rows).toEqual([
      'Фото: спереди, сзади, слева, справа, одометр5 фото',
      'Пробег по одометру, км84 210',
      'Уровень топлива¾',
      'Чек-лист: кузов, шины, документыкузов, шины, документы',
      'Есть дефекты?нет',
      'Описание дефектаНе показывался по условию',
      'Дефект критическийНе показывался по условию',
    ]);
    expect(journal().textContent).toContain(
      'Строка в таблице «Осмотры» · страница «Журнал осмотров машин» · 27.09 09:12 · правило v1',
    );
    expect(within(journal()).getByRole('button', { name: 'Открыть страницу' })).toBeTruthy();
    expect(journal().textContent).toContain(
      'Повторная обработка не создаёт вторую задачу или строку.',
    );
    fireEvent.click(feedRows()[1] as HTMLElement);
    await waitFor(
      () =>
        expect(card().textContent).toContain(
          'Кирилл Громов · 18.09 08:41 · показан по структуре версии v2 (действует v3)',
        ),
      SLOW,
    );
    const s = app?.router.state.location.search as Record<string, unknown>;
    expect(s.resp).toBe(A('R-0988'));
  });

  it('`&resp=` — «Лента» с выбранным ответом', async () => {
    await open(INSP, 'responses', { extra: `&resp=${A('R-0988')}` });
    await waitFor(() => expect(feedRows()).toHaveLength(2), SLOW);
    expect(view('Лента').getAttribute('aria-pressed')).toBe('true');
    expect(feedRows()[1]?.getAttribute('aria-pressed')).toBe('true');
  });

  it('ошибка «в БЗ» в журнале — «Повторить»: тост «Ответ R-1012 сохранён в Базу знаний», строка без ошибки', async () => {
    await open(INSP, 'responses', { extra: `&resp=${A('R-1012')}` });
    await waitFor(() => expect(feedRows()).toHaveLength(2), SLOW);
    // Состояние сервера: действие «в БЗ» R-1012 не выполнено (снаружи сценарного сервера ошибку kbRun не вызвать).
    const org = app?.scenario.state().orgs[ALTA] as unknown as {
      formsData: { responses: { proto: string; actions: Record<string, unknown>[] }[] };
    };
    const r = org.formsData.responses.find((x) => x.proto === 'R-1012');
    if (!r) throw new Error('нет R-1012 в состоянии сервера');
    r.actions = [
      {
        ruleId: A('au-2'),
        ruleVersion: 1,
        kind: 'kb',
        ok: false,
        at: '2026-09-27T06:12:00Z',
        error: 'страница удалена из Базы знаний',
      },
    ];
    fireEvent.click(screen.getByRole('tab', { name: /^Версии/ }));
    fireEvent.click(screen.getByRole('tab', { name: /^Ответы/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Лента' }, SLOW));
    await waitFor(
      () =>
        expect(journal().textContent).toContain(
          'Не сохранено в Базу знаний: страница удалена из Базы знаний · 27.09 09:12',
        ),
      SLOW,
    );
    fireEvent.click(within(journal()).getByRole('button', { name: 'Повторить' }));
    await waitFor(
      () =>
        expect(document.querySelector('.ox-toast .ox-toast-text')?.textContent).toBe(
          'Ответ R-1012 сохранён в Базу знаний',
        ),
      SLOW,
    );
    await waitFor(() => expect(journal().textContent).not.toContain('Не сохранено'), SLOW);
    expect(within(journal()).getByRole('button', { name: 'Открыть страницу' })).toBeTruthy();
  });

  it('«Таблица»: колонки эталона, «—» у пустых', async () => {
    await open(INSP, 'responses');
    fireEvent.click(await screen.findByRole('button', { name: 'Таблица' }, SLOW));
    const table = await waitFor(() => {
      const t = rs().querySelector('table');
      expect(t).toBeTruthy();
      return t as HTMLTableElement;
    }, SLOW);
    expect([...table.querySelectorAll('th')].slice(0, 5).map((t) => t.textContent)).toEqual([
      'Ответ',
      'Дата',
      'Автор',
      'Объект',
      'Версия',
    ]);
    const first = [...(table.querySelector('tbody tr')?.querySelectorAll('td') ?? [])].map(
      (c) => c.textContent,
    );
    expect(first.slice(0, 5)).toEqual([
      'R-1012',
      '27.09 09:05',
      'Илья Васильев',
      'Рейс Р-196',
      'v3',
    ]);
    expect(first[10]).toBe('—');
  });

  it('«Выгрузить CSV» — exportFormResponses; черновик — пусто, кнопка недоступна', async () => {
    await open(INSP, 'responses');
    const btn = await screen.findByRole('button', { name: 'Выгрузить CSV' }, SLOW);
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false), SLOW);
    fireEvent.click(btn);
    await waitFor(
      () =>
        expect(
          app
            ?.responses()
            .some((r) => r.path.endsWith(`/forms/${INSP}/export`) && r.status === 200),
        ).toBe(true),
      SLOW,
    );
    app?.close();
    await open(FOREMAN, 'responses');
    await screen.findByText('Ответов нет: форма ещё не опубликована.', {}, SLOW);
    expect(
      (screen.getByRole('button', { name: 'Выгрузить CSV' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(rs().textContent).toContain('0 ответов');
  });

  it('принятый ответ — без «Принять» и «Отклонить» (проверка — у ответа на проверке, e2e)', async () => {
    await open(INSP, 'responses', { extra: `&resp=${A('R-1012')}` });
    await waitFor(() => expect(feedRows()).toHaveLength(2), SLOW);
    expect(card().querySelector('.ox-fr-resp-status')?.textContent).toBe('Принят');
    expect(within(card()).queryByRole('button', { name: 'Принять' })).toBeNull();
    expect(within(card()).queryByRole('button', { name: 'Отклонить' })).toBeNull();
  });

  it('ошибка «Сводки» — «Повторить»; логист — без «Повторить» в журнале', async () => {
    await open(INSP, 'responses', { scenario: 'getFormResponseSummary=rate_limited' });
    await within(rs()).findByText(/Не удалось загрузить данные/, {}, SLOW);
    app?.scenario.setScenario(null);
    fireEvent.click(within(rs()).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(document.querySelectorAll('.ox-fr-stat').length).toBe(8), SLOW);
    app?.close();
    await open(INSP, 'responses', { persona: 'manager', extra: `&resp=${A('R-1012')}` });
    await waitFor(() => expect(card()).toBeTruthy(), SLOW);
    expect(within(journal()).queryByRole('button', { name: 'Повторить' })).toBeNull();
  });
});

describe('«Версии»', () => {
  it('список: новая первой, «Действует», мета; структура v3 с отличиями; v2 — «Текст изменён»', async () => {
    await open(INSP, 'versions');
    const list = await waitFor(() => {
      const b = [...document.querySelectorAll<HTMLElement>('.ox-fr-vlist > button')];
      expect(b).toHaveLength(3);
      return b;
    }, SLOW);
    expect(list.map((b) => b.querySelector('strong')?.textContent)).toEqual([
      'Версия 3',
      'Версия 2',
      'Версия 1',
    ]);
    expect(list[0]?.textContent).toContain('Действует');
    expect(list[0]?.textContent).toContain('24.09.2026 · Дарья Зимина · вопросов: 7');
    const ver = () => document.querySelector<HTMLElement>('.ox-fr-ver') as HTMLElement;
    expect(ver().querySelector('h3')?.textContent).toBe('Структура версии 3 · неизменяема');
    expect([...ver().querySelectorAll('.ox-fr-vpage')].map((x) => x.textContent)).toEqual([
      'Фото',
      'Показания',
      'Проверка',
      'Дефекты',
    ]);
    const q = (label: string) =>
      [...ver().querySelectorAll<HTMLElement>('.ox-fr-vq')].find(
        (x) => x.querySelector('.ox-fr-vq-label')?.textContent === label,
      ) as HTMLElement;
    expect(q('Уровень топлива').textContent).toContain('Добавлено');
    expect(q('Пробег по одометру, км').querySelector('.ox-fr-chip')).toBeNull();
    expect(q('Описание дефекта').textContent).toContain(
      'ID q-defect-text · Короткий текст · обязательный · если «Есть дефекты?» = да',
    );
    expect(ver().textContent).toContain('Убрано относительно предыдущей версии: «Уровень топлива»');
    fireEvent.click(list[1] as HTMLElement);
    await waitFor(() =>
      expect(ver().querySelector('h3')?.textContent).toBe('Структура версии 2 · неизменяема'),
    );
    expect(q('Пробег по одометру, км').textContent).toContain('Текст изменён');
    expect(q('Чек-лист: кузов, шины, документы').textContent).toContain('Добавлено');
  });

  it('черновик — «Форма ещё не публиковалась»', async () => {
    await open(FOREMAN, 'versions');
    await screen.findByText('Форма ещё не публиковалась', {}, SLOW);
  });
});
