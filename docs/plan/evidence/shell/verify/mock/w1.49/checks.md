# shell · проверка W1.49 (ws/W1.49 172970b), режим mock

Проверяющий: слот 17, приложение 6101 (Vite `--mode e2e`, `VITE_ADAPTER=mock`), эталон 4117 `--offline --ref design-stage-1`.
MCP: `@playwright/mcp` из `.mcp.json` по stdio через HTTP-мост (`mcp/bridge.mjs`; `mcp__playwright__*` в сессии нет), вывод `.playwright-mcp/6101`.

## 1. e2e (mobile-390, desktop-1440)
`e2e-mock-390-1440.txt`: shell, access-gate, visual, me-context — 138 passed, 14 skipped (строки `@stand`), 0 failed.
`e2e-visual-768.txt`: tablet-768 visual — 23 passed.

## 2. Визуальная и структурная сверка
390 / 768 / 1440: owner 0,0011/0,0024/0,0010; operator 0,0004/0,0004/0,0002; driver 0,0011/0,0012/0,0006;
therapist 0,0007/0,0010/0,0005; foreman 0,0004/0,0009/0,0003; кадр загрузки, баннеры, access-gate — 0 px.
labels 6 персонажей — зелёные. therapist@t-lotos (вне автоматики) — MCP: «Мой день», «Чаты», «Календарь», «База знаний» =
эталон (`ref-snap-therapist-lotos-1440.md`; бейдж «Чаты 2», «Л/Лотос», акцент — allowlist shell.md out-of-stage).
Массажист «Альты»: эталон «Касса 2» — allowlist shell-therapist.md (out-of-stage, stage-5, R-1 брифа).

## 3. Проходка MCP
Деревья 8 персонажей × 1440/768/390 (`snap-*`, `widths-*.md`): боковая 244, рейл 68, нижняя 60 px, без горизонтальной
прокрутки. Поповеры, «Прочитать все», Escape → фокус на кнопку; Tab-обход владельца (`keyboard-owner-1440.md`);
лист «Все разделы» (ловушка фокуса, Escape → «Ещё»); переключатель бизнеса (Escape → фокус, «Лотос» ↔ «Альта»);
«Выйти» → /auth/login, после logout запросов нет, 401 нет (`network-logout.md`, `console-logout.md`); «Нужен вход»;
кадр загрузки; ошибка загрузки (offline → alert дословно); storage-full (владелец с кнопкой → «Модули и место» без кнопки;
массажист — текст сотрудника); trial-ended (владелец, оператор без баннера); офлайн (пилюля, баннер, тост);
D-23 «Отключены · только чтение» → «Логистика» с баннером (владелец, водитель); 404 в оболочке и вне;
гейты: водитель, прораб, владелец /repair → «Открыть «Модули и место»», массажист /cash → «Нет доступа к разделу «Касса»».
Сеть — только 127.0.0.1:6101; createRealtimeTicket в mock не запрашивается.
Консоль: ошибок React нет; favicon.ico 404 (index.html W0.09), ожидаемые 401/offline в состояниях ошибок, 400/404/428 —
пробы проверяющего.

Расхождение:
- minor: переключатель бизнеса (no-reference, B-6) на 390 — цель 171×18 px (`.ox-org-switch`, min-height auto, padding 0),
  меньше 44 px (verification-protocol §1 п. 3); e2e «цели ≥ 44 px» проверяет только нижнюю навигацию и иконки шапки.
  axe target-size проходит (исключение по отступам). `snap-therapist-390.md`, `impl-therapist-390.png`.

## 4. axe (axe-core 4.13.0 + target-size)
`mcp/axe.md`: 7 персонажей × 3 ширины, профиль, уведомления, лист, загрузка, ошибка, «Нужен вход», 404 ×2, офлайн —
serious/critical нет; moderate: page-has-heading-one (загрузка, ошибка), landmark-one-main/region («Нужен вход»).
