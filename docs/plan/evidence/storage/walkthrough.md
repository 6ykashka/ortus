# Проходка Playwright MCP · storage «Хранилище» (mock, no-reference B-6 №5)

ok — переход по ссылке «Хранилище» из «Модули и место»: h1
ok — крошка
ok — занято 46,2 ГБ, meter
ok — резерв начатых загрузок
ok — разбивка по видам файлов (группы эталона)
ok — разбивка по модулям
ok — расчёт: «Лимит 250 ГБ · 2 500 ₽ в месяц»
ok — срок расчёта
ok — применено: «из 250 ГБ», тост «Лимит места: 250 ГБ»
ok — 25 ГБ: отказ сервера (downgrade_below_usage) текстом в карточке
ok — storage-full: alert карточки и баннер
ok — логист: гейт «Нет права», данных места нет (подпись раздела пустая — манифест W1.20)
ok — 390: без горизонтальной прокрутки ("390,390")
сеть: хосты 127.0.0.1:5212

## Как выполнялась

- Сервер MCP — `@playwright/mcp` 0.0.78 из `.mcp.json` по stdio (инструментов `mcp__playwright__*` в сессии нет — ToolSearch), Chromium headless, `--isolated`, `--output-dir .playwright-mcp/5212`; клики — по `ref` снимка дерева доступности, найденным по роли и подписи.
- Приложение — Vite `--mode e2e` на 5212 (`VITE_ADAPTER=mock`, сценарный сервер MSW W0.13), вход — dev-вход `?persona=`; эталон — `node tools/design-preview.js design 4112 --offline --ref design-stage-1`.
- Негативные состояния — сценарный сервер (`POST /api/v1/dev/scenario`: пресеты `trial-ended`, `storage-full`, `logistics-ready`, сценарии `X-Test-Scenario`).
- Часы браузера MCP — системные (16.10.2026), в e2e — демо-«сейчас» 01.10.2026 (`installClock`).
- Ход проходки по шагам — `walk-log.txt`; снимки дерева — `snapshot-*.md`; консоль — `console.txt`; сеть — `network.txt`.
## Итог

- Все проверки `ok`. Снимки: `1440.png`, `768.png`, `390.png`, расчёт `quote-1440.png`, `states/downgrade-1440.png` (отказ ниже занятого), `states/storage-full-1440.png`. Эталона экрана нет (allowlist `storage.md`, вид `no-reference`).
- Замечание интегратору: у логиста гейт «Нет права» с подписью «Нет доступа к разделу «»» — у страницы `storage` в манифесте `company` W1.20 нет подписи меню (`pageLabel` → null); `snapshot-manager.md`.
- Консоль и сеть — `console.txt`, `network.txt`: только `127.0.0.1:5212`, ошибок React нет.