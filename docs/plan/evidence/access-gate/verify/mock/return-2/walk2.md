foreman: "{\"url\":\"/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/repair\",\"gate\":[\"extension_off\",\"Модуль не подключён\",\"«Ремонт и стройка» не подключён организацией\",\"Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — нужна ещё роль.\"],\"reason\":\"module_off\",\"h1\":[\"«Ремонт и стройка» не подключён организацией\"],\"banners\":[]}"

alta = f04f636e-b66d-509e-ae10-9c27a18e3baa

owner repair: "{\"url\":\"/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/repair\",\"gate\":[\"extension_off\",\"Модуль не подключён\",\"«Ремонт и стройка» не подключён организацией\",\"Подключите модуль в разделе «Модули и место». Права сотрудникам выдаются отдельно.\",\"Открыть «Модули и место»\"],\"reason\":\"module_off\",\"h1\":[\"«Ремонт и стройка» не подключён организацией\"],\"banners\":[]}"

owner Tab order to gate action:
  "A|К содержимому|outline=solid 2px rgb(31, 107, 82)|inGate=false"
  "SELECT|Область просмотра|outline=solid 2px rgb(31, 107, 82)|inGate=false"
  "BUTTON|Уведомления: 2 новых|outline=solid 2px rgb(31, 107, 82)|inGate=false"
  "BUTTON|Профиль|outline=solid 2px rgb(31, 107, 82)|inGate=false"
  "BUTTON|homeГлавная|outline=solid 2px rgb(31, 107, 82)|inGate=false"
  "BUTTON|extensionМодули и место|outline=solid 2px rgb(31, 107, 82)|inGate=false"
  "BUTTON|groupПользователи и роли|outline=solid 2px rgb(31, 107, 82)|inGate=false"
  "BUTTON|workspace_premiumПодписка и места|outline=solid 2px rgb(31, 107, 82)|inGate=false"
  "BUTTON|paletteОформление|outline=solid 2px rgb(31, 107, 82)|inGate=false"
  "BUTTON|spaСалон и SPA|outline=solid 2px rgb(31, 107, 82)|inGate=false"
  "BUTTON|forumЧаты|outline=solid 2px rgb(31, 107, 82)|inGate=false"
  "BUTTON|task_altЗадачи|outline=solid 2px rgb(31, 107, 82)|inGate=false"
  "BUTTON|support_agentОбращения|outline=solid 2px rgb(31, 107, 82)|inGate=false"
  "BUTTON|dynamic_formФормы и опросы|outline=solid 2px rgb(31, 107, 82)|inGate=false"
  "BUTTON|calendar_monthКалендарь|outline=solid 2px rgb(31, 107, 82)|inGate=false"
  "BUTTON|menu_bookБаза знаний|outline=solid 2px rgb(31, 107, 82)|inGate=false"
  "BUTTON|descriptionДокументы|outline=solid 2px rgb(31, 107, 82)|inGate=false"
  "BUTTON|table_viewДанные|outline=solid 2px rgb(31, 107, 82)|inGate=false"
  "BUTTON|folder_openФайлы|outline=solid 2px rgb(31, 107, 82)|inGate=false"
  "BUTTON|account_balance_walletКасса|outline=solid 2px rgb(31, 107, 82)|inGate=false"
  "BUTTON|Открыть «Модули и место»|outline=solid 2px rgb(31, 107, 82)|inGate=true"

after Enter: "{\"url\":\"/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/modules\",\"gate\":null,\"reason\":null,\"h1\":[\"Модули и место\"],\"banners\":[]}"

owner fleet: "{\"url\":\"/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/fleet\",\"gate\":[\"extension_off\",\"Модуль не подключён\",\"«Логистика» не подключена организацией\",\"Подключите модуль в разделе «Модули и место», затем назначьте роли сотрудникам.\",\"Открыть «Модули и место»\"],\"reason\":\"module_off\",\"h1\":[\"«Логистика» не подключена организацией\"],\"banners\":[]}"

owner fleet click: "{\"url\":\"/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/modules\",\"gate\":null,\"reason\":null,\"h1\":[\"Модули и место\"],\"banners\":[]}"

manager fleet (module off): "{\"url\":\"/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/fleet\",\"gate\":[\"extension_off\",\"Модуль не подключён\",\"«Логистика» не подключена организацией\",\"Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — понадобится ещё роль с областью.\"],\"reason\":\"module_off\",\"h1\":[\"«Логистика» не подключена организацией\"],\"banners\":[]}"

enable fleet: "200 {\"moduleKey\":\"fleet\",\"version\":\"1.0.0\",\"name\":\"Логистика\",\"dependencies\":[\"calendar\",\"files\",\"forms\"],\"permissions\":[{\"key\":\"fleet.vehicles.read\",\"moduleKey\":\"fleet\",\"description\":\"Видеть машины\",\"allowedScopeKinds\":[\"tenant\",\"org_unit\",\"resource_pool\"],\"sensitivity\":\"standard\"},{\"key\":\"fleet.vehicl"

manager fleet (no role): "{\"url\":\"/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/fleet\",\"gate\":[\"lock\",\"Нет права\",\"Нет роли с доступом к модулю «Логистика»\",\"Модуль подключён, но ни одна ваша роль не разрешает это действие. Владелец бизнеса может назначить роль и область.\"],\"reason\":\"no_permission\",\"h1\":[\"Нет роли с доступом к модулю «Логистика»\"],\"banners\":[]}"

manager review: "{\"url\":\"/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/review\",\"gate\":[\"lock\",\"Нет права\",\"Нет права на приёмку смен\",\"Модуль подключён, но ни одна ваша роль не разрешает это действие («Проверять»). Владелец бизнеса может назначить роль и область.\"],\"reason\":\"no_permission\",\"h1\":[\"Нет права на приёмку смен\"],\"banners\":[]}"

manager forms: "{\"url\":\"/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/forms\",\"gate\":[\"lock\",\"Нет права\",\"Нет доступа к разделу «Формы»\",\"Ни одна ваша роль не разрешает его просматривать. Владелец бизнеса может добавить действие в роль.\"],\"reason\":\"no_permission\",\"h1\":[\"Нет доступа к разделу «Формы»\"],\"banners\":[]}"

driver (fleet on): "{\"url\":\"/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/today\",\"gate\":null,\"reason\":null,\"h1\":[\"Сегодня\"],\"banners\":[]}"

disable fleet: "200 {\"moduleKey\":\"fleet\",\"version\":\"1.0.0\",\"name\":\"Логистика\",\"dependencies\":[\"calendar\",\"files\",\"forms\"],\"permissions\":[{\"key\":\"fleet.vehicles.read\",\"moduleKey\":\"fleet\",\"description\":\"Видеть машины\",\"allowedScopeKinds\":[\"tenant\",\"org_unit\",\"resource_pool\"],\"sensitivity\":\"standard\"},{\"key\":\"fleet.vehicl"

driver (fleet ro): "{\"url\":\"/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/today\",\"gate\":null,\"reason\":null,\"h1\":[\"Сегодня\"],\"banners\":[\"historyМодуль «Логистика» отключён. Новые брони и рейсы закрыты. Начатые смены можно завершить; история доступна для чтения.\"]}"

manager fleet (ro): "{\"url\":\"/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/fleet\",\"gate\":[\"extension_off\",\"Модуль отключён\",\"«Логистика» не подключена организацией\",\"Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — понадобится ещё роль с областью.\"],\"reason\":\"module_readonly\",\"h1\":[\"«Логистика» не подключена организацией\"],\"banners\":[\"historyМодуль «Логистика» отключён. Новые брони и рейсы закрыты. Начатые смены можно завершить; история доступна для чтения.\"]}"

owner fleet (ro): "{\"url\":\"/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/fleet\",\"gate\":null,\"reason\":null,\"h1\":[\"Рабочее место логиста\"],\"banners\":[\"historyМодуль «Логистика» отключён. Новые брони и рейсы закрыты. Начатые смены можно завершить; история доступна для чтения.\"]}"

reset: "200 {\"clock\":\"2026-10-01T07:30:00Z\",\"scenario\":null,\"presets\":[\"logistics-ready\",\"seats-full\",\"trial-ended\",\"storage-full\"],\"invitations\":[{\"tenantId\":\"f04f636e-b66d-509e-ae10-9c27a18e3baa\",\"email\":\"o.petrova@alta.example\",\"status\":\"pending\",\"token\":\"inv_d79d3e928ef456668c55d8cf04be9bcf\"},{\"tenantId\":\"f"

driver after reset: "{\"url\":\"/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/today\",\"gate\":[\"extension_off\",\"Модуль не подключён\",\"«Логистика» не подключена организацией\",\"Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — понадобится ещё роль с областью.\"],\"reason\":\"module_off\",\"h1\":[\"«Логистика» не подключена организацией\"],\"banners\":[]}"

driver offline: "{\"url\":\"/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/today\",\"gate\":[\"extension_off\",\"Модуль не подключён\",\"«Логистика» не подключена организацией\",\"Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — понадобится ещё роль с областью.\"],\"reason\":\"module_off\",\"h1\":[\"«Логистика» не подключена организацией\"],\"banners\":[\"cloud_offНет связи\",\"cloud_offНет связи. Черновики, фото и расходы сохраняются на устройстве. Бронь, выезд и приёмка требуют подтверждения сервера.\",\"cloud_offНет связи. Черновики сохраняются на устройстве\"]}"

delay: "200 {\"clock\":\"2026-10-01T07:30:00Z\",\"scenario\":\"getMyContext=delay=4000\",\"presets\":[\"logistics-ready\",\"seats-full\",\"trial-ended\",\"storage-full\"],\"invitations\":[{\"tenantId\":\"f04f636e-b66d-509e-ae10-9c27a18e3baa\",\"email\":\"o.petrova@alta.example\",\"status\":\"pending\",\"token\":\"inv_d79d3e928ef456668c55d8cf04be"

loading (t+0): "{\"url\":\"/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/today\",\"gate\":null,\"reason\":null,\"h1\":[],\"banners\":[]}" | "К содержимому / о / ортус / пространство бизнеса / domain / Альта Групп / Мои назначения / notifications / ИВ / РАБОТА / today / Сегодня / local"

loaded: "{\"url\":\"/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/today\",\"gate\":[\"extension_off\",\"Модуль не подключён\",\"«Логистика» не подключена организацией\",\"Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — понадобится ещё роль с областью.\"],\"reason\":\"module_off\",\"h1\":[\"«Логистика» не подключена организацией\"],\"banners\":[]}"

clear: "200 {\"clock\":\"2026-10-01T07:30:00Z\",\"scenario\":null,\"presets\":[\"logistics-ready\",\"seats-full\",\"trial-ended\",\"storage-full\"],\"invitations\":[{\"tenantId\":\"f04f636e-b66d-509e-ae10-9c27a18e3baa\",\"email\":\"o.petrova@alta.example\",\"status\":\"pending\",\"token\":\"inv_d79d3e928ef456668c55d8cf04be9bcf\"},{\"tenantId\":\"f"

err: "200 {\"clock\":\"2026-10-01T07:30:00Z\",\"scenario\":\"getMyContext=offline\",\"presets\":[\"logistics-ready\",\"seats-full\",\"trial-ended\",\"storage-full\"],\"invitations\":[{\"tenantId\":\"f04f636e-b66d-509e-ae10-9c27a18e3baa\",\"email\":\"o.petrova@alta.example\",\"status\":\"pending\",\"token\":\"inv_d79d3e928ef456668c55d8cf04be9bc"

error: "{\"url\":\"/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/today\",\"gate\":null,\"reason\":null,\"h1\":[],\"banners\":[\"Не удалось загрузить модули прототипа: Нет связи с сервером. Операция не выполнена.\"]}" | "К содержимому / о / ортус / пространство бизнеса / domain / Ортус / Загрузка… / Не удалось загрузить модули прототипа: Нет связи с сервером. Операция не выполнена."

clear: "200 {\"clock\":\"2026-10-01T07:30:00Z\",\"scenario\":null,\"presets\":[\"logistics-ready\",\"seats-full\",\"trial-ended\",\"storage-full\"],\"invitations\":[{\"tenantId\":\"f04f636e-b66d-509e-ae10-9c27a18e3baa\",\"email\":\"o.petrova@alta.example\",\"status\":\"pending\",\"token\":\"inv_d79d3e928ef456668c55d8cf04be9bcf\"},{\"tenantId\":\"f"

Console:
### Result
Total messages: 4 (Errors: 1, Warnings: 0)
Returning 1 messages for level "warning"

[ERROR] Failed to load resource: net::ERR_FAILED @ http://127.0.0.1:6103/api/v1/me/context:0

Network (app):
### Result
294. [GET] http://127.0.0.1:6103/api/v1/me/context => [FAILED] net::ERR_FAILED
306. [POST] http://127.0.0.1:6103/api/v1/dev/scenario => [200] 

Note: 293 static requests not shown, run with "static" option to see them.