// W2.48 · Порядок действий оператора «квоты пилота» (D-08, D-33) — шаги docs/plan/v2/pilot-quotas.md помощниками e2e.
// Шаг 2 — фрагмент консоли из документа дословно (блок `js`, меняются только ORG, UNTIL, TICKET): GET подписки и
// ETag → updatePlatformSubscription `active` до конца пилота, ручные права `seats` = 100 и `storage_quota_bytes`
// = 100 ГиБ. Шаг 4 — владелец: квоту «Хранилища» (`files.usage`) право оператора не меняет (Q-W2.48-1), поэтому
// если там не 100 ГБ — «Новый лимит» 100 ГБ.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, type Page } from '@playwright/test';

import { expectStatus, type Subscription } from '../../_stand/stand.ts';
import { call } from '../../shell.helpers.ts';

const GiB = 2 ** 30;
const DAY = 86_400_000;

/** Квоты пилота (D-08): 100 мест и 100 ГБ (ГиБ, как подписи интерфейса и MSW `DEFAULT_QUOTA`). */
export const PILOT = { seats: 100, storageGb: 100, storageBytes: 100 * GiB } as const;

/** Документ порядка действий (корень репозитория — шесть уровней выше каталога spec). */
export const PILOT_DOC = resolve(
  import.meta.dirname,
  '../../../../../../docs/plan/v2/pilot-quotas.md',
);

/** Условия пилота: срок ручных прав и подписки, основание (тикет) и причина для журнала платформы. */
export interface PilotTerms {
  until: string;
  ticket: string;
  reason: string;
}

const two = (n: number): string => String(n).padStart(2, '0');

/**
 * Условия пилота на `days` дней: срок — конец дня по Москве (21:00 UTC), основание — «Пилот D-08 · {label}»,
 * причина — та, что строит фрагмент документа: «{основание}: 100 мест и 100 ГБ до ДД.ММ.ГГГГ».
 */
export function pilotTerms(days: number, label: string): PilotTerms {
  const end = new Date(Date.now() + days * DAY);
  end.setUTCHours(21, 0, 0, 0);
  const day = `${two(end.getUTCDate())}.${two(end.getUTCMonth() + 1)}.${end.getUTCFullYear()}`;
  const ticket = `Пилот D-08 · ${label}`;
  return {
    until: end.toISOString(),
    ticket,
    reason: `${ticket}: ${PILOT.seats} мест и ${PILOT.storageGb} ГБ до ${day}`,
  };
}

/** Строка `const NAME = '…';` фрагмента с новым значением; строки нет — ошибка (документ изменился). */
function setConst(code: string, name: string, value: string): string {
  const re = new RegExp(`^const ${name} = '[^'\\n]*';`, 'm');
  if (!re.test(code))
    throw new Error(`${PILOT_DOC}: во фрагменте нет строки «const ${name} = '…';»`);
  return code.replace(re, `const ${name} = ${JSON.stringify(value)};`);
}

/** Фрагмент шага 2 из документа (единственный блок `js`) с организацией и условиями пилота. */
export function docSnippet(org: string, terms: PilotTerms): string {
  const blocks = [...readFileSync(PILOT_DOC, 'utf8').matchAll(/```js\r?\n([\s\S]*?)```/g)];
  if (blocks.length !== 1) throw new Error(`${PILOT_DOC}: блоков js ${blocks.length}, нужен один`);
  let code = blocks[0]?.[1] ?? '';
  code = setConst(code, 'ORG', org);
  code = setConst(code, 'UNTIL', terms.until);
  return setConst(code, 'TICKET', terms.ticket);
}

/** Шаг 2 порядка: фрагмент документа во вкладке оператора (как в консоли) → ответ PUT 200, новая подписка. */
export async function applyPilotQuotas(
  operator: Page,
  org: string,
  terms: PilotTerms,
): Promise<Subscription> {
  const code = `${docSnippet(org, terms)}\nreturn result;`;
  const result = await operator.evaluate(async (src) => {
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
      body: string,
    ) => () => Promise<{ status: number; body: unknown }>;
    return new AsyncFunction(src)();
  }, code);
  return expectStatus(
    { ...result, headers: {} },
    200,
    'фрагмент шага 2 (updatePlatformSubscription)',
  ).body as Subscription;
}

/** Квота «Хранилища» владельца (getStorageUsage.quotaBytes). */
export async function ownerStorageBytes(owner: Page, tenant: string): Promise<number> {
  const r = await call(owner, 'GET', `/api/v1/tenants/${tenant}/storage`);
  return (expectStatus(r, 200, 'getStorageUsage').body as { quotaBytes: number }).quotaBytes;
}

/** Лимит места владельцем через API (requestStorageChange quote → commit): предусловие и возврат сида. */
export async function setOwnerStorageGb(owner: Page, tenant: string, gb: number): Promise<void> {
  const bytes = gb * GiB;
  if ((await ownerStorageBytes(owner, tenant)) === bytes) return;
  const path = `/api/v1/tenants/${tenant}/storage/changes`;
  const quote = expectStatus(
    await call(owner, 'POST', path, { body: { requestedQuotaBytes: bytes, mode: 'quote' } }),
    201,
    `requestStorageChange quote ${gb} ГБ`,
  ).body as { quoteId: string };
  expectStatus(
    await call(owner, 'POST', path, {
      body: { requestedQuotaBytes: bytes, mode: 'commit', acceptedQuoteId: quote.quoteId },
    }),
    201,
    `requestStorageChange commit ${gb} ГБ`,
  );
}

/**
 * Шаг 4 порядка на открытой странице «Хранилище»: лимит не 100 ГБ — владелец выбирает «Новый лимит» 100 ГБ,
 * «Рассчитать» → «Применить». `true` — лимит пришлось поставить, `false` — он уже 100 ГБ.
 */
export async function alignStorage(owner: Page): Promise<boolean> {
  const quota = owner.locator('.ox-st-usage .ox-mod-storage-of');
  const want = `из ${PILOT.storageGb} ГБ`;
  await expect(quota).toBeVisible({ timeout: 30_000 });
  if ((await quota.textContent())?.trim() === want) return false;
  await owner.getByLabel('Новый лимит').selectOption(String(PILOT.storageGb));
  await owner.getByRole('button', { name: 'Рассчитать' }).click();
  const quote = owner.locator('.ox-st-quote');
  await expect(quote).toContainText(`Лимит ${PILOT.storageGb} ГБ`);
  await quote.getByRole('button', { name: 'Применить' }).click();
  await expect(owner.locator('.ox-toast .ox-toast-text')).toHaveText(
    `Лимит места: ${PILOT.storageGb} ГБ`,
  );
  await expect(quota).toHaveText(want);
  return true;
}
