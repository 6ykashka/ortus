// W2.48 · Квоты пилота (D-08, D-33; бриф docs/plan/v2/ws/W2.48.md). Оператор ставит организации 100 мест и 100 ГБ
// командой этапа 1 (updatePlatformSubscription). Владелец видит 100 ГБ на «Модули и место» и «Хранилище» и 100 мест
// в «Пригласить участника». Порядок действий — docs/plan/v2/pilot-quotas.md, его шаги — помощники `./quotas.ts`.
// Пилотной организации в сиде нет — порядок проходит на «Альте». Сид стенда общий для трёх проектов прогона:
// подписку и лимит места возвращает фикстура `undo`.
import type { Page } from '@playwright/test';

import { expect, test } from '../../_stand/fixtures.ts';
import {
  expectStatus,
  platformSubscription,
  putSubscription,
  type Subscription,
} from '../../_stand/stand.ts';
import { h1 } from '../../modules.helpers.ts';
import { dialog, openUsers } from '../../people.helpers.ts';
import { cardValue, orgCard, orgRow, platformTenantId } from '../../platform-orgs.helpers.ts';
import { ALTA, call } from '../../shell.helpers.ts';
import {
  alignStorage,
  applyPilotQuotas,
  ownerStorageBytes,
  PILOT,
  pilotTerms,
  setOwnerStorageGb,
} from './quotas.ts';

type AppFn = (route: string, o?: { persona?: 'owner' }) => Promise<unknown>;

const right = (s: Subscription, key: string) => s.entitlements.find((e) => e.key === key);

const GiB = 2 ** 30;

/** «из 100 ГБ» на «Модули и место» и «Хранилище» у владельца. */
async function ownerSeesStorage(app: AppFn, page: Page, tenant: string): Promise<void> {
  await app(`/t/${tenant}/modules`, { persona: 'owner' });
  await expect(h1(page, 'Модули и место')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.ox-mod-storage-of')).toHaveText(`из ${PILOT.storageGb} ГБ`);
  await app(`/t/${tenant}/storage`, { persona: 'owner' });
  await expect(h1(page, 'Хранилище')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.ox-st-usage .ox-mod-storage-of')).toHaveText(
    `из ${PILOT.storageGb} ГБ`,
  );
}

test.describe('пилот — квоты 100 мест и 100 ГБ оператором @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('оператор ставит «Альте» квоты пилота → владелец видит 100 ГБ и 100 мест', async ({
    app,
    page,
    session,
    undo,
  }, testInfo) => {
    test.slow();
    const operator = await session();
    await operator.open('/platform/tenants', 'operator');
    const alta = await platformTenantId(operator.page, ALTA);
    const { sub: before } = await platformSubscription(operator.page, alta);
    expect(right(before, 'seats')?.value, 'до пилота — места пробного тарифа').toBeLessThan(
      PILOT.seats,
    );
    const restore = undo(`подписка ${ALTA}`, () =>
      putSubscription(operator.page, alta, before, 'W2.48: возврат подписки после стенд-e2e'),
    );

    // Шаги 1–3 порядка: подписка, ETag, updatePlatformSubscription с ручными правами до конца пилота.
    const terms = pilotTerms(30, testInfo.project.name);
    const after = await applyPilotQuotas(operator.page, ALTA, terms);
    expect(after.status).toBe('active');
    expect(Date.parse(after.periodEndsAt ?? '')).toBe(Date.parse(terms.until));
    expect(right(after, 'seats')).toMatchObject({
      sourceType: 'manual',
      sourceRef: terms.ticket,
      value: PILOT.seats,
    });
    expect(right(after, 'storage_quota_bytes')).toMatchObject({
      sourceType: 'manual',
      sourceRef: terms.ticket,
      value: PILOT.storageBytes,
    });

    await test.step('оператор: карточка «Альты» — 100 мест и 100 ГБ, причина в журнале', async () => {
      await operator.page.reload();
      await orgRow(operator.page, ALTA).click();
      const card = orgCard(operator.page, ALTA);
      await expect(card.locator('.ox-org-seats')).toHaveText(/из 100$/, { timeout: 15_000 });
      await expect(cardValue(card, 'Место')).toHaveText(/из 100 ГБ$/);
      await expect(operator.page.locator('.ox-audit')).toContainText(terms.reason);
    });

    await test.step('владелец: «Модули и место» и «Хранилище» — из 100 ГБ', async () => {
      await app('/', { persona: 'owner' });
      await expect(page).toHaveURL(new RegExp(`/t/${alta}/home$`), { timeout: 15_000 });
      // Шаг 4 порядка: на сиде лимит места уже 100 ГБ — выравнивать не нужно.
      await app(`/t/${alta}/storage`, { persona: 'owner' });
      await expect(h1(page, 'Хранилище')).toBeVisible({ timeout: 30_000 });
      expect(await alignStorage(page), 'лимит места сида — 100 ГБ').toBe(false);
      await ownerSeesStorage(app, page, alta);
      expect(await ownerStorageBytes(page, alta), 'квота «Хранилища» = право оператора').toBe(
        right(after, 'storage_quota_bytes')?.value,
      );
    });

    await test.step('владелец: «Пригласить участника» — свободно мест из 100', async () => {
      await openUsers(app, page);
      await page.getByRole('button', { name: 'Пригласить' }).click();
      const dlg = dialog(page, 'Пригласить участника');
      // Только числа: при 91 свободном месте строка говорит «— это последнее» (ICU `one` у 21, 31, … 91 —
      // Q-W2.48-6, словарь @ortus/texts), это не предмет строки.
      await expect(dlg.locator('.ox-dlg-seats')).toContainText(/Свободно мест: \d+ из 100\b/, {
        timeout: 15_000,
      });
      await page.keyboard.press('Escape');
      await expect(dlg).toHaveCount(0);
      const own = expectStatus(
        await call(page, 'GET', `/api/v1/tenants/${alta}/subscription`),
        200,
        'getTenantSubscription',
      ).body as Subscription;
      expect(right(own, 'seats')?.value).toBe(PILOT.seats);
    });

    // Возврат: подписка и права — как до строки.
    await restore();
    const { sub: back } = await platformSubscription(operator.page, alta);
    expect(back.status).toBe(before.status);
    expect(right(back, 'seats')?.value).toBe(right(before, 'seats')?.value);
  });

  test('лимит места был изменён (50 ГБ) → после квот оператора владелец ставит 100 ГБ на «Хранилище»', async ({
    app,
    page,
    session,
    undo,
  }, testInfo) => {
    test.slow();
    const operator = await session();
    await operator.open('/platform/tenants', 'operator');
    const alta = await platformTenantId(operator.page, ALTA);
    const { sub: before } = await platformSubscription(operator.page, alta);
    undo(`подписка ${ALTA}`, () =>
      putSubscription(operator.page, alta, before, 'W2.48: возврат подписки после стенд-e2e'),
    );

    // Предусловие: владелец раньше уменьшил лимит места до 50 ГБ (requestStorageChange); уборка возвращает прежний.
    await app('/', { persona: 'owner' });
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/home$`), { timeout: 15_000 });
    const quotaBefore = await ownerStorageBytes(page, alta);
    undo('лимит места «Альты»', () => setOwnerStorageGb(page, alta, Math.round(quotaBefore / GiB)));
    await setOwnerStorageGb(page, alta, 50);

    await applyPilotQuotas(operator.page, ALTA, pilotTerms(30, testInfo.project.name));

    // Шаг 4 порядка: «Хранилище» не 100 ГБ — владелец выбирает «Новый лимит» 100 ГБ.
    await app(`/t/${alta}/storage`, { persona: 'owner' });
    await expect(h1(page, 'Хранилище')).toBeVisible({ timeout: 30_000 });
    const aligned = await alignStorage(page);
    testInfo.annotations.push({
      type: 'W2.48',
      description: aligned
        ? 'право оператора не меняет files.usage — лимит поставил владелец (Q-W2.48-1)'
        : 'лимит места уже равен праву оператора',
    });
    await ownerSeesStorage(app, page, alta);
    expect(await ownerStorageBytes(page, alta)).toBe(PILOT.storageBytes);
  });
});
