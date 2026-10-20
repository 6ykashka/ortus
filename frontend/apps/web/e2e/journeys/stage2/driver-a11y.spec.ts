// W2.32 · Выход этапа 2, доступность «Моей смены» вне онлайна (возврат 1, проверяющий страницы driver-today r1/r2):
// axe на телефоне водителя и на 768/1440 в состояниях «Без связи» и «Модуль «Логистика» отключён» (только чтение).
// e2e страницы (W2.22, driver-today.spec.ts) гоняет axe только онлайн и это пропускает.
//
// Дефект страницы (Q-W2.32-12 → владелец страницы W2.22): в этих состояниях все команды в `#ox-main` отключены
// («Бронь недоступна»), целей Tab 0, а `#ox-main` (tabindex=-1, overflow-y: auto) прокручивается (содержимое выше
// области) — axe serious `scrollable-region-focusable`, список машин с клавиатуры не прокрутить. Онлайн целей Tab две
// («Забронировать»), нарушения нет. Так же правило уже исправлялось в W1.54 и W2.24 (Q-W2.24-8): у прокручиваемой
// области без команд — цель Tab (`tabIndex=0`, видимый `:focus-visible`). Evidence проверяющего:
// docs/plan/evidence/driver-today/verify/mock/w2.32-r1/r2/logs/offline-axe.txt.
//
// Строки — `@known-defect` и `test.fixme` (бриф §7, §10): шаги записаны целиком; без fixme обе падают на `serious()`
// после перехода в офлайн / при отключённом модуле — «serious scrollable-region-focusable», единственное нарушение, все
// три проекта (возврат 1, ревью r2, mock слота 3: 6 failed; онлайн-проверка в той же строке зелёная). После исправления
// страницы — снять fixme;
// тег `@mock` уже есть, `@known-defect` убрать. draining в mock не моделируется (Q-W2.32-5): в draining у водителя
// с начатой сменой есть её команды (цели Tab), без смены модуль сразу уходит в «только чтение» — его строка ниже.
import type { Page } from '@playwright/test';

import { expect, test } from '../../_stand/fixtures.ts';
import { carCard, openDriver } from '../../driver.helpers.ts';
import { h1, noHorizontalScroll } from '../../modules.helpers.ts';
import { devScenario, setModule, tenantId } from '../../shell.helpers.ts';

type Axe = (page: Page) => Promise<{ violations: { id: string; impact?: string | null }[] }>;

/** Нарушения serious/critical: `impact id`. */
async function serious(axe: Axe, page: Page): Promise<string[]> {
  return (await axe(page)).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}`);
}

test.describe('«Моя смена» — axe без связи и при отключённой «Логистике» @mock @known-defect', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты — сценарный сервер mock');

  test.fixme('без связи: бронь недоступна, axe без serious/critical (прокручиваемая область — цель Tab)', async ({
    app,
    page,
    axe,
  }) => {
    await openDriver(app, page, 'today');
    const book = carCard(page, 'ГАЗель Next');
    await expect(book.getByRole('button', { name: 'Забронировать' })).toBeEnabled();
    expect(await serious(axe, page), 'онлайн').toEqual([]);

    await page.context().setOffline(true);
    await expect(page.getByText('Нет связи: бронь требует подтверждения сервера.')).toBeVisible();
    await expect(book.getByRole('button', { name: 'Бронь недоступна' })).toBeDisabled();
    expect(await serious(axe, page), 'без связи').toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.context().setOffline(false);
  });

  test.fixme('модуль отключён с историей: баннер, бронь недоступна, axe без serious/critical', async ({
    app,
    page,
    axe,
  }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await setModule(page, alta, 'fleet', false);
    await app(`/t/${alta}/today`, { persona: 'driver' });
    await expect(h1(page, 'Моя смена')).toBeVisible();
    await expect(
      page.getByText('Модуль «Логистика» отключён: новые брони недоступны.'),
    ).toBeVisible();
    await expect(
      carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Бронь недоступна' }),
    ).toBeDisabled();
    expect(await serious(axe, page), 'только чтение').toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});
