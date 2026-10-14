# WS-40 · `cmd/api`: chi + strict server по тегам, конвейер middleware, сессия dev-провайдера (BFF), tenant resolver, `/me/context` (`tenants[]`, `selectTenant`), `listMyEvents`, idempotency, `X-Test-Scenario` (PD-31), Problem-маппинг

Волна 1 · Размер M (2–3 сессии агента, `00-master-plan.md` §5) · Вид backend · Зависит от WS-02 (compose), WS-03 (контракт 0.2 core) · Блокирует WS-42, WS-43, WS-54 напрямую (§6.1: `WS-40 → WS-42, WS-43, WS-54`), через WS-42 — WS-44…WS-50 · Ревьюеров 1 · `suites: ["integration"]` (§7.2) · `pages: []` (страниц и MCP-проходки у WS нет; проверяющие по `ws.pages` не запускаются — `orchestration.md` §4).

Условные ссылки как в мастер-плане §0.1: «10 §3.2» = `docs/plan/analysis/10-api-and-architecture.md` §3.2; «12 R6» = `docs/plan/analysis/12-prior-project-and-skills.md` §3.2 строка R6; «yaml:6628» = `design/docs/v0.1/ortus-openapi-v0.1.yaml:6628`; «control:47» = `design/docs/db/control_0001_init.sql:47`; «core:27» = `design/docs/db/tenant_0001_core.sql:27`; «12-errors:32» = `design/docs/12-errors-and-events.md:32`; «D-NN/Q-NN» = `docs/plan/decisions.md` и `00-master-plan.md` §10.3.

## 1. Цель

После WS-40 один запрос проходит путь «браузер → BFF → API → control DB → ответ» (выход из S0, `design/docs/13-backlog-s0-s2.md:38`): `POST devLogin` ставит cookie `ortus_sid`, `GET /api/v1/me/context` отдаёт `MeContext` с `tenants[]`/`lastTenantId` и `selectTenant` запоминает выбор (S1-07, PD-48), а любой запрос к `/api/v1/tenants/{tenantId}/…` проходит конвейер «request-id → лог → сессия → CSRF/Origin → членство → состояние тенанта → TenantContext → идемпотентность → хендлер тега» без fallback в «главную БД» (S1-02; 10 §3.3; 12 R7). Все ошибки — `application/problem+json` с кодом из enum (`problem.From(err)` в одном месте, `design/docs/14-engineering.md:110`), четыре вида 404 байт-в-байт равны (12 §5 п.1), `Idempotency-Key` обрабатывается middleware для всех изменяющих операций (S1-25, NFR-02), а заголовок `X-Test-Scenario` принимается только при `APP_ENV=e2e` (PD-31) — это фундамент, на который WS-42…WS-50 вешают `permit()`, `scopeQuery()` и модули.

## 2. Границы файлов

| Действие | Пути | Примечание |
|---|---|---|
| создаёт | `backend/cmd/api/{main.go,config.go,router.go,router_test.go,deps.go}` | композитный роутер по тегам (PD-47); `router.go` после слияния волны 1 правит только интегратор (§3.3) |
| создаёт | `backend/internal/platform/requestid/` | `X-Request-Id` (12 R6) |
| создаёт | `backend/internal/platform/clock/` | `Clock`, `System`, `Fixed`, `E2E_CLOCK` (PD-45, П18) |
| создаёт | `backend/internal/platform/problem/` | `Problem`, `Error`, реестр `code → status/title`, `From(err)`, `Write` |
| создаёт | `backend/internal/platform/httpx/` | `DecodeStrict`, `JSON`, `WantsHTML`, `Recover`, `Logging`/`AddAttrs`, `SecurityHeaders`, `TestScenario` (PD-31), `ResponseRecorder.Unwrap` |
| создаёт | `backend/internal/platform/session/` (+ `session/dev/`, `session/authhttp/`) | `Manager`, `Store` (`memstore`), cookie, CSRF double-submit + Origin, dev-провайдер; strict-реализация тега `auth` |
| создаёт | `backend/internal/platform/tenantctx/` (+ `tenantctx/pgdirectory/`, `tenantctx/mehttp/`) | `Directory`, `TenantContext`, `Resolve`, `Pools` (ленивый пул + sentinel); strict-реализация тега `me` |
| создаёт | `backend/internal/platform/idem/` (+ `idem/pgstore/`, `idem/memstore/`) | `Store`, `Middleware`, `FromContext`, `CompleteInTx` |
| создаёт | `backend/internal/platform/pipeline/` | `Mount`, `Chain`, маркер монтирования, `Verify`, `Authorizer` (`DenyAll`), `Operation` из спецификации |
| создаёт | `backend/test/isolation/platform_test.go`, `backend/test/concurrency/platform_test.go` | файл на модуль (PD-51; §3.3 «файл на модуль — его WS»); фикстуры строит сам тест через харнесс WS-07, без `TRUNCATE` (12 §6 п.12) |
| создаёт | `docs/plan/reports/WS-40.md`, `docs/plan/evidence/backend-platform/` | отчёт и evidence (§8) |
| меняет | `docs/plan/status.md` — только строка `WS-40` | `orchestration.md` §7 |
| **запрещено** | `api/**` (контракт — WS-03/интегратор, PD-47), `backend/internal/api/**` (генерация, только `make gen` без правок), `backend/go.mod` (новые зависимости — через интегратора, 12 §5 п.28), `backend/migrations/**` (WS-41), `backend/internal/platform/{authz,scopeddb}/` (WS-42), `backend/internal/platform/{storage,events,audit}/` (WS-45), `backend/test/harness.go`, `backend/test/testdb/` (WS-07), `deploy/**` (WS-02), `.github/**`, `Makefile`, `.golangci.yml` (WS-01), `design/**`, `frontend/**` | файл вне карты возвращается автору (12 §5 п.15) |

Worktree и ветка (PowerShell 5.1, без `&&`; `orchestration.md` §1):

```powershell
git worktree add ..\ws-40-backend-platform -b ws/ws-40-backend-platform main
cd ..\ws-40-backend-platform
pnpm install                      # хуки husky/lint-staged в каждом worktree (12 §8 п.16)
go -C backend mod download
docker compose -f deploy/compose/docker-compose.yml --profile test up -d --wait postgres-test   # 5433, tmpfs (WS-02)
$env:HTTP_ADDR = "127.0.0.1:8120" # 8080 + 40: порт исполнителя, интегратор — 8080 (правило §7.4 для backend)
```

Коммиты — `git commit -F <файл без BOM>`; первый коммит ветки начинается с `test(ws-40): …` (12 §5 п.12, §6 п.21–22).

## 3. Входы

| Источник | Что взять |
|---|---|
| 10 §3.2 «Сессия и BFF» | cookie `HttpOnly, Secure, SameSite=Lax`; CSRF `X-CSRF-Token` + `Origin`; bearer + cookie отклоняются; CSRF bootstrap — «deferred authentication surface» (yaml:75–77) |
| 10 §3.3 «Tenant resolver и TenantContext» | порядок сессия → Account → активный TenantMembership → состояние тенанта → immutable `TenantContext {tenant_id, membership_id, actor_id, policy_version}`; routing в control DB; sentinel при открытии пула; «нет fallback в главную БД» |
| 10 §3.4 | `x-permissions-mode: all`; `permit()`/`scopeQuery()` — WS-42, здесь только слот `Authorizer` |
| 10 §3.5 | idempotency: hash + outcome в одной транзакции с эффектом; `Idempotency-Replayed: true`; namespace |
| 10 §4 «Общие правила контракта» | заголовки ответа (`X-Request-Id`, `Cache-Control: private, no-store`, `Retry-After`), `Problem` required `type,title,status,code,requestId`, `additionalProperties: false`, легенда наборов кодов |
| 10 §8 «Auth-эндпоинты: статус» | что отсутствовало в 0.1 и добавлено WS-03 в 0.2: `startLogin`, `authCallback`, `logout`, `getCsrf`, `acceptInvitation`, `devLogin` (§4.1 мастер-плана) |
| 10 §9 п.1–3, 7–9, 23–25, 27 | инварианты порядка проверок, 404, no-fallback, `unknown_field`, idempotency, `If-Match` (412/428 — слот для WS-44), `Cache-Control`, логи, контракт как источник |
| 10 §10 A1–A4, B2, B4, D1, I1–I2 | чек-лист приёмки API-уровня → скелет §6 |
| 10 §12 п.16–17 | NFR p95 ≤ 500/800 мс; «`Cache-Control: private, no-store` и `X-Request-Id` — на каждом ответе; middleware должен ставить их централизованно» |
| 12 §3.2 R5 | «одинаковый отказ на любую причину», cookie `HttpOnly, SameSite=Lax, Path=/`, `Secure` из конфигурации, 302/401 по `Accept`, санитизация `next` |
| 12 §3.2 R6 | `RequestID` (валидация `[A-Za-z0-9._:-]{1,128}`), CSRF double-submit (cookie не HttpOnly, `subtle.ConstantTimeCompare`, генератор отдельный от request-id), `Logging` с `AddAttrs`, `statusRecorder.Unwrap()`; имена → `ortus_sid`, `X-CSRF-Token`; «в 2.0 композиция так и не была собрана — в 3.0 это тест на старте» |
| 12 §3.2 R7 | конвейер 7 шагов + 2a/2b; маркер `Chain.Mount`; один `notFoundBody` с `\n`; `DB()` только `InTx`; `isBareIdentifier` |
| 12 §5 п.1–8, 22–24, 30 | инварианты: один 404 байт-в-байт; членство до состояния; БД тенанта только после права; depguard; `DB()` не голый пул; сессия — cookie; CSRF double-submit; `next` однозначный; `//nolint` с причиной; `%w` lowercase; `ctx` первым, ключи контекста unexported; логи без токенов |
| 12 §6 п.11–18, 23–25 | Go-харнесс (падает без базы), маркер 404 ×4 `bytes.Equal`, контракт/Problem, сессия и CSRF — формулировки тестов |
| 09 §5.1 | форма `Problem`; `retryable` схемой не допускается; `requestId` |
| 09 §5.2 | реестр кодов дословно (36) — таблица `problem/registry.go` |
| 09 §5.6 | соглашения API: пути, `tenantId` не право, DTO (`unknown_field`), вход, идемпотентность (UUID v4, namespace), 404 vs 403, заголовки |
| 09 §6 I-18, I-21, I-22 | тесты idempotency (100 повторов, другой payload, in-flight, длина ключа), резолвер (пул B не открывается), sentinel → 503 |
| 09 §10 п.3, 7–8, 12, 16, 20 | роли БД (у API нет DDL), маппинг кодов в одном месте, каждый код покрыт тестом, саги control↔tenant, Idempotency-Key везде, эквиваленты демо-флагов |
| `design/docs/13-backlog-s0-s2.md` S0-04 (:31), S1-02 (:47), S1-05 (:55, заглушка), S1-07 (:57), S1-25 (:100) | истории WS |
| `design/docs/14-engineering.md:10, 53, 81, 108–115` | chi + strict server; depguard; у API нет DDL; типизированные ошибки → `Problem.code` в одном месте; `TenantContext` только из middleware; логи |
| `design/docs/repo-skeleton/.env.example:6–10, 28–31, 38–39` | `CONTROL_DB_URL`, `TENANT_DB_*`, `SESSION_COOKIE_NAME=ortus_sid`, `SESSION_TTL=12h`, `ALLOWED_ORIGINS`, `LOG_LEVEL` |
| control:12–58, 118–131; core:18–38 | таблицы `accounts`, `tenants` (`tenant_state` 8 значений), `tenant_routing` (`sentinel`), `memberships` (`membership_status`), `platform_operators`; `core.tenant_identity`, `core.idempotency_keys` (PK `actor_id, operation, key`, `request_hash`, `state`, `response_status/body`, `expires_at`) |
| `design/ortus/mock-data.js:115–136, 152–161` | учётки сида для dev-провайдера и фикстур: `d.zimina@alta.example` (владелец, `acc-1`), `m.kotova@alta.example` (членства `t-alta` active + `t-cargo` ended), `a.morozova@alta.example` (`t-alta` + `t-lotos`), `o.petrova@alta.example` (invited), `k.gromov@alta.example` (suspended), `d.shishkin@cargo.example` (`locked`), `e.lapteva@ortus.example` (оператор `owner`), `owner@lotos-spa.example` |
| `design/ortus/api.js:573–586` | `createHttpAdapter.load` = `GET /me/context`; `req()` с `Idempotency-Key`/`If-Match` |
| PD-18 (dev-провайдер вместо Keycloak в фазе 1), PD-25 (один origin, тенант в пути), PD-31 (`X-Test-Scenario` только при `APP_ENV=e2e`), PD-47 (strict server по тегам, `notimpl` 501, композитный роутер), PD-48 (S1-07 без UI-переключателя), PD-38 (Go последний стабильный, PostgreSQL 17), PD-45/П18 (часы `2026-10-01T10:30:00+03:00`) | решения |
| Q-87 (namespace tenant + actor + opId), Q-101 (один origin `http://localhost:5173`, Vite proxy `/api` → `127.0.0.1:8080`), Q-112 (`HTTP_ADDR=127.0.0.1:8080` в dev) | вопросы с поведением по умолчанию |
| `tdd-protocol.md` §1–§5, `verification-protocol.md` §1 п.3–4, §5–§6, `orchestration.md` §1, §5, §7; мастер-план §3.3, §4.1, §4.7, §8.1 (колонка backend), §8.3, §8.4 | протоколы — соблюдать буквально |

## 4. Контракты

### 4.1 Потребляет (должно быть в `main` до старта)

| Контракт | Откуда | Где лежит | Если нет |
|---|---|---|---|
| strict server по тегам `auth`, `me` (+ `Context`), `platform`, `notimpl` 501 для прочих тегов; `GetSwagger()` каждого тега; константы `ERR.*` из `api/errors.yaml`; `screens.yaml` | WS-03 | `backend/internal/api/<tag>/`, `backend/internal/api/notimpl/`, `backend/internal/api/errcodes/` (имя по WS-03) | `make gen` из `main`; если операций `devLogin`, `logout`, `getCsrf`, `getMyContext` (с `tenants[]`, `lastTenantId`), `selectTenant`, `listMyEvents` в бандле нет — **блокер**, в отчёт и интегратору; пути и тела не выдумывать (`orchestration.md` §7) |
| Go-харнесс: `backend/test/harness.go`, `testdb.New(t)` (control + tenant DB по `t.Name()`, миграции лексикографически, падает без базы) | WS-07 | `backend/test/` | тест с тегом `integration` пишется против харнесса; до слияния WS-07 — `t.Skip` недопустим, вместо этого ветка ребейзится на `main` после барьера 0→1 |
| compose `postgres-test` на 5433 (`profiles: [test]`), `.env.example` с `HTTP_ADDR=127.0.0.1:8080`, `APP_ENV`, `AUTH_PROVIDER=dev` | WS-02 | `deploy/compose/` | без базы интеграционные тесты падают, не skip (12 §6 п.11) |
| миграции control 0001–0003, tenant 0001–0003 | WS-41 (та же волна, прямой зависимости нет) | `backend/migrations/` | unit-тесты — на `FakeDirectory`; `integration/isolation/concurrency` зелёные после слияния WS-41; локально — `git worktree add ..\ws-41 ws/ws-41-migrations` и `MIGRATIONS_DIR` харнесса, если WS-07 его поддерживает; в отчёте указать, на каком коммите WS-41 прогнано |

### 4.2 Публикует (для WS-42…WS-50, WS-54, WS-56)

```go
// internal/platform/requestid
func Middleware(next http.Handler) http.Handler   // входящий X-Request-Id по ^[A-Za-z0-9._:-]{1,128}$ эхо, иначе новый (UUID v4)
func FromContext(ctx context.Context) string

// internal/platform/clock
type Clock interface{ Now() time.Time }
func System() Clock; func Fixed(t time.Time) Clock
func WithClock(ctx context.Context, c Clock) context.Context; func FromContext(ctx context.Context) Clock  // по умолчанию System

// internal/platform/problem
type Violation struct{ Field, Code, Message string }
type Error struct{ Code string; Detail string; Violations []Violation; Retry time.Duration; cause error } // error + Unwrap
func New(code string, detail string) *Error             // status/title/type из реестра по code; неизвестный code → panic в init-тесте
func Wrap(code string, err error) *Error
func Is(err error, code string) bool
var ErrNotFound, ErrSessionExpired, ErrForbidden *Error // предопределённые без detail
func From(ctx context.Context, err error) Problem       // ЕДИНСТВЕННОЕ место маппинга: *Error → Problem; context.DeadlineExceeded → 503 dependency_unavailable; прочее → 500 (§10 п.3)
func Write(w http.ResponseWriter, r *http.Request, err error)  // application/problem+json; тело через json.Encoder (детерминированный порядок полей, завершающий '\n')

// internal/platform/httpx
func DecodeStrict(r *http.Request, dst any) error        // DisallowUnknownFields → unknown_field; синтаксис → malformed_request; пустое тело → malformed_request
func JSON(w http.ResponseWriter, status int, v any)
func WantsHTML(r *http.Request) bool                     // Accept содержит text/html
func Recover(logger *slog.Logger) func(http.Handler) http.Handler
func Logging(logger *slog.Logger) func(http.Handler) http.Handler; func AddAttrs(ctx context.Context, attrs ...slog.Attr)
func SecurityHeaders(next http.Handler) http.Handler     // Cache-Control: private, no-store; X-Content-Type-Options: nosniff — на каждом ответе
func TestScenarioMiddleware(appEnv string, known func(code string) bool) func(http.Handler) http.Handler  // PD-31
func TestScenario(ctx context.Context) (code string, ok bool)

// internal/platform/session
type Session struct{ ID string; AccountID uuid.UUID; IssuedAt, ExpiresAt time.Time; CSRF string; LastTenantID *uuid.UUID }
type Store interface{ Create(ctx, Session) error; Get(ctx, id string) (Session, error); Delete(ctx, id string) error; SetLastTenant(ctx, id string, t uuid.UUID) error }
func NewMemStore(c clock.Clock) Store                     // волна 1; durable store — §10 п.5
type Manager struct{ /* CookieName (ortus_sid), TTL (12h), AllowedOrigins, Clock, Store */ }
func (m *Manager) Issue(w http.ResponseWriter, r *http.Request, accountID uuid.UUID) (Session, error)   // Set-Cookie HttpOnly; SameSite=Lax; Path=/; Secure при TLS или X-Forwarded-Proto: https
func (m *Manager) Clear(w http.ResponseWriter, r *http.Request, s Session) error
func (m *Manager) Require(next http.Handler) http.Handler  // нет/истекла → 302 /auth/login?next=<path> при WantsHTML, иначе 401 session_expired; bearer+cookie → 400 malformed_request
func (m *Manager) CSRF(next http.Handler) http.Handler     // POST/PUT/PATCH/DELETE с cookie: X-CSRF-Token == s.CSRF (ConstantTimeCompare) иначе 403 csrf_failed; Origin ∉ AllowedOrigins → 403 origin_not_allowed
func FromContext(ctx context.Context) (Session, bool)
// session/dev: strict-реализация тега auth при AUTH_PROVIDER=dev (devLogin, logout, getCsrf); startLogin/authCallback/acceptInvitation → notimpl 501

// internal/platform/tenantctx
type Account struct{ ID uuid.UUID; DisplayName, EmailNorm, Status string; PlatformOperator bool }
type Membership struct{ ID, TenantID uuid.UUID; TenantName, Status string; PersonProfileID uuid.UUID }
type Tenant struct{ ID uuid.UUID; Name string; State string }                    // tenant_state (control:8–9)
type Routing struct{ TenantID uuid.UUID; ClusterRef, DatabaseName, SecretRef string; SchemaVersion int64; Sentinel uuid.UUID }
type Directory interface {
    AccountByEmail(ctx, emailNorm string) (Account, error); AccountByID(ctx, id uuid.UUID) (Account, error)
    Memberships(ctx, accountID uuid.UUID) ([]Membership, error)   // status ∈ {active, suspended}, сортировка по TenantName (ru), затем TenantID
    Tenant(ctx, id uuid.UUID) (Tenant, error); Routing(ctx, id uuid.UUID) (Routing, error)
}
// pgdirectory.New(pool) — реализация на control DB; FakeDirectory в tenantctx/tenantctxtest
type TenantContext struct{ TenantID, MembershipID, ActorID, AccountID uuid.UUID; TenantName, State string; ReadOnly bool; PolicyVersion string }
func FromContext(ctx context.Context) (TenantContext, bool); func MustFromContext(ctx context.Context) TenantContext  // паника, не «главная БД»
type Pools interface{ For(ctx context.Context, tc TenantContext) (*pgxpool.Pool, error); Opened() []uuid.UUID; Close() }  // ленивый, бюджет TENANT_DB_POOL_BUDGET, idle TTL, sentinel при открытии
func Resolve(dir Directory, pools Pools) func(http.Handler) http.Handler  // шаги 5–7 конвейера для /tenants/{tenantId}
// tenantctx/mehttp: strict-реализация тега me (getMyContext, selectTenant, listMyEvents); порт EventsReader{ ListMyEvents(ctx, accountID, cursor, limit) ([]Event, string, error) } + NoEvents

// internal/platform/idem
type Namespace struct{ TenantID uuid.UUID /* zero для platform */; ActorID uuid.UUID; Operation string }
type Record struct{ Namespace; Key string; Hash []byte }
type Outcome struct{ Status int; Header http.Header; Body []byte }
type Store interface{ Begin(ctx, Record) (replay *Outcome, inProgress bool, err error); Complete(ctx, Record, Outcome) error; Release(ctx, Record) error }
func Middleware(st Store, c clock.Clock, ttl time.Duration, mutating func(r *http.Request) (op string, ok bool)) func(http.Handler) http.Handler
func FromContext(ctx context.Context) (Record, bool); func CompleteInTx(ctx context.Context, tx pgx.Tx, status int, body []byte) error  // для сервисов WS-44+: outcome в одной транзакции с эффектом (10 §3.5)

// internal/platform/pipeline
type Operation struct{ ID string; Tag string; Permissions []string; Mutating bool }   // из GetSwagger() тега по методу+шаблону пути; Mutating = есть параметр Idempotency-Key
type Authorizer interface{ Permit(ctx context.Context, tc tenantctx.TenantContext, op Operation) error }
var DenyAll Authorizer   // 403 forbidden_action для всех op с непустыми Permissions; op с пустыми — пропускает (getMyContext yaml:73)
type Options struct{ AppEnv string; Logger *slog.Logger; Clock clock.Clock; Sessions *session.Manager; Dir tenantctx.Directory; Pools tenantctx.Pools; Authz Authorizer; Idem idem.Store; IdemTTL time.Duration; KnownCode func(string) bool }
func Mount(r chi.Router, o Options) *Chain       // ставит общие middleware и маркер; Identity()/Tenant()/Platform() — группы маршрутов
func Verify(r chi.Router, allow []string) error  // обход chi.Walk: каждый маршрут несёт маркер, кроме allow (/healthz, /readyz)
```

### 4.3 Кто и что потребляет из §4.2 (следующие волны пишут тесты против этих сигнатур, не дожидаясь соседей)

| Потребитель | Что берёт | Для чего |
|---|---|---|
| WS-42 authz | `pipeline.Authorizer` (заменяет `DenyAll`), `tenantctx.TenantContext.PolicyVersion`, `tenantctx.Pools.For` | `permit()`, `scopeQuery()`, `scopeddb.For(tenant)` поверх пула с проверенным sentinel |
| WS-43 control-tenants | `problem.New/Wrap`, `idem.FromContext`, `clock.FromContext`, группа `Chain.Platform()` | платформенные операции под оператором; `tenant.state_changed` → резолвер читает `tenants.state` без кеша |
| WS-44 access-people-org | `idem.CompleteInTx`, `httpx.DecodeStrict`, `problem.Error.Violations`, `session.FromContext` | саги control↔tenant с идемпотентностью (09 I-33); `acceptInvitation` заменяет 501 |
| WS-45 modules-files-services | `mehttp.EventsReader` (заменяет `NoEvents`), строка (e) в таблице K-09, `tenantctx.TenantContext.ReadOnly` | серверная лента `listMyEvents`; гейт модуля после гейта тенанта |
| WS-47 fleet-shift, WS-53 e2e-full-stand | `httpx.TestScenario(ctx)` | `X-Test-Scenario: reservation_overlap|upload_failed` при `APP_ENV=e2e` (PD-31) |
| WS-54 keycloak-oidc | `session.Manager.Issue/Clear`, `session.Store`, слоты `startLogin`/`authCallback` | OIDC Code + PKCE вместо dev-провайдера; durable `Store` |
| WS-56 provisioning | `tenantctx.Directory.Routing`, `tenantctx.Pools` (sentinel) | «создать тенант → БД и sentinel → `GET /me/context` в новой БД» |
| WS-52 go-seed | учётки §3 (`mock-data.js:115–136`) как ожидаемый вход `devLogin` | сид control DB совпадает с фикстурой изоляции по email/статусам |

Порядок конвейера (12 R7 + 10 §3.3; фиксируется тестом K-30/K-31): `requestid → httpx.Logging → httpx.Recover → httpx.SecurityHeaders → httpx.TestScenarioMiddleware → OapiRequestValidator тега (400 malformed_request/unknown_field) → session.Require → session.CSRF → [Platform: оператор? иначе 404] | [Tenant: членство (404) → состояние тенанта (403 tenant_suspended / 404 closing,closed,provisioning / ReadOnly для grace,read_only) → TenantContext → Authorizer.Permit (403) → idem.Middleware (мутации) → ReadOnly && Mutating → 403 tenant_read_only] → strict handler`. Пул тенанта открывается только из хендлера/сервиса через `Pools.For` (12 §5 п.3) — WS-40 сам его в волне 1 не открывает, кроме теста sentinel.

Тела и пути операций — строго по `api/openapi/paths/{auth,me}.yaml` WS-03 (ожидаемо `/api/v1/auth/{dev,logout,csrf}`, `/api/v1/me/context`, `/api/v1/me/context/tenant`, `/api/v1/me/events`); бриф ссылается на `operationId`. `MeContext` 0.1: `userId, displayName, platformOperator, tenants[], permissionVersion` (yaml:7078–7101) + `lastTenantId` (0.2); `TenantContext`: `tenantId, name, membershipId, membershipStatus ∈ {active, suspended}, orgUnitIds[], modules[], capabilities[]` (yaml:7043–7077) — в волне 1 `orgUnitIds`, `modules`, `capabilities` = `[]` (владельцы: WS-44, WS-45, WS-42), `permissionVersion` = `"0"` до WS-42.

## 5. Операции и состояния (аналог таблицы экранов для backend)

| operationId (тег) | summary дословно / источник | Акторы (учётки сида) | Состояния и коды | Тест | Маршрут |
|---|---|---|---|---|---|
| `devLogin` (auth) | «dev-only, PD-18» (§4.1 мастер-плана); тело по WS-03 (`email`) | `d.zimina@alta.example`, `e.lapteva@ortus.example`, неизвестный, `locked` (`d.shishkin@cargo.example`) | 200/204 + `Set-Cookie ortus_sid` + CSRF-cookie; один отказ 401 `session_expired` для неизвестного/`locked`; 404 при `AUTH_PROVIDER≠dev`; 400 `unknown_field`/`malformed_request` | `session/dev/dev_test.go`, K-02, K-20, K-21, K-34 | `/api/v1/auth/dev` (по WS-03) |
| `getCsrf` (auth) | «CSRF bootstrap» (yaml:75–77; 10 §8) | любая сессия | 200 `{token}` + `Set-Cookie ortus_csrf` без `HttpOnly`; 401 без сессии | K-04 | `/api/v1/auth/csrf` |
| `logout` (auth) | «Logout (сброс cookie…)» (10 §8) | любая сессия | 204, cookie `Max-Age=0`, сессия удалена в `Store`; 403 `csrf_failed` без токена | K-22 | `/api/v1/auth/logout` |
| `startLogin`, `authCallback`, `acceptInvitation` (auth) | OIDC и приглашение — WS-54, WS-44 | — | 501 `not_implemented` после конвейера | K-31 | по WS-03 |
| `getMyContext` (me/Context) | «Get identity and visible business contexts» (yaml:72); «Only active/recovery memberships of the current user» (yaml:75) | все 8 персонажей + оператор | 200 `MeContext`; 401; `tenants[]` только `active`/`suspended` членства; `platformOperator` по `platform_operators` (control:118); `lastTenantId` из сессии или первое `active` | K-01, K-16…K-19 | `/api/v1/me/context` |
| `selectTenant` (me) | S1-07 «последний выбор запоминается» (`13-backlog:57`) | `a.morozova@alta.example` (два членства) | 200 + новый `lastTenantId`; 404 чужой/`ended`/`invited` тенант; 403 `csrf_failed`; 400 без `Idempotency-Key`; replay/409 по §6 | K-17, K-24…K-27 | `/api/v1/me/context/tenant` |
| `listMyEvents` (me) | «лента `db.events`» (§4.1; 10 §12 п.28); фильтр прототипа `to.includes(actor) && (!sensitive \|\| canEarnings)` (`api.js:80`) | любая сессия | 200 `{items: [], nextCursor: null}` через `NoEvents`; серверная лента — WS-45 (§5.4 карточка WS-45) | K-35 | `/api/v1/me/events` |
| любой тег под `/api/v1/tenants/{tenantId}/…` (notimpl) | «тег без реализации монтирует `notimpl` (501 `not_implemented`)» (§4.1) | владелец t-alta | 401 → 403 → 404 → 403 `tenant_suspended` → 403 `tenant_read_only` → 501 в порядке конвейера | K-09…K-15, K-31 | `/api/v1/tenants/{tenantId}/fleet/vehicles` (пример) |
| любой тег под `/api/v1/platform/…` | «Platform operator control plane» (yaml:31–32) | оператор / владелец | оператор → 501 (notimpl); не-оператор → 404 | K-15 | `/api/v1/platform/tenants` |
| `GET /healthz`, `GET /readyz` | вне OpenAPI; allowlist `pipeline.Verify` | — | 200 без сессии; `readyz` 503 `dependency_unavailable` без control DB | K-36 | — |

Состояния «пусто/загрузка/офлайн/только чтение» для backend: пусто = `tenants: []` у оператора (K-19) и `items: []` (K-35); только чтение = `tenant_read_only` (K-13); конфликт = `idempotency_key_reused`/`idempotency_in_progress` (K-24, K-25); нет права = `forbidden_action` от `DenyAll` (K-31 вариант b); офлайн — клиентское состояние (12-errors:67), на сервере не моделируется.

## 6. Тесты первыми

### 6.1 (а) Скелет — контрактные тесты на strict server с `t.Skip`, первый коммит `test(ws-40): скелет контрактных тестов auth/me/pipeline` (мастер-план §8.1 «backend», B §5.1)

Файлы скелета: `backend/cmd/api/router_test.go` (K-01…K-09, K-15…K-27, K-29…K-31, K-34…K-38 — httptest + `FakeDirectory`, без БД), `backend/test/isolation/platform_test.go` (`//go:build isolation`: K-10…K-14, K-32), `backend/test/concurrency/platform_test.go` (`//go:build concurrency`: K-28), `backend/internal/platform/httpx/log_test.go` (K-33). Имя `t.Run` = текст колонки «Given/When/Then» дословно. Тело скелета: `t.Skip("WS-40: скелет, снимается циклом §7 №N")`.

| № | Источник | Given / When / Then (дословно или сжато без изменения смысла) |
|---|---|---|
| K-01 | 10 §10 A1 | Given неавторизованный браузер, When `GET /api/v1/me/context`, Then 401 с `application/problem+json`, `code` = `session_expired` (12-errors:32), заголовок `X-Request-Id` присутствует |
| K-02 | 12 §6 п.23 | Given успешный вход (`devLogin` `d.zimina@alta.example`); When читаем `Set-Cookie`; Then есть `HttpOnly`, `SameSite=Lax`, `Path=/`, имя `ortus_sid`; `Secure` присутствует при `X-Forwarded-Proto: https` и отсутствует при обычном http |
| K-03 | 12 R5; 12 §5 п.6, п.8 | Given нет сессии; When `GET /api/v1/me/context` с `Accept: text/html`; Then 302 и `Location: /auth/login?next=/api/v1/me/context`; When `next`-кандидат `//evil.example` или `https://…`; Then `next` отброшен (`/auth/login` без `next`); When `Accept: application/json`; Then 401 `session_expired` |
| K-04 | 10 §10 A2; 12 §6 п.24 | Given сессия с cookie; When POST-мутация (`selectTenant`) без `X-CSRF-Token`; Then 403, `code` = `csrf_failed`; Given `GET getCsrf`; Then `Set-Cookie` с CSRF-токеном **без** `HttpOnly` и тело с тем же токеном |
| K-05 | yaml:6662–6667; 12 §5 п.7 | Given cookie и верный `X-CSRF-Token`; When `Origin: https://evil.example`; Then 403 `origin_not_allowed`; When `Origin` ∈ `ALLOWED_ORIGINS` (`http://localhost:5173`); Then запрос проходит дальше |
| K-06 | 10 §10 A3 (yaml:6443 «Do not send this cookie with a bearer token») | Given cookie и `Authorization: Bearer x` одновременно; When любой запрос; Then 400 `malformed_request`; Given только bearer; Then 401 `session_expired` (bearer в волне 1 не валидируется — WS-54) |
| K-07 | 10 §10 A4; 10 §12 п.17 | Given любой ответ (200, 401, 404, 501); Then `Cache-Control: private, no-store` и `X-Request-Id`; Given входящий `X-Request-Id: abc.1:2-x`; Then эхо; Given `X-Request-Id` длиннее 128 или с пробелом; Then сгенерирован новый UUID v4 |
| K-08 | 12 §6 п.18; 09 §5.1; yaml:6904–6935 | Given любой 4xx/5xx; Then `Content-Type: application/problem+json`, тело содержит `type` (`https://docs.ortus.example/errors/<code>`), `title`, `status`, `code`, `requestId`; `code` ∈ `ERR.*`; нет полей вне схемы (`retryable` отсутствует); `requestId` == заголовку |
| K-09 | 12 §6 п.16; 12 §5 п.1 | Given один и тот же входящий `X-Request-Id: k09-fixed`; When четыре запроса: (a) неизвестный тенант `/tenants/00000000-…-000000000000/fleet/vehicles`, (b) чужой тенант B сессией A, (c) оператор платформы на `/tenants/{A}/…`, (d) несуществующий роут `/api/v1/nope`; Then четыре тела 404 равны **байт в байт** (`bytes.Equal`, без `TrimSpace`, с завершающим `\n`); строка (e) «выключенный модуль» добавляется WS-45 в ту же таблицу |
| K-10 | 10 §10 B2; AC-02 (`15-quality-security.md:36`); 09 I-21 | Given сессия тенанта A; When `GET /api/v1/tenants/{B}/fleet/vehicles`; Then 404 `not_found`; `Pools.Opened()` не содержит B |
| K-11 | 12 §5 п.2 («членство до состояния») | Given аккаунт без членства в тенанте со `state='suspended'`; When запрос к нему; Then 404 (не 403 `tenant_suspended`) |
| K-12 | 12-errors:38 `tenant_suspended` | Given активное членство в тенанте `suspended`; When `GET …/fleet/vehicles`; Then 403 `tenant_suspended` |
| K-13 | AC-11 (`15:45`); 12-errors:37 | Given тенант `read_only` (и `grace`); When операция с `Idempotency-Key` (мутация); Then 403 `tenant_read_only`; When GET того же тега; Then не 403 (доходит до 501 notimpl) |
| K-14 | control:8–9; 12 R7 (`archived` 404) | Given тенант `closing`, `closed`, `provisioning`; When любой запрос; Then 404 с тем же телом, что K-09 |
| K-15 | 10 §10 B4 | Given оператор платформы (`platform_operators.status='active'`, `e.lapteva@ortus.example`); When `GET /api/v1/tenants/{anyId}/fleet/trips`; Then 404; When `GET /api/v1/platform/tenants`; Then 501 (дошёл до notimpl); Given владелец t-alta; When `GET /api/v1/platform/tenants`; Then 404 |
| K-16 | yaml:7078–7101; `mock-data.js:115` | Given сессия `d.zimina@alta.example`; When `GET /api/v1/me/context`; Then 200, `displayName` = «Дарья Зимина», `platformOperator: false`, `tenants[0].name` = «Альта Групп», `tenants[0].membershipStatus` = `active`, `orgUnitIds/modules/capabilities` = `[]`, `permissionVersion` строка, `lastTenantId` = id t-alta |
| K-17 | S1-07 (`13-backlog:57`); `mock-data.js:118` | Given `a.morozova@alta.example` (членства `t-alta`, `t-lotos`); Then `tenants[]` длины 2 в порядке «SPA «Лотос»», «Альта Групп» (сортировка `ru`); `lastTenantId` = первый `active`; When `selectTenant {tenantId: t-lotos}` с CSRF и `Idempotency-Key`; Then 200 и следующий `GET /me/context` → `lastTenantId: t-lotos`; When `selectTenant` с `tenantId` без членства; Then 404 |
| K-18 | yaml:75, 7053–7057; `mock-data.js:116, 120–121` | Given `m.kotova@alta.example` (`t-cargo` `ended`), `o.petrova@alta.example` (`invited`), `k.gromov@alta.example` (`suspended`); Then `ended`/`invited` в `tenants[]` отсутствуют, `suspended` присутствует с `membershipStatus: suspended`; `selectTenant` на `suspended` → 404 |
| K-19 | `mock-data.js:131` | Given оператор `e.lapteva@ortus.example`; Then `platformOperator: true`, `tenants: []`, `lastTenantId` отсутствует/`null` по схеме WS-03 |
| K-20 | PD-18; карточка WS-40 «`devLogin` только при `AUTH_PROVIDER=dev`» | Given `AUTH_PROVIDER=oidc` или `APP_ENV=prod`; When `POST devLogin`; Then 404 с телом K-09 (роут не смонтирован) |
| K-21 | 12 R5 («login never creates a user», «одинаковый отказ») ; 12 §6 п.25 | Given неизвестный email и `locked` аккаунт (`d.shishkin@cargo.example`, `accounts.status='locked'` control:18); When два `devLogin`; Then равны статус (401), `code`, `detail`; `Set-Cookie` отсутствует; `count(accounts)` до/после одинаков |
| K-22 | 10 §8 «Logout» | Given сессия; When `POST logout` с CSRF; Then 204, `Set-Cookie: ortus_sid=; Max-Age=0`; повторный `GET /me/context` с прежней cookie → 401 (сессия удалена в `Store`, не только cookie) |
| K-23 | `.env.example:30` `SESSION_TTL=12h` | Given `clock.Fixed(T)` и вход в T; When запрос при `T+12h+1s`; Then 401 `session_expired`; при `T+11h59m` — 200 |
| K-24 | 10 §10 D1; 09 I-18 | Given `POST selectTenant` с `Idempotency-Key: K` (≥16 символов); When повтор с тем же телом; Then тот же статус/тело и `Idempotency-Replayed: true`; When повтор с другим телом; Then 409 `idempotency_key_reused` |
| K-25 | 09 I-18; yaml:15 | Given хендлер, заблокированный на канале; When повтор с тем же ключом во время выполнения; Then 409 `idempotency_in_progress` и `Retry-After` ≥ 1 |
| K-26 | yaml:6635–6639 | Given ключ из 15 символов / 129 символов / с символом `#`; Then 400 `malformed_request`; Given мутация без `Idempotency-Key`; Then 400 `malformed_request` (валидатор OpenAPI) |
| K-27 | Q-87; yaml:15 («The same key from another tenant or actor is a different namespace») | Given ключ K использован актором 1; When актор 2 шлёт K с другим телом; Then не 409 и не replay — выполняется заново |
| K-28 | AC-07 (`15:41`); 09 I-18 | Given 100 параллельных `POST selectTenant` с одним ключом и телом; Then хендлер вызван ровно 1 раз, все 100 ответов одинаковы по статусу и телу (`concurrency`) |
| K-29 | PD-31; карточка WS-40 «`X-Test-Scenario` игнорируется при `APP_ENV=prod`» | Given `APP_ENV=prod` или `dev`; When `X-Test-Scenario: reservation_overlap`; Then `httpx.TestScenario(ctx)` пуст; Given `APP_ENV=e2e`; Then значение доступно хендлеру; значение не из `ERR.*` → 400 `malformed_request` |
| K-30 | 12 R7 («маркер; тест обходит ServeMux и ловит роут мимо цепочки»); 12 §8 п.12 | Given маршрут, смонтированный мимо `pipeline.Mount`; When `pipeline.Verify(router, []string{"/healthz","/readyz"})`; Then ошибка с именем маршрута; Given штатный роутер; Then nil |
| K-31 | PD-47 (`notimpl` 501); порядок конвейера | Given сессия владельца t-alta и тег `fleet` без реализации; When `GET /api/v1/tenants/{t-alta}/fleet/vehicles`; Then 501 `not_implemented`; (b) с `Authorizer = DenyAll` и операцией с `x-permissions` ≠ [] → 403 `forbidden_action` раньше 501; (c) без сессии → 401 раньше всего |
| K-32 | 09 I-22; core:18–24; control:43 | Given `tenant_routing.sentinel` ≠ `core.tenant_identity.sentinel`; When `Pools.For(tc)`; Then 503 `dependency_unavailable`, пул не кэшируется (`Opened()` без тенанта) |
| K-33 | 12 §5 п.30; `14-engineering.md:114` | Given `devLogin` → `GET /me/context` → `selectTenant`; When читаем slog JSON; Then каждая запись содержит `request_id`; записи tenant-маршрутов — `tenant_id`, `actor_id`; нигде нет значения cookie `ortus_sid`, CSRF-токена, заголовка `Authorization`, тела запроса |
| K-34 | 10 §9 п.7; 12-errors:30–31 | Given `POST selectTenant {"tenantId": …, "extra": 1}`; Then 400 `unknown_field`; Given тело `{` ; Then 400 `malformed_request` |
| K-35 | §4.1 `listMyEvents`; `api.js:27, 80` | Given сессия; When `GET listMyEvents`; Then 200 `{items: [], nextCursor: null}` (волна 1, `NoEvents`); без сессии → 401 |
| K-36 | 10 §3.8; 12 §6 п.11 | `GET /healthz` → 200 без сессии и без БД; `GET /readyz` при недоступном control DB → 503 `dependency_unavailable` (problem+json) |
| K-37 | PD-45, П18; 12 §5 п.20 | Given `APP_ENV=e2e` и `E2E_CLOCK=2026-10-01T10:30:00+03:00`; Then `clock.FromContext(ctx).Now()` в хендлере равен этому моменту; Given `APP_ENV=prod`; Then переменная игнорируется (`System`) |
| K-38 | 12 R6 (`Recover`), §10 п.3 | Given хендлер паникует; Then 500 problem+json с `requestId`, соединение не рвётся, лог содержит `panic` и stack, без тела запроса; `code` — по §10 п.3 |

Итого 38 пунктов скелета.

### 6.2 (б) Unit — табличные тесты (`*_test.go` рядом с кодом, `t.Parallel()`, `tdd-protocol.md` §3 Go)

| Единица | Кейсы (вход → ожидание) |
|---|---|
| `requestid.valid(s)` | `"abc.1:2-x"` → true; `""` → false; 129 символов → false; `"a b"` → false; `"кир"` → false |
| `problem.registry` | для каждого из 36 кодов 09 §5.2 + `seats_exhausted`, `request_pending`, `tier_below_usage`, `upload_failed`, `not_implemented` (PD-34): статус из таблицы (`session_expired`→401, `tenant_read_only`→403, `not_found`→404, `idempotency_key_reused`→409, `revision_mismatch`→412, `revision_required`→428, `rate_limited`→429, `dependency_unavailable`→503); `type` = `https://docs.ortus.example/errors/<code>`; каждый `ERR.*` из генерации WS-03 есть в реестре и наоборот (двусторонний тест) |
| `problem.From` | `*Error{not_found}` → 404; `fmt.Errorf("x: %w", ErrNotFound)` → 404 (`errors.Is`); `context.DeadlineExceeded` → 503 `dependency_unavailable`; `pgconn` connect error → 503; `errors.New("boom")` → 500; `Violations` сериализуются `[{field,code,message}]`; `Retry` → `Retry-After` |
| `problem.Write` | детерминированный порядок полей; завершающий `\n`; `Content-Type: application/problem+json; charset=utf-8` |
| `httpx.DecodeStrict` | `{"a":1}` в struct без `A` → `unknown_field`; `{` → `malformed_request`; пустое тело → `malformed_request`; лишний JSON после объекта → `malformed_request` |
| `httpx.WantsHTML` | `text/html,…` → true; `application/json` → false; `*/*` → false; пусто → false |
| `session.sanitizeNext` (12 §5 п.8) | `/t/x/home` → ok; `//evil` → ""; `https://e` → ""; `/a\r\nb` → ""; `""` → "" |
| `session.Manager.Issue` | атрибуты cookie по K-02; `Secure` при `r.TLS != nil` или `X-Forwarded-Proto: https`; длина id ≥ 32 байт из `crypto/rand`; CSRF-генератор не совпадает с request-id (12 R6) |
| `session.memstore` | `Get` после `Delete` → `ErrNotFound`; истечение по `clock.Fixed`; `SetLastTenant` сохраняется |
| `tenantctx.sort` | членства `[«Альта Групп», «SPA «Лотос»»]` → порядок по `collate ru` (`SPA «Лотос»` раньше? — зафиксировать `golang.org/x/text/collate` ru; результат в тесте по факту прогона, не литерал из головы) |
| `tenantctx.Resolve` (на `FakeDirectory`) | таблица «аккаунт × тенант × state → код»: нет членства → 404; членство `suspended`/`invited`/`ended` → 404 (конвейер требует «активный TenantMembership», 10 §3.3 п.1; членство проверяется до состояния тенанта, 12 §5 п.2); членство `active` + тенант `suspended` → 403 `tenant_suspended`; `grace`/`read_only` → `ReadOnly=true`; `closing/closed/provisioning` → 404; невалидный UUID в пути → 404 (не 400 — не раскрывать формат) |
| `idem.hash` | одинаковые тела с разным порядком пробелов → разный hash (сырой байтовый, как в контракте «identical request»); метод+путь входят в hash |
| `idem.Middleware` (на `memstore`) | K-24…K-27 без HTTP-сервера; 5xx хендлера → `Release` (повтор выполняется заново); 4xx → `Complete` (replay 4xx) |
| `idem.mutating` | `GET` → false; `POST selectTenant` → true; `POST queryDataset` (без `Idempotency-Key` в спецификации) → false — проверка по `GetSwagger()` |
| `pipeline.operationFor` | `GET /api/v1/me/context` → `{ID: getMyContext, Permissions: [], Mutating: false}`; неизвестный шаблон → `ok=false` |
| `clock` | `Fixed` возвращает один и тот же момент; `E2E_CLOCK` парсится RFC3339 с зоной `+03:00`; невалидное значение → ошибка конфигурации при старте |
| `cmd/api/config` | `CONTROL_DB_URL` без умолчания → ошибка старта (12 §5 п.29); `HTTP_ADDR` по умолчанию `127.0.0.1:8080` (Q-112); `APP_ENV` ∈ {dev,e2e,prod} иначе ошибка; `ALLOWED_ORIGINS` список через запятую |

### 6.3 (в) Компонентные — не применяются (backend); эквивалент — табличные тесты middleware через `httptest.NewRecorder` в §6.2 и `router_test.go`

### 6.4 (г) Контрактные / интеграционные / изоляция / конкурентность

- Контрактные (`router_test.go`, без БД): K-01…K-09, K-15…K-27, K-29…K-31, K-34…K-38 на полном композитном роутере с `FakeDirectory`; каждый `Problem.code`, который может выдать WS-40 (`session_expired`, `csrf_failed`, `origin_not_allowed`, `malformed_request`, `unknown_field`, `not_found`, `tenant_suspended`, `tenant_read_only`, `forbidden_action`, `idempotency_key_reused`, `idempotency_in_progress`, `dependency_unavailable`, `not_implemented`), покрыт ≥ 1 тестом (`tdd-protocol.md` §4; 09 §10 п.8); ответы валидируются против схемы `Problem`/`MeContext` тега через `kin-openapi` (`openapi3filter.ValidateResponse`) — ловит `additionalProperties`.
- Интеграционные (`//go:build integration`, testcontainers/`postgres-test` через харнесс WS-07): `pgdirectory` — `AccountByEmail` по `email_norm` (lower/trim, control:16), `Memberships` только `active`/`suspended` (control:51), `Tenant.State`, `Routing`; `idem/pgstore` на `core.idempotency_keys` (core:27–38): `Begin` = `INSERT … ON CONFLICT DO NOTHING` + `SELECT … FOR UPDATE`; `expires_at = now + 7d` (yaml:6632 «Retain record at least 7 days»); истёкшая запись — как отсутствующая; `CompleteInTx` в чужой транзакции.
- Изоляция (`platform_test.go`, `//go:build isolation`): K-10…K-14, K-32; фикстура теста: тенанты A и B с одинаковыми `display_name` (`15-quality-security.md:23`), аккаунт A-owner, аккаунт без членств, оператор; уникальные id на тест, без `TRUNCATE` (12 §6 п.12); для каждой операции тега `me` — строка матрицы «актор × объект × 200/403/404» (§8.3 мастер-плана).
- Конкурентность (`//go:build concurrency`): K-28 (100 горутин, один ключ → 1 вызов хендлера, одинаковые ответы); дополнительно 100 параллельных `devLogin` одной учётки → 100 разных сессий, `count(accounts)` не изменился.

Матрица изоляции волны 1 (`platform_test.go`; растёт с каждым эндпоинтом — `15-quality-security.md:29`; фикстура: тенант A «Холдинг», тенант B «Чужой клиент» с теми же названиями, `15:23`):

| Актор | Объект / запрос | Ожидание |
|---|---|---|
| owner A | `GET getMyContext` | 200, `tenants[]` = [A] |
| owner A | `POST selectTenant {A}` | 200 |
| owner A | `POST selectTenant {B}` | 404 (тело K-09) |
| owner A | `GET /tenants/{A}/fleet/vehicles` | 501 (notimpl) при `x-permissions: []`, иначе 403 `forbidden_action` (`DenyAll`) |
| owner A | `GET /tenants/{B}/fleet/vehicles` | 404; `Pools.Opened()` без B |
| аккаунт без членств | `GET getMyContext` | 200, `tenants: []`; `GET /tenants/{A}/…` → 404 |
| member A `suspended` | `GET getMyContext` / `GET /tenants/{A}/…` | 200 с `membershipStatus: suspended` / 404 |
| owner A, тенант A `suspended` | `GET /tenants/{A}/…` | 403 `tenant_suspended` |
| owner A, тенант A `read_only` | `GET` / мутация `/tenants/{A}/…` | проходит / 403 `tenant_read_only` |
| оператор платформы | `GET getMyContext` / `GET /tenants/{A}/…` / `GET /platform/tenants` | 200 `platformOperator: true`, `tenants: []` / 404 / 501 |
| без сессии | любой маршрут кроме `/healthz`, `/readyz`, `devLogin` | 401 `session_expired` (или 302 при `Accept: text/html`) |
- Инфраструктурные: `pipeline.Verify` (K-30) как обычный тест; `golangci-lint run` с `depguard`: пакеты `internal/platform/*` не импортируют `internal/modules/**` и `internal/control/**` (12 §6 п.14 обратная сторона).

## 7. Шаги реализации — TDD-циклы в порядке выполнения

Каждый цикл: `test(ws-40): …` (красный по утверждению, не по импорту — `00-master-plan.md` §8) → `feat(ws-40): …` → `refactor(ws-40): …` при необходимости. Оценка — часы чистой работы агента; суммарно ≈ 24–30 ч (M).

| № | Единица | Красный тест | Реализация | Рефакторинг / заметки | Оценка |
|---|---|---|---|---|---|
| 0 | Скелет | 38 `t.Run` с `t.Skip` в файлах §6.1; `go vet ./...` зелёный; компилируется против `internal/api/{auth,me}` | — | коммит `test(ws-40): скелет контрактных тестов auth/me/pipeline`; `status.md` → «в работе» | 1,5 |
| 1 | `requestid` | §6.2 `valid`; K-07 (эхо/генерация) на одиночном handler | `Middleware`, `FromContext`, unexported ключ контекста (12 §5 п.24) | — | 1 |
| 2 | `clock` | §6.2 `clock`; K-37 (без сервера: конфиг → Clock) | `Clock`, `System`, `Fixed`, `FromEnv(appEnv, E2E_CLOCK)` | — | 0,5 |
| 3 | `problem` | §6.2 реестр (двусторонний с `ERR.*`), `From`, `Write`; K-08 на `httptest` | `Error`, `registry.go` (таблица 09 §5.2 + PD-34, титулы на русском), `From`, `Write` с `json.Encoder` | титулы выделить в `titles.go`; `go:generate` не использовать — ручная таблица с тестом полноты | 2,5 |
| 4 | `httpx` базовые | `DecodeStrict`, `WantsHTML`, `SecurityHeaders` (K-07 часть), `Recover` (K-38), `Logging` (K-33 — захват `slog` в буфер) | функции §4.2; `ResponseRecorder.Unwrap` для `http.NewResponseController` (12 R6) | — | 2 |
| 5 | `httpx.TestScenario` | K-29 (три окружения, неизвестный код) | `TestScenarioMiddleware(appEnv, known)`; в `prod`/`dev` заголовок удаляется из `r.Header` | — | 0,5 |
| 6 | `session` ядро | §6.2 `Issue`, `memstore`, `sanitizeNext`; K-02, K-03, K-06, K-23 на `Require` | `Manager`, `Store`, `NewMemStore`, cookie-политика, 302/401 по `Accept` | `Secure`-политика в одну функцию `cookieSecure(r)` | 2,5 |
| 7 | `session.CSRF` | K-04, K-05 | double-submit `ortus_csrf` (не HttpOnly, `//nolint:gosec // double-submit токен читает JS`, 12 §5 п.7), `ConstantTimeCompare`, `Origin` ∈ `ALLOWED_ORIGINS`, применяется к POST/PUT/PATCH/DELETE | — | 1,5 |
| 8 | `session/dev` + тег `auth` | K-20, K-21, K-22, K-34 на strict-реализации (`FakeDirectory`); `getCsrf` K-04 | `DevProvider{dir}`: `devLogin` (email → `email_norm` → `AccountByEmail`; `status≠active` и не найден → один 401), `logout`, `getCsrf`; `startLogin/authCallback/acceptInvitation` делегируют в `notimpl` | монтирование `devLogin` только при `AUTH_PROVIDER=dev` — в `router.go` | 2,5 |
| 9 | `tenantctx` типы + `Resolve` | §6.2 таблица `Resolve`; K-11…K-14 на `FakeDirectory` (unit-вариант) | `TenantContext`, `FromContext/MustFromContext`, `Resolve` (членство → состояние → ctx), `ReadOnly` | ключ контекста unexported; `MustFromContext` паникует с текстом «tenantctx: no tenant in context (no fallback)» | 2 |
| 10 | `pipeline.Mount` + `Operation` + `DenyAll` | K-30, K-31 (a–c), K-09, K-15, K-01 на композитном роутере | `Mount` (порядок §4.2), маркер через `chi.With` + `context` value, `Verify` через `chi.Walk`, `operationFor` из `GetSwagger()`, `DenyAll`, `OapiRequestValidator` с `ErrorHandler → problem` (`malformed_request`/`unknown_field` по типу `openapi3.SchemaError`) | один 404: `problem.Write` для `not_found` без `detail`; `chi.NotFound`/`MethodNotAllowed` → тот же writer (405 → 404? нет: 405 остаётся 405 с `malformed_request` — зафиксировать тестом) | 3 |
| 11 | тег `me` | K-16…K-19, K-35 на `FakeDirectory` | `mehttp.Server`: `getMyContext` (членства → `TenantContext[]` с пустыми массивами; `lastTenantId` из сессии или первое `active`), `selectTenant` (членство `active` → `SetLastTenant`, иначе 404), `listMyEvents` через `NoEvents`; ответ валидируется схемой | — | 2,5 |
| 12 | `idem` | §6.2 `hash`, `mutating`, `Middleware` на `memstore`; K-24…K-27 на роутере | `Store`, `memstore`, `Middleware` (namespace из `TenantContext`/сессии + `Operation.ID`), `Idempotency-Replayed`, `Retry-After`, `CompleteInTx` | применять только к `Operation.Mutating`; namespace платформы — `TenantID` нулевой + `AccountID` | 3 |
| 13 | `cmd/api` | `config_test.go` (§6.2); `router_test.go` целиком зелёный; K-36 `/healthz` | `main.go` (`slog` JSON, `LOG_LEVEL`, graceful shutdown), `config.go`, `deps.go`, `router.go` — явный реестр монтирования по тегам без `init()` (Q-105), `notimpl` для прочих тегов, `/healthz`, `/readyz` | `router.go` ≤ 150 строк; после волны 1 — интегратор | 2 |
| 14 | `pgdirectory` + `Pools` | интеграционные §6.4; K-32 (sentinel) | запросы к `accounts`, `memberships` (+ `tenants.display_name`), `tenants`, `tenant_routing`, `platform_operators` (pgx, без sqlc в волне 1 — schema от WS-41 может ещё меняться); `Pools`: ленивое открытие, `TENANT_DB_POOL_MAX/BUDGET/IDLE_TTL`, sentinel-проверка `core.tenant_identity` vs `tenant_routing` | DSN тенанта строится из `TENANT_DB_HOST` + `database_name`, секрет — `secret_ref` → env `TENANT_DB_SECRET_<ref>` (прод-хранилище — D-05, вне WS) | 3 |
| 15 | `idem/pgstore` | интеграционные §6.4 (`core.idempotency_keys`, 7 дней, `CompleteInTx`) | реализация на `pgx.Tx`; `memstore` остаётся для unit и для platform-namespace волны 1 (§10 п.6) | — | 2 |
| 16 | Изоляция и конкурентность | K-10…K-14, K-32 (`isolation`), K-28 (`concurrency`) против реальной БД | фикстура внутри `platform_test.go` (A/B, оператор, аккаунт без членств) | строки матрицы 200/403/404 для `getMyContext`, `selectTenant`, `listMyEvents` | 2,5 |
| 17 | Закрытие | снять все `t.Skip`; `golangci-lint run`; `go test ./...`, `-tags integration`, `-tags isolation`, `-tags concurrency`; evidence §8; отчёт §5 `orchestration.md`; `status.md` → «на проверке» | — | — | 1,5 |

Ранний старт (§6.4 мастер-плана «pipeline, не parallel»): циклы 1–13 не требуют WS-41 и выполняются сразу после барьера 0→1; 14–16 — после появления `backend/migrations/` в `main` (или на worktree WS-41 с пометкой в отчёте).

## 8. Проверка WS (страниц нет — проверяется конвейер и стенд)

Playwright MCP и визуальная сверка (`verification-protocol.md` §3–§4) к WS-40 не применяются (`pages: []`); обязательны §1 п.4 (вывод прогонов прикладывается), §5 (ревью) и §6 (хуки). Эквивалент «проходки» — сценарий ниже, вывод кладётся в `docs/plan/evidence/backend-platform/`.

1. Прогоны (вывод дословно, последние 40 строк каждого — в отчёт):
   ```powershell
   go -C backend test ./... -count=1
   go -C backend test -tags integration ./internal/platform/... ./test/... -count=1
   go -C backend test -tags isolation ./test/isolation/... -run 'Platform' -count=1
   go -C backend test -tags concurrency ./test/concurrency/... -run 'Platform' -count=1
   golangci-lint run ./...   # из backend/, config verify — 12 §6 п.13
   ```
   Evidence: `go-test-unit.txt`, `go-test-integration.txt`, `go-test-isolation.txt`, `go-test-concurrency.txt`, `lint.txt`.
2. Маршруты: `go -C backend run ./cmd/api -print-routes` (флаг добавляется в цикле 13) → `routes.txt`: каждый маршрут с тегом и маркером; `/healthz`, `/readyz` помечены `no-pipeline`.
3. Ручной сценарий «devLogin → /me/context» на стенде (`make up`, `make migrate` после WS-41; до WS-52 строк в control DB нет — фикстура берётся из изоляционного теста: `go -C backend test -tags isolation -run TestPlatform_DevLoginToMeContext -v -keep-fixture` печатает DSN и email) — выполняется через `Invoke-WebRequest` (PowerShell 5.1) с `-SessionVariable s`, ожидаемые результаты дословно:
   - `POST http://127.0.0.1:8120/api/v1/auth/dev` `{"email":"d.zimina@alta.example"}` → `Set-Cookie: ortus_sid=…; Path=/; HttpOnly; SameSite=Lax`, `Set-Cookie: ortus_csrf=…; Path=/; SameSite=Lax`, `X-Request-Id`, `Cache-Control: private, no-store`;
   - `GET /api/v1/me/context` → 200, `"displayName":"Дарья Зимина"`, `"platformOperator":false`, `"tenants":[{"name":"Альта Групп","membershipStatus":"active",…}]`;
   - `GET /api/v1/me/context` без cookie → 401, тело `{"type":"https://docs.ortus.example/errors/session_expired","title":…,"status":401,"code":"session_expired","requestId":"…"}`;
   - `POST /api/v1/me/context/tenant` без `X-CSRF-Token` → 403 `csrf_failed`; с токеном и `Idempotency-Key: 0123456789abcdef` → 200; повтор → заголовок `Idempotency-Replayed: true`; повтор с другим телом → 409 `idempotency_key_reused`;
   - `GET /api/v1/tenants/<t-lotos-uuid>/fleet/vehicles` сессией Дарьи → 404; тот же `X-Request-Id: k09-fixed` на `/api/v1/nope` → байт-в-байт то же тело (сравнить `fc.exe /b`);
   - `GET /api/v1/tenants/<t-alta-uuid>/fleet/vehicles` → 501 `not_implemented` (конвейер пройден, тег не реализован) или 403 `forbidden_action` (если `x-permissions` операции непусты — `DenyAll`);
   - `X-Test-Scenario: reservation_overlap` при `APP_ENV=dev` → ответ не меняется; при `APP_ENV=e2e` — в логе запроса поле `test_scenario`.
   Evidence: `curl-devlogin.txt` (запрос/ответ с заголовками), `404-bytes.txt` (вывод `fc.exe /b`), `log-sample.jsonl` (10 строк slog с `request_id`, без cookie-значений — проверить `Select-String ortus_sid=` пуст).
4. Сеть/консоль (аналог §4 п.5): `go test -tags integration -run TestPlatform_NoExternalHosts` — API не делает исходящих HTTP-запросов (нет `http.DefaultClient` вызовов; проверка `httptest`-перехватом `http.DefaultTransport`).
5. Отчёт `docs/plan/reports/WS-40.md` по `orchestration.md` §5 с таблицей «Тест | Слой | Коммит red | Коммит green» для 38 пунктов и раздел «Проверка MCP: не применяется (`pages: []`), эквивалент — §8 п.3, evidence `docs/plan/evidence/backend-platform/`».

Состав `docs/plan/evidence/backend-platform/` (проверяющий/ревьюер сверяет наличие и содержимое):

| Файл | Содержимое | Проверка |
|---|---|---|
| `go-test-unit.txt` | `go test ./... -count=1` целиком | `ok` для каждого пакета §2; `FAIL` отсутствует |
| `go-test-integration.txt` | `-tags integration` | содержит `TestPgDirectory_`, `TestIdemPgStore_`; `ok` |
| `go-test-isolation.txt` | `-tags isolation -run Platform` | 11 строк матрицы §6.4 как `--- PASS` |
| `go-test-concurrency.txt` | `-tags concurrency -run Platform` | `TestPlatform_Idempotency100` PASS |
| `lint.txt` | `golangci-lint config verify` + `run ./...` | пусто/`0 issues` |
| `routes.txt` | `-print-routes` | каждый маршрут с `tag=` и `pipeline=yes`, кроме `/healthz`, `/readyz` |
| `curl-devlogin.txt` | 7 шагов §8 п.3 с заголовками | дословные значения из §8 п.3 |
| `404-bytes.txt` | `fc.exe /b` двух тел 404 | `FC: no differences encountered` |
| `log-sample.jsonl` | 10 строк slog | есть `request_id`; `Select-String 'ortus_sid=|X-CSRF|Bearer'` пуст |

## 9. Критерии готовности (DoD)

- [ ] Первый коммит ветки — `test(ws-40): скелет …` с 38 `t.Skip`; `git log --reverse --format=%s main..HEAD` начинается с `test(` и перед каждым `feat(` единицы есть `test(` (12 §6 п.21; `tdd-protocol.md` §1).
- [ ] Все 38 пунктов скелета без `t.Skip`; `go test ./...`, `-tags integration`, `-tags isolation`, `-tags concurrency` зелёные локально (вывод в отчёте) и в CI-jobs `unit`, `integration`, `isolation+concurrency` (`14-engineering.md:85–94`).
- [ ] Каждый `Problem.code`, который может вернуть WS-40 (13 кодов §6.4), покрыт ≥ 1 тестом; реестр `problem` двусторонне совпадает с `ERR.*` WS-03 (`tdd-protocol.md` §4).
- [ ] Четыре 404 байт-в-байт (K-09) и `pipeline.Verify` (K-30) зелёные; маршрутов мимо конвейера нет, allowlist = `/healthz`, `/readyz`.
- [ ] `devLogin → /me/context → selectTenant → /me/context` проходит на стенде по §8 п.3 (барьер 1→2 мастер-плана §6.5: «`devLogin → /me/context` через конвейер», «`go test -tags isolation` для `/me/context`»).
- [ ] Логи: `request_id`, `tenant_id`, `actor_id` присутствуют; значения cookie/CSRF/`Authorization`/тела запросов отсутствуют (K-33; `14-engineering.md:114`).
- [ ] `golangci-lint run` и `golangci-lint config verify` без ошибок; `//nolint` только с линтером и причиной (12 §5 п.22); `depguard`: `internal/platform/*` не импортирует `internal/modules/**`, `internal/control/**`.
- [ ] Покрытие `internal/platform/{session,tenantctx,idem,pipeline,problem}` ≥ 90 % строк (`tdd-protocol.md` §4 — платформенный фундамент приравнивается к `authz`).
- [ ] Контракт не менялся (`git diff --exit-code api/ backend/internal/api/` после `make gen` пуст); запросы к интегратору на аддитивные изменения перечислены в отчёте («Контракты, которые я изменил» — пусто; «Запросы к контракту» — §10 п.3, п.4).
- [ ] `docs/plan/reports/WS-40.md` по `orchestration.md` §5 с выводом прогонов; evidence `docs/plan/evidence/backend-platform/` (5 файлов прогонов + `routes.txt`, `curl-devlogin.txt`, `404-bytes.txt`, `log-sample.jsonl`); строка `WS-40` в `status.md` → «на проверке».
- [ ] Ревью 1 ревьюера по §8.4 мастер-плана (`backend`): типизированные ошибки → `Problem.code` в одном месте, `depguard`, порядок коммитов; `approve`.
- [ ] Ничего вне границ §2; `design/` не тронут; `go.mod` не менялся (новые зависимости — `golang.org/x/text` для `collate`, `github.com/getkin/kin-openapi` — только если их уже внёс WS-03/WS-01; иначе запрос интегратору в отчёте).

## 10. Риски, расхождения, открытые вопросы (поведение по умолчанию)

1. **Имя cookie.** OpenAPI 0.1 описывает `__Host-ortus_session` (yaml:6438–6443; 10 §3.2), `.env.example:29` и карточка WS-40 — `ortus_sid`. По умолчанию: `SESSION_COOKIE_NAME` (default `ortus_sid`); префикс `__Host-` невозможен без `Secure` на `http://localhost:5173` (Q-101). Интегратору: сверить `securitySchemes.sessionCookie.name` в 0.2 с `.env.example`; в prod-конфиге рекомендуется `__Host-ortus_session` + `Secure`.
2. **Bearer + cookie одновременно** — источник требует «отказ» без кода (yaml:6443; 10 §10 A3). По умолчанию 400 `malformed_request`; bearer-only → 401 `session_expired` до WS-54. Записать как Q-WS40-1 в отчёте для `decisions.md` (через WS-00/интегратора).
3. **Код для 500.** В реестре 12-errors нет кода для внутренней ошибки/паники; `Problem.code` — enum (PD-34). По умолчанию: аддитивный запрос интегратору добавить `internal_error` (500) в `api/errors.yaml` (PD-47 допускает аддитивные правки через интегратора); до добавления K-38 и `problem.From` для неизвестных ошибок используют 503 `dependency_unavailable` с `detail` «Внутренняя ошибка» и это помечено `// TODO(ws-40): internal_error` с тестом, который станет красным после появления кода в `ERR.*` (двусторонний тест реестра).
4. **`selectTenant`, `listMyEvents`, `lastTenantId`** — добавлены WS-03 в 0.2 (§4.1), в 0.1 их нет (10 §8 «Переключатель бизнеса … без отдельной операции»). Если в бандле `main` операции отсутствуют или называются иначе — блокер, не выдумывать пути.
5. **Хранилище сессий.** В control DB нет таблицы сессий (grep `sessions` по `design/docs/db/*.sql` пуст). По умолчанию волна 1: `memstore` (один процесс, сессии теряются при рестарте — допустимо для dev/e2e, PD-18); интерфейс `Store` позволяет WS-54 добавить durable-хранилище с миграцией control через WS-41/интегратора. Вопрос Q-WS40-2.
6. **Idempotency platform-операций.** `core.idempotency_keys` есть только в tenant DB (core:27–38); для `/platform/**` и `selectTenant` (identity-scope) таблицы нет. По умолчанию: namespace с нулевым `TenantID` → `memstore` (волна 1); для фазы 2 WS-43 добавляет `idempotency_keys` в control DB (миграция в его диапазоне, §4.11) и подключает `pgstore`. Вопрос Q-WS40-3.
7. **`lastTenantId` долговременно** (S1-07 «запоминается»). По умолчанию в сессии; колонка `accounts.last_tenant_id` — предложение WS-43 (control-миграция). Q-WS40-4.
8. **Членства `suspended` в `tenants[]`.** Описание `getMyContext` — «Only active/recovery memberships» (yaml:75), enum `membershipStatus` допускает `suspended` (yaml:7053–7057). По умолчанию: включать `active` и `suspended` (UI покажет статус), `invited`/`ended` — нет; `selectTenant` и tenant-маршруты принимают только `active`.
9. **Один отказ для `devLogin`.** Неизвестный email и `locked` → одинаковые 401 `session_expired` (12 R5 «одинаковый отказ на любую причину»); код 401 выбран как ближайший в реестре («Нет действующей аутентификации», `03-api-guide.md:83`). Q-WS40-5.
10. **Состояния тенанта.** Прототип знает 4 чипа (Q-01, PD-35), control DB — 8 (`tenant_state`). Резолвер работает по 8: `trial/active` → ок; `grace/read_only` → `ReadOnly`; `suspended` → 403 `tenant_suspended`; `provisioning/closing/closed` → 404 (как `archived` в 2.0, 12 R7). Маппинг на чипы — WS-27/WS-43 (PD-35), не здесь.
11. **Нет сида до WS-52** (волна 3): стенд без строк в control DB; проверка барьера — автоматизированный `TestPlatform_DevLoginToMeContext` (`isolation`) + §8 п.3 на его фикстуре. Если интегратору нужен постоянный dev-fixture раньше WS-52 — предложение `make dev-fixture` (Makefile — WS-01) в отчёте.
12. **WS-41 параллелен.** Циклы 14–16 зависят от схемы `backend/migrations/`; до слияния WS-41 они прогоняются на его worktree; в отчёте — коммит WS-41. Если WS-41 изменит имена колонок `control_0001` — правка `pgdirectory` в этом WS до закрытия.
13. **Валидатор запросов и 405.** `chi` отдаёт 405 на известный путь с другим методом; тело — problem `malformed_request` 405? Реестр не содержит кода для 405. По умолчанию: 405 с кодом `malformed_request` (структура HTTP неверна — `03-api-guide.md:82`), заголовок `Allow`; зафиксировать тестом.
14. **`golang.org/x/text/collate` для сортировки `tenants[]`** — новая зависимость (12 §5 п.28); если интегратор отказывает — сортировать по `TenantID` (детерминированно), пометить в отчёте.
15. **Rate limiting 429, OTel-метрики, `If-Match` 412/428** — вне WS-40 (429 — не спроектировано; OTel — D-07; `If-Match` — хелпер `httpx.IfMatch` добавит WS-44 как первый потребитель). `httpx` оставляет точку расширения `Options.Metrics` без реализации.

## 11. Промпт запуска

Ты — исполнитель WS-40 «backend-platform» (волна 1, вид backend, размер M) проекта «Ортус CRM». Прочитай полностью бриф `docs/plan/ws/WS-40-backend-platform.md`, затем `docs/plan/tdd-protocol.md`, `docs/plan/verification-protocol.md` §1 п.4, §5–§6, `docs/plan/orchestration.md` §1, §5, §7 и разделы мастер-плана `docs/plan/00-master-plan.md` §3.3, §4.1, §4.7, §8.1 (колонка backend), §8.3, §8.4, PD-31, PD-47, PD-48. Входы брифа §3 читай целиком: `docs/plan/analysis/10-api-and-architecture.md` §3.2–3.5, §8, §9, §10 A–B, D, §12 п.16–17; `12-prior-project-and-skills.md` §3.2 R5–R7, §5 п.1–8, 22–24, 30, §6 п.11–18, 23–25; `09-data-permissions-errors.md` §5.1, §5.2, §5.6, §6 I-18, I-21, I-22; `design/docs/13-backlog-s0-s2.md` S1-02, S1-07, S1-25; `design/docs/db/control_0001_init.sql`, `tenant_0001_core.sql:18–38`; `design/docs/repo-skeleton/.env.example`.

Работай в worktree `..\ws-40-backend-platform` на ветке `ws/ws-40-backend-platform` от `main` (команды — бриф §2; PowerShell 5.1, без `&&`; коммиты через `git commit -F` без BOM). Порт API исполнителя `HTTP_ADDR=127.0.0.1:8120`. Границы файлов — только §2; `api/**`, `backend/internal/api/**`, `go.mod`, `backend/migrations/**`, `authz/`, `scopeddb/`, `design/**` не трогать; нужные контракту аддитивные правки (§10 п.3) — запросом в отчёте, не правкой.

Порядок: первый коммит `test(ws-40): скелет контрактных тестов auth/me/pipeline` — 38 пунктов §6.1 как `t.Run` с `t.Skip`; затем циклы §7 по порядку 1→17, каждый `test(` → `feat(` → `refactor(`; красный тест обязан падать по утверждению, не по импорту. Пути и тела операций — по сгенерированным пакетам `backend/internal/api/{auth,me}`; если операций `devLogin`, `getCsrf`, `logout`, `getMyContext` (с `tenants[]`, `lastTenantId`), `selectTenant`, `listMyEvents` в бандле нет — остановись и опиши блокер. `problem.From(err)` — единственное место маппинга ошибок; `tenantctx.MustFromContext` без fallback; четыре 404 байт-в-байт; `X-Test-Scenario` только при `APP_ENV=e2e`; логи без cookie/CSRF/`Authorization`/тел.

Перед закрытием: все `t.Skip` сняты; прогоны `go test ./...`, `-tags integration`, `-tags isolation`, `-tags concurrency`, `golangci-lint run` зелёные; сценарий §8 п.3 выполнен, evidence в `docs/plan/evidence/backend-platform/` (9 файлов из §9). Напиши `docs/plan/reports/WS-40.md` по `orchestration.md` §5 с дословным выводом прогонов, таблицей red→green для 38 пунктов, разделом «Проверка MCP: не применяется (`pages: []`)», списком вопросов Q-WS40-1…5 из §10 и пустым разделом «Контракты, которые я изменил». Обнови свою строку в `docs/plan/status.md`. Верни: `ws`, `branch`, `reportPath`, `done`, `pagesDelivered: []`, `fixmeLeft` (пункты K-NN, оставшиеся в `t.Skip`, со ссылкой на вопрос), `contractsChanged: []`, `testRunsOk`.
