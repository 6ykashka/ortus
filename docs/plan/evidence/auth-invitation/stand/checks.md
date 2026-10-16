# W1.22 · проходка Playwright MCP на стенде — auth-invitation (слот 10, 16.10)

Стенд `ortus-s10`: postgres + mailpit (`stand.mjs up postgres` / `up mailpit`), `cmd/api` APP_ENV=e2e, AUTH_PROVIDER=dev,
SMTP localhost:2025, PUBLIC_ORIGIN=http://localhost:5210; Vite `--mode e2e` VITE_ADAPTER=http на 5210. Сценарий —
`docs/plan/evidence/auth-login/stand/walk-invitation-inbox.js` через `@playwright/mcp` по stdio (`mcp-run.mjs`).

| # | Проверка | Итог | Детали |
|---|---|---|---|
| 1 | владелец «SPA «Лотос»» приглашает (inviteMember 201) → письмо в Mailpit | ok | тема «Приглашение в «SPA «Лотос»»», ссылка http://localhost:5210/auth/invitation#token=… |
| 2 | ссылка без входа: «Приглашение в «SPA «Лотос»»», «Войти и принять», фрагмент убран из адреса | ok | `1440.png`, `768.png`, `390.png`; адрес /auth/invitation, overflow 0 |
| 3 | токен не попал в адреса запросов к API | ok | tokenInApiUrls: false (токен только в теле POST inspect/accept) |
| 4 | dev-вход нового человека (W1.50) → «Вы вошли как Проходка Приглашения.» → «Принять приглашение» | ok | `impl-signed-in-1440.png` |
| 5 | принятие → /t/<Лотос>/home, тост «Вы присоединились к «SPA «Лотос»»» | ok | `impl-accepted-1440.png` |
| 6 | повторная ссылка — «Приглашение уже принято» | ok | `impl-already-accepted-1440.png` |
| 7 | неизвестный токен — «Приглашение не найдено» (inspect 404) | ok |  |
| 8 | уборка: владелец приостанавливает новичка (updateMember 200), место тарифа свободно | ok |  |
| 9 | консоль | ok | ошибок React нет; журнал сети браузера: 404 inspect (неизвестный токен), 401 /me/context без входа, 501 realtime-tickets (W1.49), 404 /favicon.ico |