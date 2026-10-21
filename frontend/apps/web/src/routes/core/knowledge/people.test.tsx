// W4.32 · Экранные тесты «Участники и доступ» (М:199–256, peopleVM М:676–710) и «Автоматизация» (М:258–280):
// карточки ролей (KB-02 — три роли), «По уровню», смена роли и «Убрать», «Добавить в пространство», карта доступа и
// «Проверить сотрудника»; правила, переключатель, «Проверить сроки сейчас», «Создать раздел», журнал запусков.
// Логист Котова — руководитель «Логистики» (пресет logistics-ready: роль «Менеджер логистики» в «Север Логистик»).
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, renderMockApp } from '../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const A = (id: string) => seedUuid('t-alta', id);
const SLOW = { timeout: 8_000 };

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (
  sp: string,
  tab: string,
  o: Parameters<typeof renderMockApp>[1] = {},
): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/knowledge?space=${A(sp)}&tab=${tab}`, {
    persona: 'manager',
    preset: 'logistics-ready',
    ...o,
  });
  return app;
};
const roles = () => [...document.querySelectorAll<HTMLElement>('.ox-kb-role')];
const role = (name: string) =>
  roles().find((r) => r.querySelector('strong')?.textContent === name) as HTMLElement;
const toast = () => document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const people = (card: HTMLElement) =>
  [...card.querySelectorAll('.ox-kb-person-name')].map((x) => x.textContent);

describe('«Участники и доступ»', () => {
  it('руководитель: три роли и «По уровню «Ограниченное»», своя роль руководителя без выбора', async () => {
    await open('sp-log', 'people');
    await waitFor(() => expect(roles()).toHaveLength(4), SLOW);
    expect(document.querySelector('.ox-kb-people-intro')?.textContent).toBe(
      'Роли пространства — назначения из «Пользователей и ролей» с областью «Логистика». Остальные получают доступ по уровню пространства: все в области читают, пишут участники.',
    );
    expect(roles().map((r) => r.querySelector('strong')?.textContent)).toEqual([
      'Руководитель пространства',
      'Редактор',
      'Читатель',
      'По уровню «Ограниченное»',
    ]);
    expect(role('Руководитель пространства').textContent).toContain(
      'Всё в пространстве, участники, доступ, автоматизация',
    );
    expect(people(role('Руководитель пространства'))).toEqual(['Марина Котова']);
    expect(role('Руководитель пространства').querySelector('select')).toBeNull();
    expect(people(role('Редактор'))).toEqual(['Вера Котельникова']);
    expect(within(role('Редактор')).getByLabelText('Роль в пространстве')).toBeTruthy();
    expect(role('Читатель').textContent).toContain('Никого');
    const level = role('По уровню «Ограниченное»');
    expect(level.textContent).toContain(
      'Все в области читают, пишут участники · фирма «Север Логистик»',
    );
    expect(people(level)).toContain('Илья Васильев');
  });

  it('«Добавить в пространство» читателем, «Роль изменена», «Убран(а) из пространства»', async () => {
    await open('sp-log', 'people');
    const who = (await screen.findByLabelText(
      'Сотрудник',
      { selector: '.ox-kb-add select' },
      SLOW,
    )) as HTMLSelectElement;
    await waitFor(() => expect(who.options.length).toBeGreaterThan(1), SLOW);
    const ilya = [...who.options].find(
      (o) => o.textContent === 'Илья Васильев',
    ) as HTMLOptionElement;
    const add = screen.getByRole('button', {
      name: /Добавить в пространство/,
    }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(who, { target: { value: ilya.value } });
    fireEvent.click(add);
    await waitFor(() => expect(toast()).toBe('Добавлен(а) в пространство'), SLOW);
    await waitFor(() => expect(people(role('Читатель'))).toEqual(['Илья Васильев']), SLOW);
    expect(role('Читатель').textContent).toContain('назначение в пространстве');
    fireEvent.change(within(role('Читатель')).getByLabelText('Роль в пространстве'), {
      target: { value: 'kb_space_editor' },
    });
    await waitFor(() => expect(toast()).toBe('Роль изменена'), SLOW);
    await waitFor(() => expect(people(role('Редактор'))).toContain('Илья Васильев'), SLOW);
    const row = [...role('Редактор').querySelectorAll<HTMLElement>('.ox-kb-person')].find((x) =>
      x.textContent?.includes('Илья Васильев'),
    ) as HTMLElement;
    fireEvent.change(within(row).getByLabelText('Роль в пространстве'), { target: { value: '' } });
    await waitFor(() => expect(toast()).toBe('Убран(а) из пространства'), SLOW);
    await waitFor(() => expect(people(role('Редактор'))).not.toContain('Илья Васильев'), SLOW);
  });

  it('карта доступа: колонки сотрудников, ячейки, «Проверить сотрудника» с цепочкой и итогом', async () => {
    await open('sp-log', 'people');
    const map = await waitFor(() => {
      const m = document.querySelector<HTMLElement>('.ox-kb-map');
      expect(m?.querySelectorAll('.ox-kb-cell').length).toBeGreaterThan(0);
      return m as HTMLElement;
    }, SLOW);
    expect(map.textContent).toContain('Карта доступа');
    expect(map.textContent).toContain(
      'Страницы × сотрудники. Нажмите на ячейку, чтобы увидеть причину. Владелец бизнеса видит всё.',
    );
    const cols = [...map.querySelectorAll('.ox-kb-map-name')].map((x) => x.textContent);
    expect(cols).toEqual(['Марина', 'Илья', 'Вера']);
    const why = screen.getByRole('complementary', { name: 'Почему так' });
    await waitFor(
      () => expect(why.querySelector('.ox-kb-res')?.textContent).toContain('Читает и правит.'),
      SLOW,
    );
    expect(why.textContent).toContain('«Обзор»');
    // Ячейка водителя у «Тарифов и начислений» — «Функция».
    const fin = [...map.querySelectorAll<HTMLElement>('.ox-kb-map-row')].find((r) =>
      r.textContent?.startsWith('descriptionТарифы и начисления'),
    ) as HTMLElement;
    const cell = fin.querySelectorAll<HTMLElement>('.ox-kb-cell')[1] as HTMLElement;
    expect(cell.textContent).toBe('blockФункция');
    fireEvent.click(cell);
    await waitFor(
      () =>
        expect(why.querySelector('.ox-kb-res')?.textContent).toContain(
          'Не видит: страницы нет в его дереве, поиске и блоке «Подстраницы». Функция «Водитель» закрывает финансовые страницы, роль или группа это не обходят.',
        ),
      SLOW,
    );
    expect(why.textContent).toContain('«Тарифы и начисления»');
    expect(cell.dataset.ring).toBe('');
    expect((within(why).getByLabelText('Сотрудник') as HTMLSelectElement).value).toBe(
      A('m-vasiliev'),
    );
  });

  it('водитель: роли без управления, без карты и «Добавить»', async () => {
    await open('sp-log', 'people', { persona: 'driver', preset: undefined });
    await waitFor(() => expect(roles().length).toBeGreaterThan(0), SLOW);
    expect(document.querySelector('.ox-kb-map')).toBeNull();
    expect(document.querySelector('.ox-kb-add')).toBeNull();
    expect(document.querySelector('.ox-kb-role select')).toBeNull();
  });
});

describe('«Автоматизация»', () => {
  it('правила «Логистики», переключатель, «Проверить сроки сейчас», журнал', async () => {
    await open('sp-log', 'auto', { persona: 'owner', preset: undefined });
    await waitFor(() => expect(document.querySelectorAll('.ox-kb-rule')).toHaveLength(2), SLOW);
    const rules = [...document.querySelectorAll<HTMLElement>('.ox-kb-rule')];
    expect(rules.map((r) => r.querySelector('strong')?.textContent)).toEqual([
      'Новая версия регламента → попросить ознакомиться заново',
      'Пора пересмотреть страницу → уведомить владельца',
    ]);
    expect(rules[0]?.textContent).toContain('База знаний · страница опубликована');
    expect(rules[1]?.textContent).toContain(
      'Ищет страницы с наступившим сроком пересмотра, ставит статус «Пора пересмотреть» и уведомляет владельца.',
    );
    const runs = document.querySelector('.ox-kb-runs') as HTMLElement;
    await waitFor(() => expect(runs.textContent).toContain('24.09 18:10'), SLOW);
    expect(runs.textContent).toContain(
      '«Регламент приёмки смены» v2: попросили ознакомиться роль «Водитель» в «Север Логистик» — 1 человек',
    );
    const sw = within(rules[0] as HTMLElement).getByRole('switch', { name: 'Правило включено' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    await waitFor(() => expect(toast()).toBe('Правило выключено'), SLOW);
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('false'), SLOW);
    fireEvent.click(
      within(rules[1] as HTMLElement).getByRole('button', { name: 'Проверить сроки сейчас' }),
    );
    await waitFor(() => expect(toast()).toBe('Проверка выполнена'), SLOW);
    expect(document.body.textContent).toContain(
      'Правило выполняется от имени того, кто его включил; права проверяются при каждом запуске. Изменения, которые сделало правило, другие правила не запускают.',
    );
  });

  it('«Ремонт и стройка»: объекты раздела — «Открыть раздел» и «Создать раздел»; выключенное правило', async () => {
    const a = await open('sp-rep', 'auto', { persona: 'owner', preset: undefined });
    await waitFor(
      () => expect(document.querySelectorAll('.ox-kb-object').length).toBeGreaterThan(0),
      SLOW,
    );
    const objs = [...document.querySelectorAll<HTMLElement>('.ox-kb-object')];
    const o42 = objs.find((o) => o.textContent?.includes('ЖК Речной · квартира 42')) as HTMLElement;
    expect(o42.textContent).toContain('Черновая отделка · прораб Алексей Соколов');
    const cafe = objs.find((o) => o.textContent?.includes('Кофейня на Покровке')) as HTMLElement;
    expect(cafe.textContent).toContain('Подготовка · прораб не назначен');
    const review = [...document.querySelectorAll<HTMLElement>('.ox-kb-rule')].at(-1) as HTMLElement;
    expect(within(review).getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect(
      (within(review).getByRole('button', { name: 'Проверить сроки сейчас' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    const north = objs.find((o) => o.textContent?.includes('ЖК Северный парк')) as HTMLElement;
    fireEvent.click(within(north).getByRole('button', { name: 'Создать раздел' }));
    await waitFor(() => expect(toast()).toBe('Раздел создан'), SLOW);
    const fresh = await waitFor(() => {
      const n = [...document.querySelectorAll<HTMLElement>('.ox-kb-object')].find((o) =>
        o.textContent?.includes('ЖК Северный парк'),
      );
      expect(n && within(n).queryByRole('button', { name: 'Открыть раздел' })).toBeTruthy();
      return n as HTMLElement;
    }, SLOW);
    fireEvent.click(within(o42).getByRole('button', { name: 'Открыть раздел' }));
    await waitFor(
      () =>
        expect((a.router.state.location.search as Record<string, unknown>).page).toBe(
          A('kb-o-obj-42'),
        ),
      SLOW,
    );
    void fresh;
  });
});
