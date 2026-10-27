# Allowlist `inventory-movements` (W5.11)

Экрана «Движения склада» нет в прототипе: в эталоне есть только блок «Движения склада» на странице «Салон и SPA»
(«Ортус CRM.dc.html» pg.spa, :1891 — списания по технологической карте), журнала склада и ручных движений нет (B-6 плана
v2; Q-W5.11-1). Пиксельной и структурной сверки нет; e2e (`e2e/inventory-movements.spec.ts`) и проходка Playwright MCP
(`docs/plan/evidence/inventory-movements/`) обязательны. Страница вне меню (Q-W5.11-4): вход — «Связанные разделы» страницы
«Склад»; право чтения — `inventory.movements.read`, проведение и сторно — `inventory.movements.post`.

- kind: no-reference · target: h1:Движения склада · mode: both · reason: страница вне меню /t/:tenantId/inventory-movements — журнал от новых к старым: вид (Приход, Расход, Перемещение, Корректировка, Сторно), склад, время по Москве, основание, строки с количеством и сроком годности; направления корректировки и сторно в ответе контракта нет (Q-W5.11-6) · decision: B-6, D-20 комплекта, Q-W5.11-1, Q-W5.11-6 · owner: W5.11
- kind: no-reference · target: dialog:Новое движение · mode: both · reason: postInventoryMovement — приход (партия и срок годности), расход (партия или FEFO), перемещение, корректировка (направление и причина); отказы 409 в окне: «не хватает» (insufficient_stock), «срок годности истёк» (lot_expired); на 390 px — лист снизу · decision: B-6, D-20 комплекта, Q-W5.11-1 · owner: W5.11
- kind: no-reference · target: dialog:Сторно движения · mode: both · reason: сторно — компенсирующая запись с обязательной причиной (kind reversal, reversesMovementId); повторное сторно и сторно сторно — 409 invalid_transition в тосте · decision: B-6, Q-W5.11-5 · owner: W5.11
- kind: no-reference · target: button:Повторить · mode: both · reason: ошибка загрузки — alert «Не удалось загрузить данные склада: …» и «Повторить»; загрузка — скелетон; организация только для чтения — журнал без «Новое движение» и «Сторно» · decision: B-6, Q-W5.11-1 · owner: W5.11
