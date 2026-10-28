// W2.103 · Данные «Кассы» для строк @stand: кассы, сейф, начальный остаток и смена создаются командами API (Cash, W5.31)
// из сессии владельца. Названия несут метку прогона: три проекта и повторы не пересекаются, а касса прошлого прогона
// не мешает — страница показывает все кассы области, нужная находится по названию.
import type { Page } from '@playwright/test';

import { expectStatus, listUnits, runLabel } from './_stand/stand.ts';
import { memberIdByEmail } from './docs.stand.ts';
import { call } from './shell.helpers.ts';

export interface StandAccount {
  id: string;
  name: string;
  orgUnitId: string | null;
  label: string;
}

const money = (rub: number): { amountMinor: number; currency: 'RUB' } => ({
  amountMinor: Math.round(rub * 100),
  currency: 'RUB',
});

/** Касса подразделения (createCashAccount): режим смен `shiftMode`, без ККТ, допуск расхождения 100 ₽. */
export async function cashDrawer(
  page: Page,
  tenant: string,
  project: string,
  o: { shiftMode?: 'none' | 'open' | 'blind'; opening?: number; label?: string } = {},
): Promise<StandAccount> {
  const label = o.label ?? runLabel(project);
  const units = await listUnits(page, tenant);
  const unit = units.find((u) => u.kind === 'company') ?? units[0];
  if (!unit) throw new Error('в организации нет подразделений');
  const name = `Касса ${label}`;
  const r = expectStatus(
    await call(page, 'POST', `/api/v1/tenants/${tenant}/cash/accounts`, {
      body: {
        orgUnitId: unit.id,
        name,
        currency: 'RUB',
        kind: 'cash_drawer',
        shiftMode: o.shiftMode ?? 'none',
        kktMode: 'none',
        floatAmount: money(0),
        tolerance: money(100),
      },
    }),
    201,
    'createCashAccount',
  );
  const acc = r.body as { id: string };
  if (o.opening) await openingBalance(page, tenant, acc.id, o.opening);
  return { id: acc.id, name, orgUnitId: unit.id, label };
}

/** Сейф организации (подразделения нет) — приёмник перемещений. */
export async function cashSafe(
  page: Page,
  tenant: string,
  project: string,
  label = runLabel(project),
): Promise<StandAccount> {
  const name = `Сейф ${label}`;
  const r = expectStatus(
    await call(page, 'POST', `/api/v1/tenants/${tenant}/cash/accounts`, {
      body: { orgUnitId: null, name, currency: 'RUB', kind: 'safe' },
    }),
    201,
    'createCashAccount safe',
  );
  return { id: (r.body as { id: string }).id, name, orgUnitId: null, label };
}

/** Начальный остаток — явная проводка `opening` (Q-W4.00-cash-8), деньги не появляются сами. */
export async function openingBalance(
  page: Page,
  tenant: string,
  accountId: string,
  rub: number,
): Promise<void> {
  expectStatus(
    await call(page, 'POST', `/api/v1/tenants/${tenant}/cash/operations`, {
      body: {
        accountId,
        direction: 'in',
        amount: money(rub),
        category: 'opening_balance',
        type: 'opening',
        method: 'cash',
        basis: 'Остаток на начало стенда',
        occurredAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      },
    }),
    201,
    'postCashOperation opening',
  );
}

/** Открыть смену кассы с пересчитанным размером размена (openCashShift). */
export async function openShift(
  page: Page,
  tenant: string,
  accountId: string,
  floatRub = 0,
): Promise<{ id: string; number: number }> {
  const r = expectStatus(
    await call(page, 'POST', `/api/v1/tenants/${tenant}/cash/accounts/${accountId}/shifts`, {
      body: { countedFloat: money(floatRub) },
    }),
    201,
    'openCashShift',
  );
  return r.body as { id: string; number: number };
}

/** Подотчёт держателя: касса-источник с остатком, счёт подотчёта на держателя и выдача (advance-issues). */
export async function advanceFor(
  page: Page,
  tenant: string,
  project: string,
  o: { holderEmail: string; funds: number; issued: number; label?: string },
): Promise<StandAccount & { holderMemberId: string; sourceId: string }> {
  const label = o.label ?? runLabel(project);
  const source = await cashDrawer(page, tenant, project, { opening: o.funds, label: `${label}s` });
  const holder = await memberIdByEmail(page, tenant, o.holderEmail);
  // Подотчёт лежит в подразделении держателя: право cash.advance.self выдано в его области.
  const members = expectStatus(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/members?limit=200`),
    200,
    'listMembers',
  ).body as { items: { id: string; orgUnitIds?: string[] }[] };
  const unitId = members.items.find((m) => m.id === holder)?.orgUnitIds?.[0];
  if (!unitId) throw new Error('у держателя нет подразделения');
  // Страница «Мой подотчёт» показывает карточку на каждый счёт держателя, поэтому счёт у держателя один на стенд:
  // он создаётся первым тестом, остальные пополняют его выдачей.
  const all = expectStatus(
    await call(page, 'GET', `/api/v1/tenants/${tenant}/cash/accounts?limit=200`),
    200,
    'listCashAccounts',
  ).body as { items: { id: string; name: string; kind: string; holderMemberId?: string | null }[] };
  const known = all.items.find((a) => a.kind === 'advance' && a.holderMemberId === holder);
  const name = known?.name ?? `Подотчёт ${label}`;
  const acc = known
    ? { id: known.id }
    : (expectStatus(
        await call(page, 'POST', `/api/v1/tenants/${tenant}/cash/accounts`, {
          body: {
            orgUnitId: unitId,
            name,
            currency: 'RUB',
            kind: 'advance',
            holderMemberId: holder,
            advanceLimit: money(5_000_000),
            // Остаток возвращается в кассу, из которой счёт пополняется (по умолчанию — drawerAccountId).
            drawerAccountId: source.id,
          },
        }),
        201,
        'createCashAccount advance',
      ).body as { id: string });
  const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const issued = expectStatus(
    await call(page, 'POST', `/api/v1/tenants/${tenant}/cash/accounts/${acc.id}/advance-issues`, {
      body: { sourceAccountId: source.id, amount: money(o.issued), dueDate: due },
    }),
    201,
    'issueCashAdvance',
  ).body as { id: string; revision: number };
  // Держатель с одним `cash.advance.self` не видит перемещения (Q-W5.33-8) и принять выдачу не может — её принимает
  // кассир (владелец, право cash.transfer): деньги встают на счёт подотчёта.
  expectStatus(
    await call(page, 'POST', `/api/v1/tenants/${tenant}/cash/transfers/${issued.id}/decision`, {
      body: { decision: 'accept' },
      ifMatch: `"rev-${issued.revision}"`,
    }),
    200,
    'decideCashTransfer accept',
  );
  return {
    id: acc.id,
    name,
    orgUnitId: unitId,
    label,
    holderMemberId: holder,
    sourceId: source.id,
  };
}
