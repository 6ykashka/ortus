// W2.20 · Подписи рабочего места логиста без эталона (тест дословности словаря W0.14 их не пропустит): тип кузова
// контракта (`Vehicle.bodyType`; в эталоне — строки сида mock-data.js), ошибка загрузки и точка входа в
// планирование (no-reference, design-requests `logistics-plan`). Перенос в @ortus/texts — владелец словаря.
export const FLEET_TEXT = {
  bodyTypes: {
    van: 'Фургон',
    box: 'Фургон',
    flatbed: 'Борт',
    refrigerated: 'Рефрижератор',
    tent: 'Тент',
  },
  loadFailed: 'Не удалось загрузить рабочее место: {error}',
  retry: 'Повторить',
  plan: 'Запланировать рейс',
} as const;
