# tools/ — снимок проекта Claude Design и его обслуживание

Каталог `design/` — байт-в-байт копия проекта Claude Design «Ортус CRM: первая итерация»
(`https://claude.ai/design/p/724fad7d-35a5-4dcc-b888-2f2c0c9690e6`), снятая 3 октября 2026 года.
Это эталон реализации («точно так же, как нарисовано»); его не редактируют. Обновлять — только
целиком, повторив процедуру ниже, с записью даты в этом файле.

## Состав снимка

| Путь                                                                                      | Что                                                                                                               | Размер                   |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `design/Ортус CRM.dc.html`                                                                | Интерактивный прототип CRM (шаблон + логика)                                                                      | 601 806 байт, 4537 строк |
| `design/Документация.dc.html`                                                             | Просмотрщик документации (навигация, поиск, рендер md/yaml/sql)                                                   | 43 411 байт              |
| `design/Дизайн-система.dc.html`, `Объекты - варианты.dc.html`, `Ремонт и стройка.dc.html` | Справочник дизайн-системы, варианты карточки объекта, дочерний макет ремонта                                      | —                        |
| `design/support.js`                                                                       | Рантайм dc-компонентов (sc-if/sc-for, DCLogic, загрузка React UMD с CDN)                                          | 69 150 байт              |
| `design/ortus/*.js`                                                                       | Домен (`models.js`), mock-адаптер (`api.js`), сид (`mock-data.js`, `extra-data.js`), карта экранов (`roadmap.js`) | —                        |
| `design/docs/**`                                                                          | Комплект документов v0.1/v0.2, SQL, OpenAPI (365 КБ), токены, каталог прав                                        | —                        |
| `design/README.md`                                                                        | README прототипа                                                                                                  | —                        |
| `design/uploads/**`, `design/screenshots/**`, `design/.thumbnail`                         | Исходные загрузки и служебные изображения (не используются)                                                       | —                        |
| `design/Ortus CRM.dc.html`                                                                | Пустая латинская заготовка (207 байт), не используется                                                            | —                        |

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
