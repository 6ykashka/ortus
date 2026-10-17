# Allowlist `logistics-earnings` (W2.21)

Экрана «Начисления водителям» нет в прототипе (S2-12, 14-stage2-dor.md §4; в эталоне начисление — блок карточки смены
«Начисление водителю за рейс» :636–641). Пиксельной и структурной сверки нет; e2e (`e2e/logistics-earnings.spec.ts`) и
проходка Playwright MCP обязательны. Водителю — гейт оболочки и 403 сервера (D-10, AC-05).

- kind: no-reference · target: h1:Начисления водителям · mode: both · reason: страница вне меню /t/:tenantId/earnings — список по рейсам (рейс, водитель, сумма, «Изменено … · кто»), «Итого», фильтр «Подразделение» (listTripEarnings orgUnitId), вход со «Приёмки смен»; дорисовать в прототипе — design-requests «logistics-earnings» · decision: B-6, Q-W2.21-3 · owner: W2.21
- kind: no-reference · target: dialog:Начисление по рейсу · mode: both · reason: правка суммы владельцем (fleet.earnings.manage, setTripEarnings с If-Match): «Сумма, ₽», «Как рассчитано»; проверки суммы — тексты validateExpense эталона · decision: B-6, Q-W2.21-3 · owner: W2.21
- kind: no-reference · target: button:Повторить · mode: both · reason: ошибка listTripEarnings — alert «Не удалось загрузить начисления: …» и «Повторить»; пусто — «Начислений пока нет» · decision: B-6, Q-W2.21-3 · owner: W2.21
