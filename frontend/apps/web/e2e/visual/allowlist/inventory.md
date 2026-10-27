# Allowlist `inventory` (W5.11)

Экрана «Склад» нет в прототипе: в эталоне склад — блоки «Остатки кабинета» и «Движения склада» на странице «Салон и SPA»
(«Ортус CRM.dc.html» pg.spa, :1890–1891), страницы склада и пункта меню нет (B-6 плана v2; Q-W5.11-1). Пиксельной и
структурной сверки нет; e2e (`e2e/inventory.spec.ts`) и проходка Playwright MCP (`docs/plan/evidence/inventory/`)
обязательны. Страница вне меню (Q-W5.11-4): в `CORE_ITEMS` эталона (:2970) склада нет, пункт ломал бы сверку меню; вход —
прямой URL и «Связанные разделы» страниц-потребителей; права — `inventory.items.read`, правка — `inventory.items.manage`,
`inventory.warehouses.manage`, снятие резерва — `inventory.movements.post`.

- kind: no-reference · target: h1:Склад · mode: both · reason: страница вне меню /t/:tenantId/inventory — вкладки «Остатки» и «Резервы», фильтры «Склад» и «Ниже минимума» (адрес `?view=&warehouse=&low=1`), строки остатков «В наличии / В резерве / Доступно» с единицей и минимумом, партии по кнопке «Партии (N)» в порядке FEFO («Спишется первой», «Срок истёк»); дорисовать в прототипе — design-requests «inventory» · decision: B-6, D-20 комплекта, Q-W5.11-1, Q-W5.11-4 · owner: W5.11
- kind: no-reference · target: dialog:Новая позиция · mode: both · reason: создание и правка позиции (createInventoryItem, updateInventoryItem, If-Match "rev-<revision>"): подразделение, название, артикул, единица, учёт по партиям; минимальный уровень, архив; дубль артикула — 422 под полем «Артикул»; единица и артикул после движений не меняются · decision: B-6, Q-W5.00-5, Q-W5.11-1 · owner: W5.11
- kind: no-reference · target: dialog:Новый склад · mode: both · reason: createWarehouse — подразделение, название, необязательный код; дубль кода — 422 под полем «Код» · decision: B-6, Q-W5.00-5 · owner: W5.11
- kind: no-reference · target: tab:Резервы · mode: both · reason: резервы создают модули (запись SPA, закупка ремонта), здесь список и «Снять резерв» с подтверждением (releaseInventoryReservation); ручной формы резерва нет · decision: B-6, Q-W5.11-2 · owner: W5.11
- kind: no-reference · target: button:Повторить · mode: both · reason: ошибка загрузки — alert «Не удалось загрузить данные склада: …» и «Повторить»; загрузка — скелетон role=status «Загрузка»; организация только для чтения — просмотр без кнопок действий с пояснением · decision: B-6, Q-W5.11-1 · owner: W5.11
