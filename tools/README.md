# tools/ — снимок проекта Claude Design и его обслуживание

Каталог `design/` — байт-в-байт копия проекта Claude Design «Ортус CRM: первая итерация»
(`https://claude.ai/design/p/724fad7d-35a5-4dcc-b888-2f2c0c9690e6`). Первый снимок снят 3 октября
2026 года (тег `design-2026-10-03`); текущий — **итерация 14.10.2026** (W0.02, тег `design-stage-1`),
частичный: полного экспорта 14.10 нет (блокер B-1). Происхождение, размер и SHA-256 каждого файла и
список недостающих — в `design/MANIFEST.md`.
Это эталон реализации («точно так же, как нарисовано»); его не редактируют. Обновлять — только
целиком, повторив процедуру ниже, с записью даты в этом файле и в `design/MANIFEST.md`.

## Состав снимка (14.10.2026)

| Путь                                                                                      | Что                                                                                                                                                                                                                | Итерация · размер                                       |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `design/Ортус CRM.dc.html`                                                                | Интерактивный прототип CRM (оболочка + 8 встроенных модулей `<dc-import>`)                                                                                                                                         | 14.10 · 610 877 байт, 4512 строк                        |
| `design/Документация.dc.html`                                                             | Просмотрщик документации (навигация, поиск, рендер md/yaml/sql; документы 20–27)                                                                                                                                   | 14.10 · 45 274 байт                                     |
| `design/ortus/*.js`                                                                       | Домен (`models.js`), mock-адаптер (`api.js`), сид (`mock-data.js`, `extra-data.js`), карта экранов (`roadmap.js`), домен модулей (`service.js`, `knowledge.js`, `documents.js`, `chats.js`, `cash.js`) — 10 файлов | 14.10                                                   |
| `design/docs/**`                                                                          | Комплект документов v0.1/v0.2 (включая 20–27), SQL, OpenAPI (365 КБ), токены, каталог прав                                                                                                                         | 14.10                                                   |
| `design/uploads/**`, `design/screenshots/**`                                              | Исходные загрузки (в т. ч. референсы Яндекс Форм) и проверочные снимки модулей                                                                                                                                     | 14.10 (+ 4 старых `screenshots/*dbg.png` от 03.10)      |
| `design/Дизайн-система.dc.html`, `Объекты - варианты.dc.html`, `Ремонт и стройка.dc.html` | Справочник дизайн-системы, варианты карточки объекта, дочерний макет ремонта                                                                                                                                       | 03.10 (в 14.10 не присланы; «Ремонт и стройка» устарел) |
| `design/support.js`                                                                       | Рантайм dc-компонентов (sc-if/sc-for, DCLogic, загрузка React UMD с CDN)                                                                                                                                           | 03.10 · 69 150 байт                                     |
| `design/README.md`, `design/.thumbnail`, `design/Ortus CRM.dc.html`                       | README прототипа, превью, пустая латинская заготовка                                                                                                                                                               | 03.10                                                   |
| `design/MANIFEST.md`                                                                      | Манифест снимка (W0.02): файлы, SHA-256, недостающее, как проверено                                                                                                                                                | —                                                       |

Не хватает (подробно — `design/MANIFEST.md`): 7 модульных `.dc.html` («Формы и опросы», «Обращения», «Задачи и проекты», «База знаний», «Документы», «Чаты», «Касса»), свежий «Ремонт и стройка» и шесть «… - варианты».

### Как собран снимок 14.10 (W0.02)

Файлы итерации прислал пользователь: `Downloads/Ортус CRM.dc.html`, `Downloads/Документация.dc.html` и архивы `Downloads/Ортус CRM_ первая итерация*.zip` (`docs/`, `ortus/`, `screenshots/`, `uploads/`). Архивы распакованы во временный каталог и сверены по SHA-256 с повторной распаковкой; файлы скопированы в `design/` байт в байт. Служебных блоков `data-omelette-injected` в них нет (экспорт, а не `GetFile`), `design-strip-injected.js` не понадобился. Проверка: `node --test "docs/plan/scripts/design-snapshot.test.mjs"` и проходка эталона в Chromium у owner, manager, driver.

## Как снят снимок

1. `DesignSync` (встроенный инструмент Claude Code) отдаёт файлы проекта, но режет содержимое на
   256 КиБ: прототип (602 КБ) и OpenAPI (365 КБ) через него получить целиком нельзя.
2. Поэтому полные файлы забраны через RPC самого приложения Claude Design из залогиненного
   браузера: `POST https://claude.ai/design/anthropic.omelette.api.v1alpha.OmeletteService/ListFiles`
   (рекурсивно по `path`) и `.../GetFile` с заголовками `content-type: application/json`,
   `connect-protocol-version: 1`; `GetFile` возвращает `content` в base64. Все 78 файлов собраны
   в один JSON-бандл и скачаны как `ortus-design-bundle.json`.
3. `node tools/design-unpack-bundle.js <bundle.json> design` — распаковка байт-в-байт с
   проверкой размеров.
4. `node tools/design-strip-injected.js design` — HTML-файлы, отданные через `GetFile`, содержат
   служебные блоки `<style data-omelette-injected>` и `<script data-omelette-injected>`
   (переключатель темы редактора, ~20 КБ) после `<head>`; скрипт удаляет их. После удаления
   размеры совпали с `ListFiles` для всех `.dc.html`, а первые 256 КиБ прототипа — с копией
   от `DesignSync` (сверено побайтно).

## Локальный эталон

```bash
node tools/design-preview.js design 4173                 # как облачная версия (CDN, нужен интернет)
node tools/design-preview.js design 4173 --offline       # офлайн: React UMD из tools/vendor, без Google Fonts
node tools/design-preview.js design 4174 --offline --ref design-stage-1   # снимок этапа из git-тега (PD-57)
# http://127.0.0.1:4173/Ортус%20CRM.dc.html
# http://127.0.0.1:4173/Документация.dc.html#/openapi
```

Сервер отдаёт кириллические пути, ES-модули (`ortus/*.js`) и markdown/yaml/sql с правильными
MIME; выход за корень — 403, отсутствующий `favicon.ico` — 204. Без флагов файлы отдаются
байт-в-байт. С `--offline` ответы `.dc.html` переписываются в памяти: React/ReactDOM UMD 18.3.1
(`tools/vendor/`, sha384 = SRI из `support.js`) подключаются до `support.js`, Google Fonts —
`/__fonts/fonts.css` (шрифты токенов W0.10; до них — пустой CSS). `Документация.dc.html` тянет
marked/js-yaml/mermaid с jsdelivr — офлайн не подменяются (читалка не эталон страниц).

Playwright-харнесс (`frontend/packages/e2e-kit`, `docs/plan/v2/ws/W0.05.md`) поднимает этот сервер
с `--offline` как `webServer` и открывает любой `.dc.html` фикстурой `reference(file)`.

## Инструменты харнесса (W0.05)

| Команда                                                       | Что делает                                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `node tools/verify-pages.js [--check] [--base main] [--hook]` | свежий evidence `docs/plan/evidence/<key>/` для изменённых страниц по реестру `tools/page-keys.json`; Stop-хук Claude Code — `--hook` |
| `node tools/allowlist-lint.js [--stage N] [<каталог>…]`       | проверка allowlist `frontend/apps/web/e2e/visual/allowlist/*.md` (D-50, `out-of-stage`, `no-reference`)                               |
| `node tools/mcp-check.js [--url <адрес>] [--expect <текст>]`  | старт Playwright MCP из `.mcp.json`, список инструментов, `browser_snapshot`                                                          |
| `node --test "tools/__tests__/*.test.mjs"`                    | тесты инструментов (`corepack pnpm run test:tools`)                                                                                   |
