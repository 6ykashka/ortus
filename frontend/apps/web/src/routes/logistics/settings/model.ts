// W2.41 · Модель справочника категорий расходов тенанта (D-12 комплекта, ответ владельца 17.10, ADR-0013; контракт
// 0.6.1-stage2 `ExpenseCategory`): список в порядке каталога сервера (посев, затем свои), архив, проверка названия,
// If-Match архивации, подписи кодов для «Приёмки смен» и варианты формы расхода водителя. До загрузки справочника —
// шесть кодов посева (`logisticsDriver.expenseKinds`), «Прочее» — с обязательным комментарием.
import { type components, ProblemError } from '@ortus/api-client';
import { errors, format, logisticsDriver, logisticsManager } from '@ortus/texts';

type S = components['schemas'];
export type Category = S['ExpenseCategory'];

const T = logisticsManager.expenseCategories;
const MSK = 'Europe/Moscow';

/** Вариант категории для формы расхода. */
export interface CategoryOption {
  code: string;
  label: string;
  commentRequired: boolean;
}

/** Шесть категорий посева (tenant 0015) — пока справочник не загружен или недоступен. */
export const SEED_OPTIONS: readonly CategoryOption[] = Object.entries(
  logisticsDriver.expenseKinds,
).map(([code, label]) => ({ code, label, commentRequired: code === 'other' }));

/** Активные и архивные — в порядке каталога сервера. */
export function split(list: readonly Category[]): { active: Category[]; archived: Category[] } {
  return {
    active: list.filter((c) => c.state === 'active'),
    archived: list.filter((c) => c.state === 'archived'),
  };
}

/** «Прочее» не архивируется (Q-W2.52-3), уже архивная — тоже. */
export const canArchive = (c: Category): boolean => c.state === 'active' && c.code !== 'other';

/** If-Match архивации: ETag категории — `"rev-<revision>"` (MSW и сервер, Q-W2.41-1). */
export const categoryETag = (c: Category): string => `"rev-${String(c.revision)}"`;

/** «В архиве с 03.10.2026» (дата по Москве); у активной — пусто. */
export function archivedSince(c: Category): string {
  if (!c.archivedAt) return '';
  const date = new Intl.DateTimeFormat('ru-RU', {
    timeZone: MSK,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(c.archivedAt));
  return format(T.archivedSince, { date });
}

/** Ошибка поля «Название» до отправки. */
export const nameError = (label: string): string | null =>
  label.trim() ? null : T.form.nameRequired;

/**
 * 422 `validation_failed` создания — текст под полем «Название»; прочее показывает тост `run`. Нарушение `label`
 * или `code` (MSW, пример контракта) — его сообщение; сервер (`problem.Body`) отдаёт только `detail` (дубль, длина,
 * формат кода, Возврат 1 W2.41) — он без точки в конце, как сообщения поля MSW и проверка до отправки; нет ни того,
 * ни другого — общий текст `validation_failed`, чтобы отказ не остался незаметным (тост подавлен `quiet`).
 */
export function serverFieldError(e: unknown): string | null {
  if (!(e instanceof ProblemError) || e.code !== 'validation_failed') return null;
  const v = e.problem?.violations?.find((x) => x.field === 'label' || x.field === 'code');
  if (v?.message) return v.message;
  const detail = e.problem?.detail?.trim().replace(/\.$/, '');
  return detail || errors.problem.validation_failed;
}

/** Подписи кодов (с архивными) — для расходов, у которых категория уже в архиве. */
export const labelsOf = (list: readonly Category[] | undefined): ReadonlyMap<string, string> =>
  new Map((list ?? []).map((c) => [c.code, c.label]));

/** Варианты формы расхода: активные в порядке каталога; до загрузки — посев. */
export function activeOptions(list: readonly Category[] | undefined): readonly CategoryOption[] {
  if (!list) return SEED_OPTIONS;
  return list
    .filter((c) => c.state === 'active')
    .map((c) => ({ code: c.code, label: c.label, commentRequired: c.commentRequired }));
}
