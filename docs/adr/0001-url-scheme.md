# 0001. URL-схема: организация в пути, один origin

Статус: принято (решение плана PD-25 по умолчанию; пересмотр — через `docs/plan/decisions.md`)
Дата: 2026-10-15 · Автор: агент W0.01 · Участники: tech lead, интегратор этапа 0
Решение плана: PD-25 (бывший D-25 мастер-плана, §4.7; вердикт плана v2 — «остаётся: дополнить маршрутами новых модулей; ADR в шаге 0.4»)
Кто решает: tech lead (решение плана, а не комплекта)
Блокирует: W0.05 (`baseURL` e2e), W0.09 (каркас `apps/web`), W1.02 (resolver), W1.20 (роутер и меню), W1.22 (вход)

## Контекст

- В прототипе нет URL. Страница — флаг `pg.*` в состоянии, стартовая страница — `DEFAULT_PAGE` персонажа (`docs/plan/analysis/01-shell.md` §8.1). Q-39: состояние таблиц и вкладок живёт в памяти, маршруты — техническая необходимость и в снимке не видны.
- В проекте 2.0 организация адресовалась хостом `{org}.platform.localhost` (`docs/plan/analysis/12-prior-project-and-skills.md` §3.3 п.6, §7 Q1). Документы комплекта задают **один origin**: `.env.example:25` (`OIDC_REDIRECT_URL=http://localhost:5173/auth/callback`), `.env.example:31` (`ALLOWED_ORIGINS=http://localhost:5173`); сессия host-only (`ortus-openapi-v0.1.yaml:6442`), cookie `HttpOnly`, `Secure`, `SameSite=Lax`, Origin и `X-CSRF-Token` (`03-api-guide.md:40`).
- `02-architecture.md:48`: `tenant_id` клиента выбирает желаемый контекст, но не даёт доступа; неизвестный `tenant_id` не ведёт в «главную БД».
- Q-101: от схемы зависят прокси Vite, redirect URI Keycloak и `baseURL` Playwright. У агентов свои порты по слоту (план v2 §3.6: Vite `5200 + slot`, API `8100 + slot`).
- Итерация 14.10 добавила страницы (`docs/plan/v2/analysis/A-prototype-delta.md` §2, §3.1): `chat` «Чаты», `docs` «Документы», `service` «Обращения», `repairCatalog` «Шаблоны и расценки», `repairSupply` «Снабжение», пункт «Подотчёт» водителя и прораба (`cashSelf`), переходы «открыть запись» (`svcSel`, `docSel`, `chatSel`, `cashOpen`, `rpObj`, `rpFilter`, `rpQ`).
- План 27 вводит экраны пилота, которых нет в прототипе (B-6): вход OIDC (1.3), принятие приглашения (S1-06), «Хранилище» (S1-22). Демо-панель не переносится (шаг 0.9, R-08): персонаж в реализации выбирается dev-входом (PD-54 заменяет PD-44).

## Варианты

1. **Организация в пути, один origin** — `/t/:tenantId/<страница>`, оператор — `/platform/<страница>`. Плюсы: один redirect URI Keycloak, один origin для Vite и CSRF, закладки и две вкладки в двух организациях работают, `baseURL` e2e = порт агента. Минусы: `tenantId` виден в URL, каждый запрос API несёт контекст явно. Цена: resolver по пути и membership (W1.02).
2. **Организация в поддомене** (как 2.0) — `{org}.ortus…`. Плюсы: изоляция cookie по хосту. Минусы: wildcard-сертификаты и DNS, redirect URI на каждую организацию, Node не резолвит `*.localhost` (12 R2), порт агента и поддомен вместе усложняют e2e. Цена: инфраструктура до этапа 1.
3. **Организация только в сессии** — URL без `tenantId`, выбор через переключатель. Плюсы: короткие URL. Минусы: две вкладки в разных организациях конфликтуют, закладка открывает «не ту» организацию, ссылки из уведомлений неоднозначны. Цена: ломает S1-07 (переключатель с запоминанием) как единственный источник правды.

## Решение

Рекомендация и принятое по умолчанию решение — вариант 1.

- Один origin: dev — `http://localhost:5173`, агенты — `http://localhost:${5200 + slot}`; прокси Vite `/api` → адрес из env (`HTTP_ADDR=127.0.0.1:(8100 + slot)`); cookie сессии host-only.
- `:tenantId` — непрозрачная строка: в режиме `mock` — id сида (`t-alta`, `t-lotos`), на стенде — UUID v5 (PD-30). Он выбирает контекст, но не даёт доступа: авторизация только по membership (`02-architecture.md:48`). Чужой или неизвестный `tenantId` → 404 с тем же телом, что у несуществующего маршрута (W1.02).
- Сегмент маршрута = ключ `pg.*` в kebab-case (`repairCatalog` → `repair-catalog`). Состояние страницы — в search-параметрах; на визуальную сверку оно не влияет (Q-39): визуальные и `labels`-спеки открывают страницы через меню.
- Персонаж: в реализации — вход; dev-вход `?persona=<id>` действует на любом маршруте только в e2e-сборке (PD-54), в продуктовой сборке параметр игнорируется. Демо-панель не переносится.
- Редирект `/` → `/t/<lastTenantId>/<DEFAULT_PAGE персонажа>` или `/platform/tenants` для оператора; `lastTenantId` — из `GET /me/context` (S1-07).

### Маршруты

| `pg.*` / контур | Маршрут | Search-параметры | Шаг · кто строит |
|---|---|---|---|
| `home` | `/t/:tenantId/home` | — | S2-18 · W2.25 |
| `modules` | `/t/:tenantId/modules` | — | 1.7 · W1.24 |
| `users` | `/t/:tenantId/users` | `?tab=people\|groups\|roles\|check&role=` (вкладки переснять по 14.10 в W1.00) | 1.5–1.6 · W1.23 |
| `billing` | `/t/:tenantId/billing` | — | 4.6 · W4.61 |
| `branding` | `/t/:tenantId/branding` | — | 4.6 · W4.62 |
| «Хранилище» (S1-22, нет в прототипе, `no-reference`) | `/t/:tenantId/storage` | — | 1.8 · W1.24 |
| «Структура» (S1-08, нет в прототипе, `no-reference`) | `/t/:tenantId/structure` | — | 1.5 · W1.54 |
| `fleet` | `/t/:tenantId/fleet` | `?trip=&pick=1` | 2.1–2.3 · W2.20 |
| `pool` | `/t/:tenantId/pool` | — | 2.9 · W2.23 |
| `review` | `/t/:tenantId/review` | `?trip=` | 2.7–2.8 · W2.21 |
| «Очередь блокирующих дефектов» (S2-17, нет в прототипе, `no-reference`) | `/t/:tenantId/defects` | `?tab=review\|decided` | 2.4 · W2.21 |
| «Начисления водителям» (S2-12, нет в прототипе, `no-reference`) | `/t/:tenantId/earnings` | `?unit=` | 2.7–2.8 · W2.21 |
| «Категории расходов» (S2-08, D-12 комплекта, нет в прототипе, `no-reference`) | `/t/:tenantId/expense-categories` | — | W2.41 |
| `today` | `/t/:tenantId/today` | — | 2.4–2.6 · W2.22 |
| `cars` | `/t/:tenantId/cars` | `?filter=all\|fit\|free` | 2.4 · W2.22 |
| `chat` | `/t/:tenantId/chat` | `?chat=` (`chatSel`) | 7.1 · W7.13 |
| `tasks` | `/t/:tenantId/tasks` | `?project=&view=board\|list&task=&mine=1` (переснять в W4.00) | 4.1 · W4.12 |
| `leads` (легаси-канбан «Заявки») | `/t/:tenantId/leads` | — (судьбу решает W4.13, A факт 11) | 4.1 · W4.13 |
| `service` | `/t/:tenantId/service` | `?req=` (`svcSel`) | 7.3 · W7.32 |
| `forms` | `/t/:tenantId/forms` | `?form=&tab=build\|versions\|responses&resp=&ver=` (переснять в W4.00) | 4.2 · W4.22 |
| `calendar` | `/t/:tenantId/calendar` | `?booking=` | 4.4 · W4.41 |
| `knowledge` | `/t/:tenantId/knowledge` | `?space=&page=` (переснять в W4.00) | 4.3 · W4.32 |
| `docs` | `/t/:tenantId/docs` | `?doc=` (`docSel`) | 7.2 · W7.25 |
| `data` | `/t/:tenantId/data` | `?set=` | 2.11 · W2.26 |
| `files` | `/t/:tenantId/files` | — | 1.8 · W1.24 |
| `cash` | `/t/:tenantId/cash` | `?open=acc:<id>\|sh:<id>` (`cashOpen`) | 5.3 · W5.32 |
| `cashSelf` «Подотчёт» | `/t/:tenantId/cash-self` | — | 5.3 · W5.33 |
| `spa` | `/t/:tenantId/spa` | — | 5.2 · W5.21 |
| `repair` «Объекты» | `/t/:tenantId/repair` | `?obj=&tab=…&filter=&q=` (`rpObj`, `rpFilter`, `rpQ`; вкладки переснять по свежему `Ремонт и стройка.dc.html` в W6.00) | 6.1 · W6.20 |
| `repairSupply` «Снабжение» | `/t/:tenantId/repair-supply` | — | 6.4 · W6.22 |
| `repairCatalog` «Шаблоны и расценки» | `/t/:tenantId/repair-catalog` | — | 6.4 · W6.22 |
| оператор `tenants`, `usage`, `requests`, `accounts`, `plans` | `/platform/tenants`, `/platform/usage`, `/platform/requests`, `/platform/accounts`, `/platform/plans` | `accounts?q=&filter=&org=`, `plans?draft=1` (карточка организации — параметр уточняет W1.25) | 1.11, 4.6 · W1.25, W4.61 |
| вход | `/auth/login`, `/auth/callback` (OIDC Code + PKCE, 1.3), `/auth/dev` (только local и e2e) | `/auth/login?next=` | 1.3 · W1.22 |
| принятие приглашения (S1-06, `no-reference`) | `/auth/invite/:token` | — | 1.3 · W1.22 |
| `planned` | не реализуется (PD-24) | — | — |

Переключатель бизнеса (S1-07) и панель входящих (S1-26) — элементы шапки, своих маршрутов у них нет: переключение меняет `:tenantId` в текущем пути.

## Последствия

- Две вкладки в разных организациях делят cookie; контекст берётся из пути каждого запроса, поэтому проверка Origin и CSRF обязательна.
- e2e: `page.goto('/t/t-alta/home')` через хелпер фикстуры, а не литералом: на стенде `tenantId` — UUID из карты сида (PD-30). Литералы портов (`:5173`) в спеках запрещены — `baseURL` берётся из порта слота.
- Модуль следующего этапа получает маршрут сразу, но до своего этапа показывает `PageStub` или AccessGate (allowlist `out-of-stage`, план v2 §3.7).
- Новые ключи `pg.*` добавляются строкой в эту таблицу тем WS, который строит страницу (DoR этапа подтверждает имя); переименование маршрута после этапа — только через новый ADR.
- Как проверим (тесты у владельцев):
  - W0.05 — `baseURL` из порта слота; `harness.spec.ts` открывает `/t/t-alta/home`;
  - W1.20 — unit роутера: у каждого ключа таблицы есть маршрут; `/t/t-alta/planned` → 404; `/` → редирект по персонажу; search-параметры восстанавливают состояние страницы;
  - W1.02 — `GET /t/<unknown>/…` и `GET /api/tenants/<foreign>/…` → 404 одинаковым телом;
  - сквозные сценарии этапов (W1.30, W2.32, …) ходят по URL из этой таблицы.

## Ссылки

- `docs/plan/00-master-plan.md` §4.7 (исходная таблица), `docs/plan/ws/WS-00-analysis-fixes.md` §7.2, §10 R13, Q-a, Q-b.
- `docs/plan/decisions.md`: PD-24, PD-25, PD-30, PD-44 → PD-54, PD-48; Q-39, Q-101.
- План v2: §2 (B-6), §3.6, §3.7, §7; `docs/plan/v2/analysis/A-prototype-delta.md` §2, §3.1.
