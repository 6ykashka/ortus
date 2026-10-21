// W4.32 · Экранные тесты диалога «Доступ · …» (М:327–365, dlgVM М:628–672): цепочка, режимы, кандидаты «Кого
// добавить» и «Уже есть в списке», «Что изменится» (setKnowledgeNodeAccess dryRun), сохранение по If-Match,
// «Применить и к подстраницам со своим доступом», запросы доступа, только чтение не руководителю, Escape.
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

const open = async (page: string, title: string, o: Parameters<typeof renderMockApp>[1] = {}) => {
  app = await renderMockApp(`/t/${ALTA}/knowledge?space=${A('sp-log')}&page=${A(page)}`, {
    persona: 'owner',
    ...o,
  });
  await waitFor(
    () => expect(document.querySelector('article.ox-kb-article h2')?.textContent).toBe(title),
    SLOW,
  );
  return app;
};
const toast = () => document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const side = (dlg: HTMLElement) => dlg.querySelector('.ox-kb-acc-side') as HTMLElement;
const entryNames = (dlg: HTMLElement) =>
  [...dlg.querySelectorAll('.ox-kb-entry-text > strong')].map((x) => x.textContent);

/** Диалог открывается сразу с «Загрузка» (возврат 3) — ждём загруженный доступ узла (цепочку). */
async function openAccess(name: string): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: 'Доступ', exact: true } as never));
  return waitFor(() => {
    const dlg = screen.getByRole('dialog', { name });
    expect(dlg.querySelector('.ox-kb-chain-row')).toBeTruthy();
    return dlg;
  }, SLOW);
}

describe('«Доступ · …»: руководитель', () => {
  it('цепочка, режим «Только выбранные», записи, сноска, «Что изменится» до правки', async () => {
    await open('kb-fin', 'Тарифы и начисления');
    const dlg = await openAccess('Доступ · Тарифы и начисления');
    expect(dlg.textContent).toContain('Логистика · 1 подстраница');
    expect([...dlg.querySelectorAll('.ox-kb-chain-card strong')].map((x) => x.textContent)).toEqual(
      ['Организация', 'Пространство «Логистика»', '«Тарифы и начисления»'],
    );
    expect(dlg.querySelector('.ox-kb-chain-card[data-cur]')?.textContent).toContain(
      'Настраиваете сейчас',
    );
    const modes = within(dlg)
      .getAllByRole('button', { pressed: false })
      .concat(within(dlg).getAllByRole('button', { pressed: true }));
    expect(modes.length).toBeGreaterThanOrEqual(3);
    expect(
      within(dlg)
        .getByRole('button', { name: /Только выбранные/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(within(dlg).getByRole('button', { name: /Как у пространства/ })).toBeTruthy();
    expect(entryNames(dlg)).toEqual([
      'Руководитель пространства и владелец бизнеса',
      'Марина Котова',
      'Вера Котельникова',
    ]);
    expect(dlg.textContent).toContain('Марина Котова · видят и правят всё в пространстве');
    expect(side(dlg).textContent).toContain('Ветка «Тарифы и начисления»: 2 страницы.');
    expect(side(dlg).textContent).toContain(
      'Измените режим или список — здесь появится, кто получит или потеряет доступ.',
    );
    expect(
      (within(dlg).getByRole('button', { name: 'Сохранить · 2 страницы' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(dlg.textContent).toContain(
      'Доступ проходит каждый уровень цепочки. Подстраница может только сузить круг читателей; правку можно выдать отдельно тем, кто видит страницу. Функция «Водитель» не открывает финансовые страницы ни через роль, ни через группу.',
    );
  });

  it('«Тарифы»: «Читают все, правят выбранные» — «Ни у кого доступ не изменится» (функция закрывает водителю)', async () => {
    await open('kb-fin', 'Тарифы и начисления');
    const dlg = await openAccess('Доступ · Тарифы и начисления');
    fireEvent.click(within(dlg).getByRole('button', { name: /Читают все, правят выбранные/ }));
    await waitFor(
      () => expect(side(dlg).textContent).toContain('Ни у кого доступ не изменится'),
      SLOW,
    );
  });

  it('«Маршруты» → «Только выбранные»: «Редактор» по умолчанию, кто потеряет чтение, «Доступ сохранён»', async () => {
    await open('kb-drv-4', 'Маршруты');
    const dlg = await openAccess('Доступ · Маршруты');
    await waitFor(() => expect(within(dlg).getByLabelText('Кого добавить')).toBeTruthy(), SLOW);
    fireEvent.click(within(dlg).getByRole('button', { name: /Только выбранные/ }));
    await waitFor(() => expect(entryNames(dlg)).toContain('Роль «Редактор» в пространстве'), SLOW);
    await waitFor(
      () => expect(side(dlg).textContent).toContain('Потеряют чтение (страниц): Илья Васильев · 1'),
      SLOW,
    );
    const save = within(dlg).getByRole('button', {
      name: 'Сохранить · 1 страница',
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(toast()).toBe('Доступ сохранён'), SLOW);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(
      () =>
        expect(screen.getByRole('complementary', { name: 'О странице' }).textContent).toContain(
          'Свой доступ: только выбранные.',
        ),
      SLOW,
    );
  });

  it('«Кого добавить»: кандидаты с охватом, «Добавить», «Уже есть в списке», «Убрать из списка»', async () => {
    await open('kb-fin', 'Тарифы и начисления');
    const dlg = await openAccess('Доступ · Тарифы и начисления');
    // Поля «Кого добавить» — после ответа кандидатов (до него — «Загрузка», возврат 3).
    const who = (await within(dlg).findByLabelText('Кого добавить', {}, SLOW)) as HTMLSelectElement;
    await waitFor(() => expect(who.options.length).toBeGreaterThan(5), SLOW);
    const texts = [...who.options].map((o) => o.textContent ?? '');
    expect(texts[0]).toBe('Выберите роль, группу или сотрудника');
    expect(texts.some((t) => t.startsWith('Роль «Редактор» в пространстве'))).toBe(true);
    expect(texts.some((t) => t.startsWith('Илья Васильев — не получит доступ:'))).toBe(true);
    const add = within(dlg).getByRole('button', { name: 'Добавить' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    const kotova = [...who.options].find((o) =>
      o.textContent?.startsWith('Марина Котова'),
    ) as HTMLOptionElement;
    fireEvent.change(who, { target: { value: kotova.value } });
    fireEvent.click(add);
    expect(dlg.querySelector('.ox-kb-dialog-err')?.textContent).toBe('Уже есть в списке');
    const editor = [...who.options].find((o) =>
      o.textContent?.startsWith('Роль «Редактор» в пространстве'),
    ) as HTMLOptionElement;
    fireEvent.change(who, { target: { value: editor.value } });
    fireEvent.change(within(dlg).getAllByLabelText('Что может')[0] as HTMLElement, {
      target: { value: 'edit' },
    });
    fireEvent.click(add);
    expect(entryNames(dlg)).toContain('Роль «Редактор» в пространстве');
    const row = [...dlg.querySelectorAll<HTMLElement>('.ox-kb-entry-row')].find((r) =>
      r.textContent?.includes('Вера Котельникова'),
    ) as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Убрать из списка' }));
    expect(entryNames(dlg)).not.toContain('Вера Котельникова');
    await waitFor(
      () => expect(side(dlg).textContent).not.toContain('Измените режим или список'),
      SLOW,
    );
  });

  it('«Применить и к подстраницам со своим доступом»: у «Водителям» — «Маршруты»', async () => {
    await open('kb-f-drv', 'Водителям');
    const dlg = await openAccess('Доступ · Водителям');
    expect(side(dlg).textContent).toContain('из них со своим доступом: Маршруты');
    const own = within(dlg).getByRole('checkbox', {
      name: 'Применить и к подстраницам со своим доступом (1): их доступ станет «Как у родителя»',
    });
    fireEvent.click(own);
    await waitFor(
      () => expect(side(dlg).querySelectorAll('.ox-kb-impact').length).toBeGreaterThan(0),
      SLOW,
    );
    expect(
      (within(dlg).getByRole('button', { name: /^Сохранить · / }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('Escape и «Отмена» закрывают диалог без изменений', async () => {
    await open('kb-fin', 'Тарифы и начисления');
    await openAccess('Доступ · Тарифы и начисления');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const dlg = await openAccess('Доступ · Тарифы и начисления');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('«Доступ · …»: запросы и только чтение', () => {
  it('запрос права правки водителя виден руководителю: «Одобрить» — «Запрос одобрен»', async () => {
    const a = await open('kb-drv-4', 'Маршруты');
    // Открытый запрос водителя в состоянии сценарного сервера (kbRequest домена: «ДД.ММ.ГГГГ ЧЧ:ММ»).
    const kb = (
      a.scenario.state() as unknown as {
        orgs: Record<string, { knowledge?: { db: { knowledge: { requests?: unknown[] } } } }>;
      }
    ).orgs[ALTA]?.knowledge?.db.knowledge;
    kb?.requests?.push({
      id: 'kq-t1',
      node: 'kb-drv-4',
      space: 'sp-log',
      member: 'm-vasiliev',
      can: 'edit',
      at: '01.10.2026 10:15',
      status: 'open',
    });
    const dlg = await openAccess('Доступ · Маршруты');
    const req = await waitFor(() => {
      const r = dlg.querySelector<HTMLElement>('.ox-kb-req');
      expect(r).toBeTruthy();
      return r as HTMLElement;
    }, SLOW);
    expect(req.textContent).toContain('Илья Васильев просит право правки · 01.10.2026 10:15');
    expect(side(dlg).textContent).toContain('Запросы доступа');
    fireEvent.click(within(req).getByRole('button', { name: 'Одобрить' }));
    await waitFor(() => expect(toast()).toBe('Запрос одобрен'), SLOW);
    await waitFor(() => expect(dlg.querySelector('.ox-kb-req')).toBeNull(), SLOW);
  });

  it('водитель: только чтение — «Доступ меняет руководитель пространства…», без «Сохранить», «Закрыть»', async () => {
    await open('kb-log-home', 'Обзор', { persona: 'driver' });
    fireEvent.click(screen.getByRole('button', { name: 'Кто видит и почему' }));
    const dlg = await waitFor(() => {
      const d = screen.getByRole('dialog', { name: 'Доступ · Обзор' });
      expect(d.querySelector('.ox-kb-chain-row')).toBeTruthy();
      return d;
    }, SLOW);
    expect(dlg.textContent).toContain(
      'Доступ меняет руководитель пространства (Марина Котова). Здесь видно, кто читает и правит.',
    );
    expect(dlg.querySelector('.ox-kb-chain-card[data-cur]')?.textContent).toContain(
      'Как у родителя',
    );
    expect(within(dlg).queryByRole('button', { name: /^Сохранить/ })).toBeNull();
    expect(within(dlg).queryByLabelText('Кого добавить')).toBeNull();
    for (const b of within(dlg).getAllByRole('button', {
      name: /Как у пространства|Читают все|Только выбранные/,
    })) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    }
    const close = within(dlg).getAllByRole('button', { name: 'Закрыть' });
    fireEvent.click(close[close.length - 1] as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
