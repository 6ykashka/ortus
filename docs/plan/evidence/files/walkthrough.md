# Проходка Playwright MCP · files «Файлы» (mock)

ok — пункт меню «Файлы» → h1 «Файлы»
ok — абзац эталона
ok — «Место организации» «46,2 из 100 ГБ»
ok — строка файла: имя, родитель, «Готов», размер
ok — «Открыть» доступна
сессия загрузки через API: 202
ok — файл на проверке: «Проверяется», «Открыть» недоступна
ok — «Открыть»: новая вкладка на хост короткой ссылки getFileDownload (storage.example.invalid — адрес MSW, страница ошибки браузера)
ok — пусто: «Доступных файлов нет»
ok — скачивание не готового: тост «Фото ещё загружается. Дождитесь окончания загрузки.»
ok — storage-full: баннер «Место организации заполнено.» и красная полоса
ok — логист с ролью: без «Места организации», список (пусто в mock)
ok — 390: без горизонтальной прокрутки ("390,390")
сеть: хосты 127.0.0.1:5212

## Как выполнялась

- Сервер MCP — `@playwright/mcp` 0.0.78 из `.mcp.json` по stdio (инструментов `mcp__playwright__*` в сессии нет — ToolSearch), Chromium headless, `--isolated`, `--output-dir .playwright-mcp/5212`; клики — по `ref` снимка дерева доступности, найденным по роли и подписи.
- Приложение — Vite `--mode e2e` на 5212 (`VITE_ADAPTER=mock`, сценарный сервер MSW W0.13), вход — dev-вход `?persona=`; эталон — `node tools/design-preview.js design 4112 --offline --ref design-stage-1`.
- Негативные состояния — сценарный сервер (`POST /api/v1/dev/scenario`: пресеты `trial-ended`, `storage-full`, `logistics-ready`, сценарии `X-Test-Scenario`).
- Часы браузера MCP — системные (16.10.2026), в e2e — демо-«сейчас» 01.10.2026 (`installClock`).
- Ход проходки по шагам — `walk-log.txt`; снимки дерева — `snapshot-*.md`; консоль — `console.txt`; сеть — `network.txt`.
## Итог

- Все проверки `ok`. Снимки: `1440.png`, `768.png`, `390.png`, `states/scanning-1440.png` (файл на проверке), `states/empty-1440.png`, `states/storage-full-1440.png`; эталон — `reference-1440.png`, `reference-390.png` (список эталона — статические файлы filesVM, в MSW — файл осмотра Р-208 из примеров контракта, allowlist `files.md`).
- «Открыть» — `getFileDownload` 200 и новая вкладка на короткую ссылку (`tabs-after-open.txt`; хост `storage.example.invalid` — адрес хранилища MSW, вкладка показывает страницу ошибки браузера). Тоста демо нет (S1-21).
- Консоль и сеть — `console.txt`, `network.txt`: запросы приложения только к `127.0.0.1:5212`; ошибки консоли — `404 /favicon.ico`, ответ сценария 409 `photo_not_ready` и `502 /api/v1/dev/scenario` (первый сброс сценария проходки до активации service worker MSW — запрос ушёл в прокси Vite; на приложение не влияет).