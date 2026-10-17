// W2.21 · Подписи «Приёмки смен», которых нет в словаре W0.14: части конкатенаций reviewVM эталона (:3341–3379,
// дословно), состояния загрузки и ссылки на страницы вне меню (no-reference). Подписи категорий расходов — словарь
// кодов logisticsDriver.expenseKinds (W2.40). Перенос в @ortus/texts — владелец словаря.
export const REVIEW_TEXT = {
  // reviewVM :3341, :3346, :3358 — дословно.
  driverFallback: 'водитель',
  queueTitle: '{trip} · {driver}',
  vehicleSub: '{model} · {plate}',
  vehicle: '{model} {plate}',
  shiftTitle: '{trip} · {title}',
  shiftSub: '{driver} · {vehicle}',
  defectSub: '{trip} · {driver} · осмотр в {time}',
  // reviewVM :3360–3366 — дословно.
  km: '{km} км',
  none: '—',
  fuel: '{before} → {after}',
  fuelPercent: '{p} %',
  checkDeparture: 'Осмотр перед выездом: чек-лист заполнен',
  checkReturn: 'Осмотр при сдаче: чек-лист заполнен',
  defectLine: '{zone} · {text} · {when}',
  whenDeparture: 'при выезде',
  whenReturn: 'при сдаче',
  downgraded: ' · признан некритичным',
  // reviewVM :3352 — теги миниатюр.
  photoTag: 'фото',
  photoNone: 'нет',
  // reviewVM :3369 — дословно.
  liters: ' · {n} л',
  receipt: ' · чек приложен',
  // accept :2768 — заголовок раздела диалога.
  consequences: 'Что произойдёт',
  // no-reference: загрузка, ошибка, входы на страницы вне меню.
  loadFailed: 'Не удалось загрузить смены: {error}',
  cardFailed: 'Не удалось загрузить смену: {error}',
  expensesFailed: 'Не удалось загрузить расходы: {error}',
  retry: 'Повторить',
  linksAria: 'Связанные разделы',
  toDefects: 'Очередь дефектов',
  toEarnings: 'Начисления',
} as const;
