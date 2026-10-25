// Кейсы контрактного PR этапа 5 (W5.00, 0.12.0-stage5): «Касса» (W5.31, W5.32, W5.33) на сиде «Альты» из эталона 19.10
// (design/ortus/cash.js seedAlta): кассы ca-spa (смены, ККТ вручную, допуск 100 ₽, смена 118 открыта), ca-term, ca-sever,
// подотчёты ca-adv-*, сейф, счёт; журнал K-301…K-326; перемещения tr-1…tr-4; чеки rc-1…rc-6; заявка rq-1 Марины
// Котовой; предложения pr-1…pr-4. Владелец — все права кассы; роли «Кассира» и «Менеджера» собираются кейсом через
// createRole и createAssignment (в сиде этапа 1 кассовых ролей нет — W5.30). Лимиты ролей — LIMITS сервера (installCash:
// Котова — расход до 5 000 ₽, возврат 0; Морозова — расход до 1 000 ₽). Примеры — tools/gen/examples-w500.mjs.
import { expect } from 'vitest';

import type { Reply, Session } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

type Body = Record<string, unknown> & {
  id?: string;
  status?: string;
  items?: Record<string, unknown>[];
  revision?: number;
  code?: string;
  reason?: string;
  amount?: { amountMinor: number };
  operations?: Record<string, unknown>[];
};
const body = (r: Reply): Body => r.body as Body;

const at = (ctx: CaseContext, rest: string) => `${ctx.alta}/cash/${rest}`;
const rub = (n: number) => ({ amountMinor: Math.round(n * 100), currency: 'RUB' });
const TENANT = { kind: 'tenant', resourceIds: [], includeDescendants: true };
const MISSING = '00000000-0000-5000-8000-0000000000aa';
const FILE = (ctx: CaseContext) => ctx.A('file-w500');

/** Роль с ключами и назначение участнику на всю организацию. */
async function grant(
  ctx: CaseContext,
  owner: Session,
  member: string,
  name: string,
  keys: string[],
) {
  const role = body(await owner.post(`${ctx.alta}/roles`, { name, permissions: keys }));
  await owner.post(`${ctx.alta}/assignments`, {
    principalType: 'member',
    principalId: ctx.A(member),
    roleId: role.id,
    scope: TENANT,
  });
}

/** Закрыть смену 118 «Кассы салона»: сверка по журналу сида — наличные 7 350 ₽, карты 12 000 ₽. */
const closeBody = (counted: number, extra: Record<string, unknown> = {}) => ({
  counted: rub(counted),
  counts: { '5000': 1, '1000': 2 },
  z: { number: '118', cash: rub(3000), card: rub(12000) },
  terminal: { card: rub(12000), sbp: rub(0) },
  ...extra,
});

/** Операция прихода в «Кассу салона» (смена 118) с чеком № ФД. */
const visitIn = (ctx: CaseContext, fd: string) => ({
  accountId: ctx.A('ca-spa'),
  type: 'in',
  direction: 'in',
  method: 'cash',
  amount: rub(2800),
  category: 'service_payment',
  categoryId: 'revenue-spa',
  basis: 'Массаж лица · Наталья С.',
  occurredAt: '2026-10-01T07:40:00Z',
  receipt: { fdNumber: fd, kktShift: '118', receiptAt: '2026-10-01T07:41:00Z' },
});

export const cashCases = cases('cash')([
  // ── кассы ──
  {
    title: 'владелец видит восемь касс «Альты» с остатками и своими правами',
    operationId: 'listCashAccounts',
    expect: 'success',
    example: 'listCashAccounts/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.get(at(ctx, 'accounts'));
      ctx.expectExample(r, 'listCashAccounts/ok');
      expect(body(r).items).toHaveLength(8);
    },
  },
  {
    title: 'фильтр по виду: подотчёты',
    operationId: 'listCashAccounts',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = body(await s.get(at(ctx, 'accounts?kind=advance')));
      expect(r.items?.map((a) => a.name)).toEqual([
        'Подотчёт · Илья Васильев',
        'Подотчёт · Тимур Ахмедов',
        'Подотчёт · Алексей Соколов',
      ]);
    },
  },
  {
    title: 'водителю без права кассы список закрыт',
    operationId: 'listCashAccounts',
    expect: 'error',
    example: 'listCashAccounts/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('driver');
      ctx.expectExample(await s.get(at(ctx, 'accounts')), 'listCashAccounts/forbidden_action');
    },
  },
  {
    title: 'без права «Видеть остаток» остаток скрыт (balance: null)',
    operationId: 'listCashAccounts',
    expect: 'success',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      await grant(ctx, owner, 'm-morozova', 'Кассир без остатка', ['cash.read', 'cash.post']);
      const s = await ctx.as('therapist');
      const r = body(await s.get(at(ctx, 'accounts')));
      expect(r.items?.length).toBe(8);
      expect(r.items?.every((a) => a.balance === null)).toBe(true);
    },
  },
  {
    title: 'новая касса бара со сменами',
    operationId: 'createCashAccount',
    expect: 'success',
    example: 'createCashAccount/created',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, 'accounts'), {
        orgUnitId: ctx.A('f-msk-sever'),
        name: 'Касса бара',
        currency: 'RUB',
        kind: 'cash_drawer',
        shiftMode: 'open',
      });
      ctx.expectExample(r, 'createCashAccount/created', 201);
      expect(r.headers.get('ETag')).toBe('"rev-1"');
    },
  },
  {
    title: 'название кассы уже занято — 422 с полем name',
    operationId: 'createCashAccount',
    expect: 'error',
    example: 'createCashAccount/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, 'accounts'), {
        orgUnitId: ctx.A('f-msk-sever'),
        name: 'касса ОФИСА',
        currency: 'RUB',
        kind: 'cash_drawer',
      });
      ctx.expectExample(r, 'createCashAccount/validation_failed', 422);
    },
  },
  {
    title: 'настраивать кассы водителю нельзя',
    operationId: 'createCashAccount',
    expect: 'error',
    example: 'createCashAccount/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('driver');
      const r = await s.post(at(ctx, 'accounts'), {
        orgUnitId: ctx.A('f-msk-sever'),
        name: 'Х',
        currency: 'RUB',
        kind: 'cash_drawer',
      });
      ctx.expectExample(r, 'createCashAccount/forbidden_action', 403);
    },
  },
  {
    title: 'терминал без кассы точки и подотчёт без держателя — 422',
    operationId: 'createCashAccount',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const t = await s.post(at(ctx, 'accounts'), {
        orgUnitId: null,
        name: 'Терминал бара',
        currency: 'RUB',
        kind: 'acquiring',
      });
      expect(t.status).toBe(422);
      const a = await s.post(at(ctx, 'accounts'), {
        orgUnitId: null,
        name: 'Подотчёт бара',
        currency: 'RUB',
        kind: 'advance',
      });
      expect(a.status).toBe(422);
    },
  },
  {
    title: '«Кто получит доступ»: владелец — единственный, у кого есть права на новую кассу',
    operationId: 'previewCashAccountAccess',
    expect: 'success',
    example: 'previewCashAccountAccess/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.get(
        at(ctx, `accounts/access-preview?kind=cash_drawer&orgUnitId=${ctx.A('f-msk-sever')}`),
      );
      ctx.expectExample(r, 'previewCashAccountAccess/ok');
    },
  },
  {
    title: 'для терминала не указана касса точки — 422',
    operationId: 'previewCashAccountAccess',
    expect: 'error',
    example: 'previewCashAccountAccess/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.get(at(ctx, 'accounts/access-preview?kind=acquiring'));
      ctx.expectExample(r, 'previewCashAccountAccess/validation_failed', 422);
    },
  },
  // ── журнал ──
  {
    title: 'журнал кассы: последние операции — K-326, K-325, K-324',
    operationId: 'listCashOperations',
    expect: 'success',
    example: 'listCashOperations/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.get(at(ctx, `operations?limit=3`));
      ctx.expectExample(r, 'listCashOperations/ok');
      const rows = await s.get(at(ctx, `operations?accountId=${ctx.A('ca-adv-vas')}`));
      expect(body(rows).items).toHaveLength(3);
    },
  },
  {
    title: 'журнал закрыт водителю',
    operationId: 'listCashOperations',
    expect: 'error',
    example: 'listCashOperations/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('driver');
      ctx.expectExample(await s.get(at(ctx, 'operations')), 'listCashOperations/forbidden_action');
    },
  },
  {
    title: 'приход 2 800 ₽ с чеком № ФД 4521 в смену 118',
    operationId: 'postCashOperation',
    expect: 'success',
    example: 'postCashOperation/created',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, 'operations'), visitIn(ctx, '4521'));
      ctx.expectExample(r, 'postCashOperation/created', 201);
      const accounts = body(await s.get(at(ctx, 'accounts')));
      const spa = accounts.items?.find((a) => a.id === ctx.A('ca-spa')) as {
        balance: { amountMinor: number };
      };
      expect(spa.balance.amountMinor).toBe(735000 + 280000);
    },
  },
  {
    title: 'расход больше остатка наличных — 409 insufficient_funds',
    operationId: 'postCashOperation',
    expect: 'error',
    example: 'postCashOperation/insufficient_funds',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, 'operations'), {
        accountId: ctx.A('ca-spa'),
        type: 'out',
        direction: 'out',
        method: 'cash',
        amount: rub(50000),
        category: 'expense',
        categoryId: 'household',
        basis: 'Закупка инвентаря',
        occurredAt: '2026-10-01T07:40:00Z',
      });
      ctx.expectExample(r, 'postCashOperation/insufficient_funds', 409);
    },
  },
  {
    title: 'смена закрыта — проводить некуда: 409 shift_closed',
    operationId: 'postCashOperation',
    expect: 'error',
    example: 'postCashOperation/shift_closed',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const c = await s.post(at(ctx, `shifts/${ctx.A('sh-118')}/close`), closeBody(7350), {
        ifMatch: 1,
      });
      expect(body(c).status).toBe('closed');
      const r = await s.post(at(ctx, 'operations'), visitIn(ctx, '4521'));
      ctx.expectExample(r, 'postCashOperation/shift_closed', 409);
    },
  },
  {
    title: '№ ФД 4520 в смене ККТ 118 уже внесён — 409 duplicate_receipt',
    operationId: 'postCashOperation',
    expect: 'error',
    example: 'postCashOperation/duplicate_receipt',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, 'operations'), visitIn(ctx, '4520'));
      ctx.expectExample(r, 'postCashOperation/duplicate_receipt', 409);
    },
  },
  {
    title: 'расход сверх лимита роли — 202 и заявка на согласование (Q-W4.00-cash-2)',
    operationId: 'postCashOperation',
    expect: 'success',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      await grant(ctx, owner, 'm-kotova', 'Менеджер кассы', [
        'cash.read',
        'cash.post',
        'cash.balance.read',
      ]);
      const s = await ctx.as('manager');
      const r = await s.post(at(ctx, 'operations'), {
        accountId: ctx.A('ca-sever'),
        type: 'out',
        direction: 'out',
        method: 'cash',
        amount: rub(6500),
        category: 'expense',
        categoryId: 'repair-small',
        basis: 'Ремонт ворот склада',
        occurredAt: '2026-10-01T07:40:00Z',
      });
      expect(r.status).toBe(202);
      expect(body(r).status).toBe('pending');
      expect(body(r).amount?.amountMinor).toBe(650000);
      const ok = await s.post(at(ctx, 'operations'), {
        accountId: ctx.A('ca-sever'),
        type: 'out',
        direction: 'out',
        method: 'cash',
        amount: rub(4000),
        category: 'expense',
        categoryId: 'household',
        basis: 'Канцтовары',
        occurredAt: '2026-10-01T07:41:00Z',
      });
      expect(ok.status).toBe(201);
    },
  },
  {
    title: 'сторно оплаты K-325 владельцем: новая запись, исходная не меняется',
    operationId: 'reverseCashOperation',
    expect: 'success',
    example: 'reverseCashOperation/created',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, `operations/${ctx.A('K-325')}/reverse`), {
        reason: 'Ошибочная оплата',
      });
      ctx.expectExample(r, 'reverseCashOperation/created', 201);
      const rows = body(await s.get(at(ctx, `operations?type=storno`)));
      expect(rows.items).toHaveLength(1);
      expect((rows.items?.[0] as { reversesOperationId: string }).reversesOperationId).toBe(
        ctx.A('K-325'),
      );
    },
  },
  {
    title: 'своя операция — сторнирует другой сотрудник: 403 self_approval',
    operationId: 'reverseCashOperation',
    expect: 'error',
    example: 'reverseCashOperation/self_approval',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      await grant(ctx, owner, 'm-morozova', 'Кассир со сторно', [
        'cash.read',
        'cash.post',
        'cash.reverse',
      ]);
      const s = await ctx.as('therapist');
      const r = await s.post(at(ctx, `operations/${ctx.A('K-325')}/reverse`), {
        reason: 'Ошибочная оплата',
      });
      ctx.expectExample(r, 'reverseCashOperation/self_approval', 403);
    },
  },
  {
    title: 'операция уже сторнирована — 409',
    operationId: 'reverseCashOperation',
    expect: 'error',
    example: 'reverseCashOperation/invalid_transition',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      await s.post(at(ctx, `operations/${ctx.A('K-325')}/reverse`), { reason: 'Ошибочная оплата' });
      const r = await s.post(at(ctx, `operations/${ctx.A('K-325')}/reverse`), {
        reason: 'Ещё раз',
      });
      ctx.expectExample(r, 'reverseCashOperation/invalid_transition', 409);
    },
  },
  {
    title: 'связь операции с расходом рейса — отдельной записью',
    operationId: 'linkCashOperationSource',
    expect: 'success',
    example: 'linkCashOperationSource/created',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, `operations/${ctx.A('K-326')}/source-link`), {
        source: {
          key: 'visit:ap-pr1',
          kind: 'visit',
          id: ctx.A('ap-pr1'),
          label: 'Визит 30.09 18:00',
        },
      });
      ctx.expectExample(r, 'linkCashOperationSource/created', 201);
    },
  },
  {
    title: 'источник уже проведён — 409 duplicate_source',
    operationId: 'linkCashOperationSource',
    expect: 'error',
    example: 'linkCashOperationSource/duplicate_source',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, `operations/${ctx.A('K-326')}/source-link`), {
        source: {
          key: 'receipt:rc-1',
          kind: 'receipt',
          id: ctx.A('rc-1'),
          label: 'Чек Ильи Васильева',
        },
      });
      ctx.expectExample(r, 'linkCashOperationSource/duplicate_source', 409);
    },
  },
  {
    title: '«Похоже на дубль»: та же сумма, способ и тип в пределах 10 минут',
    operationId: 'findCashDuplicates',
    expect: 'success',
    example: 'findCashDuplicates/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const q = `accountId=${ctx.A('ca-spa')}&amountMinor=300000&method=cash&type=in&at=2026-10-01T07:20:00Z`;
      const r = await s.get(at(ctx, `duplicates?${q}`));
      ctx.expectExample(r, 'findCashDuplicates/ok');
      expect(body(r).items).toHaveLength(1);
    },
  },
  {
    title: 'дубля нет и без права «Вносить приход» поиск закрыт',
    operationId: 'findCashDuplicates',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('driver');
      const r = await s.get(at(ctx, `duplicates?accountId=${ctx.A('ca-spa')}&amountMinor=100`));
      expect(r.status).toBe(403);
    },
  },
  // ── предложения ──
  {
    title:
      'входящие: визит, возврат, оплата заказчика и выплата бригаде (финансовый блок — владельцу)',
    operationId: 'listCashProposals',
    expect: 'success',
    example: 'listCashProposals/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.get(at(ctx, 'proposals'));
      ctx.expectExample(r, 'listCashProposals/ok');
      expect(body(r).items).toHaveLength(4);
    },
  },
  {
    title: 'входящие закрыты водителю',
    operationId: 'listCashProposals',
    expect: 'error',
    example: 'listCashProposals/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('driver');
      ctx.expectExample(await s.get(at(ctx, 'proposals')), 'listCashProposals/forbidden_action');
    },
  },
  {
    title: 'провести визит pr-1 в смену 118: одна операция, предложение — проведено',
    operationId: 'postCashProposal',
    expect: 'success',
    example: 'postCashProposal/created',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, 'proposals/visit:pr-1/post'), {
        accountId: ctx.A('ca-spa'),
        parts: [{ method: 'cash', amount: rub(2800) }],
        receipt: { fdNumber: '4521', kktShift: '118', receiptAt: '2026-10-01T07:41:00Z' },
      });
      ctx.expectExample(r, 'postCashProposal/created', 201);
      expect(body(r).operations).toHaveLength(1);
    },
  },
  {
    title: 'визит оплачен частями: наличные и карта — две операции одной группы',
    operationId: 'postCashProposal',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, 'proposals/visit:pr-1/post'), {
        accountId: ctx.A('ca-spa'),
        parts: [
          { method: 'cash', amount: rub(1800) },
          { method: 'card', amount: rub(1000) },
        ],
      });
      expect(r.status).toBe(201);
      const ops = body(r).operations as { groupId: string; method: string; accountId: string }[];
      expect(ops.map((o) => o.method)).toEqual(['cash', 'card']);
      expect(new Set(ops.map((o) => o.groupId)).size).toBe(1);
      expect(ops[1]?.accountId).toBe(ctx.A('ca-term'));
    },
  },
  {
    title: 'источник уже привязан к операции — 409 duplicate_source',
    operationId: 'postCashProposal',
    expect: 'error',
    example: 'postCashProposal/duplicate_source',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      await s.post(at(ctx, `operations/${ctx.A('K-326')}/source-link`), {
        source: {
          key: 'visit:pr-1',
          kind: 'visit',
          id: ctx.A('visit-pr-1'),
          label: 'Визит 30.09 18:00',
        },
      });
      const r = await s.post(at(ctx, 'proposals/visit:pr-1/post'), {
        accountId: ctx.A('ca-spa'),
        parts: [{ method: 'cash', amount: rub(2800) }],
      });
      ctx.expectExample(r, 'postCashProposal/duplicate_source', 409);
    },
  },
  {
    title: 'не проводить: возврат pr-2 отклонён с причиной',
    operationId: 'dismissCashProposal',
    expect: 'success',
    example: 'dismissCashProposal/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, 'proposals/service_request:pr-2/dismiss'), {
        reason: 'Клиент отказался от компенсации',
      });
      ctx.expectExample(r, 'dismissCashProposal/ok');
    },
  },
  {
    title: 'предложение уже отклонено — 409',
    operationId: 'dismissCashProposal',
    expect: 'error',
    example: 'dismissCashProposal/invalid_transition',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      await s.post(at(ctx, 'proposals/service_request:pr-2/dismiss'), {
        reason: 'Клиент отказался от компенсации',
      });
      const r = await s.post(at(ctx, 'proposals/service_request:pr-2/dismiss'), {
        reason: 'Ещё раз',
      });
      ctx.expectExample(r, 'dismissCashProposal/invalid_transition', 409);
    },
  },
  // ── смены ──
  {
    title: 'смены: открытая 118 и закрытая 117 с попыткой закрытия',
    operationId: 'listCashShifts',
    expect: 'success',
    example: 'listCashShifts/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.get(at(ctx, 'shifts'));
      ctx.expectExample(r, 'listCashShifts/ok');
      const open = body(await s.get(at(ctx, 'shifts?status=open')));
      expect(open.items).toHaveLength(1);
    },
  },
  {
    title: 'смены закрыты водителю',
    operationId: 'listCashShifts',
    expect: 'error',
    example: 'listCashShifts/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('driver');
      ctx.expectExample(await s.get(at(ctx, 'shifts')), 'listCashShifts/forbidden_action');
    },
  },
  {
    title: 'смена закрыта со сдачей в сейф, новая смена открыта с размена 5 000 ₽',
    operationId: 'openCashShift',
    expect: 'success',
    example: 'openCashShift/created',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const c = await s.post(
        at(ctx, `shifts/${ctx.A('sh-118')}/close`),
        closeBody(7350, { toSafe: true }),
        { ifMatch: 1 },
      );
      expect(body(c).status).toBe('closed');
      const r = await s.post(at(ctx, `accounts/${ctx.A('ca-spa')}/shifts`), {
        countedFloat: rub(5000),
      });
      ctx.expectExample(r, 'openCashShift/created', 201);
    },
  },
  {
    title: 'смена уже открыта — 409',
    operationId: 'openCashShift',
    expect: 'error',
    example: 'openCashShift/invalid_transition',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, `accounts/${ctx.A('ca-spa')}/shifts`), {
        countedFloat: rub(5000),
      });
      ctx.expectExample(r, 'openCashShift/invalid_transition', 409);
    },
  },
  {
    title: 'недостача 350 ₽ выше допуска 100 ₽: смена уходит на решение, попытка сохранена',
    operationId: 'closeCashShift',
    expect: 'success',
    example: 'closeCashShift/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, `shifts/${ctx.A('sh-118')}/close`), closeBody(7000), {
        ifMatch: 1,
      });
      ctx.expectExample(r, 'closeCashShift/ok');
      expect(body(r).status).toBe('review');
      expect(body(r).attempts).toHaveLength(1);
    },
  },
  {
    title: 'смена 117 уже закрыта — 409 shift_closed',
    operationId: 'closeCashShift',
    expect: 'error',
    example: 'closeCashShift/shift_closed',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, `shifts/${ctx.A('sh-117')}/close`), closeBody(7350), {
        ifMatch: 3,
      });
      ctx.expectExample(r, 'closeCashShift/shift_closed', 409);
    },
  },
  {
    title: 'смену уже изменили — 412',
    operationId: 'closeCashShift',
    expect: 'error',
    example: 'closeCashShift/revision_mismatch',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, `shifts/${ctx.A('sh-118')}/close`), closeBody(7350), {
        ifMatch: 99,
      });
      ctx.expectExample(r, 'closeCashShift/revision_mismatch', 412);
    },
  },
  {
    title: 'без Z-отчёта смена с ККТ вручную не закрывается — 422',
    operationId: 'closeCashShift',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(
        at(ctx, `shifts/${ctx.A('sh-118')}/close`),
        { counted: rub(7350) },
        { ifMatch: 1 },
      );
      expect(r.status).toBe(422);
    },
  },
  {
    title: 'расхождение принимает владелец, смену закрывала Морозова',
    operationId: 'reviewCashShift',
    expect: 'success',
    example: 'reviewCashShift/ok',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      await grant(ctx, owner, 'm-morozova', 'Кассир салона', [
        'cash.read',
        'cash.post',
        'cash.shift.operate',
        'cash.balance.read',
      ]);
      const cashier = await ctx.as('therapist');
      const c = await cashier.post(at(ctx, `shifts/${ctx.A('sh-118')}/close`), closeBody(7000), {
        ifMatch: 1,
      });
      expect(body(c).status).toBe('review');
      const r = await owner.post(
        at(ctx, `shifts/${ctx.A('sh-118')}/review`),
        { decision: 'accept', reason: 'Сдача мелочью' },
        { ifMatch: 2 },
      );
      ctx.expectExample(r, 'reviewCashShift/ok');
      expect(body(r).status).toBe('closed');
    },
  },
  {
    title: 'расхождение принимает не тот, кто закрывал смену: 403 self_approval',
    operationId: 'reviewCashShift',
    expect: 'error',
    example: 'reviewCashShift/self_approval',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      await s.post(at(ctx, `shifts/${ctx.A('sh-118')}/close`), closeBody(7000), { ifMatch: 1 });
      const r = await s.post(
        at(ctx, `shifts/${ctx.A('sh-118')}/review`),
        { decision: 'accept', reason: 'Сдача мелочью' },
        { ifMatch: 2 },
      );
      ctx.expectExample(r, 'reviewCashShift/self_approval', 403);
    },
  },
  {
    title:
      '«Вернуть на пересчёт»: смена снова открыта, попытка закрытия не стирается (Q-W4.00-cash-4)',
    operationId: 'reviewCashShift',
    expect: 'success',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      await grant(ctx, owner, 'm-morozova', 'Кассир салона', ['cash.read', 'cash.shift.operate']);
      const cashier = await ctx.as('therapist');
      await cashier.post(at(ctx, `shifts/${ctx.A('sh-118')}/close`), closeBody(7000), {
        ifMatch: 1,
      });
      const r = body(
        await owner.post(
          at(ctx, `shifts/${ctx.A('sh-118')}/review`),
          { decision: 'recount', reason: 'Пересчитайте купюры' },
          { ifMatch: 2 },
        ),
      );
      expect(r.status).toBe('open');
      expect(r.attempts).toHaveLength(1);
      expect((r.attempts as { recountReason: string }[])[0]?.recountReason).toBe(
        'Пересчитайте купюры',
      );
    },
  },
  // ── перемещения ──
  {
    title: 'перемещения: в пути и принятые',
    operationId: 'listCashTransfers',
    expect: 'success',
    example: 'listCashTransfers/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const t = await s.post(at(ctx, 'transfers'), {
        fromAccountId: ctx.A('ca-sever'),
        toAccountId: ctx.A('ca-safe'),
        amount: rub(20000),
        note: 'Сдача в сейф',
      });
      expect(t.status).toBe(201);
      await s.post(at(ctx, `accounts/${ctx.A('ca-adv-vas')}/advance-issues`), {
        sourceAccountId: ctx.A('ca-sever'),
        amount: rub(5000),
        dueDate: '2026-10-10',
      });
      const r = await s.get(at(ctx, 'transfers'));
      ctx.expectExample(r, 'listCashTransfers/ok');
      const transit = body(await s.get(at(ctx, 'transfers?status=transit')));
      expect(transit.items).toHaveLength(1);
    },
  },
  {
    title: 'перемещения закрыты водителю',
    operationId: 'listCashTransfers',
    expect: 'error',
    example: 'listCashTransfers/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('driver');
      ctx.expectExample(await s.get(at(ctx, 'transfers')), 'listCashTransfers/forbidden_action');
    },
  },
  {
    title: 'сдать 20 000 ₽ из кассы офиса в сейф: «в пути», расход у отправителя',
    operationId: 'createCashTransfer',
    expect: 'success',
    example: 'createCashTransfer/created',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, 'transfers'), {
        fromAccountId: ctx.A('ca-sever'),
        toAccountId: ctx.A('ca-safe'),
        amount: rub(20000),
        note: 'Сдача в сейф',
      });
      ctx.expectExample(r, 'createCashTransfer/created', 201);
    },
  },
  {
    title: 'больше остатка кассы — 409 insufficient_funds',
    operationId: 'createCashTransfer',
    expect: 'error',
    example: 'createCashTransfer/insufficient_funds',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, 'transfers'), {
        fromAccountId: ctx.A('ca-sever'),
        toAccountId: ctx.A('ca-safe'),
        amount: rub(900000),
      });
      ctx.expectExample(r, 'createCashTransfer/insufficient_funds', 409);
    },
  },
  {
    title: 'сейф принимает: move_in у получателя',
    operationId: 'decideCashTransfer',
    expect: 'success',
    example: 'decideCashTransfer/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const t = body(
        await s.post(at(ctx, 'transfers'), {
          fromAccountId: ctx.A('ca-sever'),
          toAccountId: ctx.A('ca-safe'),
          amount: rub(20000),
          note: 'Сдача в сейф',
        }),
      );
      const r = await s.post(
        at(ctx, `transfers/${t.id}/decision`),
        { decision: 'accept' },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'decideCashTransfer/ok');
    },
  },
  {
    title: 'перемещение уже принято — 409 invalid_transition (transfer_decided)',
    operationId: 'decideCashTransfer',
    expect: 'error',
    example: 'decideCashTransfer/invalid_transition',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const t = body(
        await s.post(at(ctx, 'transfers'), {
          fromAccountId: ctx.A('ca-sever'),
          toAccountId: ctx.A('ca-safe'),
          amount: rub(20000),
          note: 'Сдача в сейф',
        }),
      );
      await s.post(at(ctx, `transfers/${t.id}/decision`), { decision: 'accept' }, { ifMatch: 1 });
      const r = await s.post(
        at(ctx, `transfers/${t.id}/decision`),
        { decision: 'accept' },
        { ifMatch: 2 },
      );
      ctx.expectExample(r, 'decideCashTransfer/invalid_transition', 409);
    },
  },
  {
    title: 'отказ от перемещения без причины — 422, с причиной — деньги возвращаются отправителю',
    operationId: 'decideCashTransfer',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const t = body(
        await s.post(at(ctx, 'transfers'), {
          fromAccountId: ctx.A('ca-sever'),
          toAccountId: ctx.A('ca-safe'),
          amount: rub(20000),
        }),
      );
      expect(
        (
          await s.post(
            at(ctx, `transfers/${t.id}/decision`),
            { decision: 'reject' },
            { ifMatch: 1 },
          )
        ).status,
      ).toBe(422);
      const r = body(
        await s.post(
          at(ctx, `transfers/${t.id}/decision`),
          { decision: 'reject', reason: 'Не пришли деньги' },
          { ifMatch: 1 },
        ),
      );
      expect(r.status).toBe('rejected');
      const accounts = body(await s.get(at(ctx, 'accounts')));
      const sever = accounts.items?.find((a) => a.id === ctx.A('ca-sever')) as {
        balance: { amountMinor: number };
      };
      expect(sever.balance.amountMinor).toBe(3076000);
    },
  },
  // ── подотчёт ──
  {
    title: 'выдать Илье Васильеву 5 000 ₽ под отчёт из кассы офиса',
    operationId: 'issueCashAdvance',
    expect: 'success',
    example: 'issueCashAdvance/created',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, `accounts/${ctx.A('ca-adv-vas')}/advance-issues`), {
        sourceAccountId: ctx.A('ca-sever'),
        amount: rub(5000),
        dueDate: '2026-10-10',
      });
      ctx.expectExample(r, 'issueCashAdvance/created', 201);
    },
  },
  {
    title: 'под отчёт себе выдаёт другой сотрудник: 403 self_approval',
    operationId: 'issueCashAdvance',
    expect: 'error',
    example: 'issueCashAdvance/self_approval',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      await grant(ctx, owner, 'm-vasiliev', 'Выдающий подотчёт', [
        'cash.read',
        'cash.advance.issue',
      ]);
      const s = await ctx.as('driver');
      const r = await s.post(at(ctx, `accounts/${ctx.A('ca-adv-vas')}/advance-issues`), {
        sourceAccountId: ctx.A('ca-sever'),
        amount: rub(1000),
        dueDate: '2026-10-10',
      });
      ctx.expectExample(r, 'issueCashAdvance/self_approval', 403);
    },
  },
  {
    title: 'выдача сверх лимита роли — 202 и заявка',
    operationId: 'issueCashAdvance',
    expect: 'success',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      await grant(ctx, owner, 'm-morozova', 'Администратор салона', [
        'cash.read',
        'cash.advance.issue',
      ]);
      const s = await ctx.as('therapist');
      const r = await s.post(at(ctx, `accounts/${ctx.A('ca-adv-vas')}/advance-issues`), {
        sourceAccountId: ctx.A('ca-spa'),
        amount: rub(1000),
        dueDate: '2026-10-10',
      });
      expect(r.status).toBe(202);
      expect(body(r).type).toBe('issue');
    },
  },
  {
    title: 'чек подотчёта: мойка 500 ₽ на проверке',
    operationId: 'submitAdvanceReceipt',
    expect: 'success',
    example: 'submitAdvanceReceipt/created',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, `accounts/${ctx.A('ca-adv-vas')}/receipts`), {
        amount: rub(500),
        categoryId: 'wash',
        fileId: FILE(ctx),
        link: { key: 'trip:r203', kind: 'trip', id: ctx.A('trip-r203'), label: 'Рейс Р-203' },
        redoOfReceiptId: ctx.A('rc-4'),
      });
      ctx.expectExample(r, 'submitAdvanceReceipt/created', 201);
    },
  },
  {
    title: 'чек больше остатка подотчёта — 409 insufficient_funds',
    operationId: 'submitAdvanceReceipt',
    expect: 'error',
    example: 'submitAdvanceReceipt/insufficient_funds',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, `accounts/${ctx.A('ca-adv-vas')}/receipts`), {
        amount: rub(90000),
        categoryId: 'fuel',
        fileId: FILE(ctx),
      });
      ctx.expectExample(r, 'submitAdvanceReceipt/insufficient_funds', 409);
    },
  },
  {
    title: 'чеки подотчёта Ильи Васильева: на проверке и отклонённый',
    operationId: 'listAdvanceReceipts',
    expect: 'success',
    example: 'listAdvanceReceipts/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.get(at(ctx, `receipts?accountId=${ctx.A('ca-adv-vas')}&limit=2`));
      ctx.expectExample(r, 'listAdvanceReceipts/ok');
    },
  },
  {
    title: 'чеки закрыты водителю без права подотчёта',
    operationId: 'listAdvanceReceipts',
    expect: 'error',
    example: 'listAdvanceReceipts/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('driver');
      ctx.expectExample(await s.get(at(ctx, 'receipts')), 'listAdvanceReceipts/forbidden_action');
    },
  },
  {
    title: 'владелец принимает чек rc-3: расход подотчёта',
    operationId: 'decideAdvanceReceipt',
    expect: 'success',
    example: 'decideAdvanceReceipt/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(
        at(ctx, `receipts/${ctx.A('rc-3')}/decision`),
        { decision: 'accept' },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'decideAdvanceReceipt/ok');
    },
  },
  {
    title: 'чек принимает не его автор: 403 self_approval',
    operationId: 'decideAdvanceReceipt',
    expect: 'error',
    example: 'decideAdvanceReceipt/self_approval',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const mine = body(
        await s.post(at(ctx, `accounts/${ctx.A('ca-adv-vas')}/receipts`), {
          amount: rub(500),
          categoryId: 'wash',
          fileId: FILE(ctx),
        }),
      );
      const r = await s.post(
        at(ctx, `receipts/${mine.id}/decision`),
        { decision: 'accept' },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'decideAdvanceReceipt/self_approval', 403);
    },
  },
  {
    title: 'вернуть остаток 1 000 ₽: подотчёт → касса выдачи, в пути',
    operationId: 'returnCashAdvance',
    expect: 'success',
    example: 'returnCashAdvance/created',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, `accounts/${ctx.A('ca-adv-vas')}/advance-returns`), {
        amount: rub(1000),
      });
      ctx.expectExample(r, 'returnCashAdvance/created', 201);
    },
  },
  {
    title: 'возвращаемая сумма больше остатка подотчёта — 409',
    operationId: 'returnCashAdvance',
    expect: 'error',
    example: 'returnCashAdvance/insufficient_funds',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(at(ctx, `accounts/${ctx.A('ca-adv-vas')}/advance-returns`), {
        amount: rub(90000),
      });
      ctx.expectExample(r, 'returnCashAdvance/insufficient_funds', 409);
    },
  },
  // ── заявки, статьи ──
  {
    title: 'заявка rq-1 Марины Котовой: расход 6 500 ₽ при лимите 5 000 ₽',
    operationId: 'listCashApprovalRequests',
    expect: 'success',
    example: 'listCashApprovalRequests/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(at(ctx, 'approval-requests')), 'listCashApprovalRequests/ok');
    },
  },
  {
    title: 'заявки закрыты водителю',
    operationId: 'listCashApprovalRequests',
    expect: 'error',
    example: 'listCashApprovalRequests/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('driver');
      ctx.expectExample(
        await s.get(at(ctx, 'approval-requests')),
        'listCashApprovalRequests/forbidden_action',
      );
    },
  },
  {
    title: 'владелец согласует rq-1: операция от имени автора с approvedBy',
    operationId: 'decideCashApprovalRequest',
    expect: 'success',
    example: 'decideCashApprovalRequest/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(
        at(ctx, `approval-requests/${ctx.A('rq-1')}/decision`),
        { decision: 'approve' },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'decideCashApprovalRequest/ok');
      const ops = body(await s.get(at(ctx, `operations?accountId=${ctx.A('ca-sever')}&limit=1`)));
      expect((ops.items?.[0] as { approvedByMemberId: string }).approvedByMemberId).toBe(
        ctx.A('m-owner'),
      );
    },
  },
  {
    title: 'заявку согласует не её автор: 403 self_approval',
    operationId: 'decideCashApprovalRequest',
    expect: 'error',
    example: 'decideCashApprovalRequest/self_approval',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      await grant(ctx, owner, 'm-kotova', 'Менеджер кассы', ['cash.read', 'cash.approve']);
      const s = await ctx.as('manager');
      const r = await s.post(
        at(ctx, `approval-requests/${ctx.A('rq-1')}/decision`),
        { decision: 'approve' },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'decideCashApprovalRequest/self_approval', 403);
    },
  },
  {
    title: 'статьи кассы — сидовый справочник',
    operationId: 'listCashCategories',
    expect: 'success',
    example: 'listCashCategories/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.get(at(ctx, 'categories'));
      ctx.expectExample(r, 'listCashCategories/ok');
      expect(body(r).items).toHaveLength(14);
    },
  },
  {
    title: 'статьи закрыты водителю',
    operationId: 'listCashCategories',
    expect: 'error',
    example: 'listCashCategories/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('driver');
      ctx.expectExample(await s.get(at(ctx, 'categories')), 'listCashCategories/forbidden_action');
    },
  },
  {
    title: 'нет такой операции, кассы, смены — 404, как у чужого',
    operationId: 'reverseCashOperation',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      expect(
        (await s.post(at(ctx, `operations/${MISSING}/reverse`), { reason: 'Нет такой' })).status,
      ).toBe(404);
      expect(
        (await s.post(at(ctx, `shifts/${MISSING}/close`), closeBody(1), { ifMatch: 1 })).status,
      ).toBe(404);
      expect(
        (await s.post(at(ctx, `accounts/${MISSING}/shifts`), { countedFloat: rub(1) })).status,
      ).toBe(404);
    },
  },
]);
