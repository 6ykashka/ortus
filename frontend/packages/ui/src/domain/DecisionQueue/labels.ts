// Подписи DecisionQueue по умолчанию — дословно из эталона (снимок design-stage-2); совпадают с @ortus/texts
// (home.queue.title, home.queue.empty). Тексты пунктов передаёт потребитель (контракт W0.10).
export const labels = {
  /** Ортус CRM.dc.html:1733 */
  title: 'Требует решения',
  /** Ортус CRM.dc.html:1744 */
  empty: 'Решений не требуется. Новые вопросы появятся здесь.',
  /** Ортус CRM.dc.html:183 (`aria-label` загрузки) */
  loading: 'Загрузка',
  /** Дизайн-система.dc.html:270 */
  retry: 'Повторить',
} as const;
