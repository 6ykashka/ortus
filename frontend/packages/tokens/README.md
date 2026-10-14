# @ortus/tokens

Дизайн-токены Ортус и локальные шрифты (W0.10). Источник значений — `design/docs/design-system/tokens.json` (0.2); пакет его не копирует, а генерирует из него файлы.

| Импорт                     | Что даёт                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `@ortus/tokens`            | TS-константы (`color`, `tone`, `sizes`, `breakpoints`, `motion`, …), тип `Tone`, `cssVar()` |
| `@ortus/tokens/tokens.css` | CSS-переменные `--ox-*`                                                                     |
| `@ortus/tokens/fonts.css`  | `@font-face` трёх семейств и класс `.material-symbols-rounded`                              |
| `@ortus/tokens/base.css`   | глобальные правила прототипа (фон, шрифт, фокус, ссылки, `ox-pulse`)                        |

Порядок подключения в приложении: `tokens.css` → `fonts.css` → `base.css`.

## Команды

```powershell
corepack pnpm --filter @ortus/tokens gen          # tokens.json + prototype.json → src/tokens.css, src/tokens.ts
corepack pnpm --filter @ortus/tokens test         # генератор, паритет с tokens.css, drift, шрифты, base.css
node frontend/packages/tokens/scripts/fetch-fonts.mjs --verify   # sha256 шрифтов, без сети
```

`fonts:fetch` нужен только при смене версии шрифтов (пины — в `scripts/fetch-fonts.mjs`); после него — `prettier --write fonts/fonts.css`.

## Правила

- Имена переменных — как в `tokens.css` 0.2 (`color.tone.ok.bg` → `--ox-ok-bg`, `size.control` → `--ox-control`, …); `generate.test.ts` фиксирует их таблицей.
- Значения, которых нет в `tokens.json`, но есть в рендере прототипа, добавляются только в `prototype.json` с `$extensions["ortus.prototype"] = { ref: "<файл>.dc.html:<строка>", decision: "PD-28" }`. Базовые токены не переопределяются.
- В компонентах — только `var(--ox-*)`; литералы цвета запрещены тестами `@ortus/ui`.
- Material Symbols Rounded — Apache 2.0 (не OFL, уточнение PD-21); файл ≈ 5,4 МБ, без субсеттинга.
