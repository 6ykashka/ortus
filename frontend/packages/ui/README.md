# @ortus/ui

Компоненты Ортус на React Aria Components (PD-13, без HeroUI) и токенах `@ortus/tokens` (W0.10).

- Реализованы (S0-05): `Button`, `Field`, `Status`, `Banner`, `Card`, `Dialog` и служебный `Icon`.
- Остальная номенклатура `components.md` 14.10 — типы пропсов (`src/types`) и заглушки `data-stub` с владельцем (`OWNERS` в `src/contract.ts`). Владелец заменяет каталог `src/core/<Name>` или `src/domain/<Name>` целиком; пропсы можно только дополнять необязательными.
- `AppShell` — только тип `AppShellProps`, реализация в `apps/web` (W1.20).

Приложение подключает стили токенов один раз: `@ortus/tokens/tokens.css`, `@ortus/tokens/fonts.css`, `@ortus/tokens/base.css`.

## Команды

```powershell
corepack pnpm --filter @ortus/ui test              # Vitest + Testing Library + axe, контракт, заглушки, баррель
corepack pnpm --filter @ortus/ui typecheck
corepack pnpm --filter @ortus/ui barrel            # пересобрать src/index.ts (не править руками)
corepack pnpm --filter @ortus/ui storybook -p 7209 # Storybook исполнителя: 7200 + слот
corepack pnpm --filter @ortus/ui storybook:build   # storybook-static/
```

## Правила

- Пропсы сверяются с `contract/components.md` (копия 14.10 до обновления `design/` задачей W0.02) тестом `contract.test.ts`.
- Цвета только через `var(--ox-*)`: литералы `#hex`, `rgb()`, `hsl()` в `src/` запрещены тестом.
- Новый компонент — каталог `src/core/<Name>/` с `index.ts`, затем `barrel`.
- Атрибуты, которые RAC не пропускает в DOM (`aria-busy`, `aria-current`, `aria-modal`), дописываются через `render` компонента RAC.
