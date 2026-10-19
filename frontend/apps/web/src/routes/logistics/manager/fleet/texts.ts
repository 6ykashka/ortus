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
  /**
   * W2.50 · «Импорт машин» (`logistics-vehicle-import`, no-reference — B-6, D-11 комплекта): тексты временные до
   * прорисовки в прототипе (design-requests «logistics-vehicle-import»), образец — импорт людей S1-10.
   */
  import: {
    open: 'Импорт машин',
    title: 'Импорт машин',
    intro:
      'Загрузите файл CSV с машинами. Сначала каждая строка проверяется без изменения данных, затем импорт применяется одной операцией. Машина с тем же госномером обновляется.',
    columns:
      'Колонки: registration_number, display_name, body_type, payload_kg, volume_m3, cargo_length_m, cargo_width_m, cargo_height_m, odometer_km; по желанию — temperature_min_c, temperature_max_c, equipment, depot, org_unit. Разделитель — «,» или «;», первая строка — заголовок.',
    unit: 'Фирма по умолчанию',
    unitFixed: 'Фирма по умолчанию: {unit}',
    file: 'Файл CSV',
    pick: 'Выбрать файл',
    noFileChosen: 'Файл не выбран',
    check: 'Проверить файл',
    checking: 'Проверяем файл…',
    noFile: 'Выберите файл CSV.',
    failed: 'Не удалось проверить файл: {error}',
    preview: 'Проверка файла «{file}»',
    note: 'Данные ещё не изменены: проверьте строки и примените импорт. Проверка действует сутки.',
    totals: {
      rows: 'Строк в файле',
      create: 'Новых машин',
      update: 'Обновить',
      skip: 'Пропущено',
      error: 'С ошибками',
    },
    /** Итоги после применения — прошедшее время, как «пропущено» и «обновлено: N» итога (ревью W2.50-r1). */
    totalsDone: {
      rows: 'Строк в файле',
      create: 'Создано',
      update: 'Обновлено',
      skip: 'Пропущено',
      error: 'С ошибками',
    },
    /**
     * Подписи колонок файла для ошибок строки — «код (подпись): текст», как ошибка заголовка сервера «Нет колонки
     * body_type (кузов)» (parse.go, MSW fleet/imports.ts); `line` — вся строка.
     */
    columnLabels: {
      registration_number: 'госномер',
      display_name: 'название',
      body_type: 'кузов',
      payload_kg: 'грузоподъёмность, кг',
      volume_m3: 'объём, м³',
      cargo_length_m: 'длина кузова, м',
      cargo_width_m: 'ширина кузова, м',
      cargo_height_m: 'высота кузова, м',
      odometer_km: 'пробег, км',
      temperature_min_c: 'мин. температура, °C',
      temperature_max_c: 'макс. температура, °C',
      equipment: 'оборудование',
      depot: 'стоянка',
      org_unit: 'фирма',
    },
    wholeLine: 'строка',
    fieldError: '{column}: {message}',
    fieldNamed: '{field} ({label})',
    errorRows: 'Строки с ошибками',
    validRows: 'Строки к применению',
    line: 'Строка {line}',
    actions: {
      create: 'Новая машина',
      update: 'Обновление',
      skip: 'Пропущена',
      error: 'Ошибка',
    },
    apply: 'Применить',
    applySkip: 'Применить без строк с ошибками',
    applying: 'Применяем…',
    nothing: 'В файле нет строк, которые можно применить. Исправьте файл и загрузите его снова.',
    /** 412/409 на «Применить»: тот же файл проверен заново новым ключом (ревью W2.50-r2; no-reference, B-6). */
    stale: 'Данные изменились после проверки — файл проверен заново.',
    staleText: 'Проверьте строки и примените импорт ещё раз.',
    done: 'Импорт применён',
    result: 'Создано машин: {create} · обновлено: {update} · пропущено строк: {skip}.',
    applied: 'Импорт машин применён',
    another: 'Загрузить другой файл',
    back: 'К рабочему месту',
    readOnly: 'Модуль только для чтения — импорт машин недоступен.',
    noRight: 'Импорт машин доступен с правом вести автопарк.',
  },
} as const;
