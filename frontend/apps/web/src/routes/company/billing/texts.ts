// W4.61 · Подписи «Подписки и мест» владельца (pg.billing «Ортус CRM.dc.html» :1454–1528, billingVM :3916–3957;
// design-2026-10-19), которых нет в @ortus/texts (там — основные подписи: company.billing). Состояния без эталона —
// в конце. ICU — format() из @ortus/texts.
export const BILLING_TEXT = {
  title: 'Подписка и места',
  paidMonthly: 'Помесячная оплата',
  paidTerm: 'Оплата за {n} мес',
  priceVersion: ' · цены версии v{v} сохраняются до конца периода',
  termMonthly: 'помесячно',
  termMonths: '{n} мес',
  priceChange:
    'С {date} меняются цены тарифов. Заявки, поданные до этой даты, считаются по текущим ценам; оплаченный период не пересчитывается.',
  noComment: 'без комментария',
  off: '−{off}%',
  upTo: 'до {seats} мест',
  more: 'больше {seats} мест',
  total: '{total} за {n} мес',
  tooSmall: 'Занято {used} — не поместится',
  calcMain: '{month} в месяц · {total} {period}',
  calcMonth: 'за месяц',
  calcTerm: 'за {n} мес',
  calcOperator: 'Стоимость рассчитает оператор',
  saving: 'Экономия {save} по сравнению с помесячной оплатой. ',
  newLimit: 'Новый лимит: {seats} мест.',
  newLimitNone: 'Новый лимит: без ограничения.',
  invite: 'Пригласить',
  noTitle: 'Должность не указана',
  inviteSent: 'Приглашение отправлено',
  noteJoin: '{note} · {reserved}',
  chipActive: 'Активен',
  chipInvited: 'Приглашён',
  /** Рабочие функции участника (Member.workProfiles) — подпись под именем вместо должности (её в контракте нет). */
  profiles: {
    driver: 'Водитель',
    practitioner: 'Специалист',
    foreman: 'Прораб',
    manager: 'Менеджер',
  },
  titleJoin: '{title} · ',
  /** Без эталона: ошибка чтения подписки, сетки, заявок или участников. */
  loadError: 'Не удалось загрузить подписку: {error}',
} as const;
