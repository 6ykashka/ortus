// W5.33 · Статьи расходов подотчёта на случай, когда держателю список статей не отдают: listCashCategories
// требует `cash.read`, у водителя и прораба — только `cash.advance.self` (403, Q-W5.33-9). Сидовый справочник
// статей один на все организации и в этапе 5 только читается (Q-W4.00-cash-9) — те же коды и подписи, что в
// ответе сервера (api/openapi `CashCategory`, MSW `CATEGORIES`). Когда контракт откроет список держателю,
// запрос вернёт настоящие данные, а эта копия не используется.
import type { Category } from './model.ts';

export const SEED_EXPENSE_CATEGORIES: readonly Category[] = [
  { id: 'household', title: 'Хозяйственные расходы', group: 'expense', direction: 'out' },
  { id: 'fuel', title: 'Топливо', group: 'expense', direction: 'out', moduleKey: 'logistics' },
  { id: 'wash', title: 'Мойка', group: 'expense', direction: 'out', moduleKey: 'logistics' },
  { id: 'parking', title: 'Парковка', group: 'expense', direction: 'out', moduleKey: 'logistics' },
  { id: 'repair-small', title: 'Мелкий ремонт', group: 'expense', direction: 'out' },
  { id: 'materials', title: 'Материалы', group: 'expense', direction: 'out', moduleKey: 'repairs' },
];
