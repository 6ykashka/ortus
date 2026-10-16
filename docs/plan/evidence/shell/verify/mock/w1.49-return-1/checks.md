# shell · проверка W1.49, возврат 1 (ws/W1.49 724249a), режим mock

Проверяющий: слот 17, приложение 6101 (Vite `--mode e2e`, `VITE_ADAPTER=mock`), эталон 4117 `--offline --ref design-stage-1`.
MCP: `@playwright/mcp` из `.mcp.json` по stdio через HTTP-мост (`mcp/bridge.mjs`, порт 9171), вывод `.playwright-mcp/6101`
(`mcp__playwright__*` в сессии нет).

## 1. e2e
- `e2e-mock-390-1440.txt`: shell, access-gate, visual, me-context, mobile-390 + desktop-1440 — 140 passed, 14 skipped (@stand), 0 failed.
- `e2e-768.txt`: tablet-768, visual + shell.spec — 58 passed, 6 skipped (@stand), 0 failed (в т.ч. «переключатель бизнеса — цель ≥ 44 px»).
- unit web (`unit-web.txt`): не запущен — vitest не стартует в worktree scratch из-за длины пути (> 260 символов до
  node_modules/.pnpm/vitest@5.0.3_…/package.json, ERR_PACKAGE_IMPORT_NOT_DEFINED). Ограничение среды, не дефект.

## 2. Визуальная и структурная сверка
390 / 768 / 1440 (доля пикселей): owner 0,0011/0,0024/0,0010; operator 0,0004/0,0004/0,0002; driver 0,0011/0,0012/0,0006;
therapist 0,0007/0,0010/0,0005; foreman 0,0004/0,0009/0,0003; boot 0. Совпадает с отчётом побитно. labels — зелёные.
therapist@t-lotos (MCP, `mcp/ref-snap-therapist-lotos-*.md`): эталон «Мой день», «Чаты 2», «Календарь», «База знаний» =
реализация (бейдж — allowlist shell.md). manager — allowlist shell-manager.md.

## 3. Проходка MCP (`mcp/`)
- 8 персонажей × 1440/768/390 (`widths-*.md`, `snap-*`, `impl-*`): боковая 244, рейл 68, нижняя 60 px, без гориз. прокрутки.
- Переключатель (`switcher.md`): 171×44 на трёх ширинах, точки верх/середина/низ — переключатель; Enter → «Бизнесы»
  («Альта Групп», «SPA «Лотос»»), Escape → фокус на переключатель.
- «Выйти» владельца → /auth/login, после logout запросов API нет, 401 нет, консоль чистая (`scenarios.md`).
- Лист «Все разделы» «Лотоса» 390 — без «Касса»; Escape → «Ещё». /cash массажиста — «Нет доступа к разделу «Касса»».
- Профиль, Escape → «Профиль» (solid). Загрузка, ошибка (offline), storage-full (владелец с кнопкой, массажист без),
  trial-ended, 404 ×3, «Нужен вход» — дословно. Tab-обход массажиста (`keyboard-therapist-1440.md`).
- Сеть: только 127.0.0.1:6101; realtime-tickets в mock — 0. Консоль: только ожидаемые (offline, 401 без сессии) и
  favicon.ico 404 (index.html W0.09, integratorNotes исполнителя).

## 4. axe (`mcp/axe.md`)
7 персонажей × 3 ширины + профиль, уведомления, лист, поповер «Бизнесы» — нарушений нет (default + target-size).

## Расхождение (minor, регресс возврата 1)
Кольцо фокуса переключателя бизнеса обрезано сверху и охватывает строку области. `.ox-org-switch` с `min-height: 44px`
и `margin-block: -13px` начинается на y = −0,7…−1 px (шапка у верхнего края окна), `outline: 2px` с `outline-offset: 2px`
уходит на y ≈ −5 — верхняя сторона кольца вне окна на 390, 768 и 1440. Кольцо при этом обводит и «Салон и SPA · мой
календарь», которая не входит в элемент управления. `mcp/impl-therapist-390-switcher-focus.png`,
`mcp/impl-therapist-1440-switcher-focus.png`, `mcp/focus1440.mjs`. До возврата 1 кольцо было полным (цель 18 px).
Требование: verification-protocol §1 п. 3 «фокус виден» (WCAG 2.4.7 / 2.4.11). e2e это не проверяет.
Вариант исправления: увеличивать цель без выхода за шапку (например, `margin-block` не больше отступа до верха шапки,
или `outline-offset: -2px` для `.ox-org-switch`), и проверить кольцо в e2e.

## Вне страницы
`git worktree add` в каталоге scratch падает: «Filename too long» на
`docs/plan/evidence/shell/verify/mock/w1.49/mcp/widths-owner_operator_manager_driver_therapist_foreman_therapist-t-lotos_owner-t-lotos.md`
(коммит 1413579). Обход — `git -c core.longpaths=true`. Предложение: переименовать файл короче.