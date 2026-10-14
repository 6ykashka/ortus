# tools/vendor — React UMD для офлайн-эталона

`node tools/design-preview.js design <port> --offline` подключает эти файлы до `support.js`, поэтому
`loadReactUmd` (`design/support.js:1838`) не ходит на unpkg. Файлы не редактируются и не
форматируются (исключены в `.prettierignore`, `eslint.config.mjs`; `-text` в `.gitattributes`).

| Файл | Источник | sha384 (SRI из `design/support.js`) |
|---|---|---|
| `react.production.min.js` | `https://unpkg.com/react@18.3.1/umd/react.production.min.js` | `DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z` (`:1144`) |
| `react-dom.production.min.js` | `https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js` | `gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1` (`:1146`) |

Скачано 15.10.2026 (W0.05); совпадение хешей проверяет `tools/__tests__/vendor.test.mjs`.
Babel standalone (`support.js:1147`) не вендорится: эталон его не загружает (нет `x-import` с JSX).
