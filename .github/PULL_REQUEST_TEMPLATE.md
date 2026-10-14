<!-- Заголовок PR — Conventional Commits: <type>(<scope>): <описание>, scope — ID WS в нижнем регистре (w1.04). -->

## Что сделано

- WS: `W<этап>.<nn>` · шаг плана 27: `X.Y` · истории: `S1-xx`, …
- Бриф: `docs/plan/v2/ws/W<id>.md`
- Отчёт: `docs/plan/v2/reports/W<id>.md` (формат `docs/plan/orchestration.md` §5, дословные прогоны)
- Контрактный PR шага: #… (или «не нужен»)

## Проверки

- [ ] Порядок коммитов: red `test(` идёт отдельным коммитом до своего `feat(`/`fix(` (`docs/plan/tdd-protocol.md` §1)
- [ ] `lint`, `typecheck`, `test`, `build` зелёные (`corepack pnpm run …` / `make …`)
- [ ] Режимы: `mock` зелёный; `stand` — зелёный или «не применяется на этом этапе»
- [ ] Страницы: четыре проверки `docs/plan/verification-protocol.md` (e2e 390/1440, визуальная и структурная сверка, MCP, ревью) или «страниц нет»
- [ ] Строки матрицы изоляции добавлены (backend) или «не применяется»
- [ ] allowlist: только записи с PD/D-ID и сроком снятия (`out-of-stage`, `no-reference`)
- [ ] `git diff --name-only main...HEAD` — только в границах брифа; `design/**` не тронут
- [ ] Новые зависимости — с точной версией и согласованы с интегратором

## Контракты, которые изменены

- … (OpenAPI, `permissions.yaml`, `errors.yaml`, миграции, пропсы `@ortus/ui`, порт адаптера) — или «нет»

## Ревью

- [ ] `api/permissions.yaml`, `api/errors.yaml`, миграции, authz/scopeddb, изоляция, финансы — нужен второй ревьюер (CODEOWNERS)
- [ ] Архитектурное решение оформлено ADR по шаблону `docs/adr/TEMPLATE.md`

## Открытые вопросы

- … (ссылка на `docs/plan/decisions.md`)
