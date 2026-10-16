# W1.49 · проходка Playwright MCP — `shell` и `access-gate` (режим mock)

- Инструментов `mcp__playwright__*` в сессии нет (ToolSearch). Сервер `@playwright/mcp` из `.mcp.json` запущен по stdio,
  как это делает `tools/mcp-check.js` (`walk.mjs` — сценарий проходки; клики по `ref` снимка, найденному по роли и подписи).
- Приложение: Vite `--mode e2e` на 5203, `VITE_ADAPTER=mock`. Эталон: `node tools/design-preview.js design 4103 --offline --ref design-stage-1`.
- Итог проверок — `checks.md` (18 проверок, все `ok`). Полный журнал вызовов — `mcp-log.md`.

## Что пройдено

1. Владелец 1440: дерево (`banner`, «Основная навигация», «К содержимому»), меню D-23 из 16 пунктов — `snapshot-owner-1440.md`, `impl-owner-1440.png`.
2. Поповер «Профиль» → Escape: фокус на кнопке «Профиль», кольцо `solid` (замечание возврата 3 W1.20 — закрыто).
3. Режим mock: запроса `createRealtimeTicket` нет (транспорта нет — бриф W1.49, R-3).
4. «Выйти» → `/auth/login`; после `POST /api/v1/auth/logout` 200 запросов нет, консоль без ошибок (`logout-network.md`, `logout-console.md`) — замечание «3 ошибки 401 после выхода» закрыто.
5. Массажист «Альты» — «Мой день», «Чаты», «Календарь», «База знаний»; переключатель → «SPA «Лотос»» — те же четыре пункта, как эталон `therapist@t-lotos` (`snapshot-therapist-lotos-1440.md` ↔ `ref-snapshot-therapist-lotos-1440.md`, `impl-therapist-lotos-1440.png` ↔ `ref-therapist-lotos-1440.png`) — замечание «Касса у массажиста Лотоса» закрыто. Эталон массажиста «Альты» показывает «Касса 2» (роль «Кассир салона» этапа 5) — allowlist `shell-therapist.md`, `out-of-stage`, `expires: stage-5`.
6. 390: нижняя навигация «Мой день», «Чаты», «Календарь», «Ещё»; лист «Все разделы» без «Касса» (`impl-therapist-lotos-390-sheet.png`).
7. 768: рейл 68 px (`impl-owner-768.png`); 390 владельца (`impl-owner-390.png`).
8. `storage-full` у массажиста «Альты»: баннер «Место организации заполнено.» с текстом сотрудника, без кнопки (`impl-therapist-storage-full-1440.png`) — замечание возврата 2 подтверждено закрытым.
9. Кадр загрузки (`getMyContext=loading`): меню 244 px, 0 пунктов, «Данные других организаций изолированы», без знака (`impl-loading-1440.png`).
10. `access-gate`: водитель на 1440/768/390 — «Логистика» не подключена организацией (`impl-driver-*.png`); массажист по прямому URL «Касса» без права — ветка A «Нет доступа к разделу «Касса»» (`impl-therapist-cash-1440.png`).

## Консоль и сеть

- Консоль `shell` и `access-gate`: 0 ошибок, 0 предупреждений (`console.md`).
- Сеть: запросы приложения — только `127.0.0.1:5203` (`network.md`).

## Прогоны e2e

- `e2e-mock-390-1440.txt` — `shell`, `access-gate`, `visual`, `me-context` на 390 и 1440: 138 passed, 14 skipped (строки стенда в mock).
- `e2e-visual-768.txt` — `visual` на 768: 23 passed.
- `e2e-stand.txt` — `node tools/ci/e2e-stand.mjs --slot 3` (CI=true): 30 passed, `@stand пройдено 30, пропущено 0, упало 0` (предыдущий прогон до `test.slow()` строки водителя — 2 flaky: холодный вход, первая строка проекта), compose `ortus-s3` снят.
