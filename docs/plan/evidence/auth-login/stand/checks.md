# W1.22 · проходка Playwright MCP на стенде — auth-login (слот 10, 16.10)

Стенд и запуск — как `../../auth-invitation/stand/checks.md`; сценарий `walk-login.js`.

| # | Проверка | Итог | Детали |
|---|---|---|---|
| 1 | `?signedOut=1` — «Вы вышли», без запросов к API | ok | `1440.png`, `snapshot-signed-out-1440.txt` |
| 2 | без сети «Войти» — «Нет связи», значок баннера — глиф (шрифт загружен заранее) | ok | `impl-offline-1440.png` |
| 3 | `?error=session_expired&next=…` — «Сессия истекла. Войдите снова — после входа вы вернётесь на прежнюю страницу.» | ok | `768.png`, `390.png`, `snapshot.txt`; overflow 0, кнопка 48 px |
| 4 | «Войти» с next=/auth/invitation → `GET /api/v1/auth/login?returnTo=%2Fauth%2Finvitation` | ok | стенд без OIDC отвечает 503 `dependency_unavailable` JSON (W1.03; Q-W1.22-3) |
| 5 | на загрузке экрана запросов к API нет | ok | apiOnLoad: [] |