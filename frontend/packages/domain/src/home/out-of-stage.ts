// W2.25 · Источники «Требует решения» модулей будущих этапов (homeVM :4060–4093; 01-shell.md §23 строки 4, 5,
// 7–11). До своего этапа провайдера нет: карточки эталона — allowlist out-of-stage (e2e/visual/allowlist/home.md).
// Владелец модуля кладёт `sources/<id>.ts` и снимает запись allowlist. W4.81: задачи (этап 4) — `sources/tasks.ts`.

export interface OutOfStageSource {
  id: string;
  /** Этап плана v2, в котором появляется источник. */
  stage: number;
  /** Что даёт источник в эталоне. */
  note: string;
}

export const OUT_OF_STAGE: readonly OutOfStageSource[] = [
  { id: 'spa', stage: 5, note: 'Салон и SPA: «Учёт материалов не завершён»' },
  { id: 'repairs', stage: 6, note: 'Ремонт и стройка: прораб, отметки, допработы, смета' },
  { id: 'service', stage: 7, note: 'Обращения: просрочка и риск SLA' },
  { id: 'docs', stage: 7, note: 'Документы: утвердить, согласовать, ознакомиться' },
  { id: 'chat', stage: 7, note: 'Чаты: подтвердить важное сообщение' },
  { id: 'cash', stage: 5, note: 'Касса: вопросы кассы' },
];
