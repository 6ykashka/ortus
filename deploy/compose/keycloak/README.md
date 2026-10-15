# Keycloak стенда (профиль `keycloak`, W1.03)

Realm-экспорт для `start-dev --import-realm` (D-03 по умолчанию, ADR-0004): realm клиентов и отдельный realm операторов. Файлы импортируются при первом старте контейнера; после правки — `down -v` профиля и новый `up`.

| Файл                         | Realm             | Регистрация                           | Пользователи (пароль `change-me-local`)                                    |
| ---------------------------- | ----------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| `realm-ortus.json`           | `ortus`           | да, с подтверждением почты (Mailpit)  | `d.zimina@alta.example`, `o.petrova@alta.example`, `m.kotova@alta.example` |
| `realm-ortus-operators.json` | `ortus-operators` | нет: операторов заводит администратор | `e.lapteva@ortus.example`                                                  |

Клиент в обоих realm — `ortus-web`: конфиденциальный (`OIDC_CLIENT_SECRET=change-me-local` — заглушка `.env.example`), только Authorization Code, PKCE S256 обязателен, implicit, direct grants и service account выключены. Redirect URI — `/api/v1/auth/callback` на Vite `5173` и `5200 + слот` (слоты 0…20, `localhost` и `127.0.0.1`), без `*`. После выхода Keycloak возвращает на корень того же origin. Файлы генерирует `node deploy/compose/keycloak/gen-realms.mjs`, проверяет `TestRealmFiles` (`backend/internal/platform/session/oidc/realm_test.go`).

Пользователи OIDC — не аккаунты сида: при первом входе BFF заводит аккаунт с issuer realm без членств (`MeContext.tenants` пуст). Членство появляется после принятия приглашения, почта которого совпадает с подтверждённой почтой Keycloak.

BFF отклоняет вход без `email_verified=true` (403, Q-W1.03-2). В realm `ortus-operators` подтверждение почты выключено (`verifyEmail: false`, нет регистрации), поэтому администратор заводит оператора сразу с флагом **Email verified** (консоль: Users → Create user → Email verified; Admin REST: `"emailVerified": true`). Иначе оператор войдёт в Keycloak, но получит 403 от BFF.

## Keycloak-smoke (интегратор, план v2 §3.6)

Keycloak занимает ≈ 1 ГБ, поэтому у исполнителей вход идёт через dev-провайдер. Smoke запускает интегратор на своём слоте:

1. `node deploy/compose/stand.mjs init --slot <N>`; `node deploy/compose/stand.mjs up --profile keycloak`; `migrate`, `seed`.
2. `cmd/api` с `AUTH_PROVIDER=oidc`, `OIDC_ISSUER=http://localhost:<KEYCLOAK_PORT>/realms/ortus`, `OIDC_CLIENT_ID=ortus-web`, `OIDC_CLIENT_SECRET=change-me-local`, `OIDC_REDIRECT_URL=http://localhost:<5200+N>/api/v1/auth/callback`, `OPERATOR_OIDC_ISSUER=http://localhost:<KEYCLOAK_PORT>/realms/ortus-operators`, `ALLOWED_ORIGINS=http://localhost:<5200+N>`; Vite `@ortus/web` на `5200 + N` (прокси `/api`).
3. Браузер: `http://localhost:<5200+N>/api/v1/auth/login?returnTo=/` → форма Keycloak `ortus` → `d.zimina@alta.example` → возврат на `/`, cookie `ortus_sid` (HttpOnly) и `ortus_csrf`; `GET /api/v1/me/context` — 200, `tenants: []`.
4. `POST /api/v1/auth/logout` без `X-CSRF-Token` → 403 `csrf_failed`; с токеном и `Idempotency-Key` → 200 и `endSessionUrl` realm `ortus`; повтор с тем же ключом → 200 `Idempotency-Replayed: true`; `GET /api/v1/me/context` → 401.
5. `…/auth/login?returnTo=/platform/tenants` → форма realm `ortus-operators`; `d.zimina@alta.example` там не входит (нет такого пользователя), `e.lapteva@ortus.example` входит.
6. `node deploy/compose/stand.mjs down -v`.

## Риск для stage и прода

`GET /api/v1/auth/login` публичный, и каждый вызов пишет строку `auth_login_states` в control DB (живёт 10 минут, просроченные убираются раз в 256 записей). Лимитера запросов в платформе нет (Q-W1.03-9), поэтому частоту `/api/v1/auth/login` и `/api/v1/auth/invitations/*` ограничивает обратный прокси по IP.
