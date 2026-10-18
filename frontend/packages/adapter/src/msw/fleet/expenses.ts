// Тег Fleet, контракт 0.5.0-stage2 (W2.00): расходы рейса (api.js addExpense: сумма 0 < a ≤ 200 000 ₽, чек готов)
// и их проверка менеджером (S2-11). Категории — шесть кодов ответа владельца 17.10 на D-12 комплекта (W2.40,
// 0.5.1-stage2): у «прочее» комментарий обязателен; штрафы — не расход; расход ≠ выплата ≠ начисление.
// W2.52 (0.6.1-stage2): справочник категорий тенанта (fleet.expense_categories) — список, создание и архивация
// владельцем (modules.settings.manage); kind расхода — код активной категории, комментарий — по commentRequired.
import type { components } from '@ortus/api-client';

import { page } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import { type CategoryRow, fleetOf, tripForCommand, tripOr404 } from './state.ts';

type S = components['schemas'];

/** 200 000 ₽ в копейках — верхняя граница суммы расхода (validateExpense эталона). */
const MAX_MINOR = 200_000 * 100;
/** Расходы пишутся в рейсе, который идёт или сдаётся (dr.showExp эталона: в рейсе и при сдаче). */
const OPEN: readonly S['TripState'][] = ['on_route', 'returning', 'rework'];
/**
 * Текст 422 «комментарий обязателен»: для «Прочее» — @ortus/texts errors.mock.logistics.expenseOtherComment
 * (W2.40), для категории владельца — та же формула с её подписью.
 */
const commentText = (label: string): string => `Для категории «${label}» добавьте комментарий`;
const DUPLICATE = 'Такая категория уже есть';

/** ExpenseCategory контракта (без порядка каталога). */
export const categoryDto = (c: CategoryRow): S['ExpenseCategory'] => ({
  code: c.code,
  label: c.label,
  commentRequired: c.commentRequired,
  seeded: c.seeded,
  state: c.state,
  ...(c.archivedAt ? { archivedAt: c.archivedAt } : {}),
  ...(c.archivedByMemberId ? { archivedByMemberId: c.archivedByMemberId } : {}),
  createdAt: c.createdAt,
  revision: c.revision,
});

/** Категории в порядке каталога: посев, затем по созданию. */
export const categoriesOf = (rows: readonly CategoryRow[]): CategoryRow[] =>
  [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));

const sameLabel = (a: string, b: string): boolean =>
  a.trim().toLocaleLowerCase('ru') === b.trim().toLocaleLowerCase('ru');

function categoryOr404(ctx: HandlerContext): CategoryRow {
  const c = fleetOf(ctx.org().org).categories.find((x) => x.code === ctx.params.categoryCode);
  if (!c) fail('not_found', 'Категория не найдена.');
  return c;
}

function expenseOr404(ctx: HandlerContext, key: string): S['TripExpense'] {
  const trip = key === 'fleet.expenses.review' ? tripForCommand(ctx, key) : tripOr404(ctx, key);
  const x = fleetOf(ctx.org().org).expenses.find(
    (e) => e.tripId === trip.id && e.id === ctx.params.expenseId?.toLowerCase(),
  );
  if (!x) fail('not_found', 'Расход не найден.');
  return x;
}

export const expenseHandlers: Registry = {
  listExpenseCategories: (ctx) => {
    const all = ctx.query.get('includeArchived') === 'true';
    const items = categoriesOf(fleetOf(ctx.org().org).categories)
      .filter((c) => all || c.state === 'active')
      .map(categoryDto);
    return { body: { items, nextCursor: null } };
  },

  createExpenseCategory: (ctx) => {
    const t = ctx.org();
    const f = fleetOf(t.org);
    const b = ctx.body as S['ExpenseCategoryCreate'];
    const label = b.label.trim();
    if (!label) {
      fail('validation_failed', 'Укажите название категории.', {
        violations: [{ field: 'label', code: 'required', message: 'Укажите название' }],
      });
    }
    if (b.code && f.categories.some((c) => c.code === b.code)) {
      fail('validation_failed', `${DUPLICATE}.`, {
        violations: [{ field: 'code', code: 'duplicate', message: DUPLICATE }],
      });
    }
    if (f.categories.some((c) => c.state === 'active' && sameLabel(c.label, label))) {
      fail('validation_failed', `${DUPLICATE}.`, {
        violations: [{ field: 'label', code: 'duplicate', message: DUPLICATE }],
      });
    }
    let code = b.code;
    for (let n = 1; !code; n++) {
      if (!f.categories.some((c) => c.code === `custom_${n}`)) code = `custom_${n}`;
    }
    const row: CategoryRow = {
      code,
      label,
      commentRequired: b.commentRequired,
      seeded: false,
      state: 'active',
      createdAt: ctx.now(),
      revision: 1,
      sortOrder: Math.max(0, ...f.categories.map((c) => c.sortOrder)) + 10,
    };
    f.categories.push(row);
    return { status: 201, body: categoryDto(row) };
  },

  archiveExpenseCategory: (ctx) => {
    const c = categoryOr404(ctx);
    ctx.revision(c.revision);
    if (c.code === 'other') fail('invalid_transition', 'Категорию «Прочее» нельзя убрать.');
    if (c.state === 'archived') fail('invalid_transition', 'Категория уже в архиве.');
    c.state = 'archived';
    c.archivedAt = ctx.now();
    c.archivedByMemberId = ctx.org().member?.id ?? '';
    c.revision++;
    return { body: categoryDto(c) };
  },

  listTripExpenses: (ctx) => {
    const trip = tripOr404(ctx, 'fleet.expenses.read');
    const items = fleetOf(ctx.org().org).expenses.filter((x) => x.tripId === trip.id);
    return { body: page(structuredClone(items), ctx.query) };
  },

  getTripExpense: (ctx) => ({ body: structuredClone(expenseOr404(ctx, 'fleet.expenses.read')) }),

  createTripExpense: (ctx) => {
    const t = ctx.org();
    const trip = tripForCommand(ctx, 'fleet.expenses.create');
    if (!OPEN.includes(trip.state))
      fail('invalid_transition', 'Расходы добавляются в рейсе и при сдаче.');
    const b = ctx.body as S['TripExpenseCreate'];
    const minor = b.amount.amountMinor;
    if (minor <= 0) fail('amount_invalid', 'Сумма должна быть больше нуля');
    if (minor > MAX_MINOR) fail('amount_invalid', 'Больше 200 000 ₽ — проверьте сумму');
    // W2.52 (0.6.1-stage2): kind — код активной категории справочника тенанта.
    const category = fleetOf(t.org).categories.find((c) => c.code === b.kind);
    if (!category) {
      fail('validation_failed', 'Категория расхода не найдена.', {
        violations: [
          { field: 'kind', code: 'unknown_category', message: 'Категория расхода не найдена' },
        ],
      });
    }
    if (category.state === 'archived') {
      fail('validation_failed', 'Категория в архиве — выберите другую.', {
        violations: [
          {
            field: 'kind',
            code: 'archived_category',
            message: 'Категория в архиве — выберите другую',
          },
        ],
      });
    }
    if (category.commentRequired && !b.comment?.trim()) {
      const text = commentText(category.label);
      fail('validation_failed', text, {
        violations: [{ field: 'comment', code: 'required', message: text }],
      });
    }
    if (!b.receiptFileIds.length) {
      fail('validation_failed', 'Добавьте фото чека', {
        violations: [{ field: 'receiptFileIds', code: 'required', message: 'Добавьте фото чека' }],
      });
    }
    const ready = b.receiptFileIds.every(
      (id) => t.org.files.find((x) => x.id === id.toLowerCase())?.status === 'ready',
    );
    if (!ready) fail('photo_not_ready', 'Фото чека ещё не загружено');
    const row: S['TripExpense'] = {
      id: ctx.newId(),
      tripId: trip.id,
      kind: b.kind,
      occurredAt: b.occurredAt,
      amount: { ...b.amount },
      ...(b.quantity ? { quantity: b.quantity } : {}),
      receiptFileIds: b.receiptFileIds.map((id) => id.toLowerCase()),
      reviewState: 'pending',
      revision: 1,
      ...(b.comment ? { comment: b.comment } : {}),
    };
    fleetOf(t.org).expenses.push(row);
    return { status: 201, body: structuredClone(row) };
  },

  reviewTripExpense: (ctx) => {
    const x = expenseOr404(ctx, 'fleet.expenses.review');
    ctx.revision(x.revision);
    if (x.reviewState !== 'pending') fail('invalid_transition', 'Расход уже проверен.');
    const b = ctx.body as S['ExpenseReview'];
    x.reviewState = b.decision === 'approve' ? 'approved' : 'rejected';
    x.revision++;
    return { body: structuredClone(x) };
  },
};
