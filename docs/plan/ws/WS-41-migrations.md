# WS-41 · Миграции: goose control 0001–0003, tenant 0001–0003, контроллер canary → партии, `cmd/migrate`, роли БД

Волна 1 · Размер M · Вид backend · Зависит от WS-01, WS-02 (и Go-харнесса WS-07 — §6.1 мастер-плана) · Блокирует WS-42, WS-43, WS-52, WS-56 · Ревью 2 (второй ревьюер — по миграциям, `verification-protocol.md` §5; CODEOWNERS `migrations/**`, `14-engineering.md:68`) · Сюиты Go, обязанные быть зелёными до слияния: `integration` (мастер-план §7.2, волна 1).

Условные ссылки как в мастер-плане §0.1: «09 §7.1» = `docs/plan/analysis/09-data-permissions-errors.md` §7.1; «12 §6 п.12» = `docs/plan/analysis/12-prior-project-and-skills.md` §6, пункт 12; «`control_0002:7`» = `design/docs/db/control_0002_billing.sql:7`; «D-38» = `docs/plan/decisions.md` / мастер-план §10.3; «Q-80» = `docs/plan/decisions.md`.

## 1. Цель

После WS-41 пять SQL-файлов дизайна (`design/docs/db/control_0001_init.sql`, `control_0002_billing.sql`, `control_0003_branding.sql`, `tenant_0001_core.sql`, `tenant_0002_fleet.sql`) лежат в `backend/migrations/{control,tenant}/` **байт-в-байт** как тело `-- +goose Up` goose-миграций, дополнены миграцией `tenant/0003_prototype_gaps.sql` с «нарисованными, но не имеющими колонок» полями прототипа (09 §7.1–7.2; Q-80, Q-90) и применяются на PostgreSQL 17 (и 16.4) ролью `ortus_migrator` через контроллер «canary → партии → остальные» с версией схемы в `tenant_routing.schema_version` (`control_0001:42`; `02-architecture.md:56`; S1-03). Команда `make migrate` (14-engineering `:101` «control + все tenant DB») получает исполнителя `backend/cmd/migrate`; роли `migrator / api_runtime / worker_runtime / provisioner` (14-engineering `:81`) создаются и проверяются тестами «у API нет DDL». Для backend-WS «точно как нарисовано» = таблица проверок схемы из `design/docs/10-data-model.md:9–22` воспроизведена тестами на реальном сервере.

## 2. Границы файлов

Создаёт (владение WS-41, мастер-план §3.3, §4.11, §5.4):

| Путь | Что |
|---|---|
| `backend/migrations/embed.go` | пакет `migrations`: `//go:embed control/*.sql`, `//go:embed tenant/*.sql`, `//go:embed roles/*.sql` → `Control`, `Tenant`, `Roles fs.FS` (подкаталог `tenant/drafts/` в шаблон не входит — §1.4 (в) мастер-плана) |
| `backend/migrations/control/0001_init.sql`, `0002_billing.sql`, `0003_branding.sql` | goose SQL; `Up` = копия `design/docs/db/control_000N_*.sql`; `Down` — авторский (обратный порядок) |
| `backend/migrations/tenant/0001_core.sql`, `0002_fleet.sql` | то же для `tenant_0001_core.sql`, `tenant_0002_fleet.sql` |
| `backend/migrations/tenant/0003_prototype_gaps.sql` | разрывы прототип↔SQL (§4 «Публикует», п. 3) |
| `backend/migrations/tenant/drafts/README.md` | назначение каталога: заготовки S3+ (0007–0013, §4.11), не встраиваются и не применяются |
| `backend/migrations/roles/roles.sql`, `grants_control.sql`, `grants_tenant.sql` | идемпотентные роли кластера и гранты на БД (не goose, выполняет `cmd/migrate`) |
| `backend/internal/platform/migrate/{source,lint,runner,controller,roles,grants,status,errors}.go` + `*_test.go` | библиотека: источник, статический линт, раннер goose, контроллер, роли/гранты, статус/дрейф |
| `backend/internal/platform/migrate/migratetest/{cluster,db,snapshot}.go` | тестовый кластер testcontainers (`postgres:17`, образ из `PG_TEST_IMAGE`), одноразовые БД, снимок схемы |
| `backend/cmd/migrate/{main,cli}.go`, `cli_test.go`, `README.md` | CLI: `control up\|down\|status`, `tenants up\|down\|status`, `all up`, `roles ensure`, `--dry-run`, коды выхода |
| `docs/plan/reports/WS-41.md`; строка WS-41 в `docs/plan/status.md`; `docs/plan/evidence/migrations/*.txt` | отчёт по `orchestration.md` §5; текстовые evidence (§8) |

Меняет только через интегратора (перечислить в отчёте «Контракты, которые я изменил»): `backend/go.mod` — новые зависимости (`pressly/goose/v3`, `testcontainers-go` + `modules/postgres`, `jackc/pgx/v5`, `stretchr/testify` по Q-110) одним первым коммитом `chore(deps): …` с пином версий (мастер-план §3.3: «`backend/go.mod` — новые зависимости через интегратора»); `Makefile` (WS-01) — цель `migrate` должна вызывать `go -C backend run ./cmd/migrate all up`; `deploy/compose/.env.example` (WS-02) — пять переменных рантайма из §4.1 п. 6 (`PG_SUPER_URL`, `PG_MIGRATOR_PASS`, `PG_API_PASS`, `PG_WORKER_PASS`, `PG_PROVISIONER_PASS`; `PG_TEST_*` — только для тестов, в `.env.example` не входят); `.github/workflows/ci.yml` (WS-01) — матрица образов `postgres:17` / `postgres:16.4` для job `integration` (D-38); `backend/test/harness.go` (WS-07) — `TestMain` вместо собственного применения `*.up.sql` (12 §6 п.12) вызывает `migrate.UpAll` (§10 Р-1).

Запрещено: `design/**` (эталон, `orchestration.md` §7); `backend/internal/platform/{tenantctx,authz,scopeddb,…}` (WS-40/42); `backend/internal/control/**` (WS-43/56); `backend/cmd/{api,provisioner,seed,worker}`; `api/**`; `frontend/**`; чужие строки `status.md`.

Worktree и ветка (`orchestration.md` §1; `workflow.template.js:69`): из корня `D:\work\test26042026_Kirill_3.0` — `git worktree add ..\ortus-ws-41 -b ws/ws-41-migrations main`; в worktree `pnpm install` не нужен (Go-only), нужен запущенный Docker Desktop (testcontainers, Q-107). PowerShell 5.1: цепочки через `;`, не `&&` (WS-01 Windows-onboarding). Dev-порт по §7.4 (`5173 + 41 = 5214`) не используется — UI нет.

## 3. Входы (прочитать полностью до первого коммита)

- `design/docs/db/control_0001_init.sql` (162 строки: enum `tenant_state`/`membership_status` `:8–10`, `accounts :12–22`, `tenants :24–34`, `tenant_routing :37–45` с `schema_version bigint :42` и `sentinel uuid :43`, `memberships :47–58`, `owner_bindings :62–71`, `invitations :73–86`, `subscriptions :88–96`, `entitlements :99–113`, `platform_operators :118–129`, `support_grants :132–146`, `platform_audit :148–161`); `control_0002_billing.sql` (`btree_gist :7`, `price_book_versions` с EXCLUDE `:10–17`, `price_tiers :19–30`, `price_terms :32–37`, `alter subscriptions :41–46`, `subscription_change_requests :49–70`, `alter accounts :73–79`, view `tenant_seat_usage :82–87`); `control_0003_branding.sql` (`tenant_branding_versions :7–23`, view `:25–26`, `alter accounts ui_theme :29`); `tenant_0001_core.sql` (`btree_gist :6`, 9 схем `:8–16`, `core.tenant_identity :19–24`, `idempotency_keys :27–38`, `counters :41–45`, `org.* :48–81`, `people.* :85–106`, `access.* :109–166`, `modules.installations :169–178`, `files.* :181–221`, `sched.* :224–254` с `reservations_no_overlap :250–252`, `audit.events :257–272`, `outbox.* :274–295`); `tenant_0002_fleet.sql` (`fleet.vehicles :7–29`, `trips :31–61` с частичными unique `:57–60`, `trip_stops :63–73`, `checklist_versions :75–83`, `inspections :85–103`, `inspection_photos :107–112`, `defects :114–128`, `odometer_corrections :130–138`, `expenses :141–160`, `pool_publications :163–173`, `driver_transfers :175–190`, `finance.earnings :195–206`).
- `design/docs/10-data-model.md` целиком: СУБД `:5–7`, таблица «Проверка 01.10.2026» `:9–22` (12 сценариев — зеркало тестов §6 (г)), «Не проверены: конкурентные транзакции…, права ролей `migrator` / `api_runtime`» `:24`, принципы `:26–39`, жизненные циклы `:82–109`, инварианты `:111–126`, «Что сознательно не в схеме» `:128–133`.
- 09 §3 (каталог таблиц с источниками, §3.1–3.6), §6 (I-01…I-33 с колонкой «Как тестировать»), §7.1 (сущности без таблиц, строка «Приёмка смены `trip.review`» → `fleet.trip_reviews`), §7.2 (разрывы полей: `title`, `model`, `depot`, `trip.title`, `distanceKm`, `pool.terms`, `source_type`), §9 DP-10 (код ошибки для `trips_active_*_uq` — не наша задача, фиксируем SQLSTATE), DP-13 (бронь без источника), DP-14 (16.4 vs 17), §10 п.1–4, 11.
- `design/docs/14-engineering.md:12` (goose + контроллер, D-06), `:33, 40` (`cmd/migrate`, `migrations/{control,tenant}`), `:68` (CODEOWNERS), `:81` (роли БД, «У API нет DDL»), `:98–103` (`make migrate`); `design/docs/v0.1/02-architecture.md:48–56` (routing, sentinel при открытии пула, контроллер canary → партии, expand/contract); `design/docs/13-backlog-s0-s2.md:46–48` (S1-01, S1-03); `design/docs/16-raid-glossary.md:12–14` (D-04, D-05, D-06); `design/docs/repo-skeleton/.env.example:3–10` (`PG_SUPERUSER`, `CONTROL_DB_URL=postgres://ortus_api:…/ortus_control`, `TENANT_DB_HOST`); `design/docs/12-errors-and-events.md:65` (503 `dependency_unavailable`).
- Мастер-план: §3.1, §3.3 (дерево, точки конфликтов), §4.11 (диапазоны и содержимое 0003), §5.4 карточка WS-41, §6.5 (барьер: «`-tags integration` (миграции up/down на двух tenant DB)»), §8.1 колонка backend, §8.3, §8.4 backend, §10.1 R15, R16; D-15, D-30, D-38, D-46, D-51.
- `docs/plan/decisions.md`: Q-80 («Mock как в прототипе; SQL — новый `source_type` или nullable»), Q-90 («Добавить в схему (поля нарисованы)»), Q-99 («Tenant DB по SQL-черновику» — аудит тенанта остаётся в `audit.events`, журнал платформы в `platform_audit`), Q-104 («Агент пишет по `10-data-model.md`, CODEOWNERS-ревью обязателен»), Q-106 («PostgreSQL 17 везде; Go — последний стабильный»), Q-107 (testcontainers для `integration`), Q-110 (`testify`, `goleak` — да; `lo`/`oops` — нет), Q-111 (module path `github.com/ortus/ortus-crm/backend`), Q-112.
- 12 §3.2 R4 (харнесс 2.0: «падает, а не skip, без БД»), §3.3 п.10 (линтер 2.0: «каждый оператор с префиксом схемы, роль модуля без `CREATE`»), п.12, п.13; §4.9 (`golang-database`: «миграции внешним инструментом», «SQL дизайна считается авторским входом»); §6 п.11–13; §7 п.5, 9; §8 п.7 (префикс `Test<WS>` для БД из `t.Name()`).
- Протоколы: `tdd-protocol.md` §1, §2 (шаги 2, 4), §3 Go, §4; `verification-protocol.md` §5, §6; `orchestration.md` §1, §5, §7. Скилы: `golang-testing` (build tags, `t.Parallel()`, `goleak.VerifyTestMain`, табличные тесты), `golang-database` (pgx, `*Context`, `errors.Is`, пул), `golang-code-style`, `golang-naming`, `golang-error-handling`, `golang-context`.

## 4. Контракты

### 4.1 Публикует (потребители — WS-40, WS-42, WS-43, WS-52, WS-56, WS-07-харнесс)

1. **Файлы миграций** (`backend/migrations/`), формат goose v3: `-- +goose Up` … `-- +goose Down`; каждая миграция — одна транзакция (без `-- +goose NO TRANSACTION`); имя `NNNN_slug.sql`, версия = `NNNN`. Таблица версий goose — `goose_db_version` в каждой БД (control и tenant). Нумерация по §4.11: control 0001–0003 и tenant 0001–0003 — WS-41; control 0004–0005 — WS-67; tenant 0004–0005 — WS-45; 0006 — WS-47; 0007–0013 — WS-60…66, WS-72, до своей волны лежат в `tenant/drafts/`.
   Контрольные числа объектов (утверждения тестов M-10/M-11; источники — файлы дизайна, 09 §10 п.1 «16 таблиц + 2 view», `10-data-model.md:9` «36 таблиц в 11 схемах»):

   | Миграция | Таблицы | Views | Типы/расширения | Ключевые ограничения, которые обязаны существовать после `Up` |
   |---|---|---|---|---|
   | control 0001 | 11: `accounts, tenants, tenant_routing, memberships, owner_bindings, invitations, subscriptions, entitlements, platform_operators, support_grants, platform_audit` | — | enum `tenant_state` (8), `membership_status` (4) | `accounts(issuer,subject)` unique; `tenants.slug` unique + regex; `owner_bindings_active_uq`; `invitations.token_hash` unique; `entitlements(tenant_id,feature_key,version)` unique; 2 CHECK `platform_operators`; 3 CHECK `support_grants` |
   | control 0002 | +4: `price_book_versions, price_tiers, price_terms, subscription_change_requests` | `tenant_seat_usage` | `btree_gist` | EXCLUDE `effective`; `price_tiers` PK/unique/CHECK; `subscriptions_tier_fk`; `scr_one_pending_uq`; `accounts_lock_reason_chk` |
   | control 0003 | +1: `tenant_branding_versions` | `tenant_branding_current` | — | PK `(tenant_id, version)`; CHECK hex/длины/jsonb; `accounts.ui_theme` CHECK |
   | tenant 0001 | 24 в 9 схемах: `core` 3, `org` 4, `people` 2, `access` 6, `modules` 1, `files` 3, `sched` 2, `audit` 1, `outbox` 2 | — | `btree_gist` | `work_profiles` EXCLUDE; `roles_name_uq`; `role_versions` CHECK `*`; `role_assignments` scope CHECK; `reservations_no_overlap`; `idempotency_keys` PK + CHECK длины |
   | tenant 0002 | +12 в 2 схемах: `fleet` 11, `finance` 1 | — | — | `vehicles_plate_uq`; `trips_active_vehicle_uq`, `trips_active_driver_uq`; `trips` CHECK `on_route`; `inspections(trip_id,kind)` unique; `expenses` CHECK; `finance.earnings.trip_id` unique |
   | tenant 0003 | +1: `fleet.trip_reviews` | — | — | `trip_reviews` CHECK `decision`/`steps`; `reservations_source_pair_chk`; 6 новых nullable-колонок |

   Содержимое `backend/migrations/tenant/drafts/README.md` (дословно): «Заготовки миграций S3+ (мастер-план §1.4 (в), §4.11): `0007_forms`, `0008_tasks`, `0009_knowledge`, `0010_spa_inventory`, `0011_cash`, `0012_repairs`, `0013_importer`. Файлы здесь не встраиваются (`//go:embed tenant/*.sql` не захватывает подкаталоги) и не применяются ни `cmd/migrate`, ни тестами (M-06). Переносит файл в `tenant/` только WS-владелец диапазона в своей волне.»

2. **Инвариант «копия дизайна»**: тело `Up` файлов control 0001–0003 и tenant 0001–0002 равно содержимому `design/docs/db/*.sql` после нормализации (CRLF→LF, обрезка хвостовых пробелов строк, один завершающий `\n`); проверяется unit-тестом M-05. Любая правка схемы S1–S2 — только новой миграцией (expand), а не правкой копии. Шапка каждого файла до маркера `Up` — одна строка-комментарий `-- WS-41 · копия design/docs/db/<имя>.sql · не редактировать, см. M-05`. Секции `Down` (авторские, порядок обратный созданию; каждая проверяется M-10/M-11 равенством снимков):

   ```sql
   -- control/0001_init.sql · Down
   drop table platform_audit; drop table support_grants; drop table platform_operators;
   drop table entitlements; drop table subscriptions; drop table invitations;
   drop table owner_bindings; drop table memberships; drop table tenant_routing;
   drop table tenants; drop table accounts;
   drop type membership_status; drop type tenant_state;
   -- control/0002_billing.sql · Down
   drop view tenant_seat_usage;
   alter table accounts drop constraint accounts_lock_reason_chk,
     drop column locked_at, drop column locked_by, drop column lock_reason,
     drop column mfa_enabled, drop column last_login_at;
   drop table subscription_change_requests;
   alter table subscriptions drop constraint subscriptions_tier_fk,
     drop column tier_code, drop column term_months, drop column price_version, drop column amount_minor;
   drop table price_terms; drop table price_tiers; drop table price_book_versions;
   drop extension if exists btree_gist;
   -- control/0003_branding.sql · Down
   alter table accounts drop column ui_theme;
   drop view tenant_branding_current; drop table tenant_branding_versions;
   -- tenant/0001_core.sql · Down
   drop schema outbox, audit, sched, files, modules, access, people, org, core cascade;
   drop extension if exists btree_gist;
   -- tenant/0002_fleet.sql · Down
   drop schema finance, fleet cascade;
   ```

   `drop schema … cascade` допустим только в `Down` файлов 0001/0002 (они создают схемы целиком); в 0003+ `Down` перечисляет объекты поимённо (L4 проверяет только `Up`).
3. **`tenant/0003_prototype_gaps.sql`** (только expand: добавления, nullable, без переписывания данных; `02-architecture.md:56`), содержимое ровно по §4.11 и 09 §7.1–7.2 — ничего сверх списка:

   ```sql
   -- +goose Up
   -- Ортус · Tenant DB · миграция 0003 · поля прототипа без места в схеме (09 §7.1–7.2; Q-80, Q-90). Только expand.

   -- Приёмка смены: review.{decision, comment, steps[], at, resolved} (api.js:380–397; REV_STEPS «Ортус CRM.dc.html»:2364).
   -- Имя колонки steps — по контракту 0.2 (TripReview.steps[]), не sections.
   create table fleet.trip_reviews (
     id          uuid primary key default gen_random_uuid(),
     trip_id     uuid not null references fleet.trips(id),
     decision    text not null check (decision in ('accept','rework')),
     comment     text,
     steps       text[] not null default '{}'
                 check (steps <@ array['photos','odo','expenses','checklist']::text[]),
     created_by  uuid not null,
     created_at  timestamptz not null default now(),
     resolved_at timestamptz
   );
   create index trip_reviews_trip_idx on fleet.trip_reviews (trip_id, created_at desc);

   -- members[].title: «Логист», «Водитель», «Диспетчер · Самара» (mock-data.js:151–162).
   alter table people.person_profiles add column title text;
   -- vehicles[].model / depot (mock-data.js:180–188).
   alter table fleet.vehicles add column model text, add column depot text;
   -- trips[].title / distanceKm (mock-data.js:189–212).
   alter table fleet.trips
     add column title text,
     add column distance_km numeric(8,1) check (distance_km is null or distance_km >= 0);
   -- pool.drivers[].terms: «По соглашению фирм группы» (mock-data.js:213–219).
   alter table fleet.pool_publications add column terms text;
   -- Бронь без источника («Перерыв», extra-data.js:17) и «Плановое ТО» (:21) — DP-13, Q-80: пара nullable.
   -- Значения source_type вида 'sched.block' / 'fleet.maintenance' допустимы и без миграции (text без CHECK, tenant_0001_core.sql:243).
   alter table sched.reservations
     alter column source_type drop not null,
     alter column source_id   drop not null,
     add constraint reservations_source_pair_chk check ((source_type is null) = (source_id is null));

   -- +goose Down
   alter table sched.reservations
     drop constraint reservations_source_pair_chk,
     alter column source_id   set not null,
     alter column source_type set not null;
   alter table fleet.pool_publications drop column terms;
   alter table fleet.trips drop column distance_km, drop column title;
   alter table fleet.vehicles drop column depot, drop column model;
   alter table people.person_profiles drop column title;
   drop table fleet.trip_reviews;
   ```

   `Down` на данных с `null`-источником обязан упасть (`23502`) — ожидаемое поведение, тест M-19. Поля вне этого списка (`cargo.kind`, тип второго фактора оператора) — §10 Р-5.
4. **Go-пакет `github.com/ortus/ortus-crm/backend/internal/platform/migrate`** (module path по Q-111):
   - `type Source struct{ Control, Tenant fs.FS }`; `func DefaultSource() Source` (из `migrations.Control/Tenant`); `func Lint(src Source) []LintError` (правила §6 (б) L1–L7).
   - `type Runner`; `func NewRunner(db *sql.DB, fsys fs.FS, opts ...Option) (*Runner, error)`; методы `Up(ctx) (from, to int64, err)`, `UpTo(ctx, v int64)`, `DownTo(ctx, v int64)`, `Version(ctx) (int64, error)`; под капотом `goose.NewProvider(goose.DialectPostgres, …)` с `goose.WithSessionLocker(lock.NewPostgresSessionLocker())` (две параллельные команды на одной БД сериализуются).
   - `func UpAll(ctx, control *sql.DB, tenants ...*sql.DB) error` — для харнессов других сюит (WS-07 `TestMain`, WS-42 фикстуры): control до последней версии, затем каждая tenant DB до последней.
   - `type TenantRef struct{ TenantID uuid.UUID; Slug, DatabaseName string; SchemaVersion int64; Sentinel uuid.UUID; CreatedAt time.Time }`; `type Connector interface{ Open(ctx, TenantRef) (*sql.DB, error) }` (реализация по умолчанию — `TENANT_DB_HOST` + учётка `ortus_migrator`; WS-56 подставит свою через `secret_ref`).
   - `type Plan struct{ Target int64; CanarySlugs []string; BatchSize int; StopOnFailure bool; DryRun bool }` (умолчания: `Target` = последняя версия источника, `BatchSize` = 10, `StopOnFailure` = true); `func (c *Controller) Rollout(ctx, Plan) (Report, error)`; `type Report struct{ RunID string; Phases []Phase; Done, Failed, Skipped []TenantResult }`; `type TenantResult struct{ Ref TenantRef; From, To int64; Err error }`.
   - Алгоритм `Rollout`: (1) `select t.id, t.slug, r.database_name, r.schema_version, r.sentinel, t.created_at from tenant_routing r join tenants t on t.id = r.tenant_id order by t.created_at, t.id` в control DB; (2) фазы: canary = тенанты из `CanarySlugs`, при пустом списке — первый по порядку; затем партии по `BatchSize` из остальных с `schema_version < Target`; тенанты с `schema_version = Target` → `Skipped`, с `schema_version > Target` → `Failed` с `ErrVersionAhead` без изменений; (3) на тенанте: `Open` → если `schema_version ≥ 1`, сверить `core.tenant_identity.sentinel` с `tenant_routing.sentinel` (`tenant_0001_core.sql:18–24`; `02-architecture.md:52`): несовпадение → `ErrSentinelMismatch`, миграции не выполняются; → `UpTo(Target)` → если таблица `core.tenant_identity` пуста (только что создана 0001) — вставить `(tenant_id, sentinel)` из routing (`ensureIdentity`, контракт для WS-56: provisioner регистрирует routing **до** вызова контроллера) → `update tenant_routing set schema_version = $to, updated_at = now() where tenant_id = $id and schema_version = $from` (0 строк → `ErrRoutingRace`) → строка в `platform_audit` (`actor_kind='system'`, `actor_id null`, `action='tenant.schema.migrate'`, `target_type='tenant'`, `target_id=tenant_id`, `result='ok'|'failed'`, `request_id=RunID`, `details={"database":…, "from":N, "to":M, "error":…}` — `control_0001_init.sql:148–161`); (4) отказ любого canary → фазы партий не стартуют, `Rollout` возвращает `ErrCanaryFailed{Tenant}`; отказ внутри партии при `StopOnFailure` → текущая партия дорабатывает уже начатые тенанты, следующие партии не стартуют; (5) `DryRun` — только фазы и `From/To`, ни одного соединения с tenant DB и ни одной записи.
   - `func (c *Controller) Status(ctx) ([]TenantStatus, error)`: `TenantStatus{Ref; Actual int64; Drift bool}` — `Actual` из `goose_db_version` tenant DB; `Drift = Actual != SchemaVersion`.
   - Ошибки (пакетный уровень, `errors.Is`): `ErrSentinelMismatch`, `ErrSentinelMissing`, `ErrCanaryFailed`, `ErrVersionAhead`, `ErrSchemaDrift`, `ErrRoutingRace`, `ErrNotMigrator` (попытка применить не ролью `ortus_migrator`: проверяется `current_user`). Маппинг в `Problem.code` (503 `dependency_unavailable` для sentinel при открытии пула, I-22) — зона WS-40 `tenantctx`, не WS-41.
   - `roles.go`: `func EnsureRoles(ctx, super *sql.DB, Passwords) error` выполняет `migrations/roles/roles.sql` (идемпотентный `DO $$ … IF NOT EXISTS (select 1 from pg_roles where rolname = …)`): `ortus_migrator` (LOGIN, NOSUPERUSER, NOCREATEDB), `ortus_api` (LOGIN), `ortus_worker` (LOGIN), `ortus_provisioner` (LOGIN, CREATEDB). `grants.go`: `func GrantControl(ctx, db)`, `func GrantTenant(ctx, db)` выполняют `grants_control.sql`/`grants_tenant.sql` после каждого успешного `Up`: `revoke connect on database current_database() from public`; `revoke create on schema public from public`; `grant connect … to ortus_api, ortus_worker`; `grant usage on schema <все схемы tenant / public control> to ortus_api, ortus_worker`; `grant select, insert, update, delete on all tables in schema … to ortus_api, ortus_worker`; `grant usage, select on all sequences in schema … to …`; `alter default privileges for role ortus_migrator in schema … grant select, insert, update, delete on tables to ortus_api, ortus_worker`. Никаких `create`/`owner` для `ortus_api` (14-engineering `:81` «У API нет DDL»). Отдельная роль чтения `finance.*` (`tenant_0002_fleet.sql:5` «позже») — не в этом WS. Скелеты файлов (пароли — только через параметры `$1…$4`/`format('%L')`, никогда литералами в репозитории):

   ```sql
   -- migrations/roles/roles.sql · выполняет суперпользователь (dev) или DBA (stage/prod), идемпотентно
   do $$ begin
     if not exists (select 1 from pg_roles where rolname = 'ortus_migrator') then
       execute format('create role ortus_migrator login nosuperuser nocreatedb nocreaterole password %L', :'migrator_pass');
     end if;
     if not exists (select 1 from pg_roles where rolname = 'ortus_api') then
       execute format('create role ortus_api login nosuperuser nocreatedb nocreaterole password %L', :'api_pass');
     end if;
     if not exists (select 1 from pg_roles where rolname = 'ortus_worker') then
       execute format('create role ortus_worker login nosuperuser nocreatedb nocreaterole password %L', :'worker_pass');
     end if;
     if not exists (select 1 from pg_roles where rolname = 'ortus_provisioner') then
       execute format('create role ortus_provisioner login nosuperuser createdb nocreaterole password %L', :'provisioner_pass');
     end if;
   end $$;
   -- migrations/roles/grants_tenant.sql · выполняет ortus_migrator (владелец БД) после каждого успешного Up
   revoke connect on database :"db" from public;
   revoke create on schema public from public;
   grant connect on database :"db" to ortus_api, ortus_worker;
   do $$ declare s text; begin
     for s in select nspname from pg_namespace
              where nspname not in ('pg_catalog','information_schema','pg_toast') and nspname not like 'pg_temp%'
     loop
       execute format('grant usage on schema %I to ortus_api, ortus_worker', s);
       execute format('grant select, insert, update, delete on all tables in schema %I to ortus_api, ortus_worker', s);
       execute format('grant usage, select on all sequences in schema %I to ortus_api, ortus_worker', s);
       execute format('alter default privileges for role ortus_migrator in schema %I grant select, insert, update, delete on tables to ortus_api, ortus_worker', s);
       execute format('alter default privileges for role ortus_migrator in schema %I grant usage, select on sequences to ortus_api, ortus_worker', s);
     end loop;
   end $$;
   -- goose_db_version: только чтение рантайму
   revoke insert, update, delete on goose_db_version from ortus_api, ortus_worker;
   ```

   (Плейсхолдеры `:'x'`/`:"db"` — нотация psql для наглядности; в Go они подставляются через `pgx` параметры и `pgx.Identifier`.) `grants_control.sql` — то же для control DB (схема `public`), плюс `grant select on tenant_routing, tenants to ortus_provisioner` (провизионер читает реестр, но не данные тенантов — M-25).
   - Логи `log/slog` JSON: поля `run_id`, `tenant_id`, `database`, `from`, `to`, `phase`, `duration_ms`; DSN и пароли никогда не логируются (14-engineering `:114`).
5. **CLI `backend/cmd/migrate`** (`func run(args []string, env func(string) string, stdout, stderr io.Writer) int` для тестов; `main` только вызывает `os.Exit(run(...))`):
   `migrate control up|down --to N|status`, `migrate tenants up [--to N] [--canary slugA,slugB] [--batch 10] [--dry-run] [--continue-on-failure]`, `migrate tenants down --to N --canary …` (down только на перечисленных canary — защита от массового отката), `migrate tenants status` (таблица `slug  database  routing  actual  drift`), `migrate all up` (= `roles ensure` при `PG_SUPER_URL` + `control up` + `tenants up`), `migrate roles ensure`. Коды выхода: 0 ок; 2 `ErrCanaryFailed`; 3 дрейф (`status` при `--fail-on-drift`); 4 ошибка конфигурации/соединения; 5 `ErrNotMigrator`. Справка `migrate --help` (дословно, проверяется M-26 по первой строке):

   ```text
   migrate — миграции control DB и tenant DB Ортус (goose + контроллер canary → партии)

   migrate control up|down --to N|status
   migrate tenants  up   [--to N] [--canary slug,...] [--batch 10] [--dry-run] [--continue-on-failure]
   migrate tenants  down --to N --canary slug,...
   migrate tenants  status [--fail-on-drift]
   migrate all      up
   migrate roles    ensure
   Переменные: CONTROL_DB_URL, TENANT_DB_HOST, PG_SUPER_URL (roles), PG_MIGRATOR_PASS, PG_API_PASS, PG_WORKER_PASS, PG_PROVISIONER_PASS
   Коды выхода: 0 ок · 2 canary упал · 3 дрейф · 4 конфигурация/соединение · 5 не ortus_migrator
   ```

   Формат `tenants status` (колонки через два пробела, сортировка по `slug`):

   ```text
   slug    database  routing  actual  drift
   alta    t_alta    3        3       false
   lotos   t_lotos   2        3       true
   ```
6. **Переменные окружения** (`backend/cmd/migrate/README.md`; добавить в `deploy/compose/.env.example` через интегратора): `CONTROL_DB_URL` (существует, `.env.example:6` — для `migrate` указывать учётку `ortus_migrator`), `TENANT_DB_HOST` (`:7`), `PG_SUPER_URL` (только для `roles ensure`, dev), `PG_MIGRATOR_PASS`, `PG_API_PASS`, `PG_WORKER_PASS`, `PG_PROVISIONER_PASS`; для тестов `PG_TEST_IMAGE` (по умолчанию `postgres:17`), `PG_TEST_URL` (внешний сервер вместо testcontainers, напр. compose `postgres-test` 5433 WS-02).
7. **`migratetest`** (для WS-42/43/52/56): `func NewCluster(t) *Cluster` (один контейнер на пакет через `TestMain`, роли созданы, control DB `ortus_control` мигрирована до последней версии владельцем `ortus_migrator`); `func (c *Cluster) NewTenantDB(t, slug string) TenantRef` (БД `t_<hex8 от t.Name()>` с `owner ortus_migrator`, строка в `tenants` + `tenant_routing` со случайным `sentinel`, `schema_version 0`); `func (c *Cluster) DB(t, dbName, role string) *sql.DB`; `func SchemaSnapshot(t, db *sql.DB) string` (отсортированный текст из `information_schema.columns`, `pg_constraint` (`conname`, `contype`, `pg_get_constraintdef`), `pg_indexes`, `pg_enum`, `pg_views`, `pg_extension`, без `goose_db_version`). Без базы — **падение, не skip**, с текстом `migratetest: Docker недоступен — запустите Docker Desktop или задайте PG_TEST_URL` (12 §6 п.11, R4).

### 4.2 Потребляет

- WS-01: `backend/go.mod` (Go последний стабильный, D-38), `.golangci.yml` (`run.build-tags: [integration, isolation, concurrency]`, `depguard`), `Makefile` цель `migrate` (заглушка → команда §4.1 п.5), CI job `integration`.
- WS-02: compose `postgres:17` на loopback, `postgres-test` (`profiles: [test]`, 5433, tmpfs) — используется только через `PG_TEST_URL`; `.env.example` имена переменных.
- WS-07: `backend/test/harness.go` — после слияния WS-41 его `TestMain` обязан вызывать `migrate.UpAll` (сейчас, по 12 §6 п.12, он применяет `*.up.sql` лексикографически — формат goose другой; см. §10 Р-1). До слияния WS-41 тесты пакета `migrate` самодостаточны (`migratetest`).

Если контракта ещё нет: `go.mod` без зависимостей → первый коммит `chore(deps)`; Makefile без `migrate` → команда документируется в README и отчёте; Docker Desktop не запущен → тесты красные с подсказкой (не skip).

## 5. Экраны, диалоги, состояния

Страниц, диалогов и ключей `pages` у WS нет (`"pages": []`, мастер-план §7.2); e2e Playwright и MCP-проходка по `verification-protocol.md` §1, §3, §4 к WS-41 не применяются (§8.1 мастер-плана, колонка backend: «—»). Эквивалент экранов — команды CLI и состояния контроллера:

| Ключ | Команда / единица | «Персонажи» (роль БД) | Источник | Состояния | Тест | Evidence |
|---|---|---|---|---|---|---|
| `cli-control` | `migrate control up\|down\|status` | `ortus_migrator` | 14-eng `:101`; D-06 | ок / уже на версии (no-op) / нет соединения (код 4) / не migrator (код 5) | M-24, M-25 | `evidence/migrations/control-status.txt` |
| `cli-tenants` | `migrate tenants up --canary … --batch N [--dry-run]` | `ortus_migrator` | `02-architecture.md:56`; S1-03 | план (dry-run) / canary ок → партии / canary упал (код 2, партии не тронуты) / sentinel не совпал / тенант впереди цели / дрейф | M-13…M-22 | `evidence/migrations/tenants-rollout-17.txt`, `-16.4.txt` |
| `cli-status` | `migrate tenants status [--fail-on-drift]` | `ortus_migrator` | `control_0001:42` | без дрейфа / дрейф (код 3) | M-21, M-26 | `evidence/migrations/tenants-status.txt` |
| `cli-roles` | `migrate roles ensure` | `PG_SUPER_URL` (dev) | 14-eng `:81` | роли созданы / уже есть (идемпотентно) / нет прав (код 4) | M-09, M-27 | `evidence/migrations/roles.txt` |

## 6. Тесты первыми

### (а) Скелет (первый коммит `test(migrate): скелет сюиты WS-41`) — зеркало e2e-скелета для backend (мастер-план §8.1: «первый коммит: тесты с `t.Skip`, снимаются по одному»)

Один `func Test…` на пункт, тело — `t.Skip("WS-41 skeleton M-NN · снимается в шаге §7.N")`, комментарий над функцией — Given/When/Then дословно. Файлы: `lint_test.go`, `mirror_test.go`, `plan_test.go` (без тега — unit), `runner_test.go`, `roles_test.go`, `invariants_test.go`, `controller_test.go`, `cli_test.go` (`//go:build integration`). Все тесты с БД — `t.Parallel()`, своя БД из `t.Name()` (префикс `TestWS41…`, 12 §8 п.7), без `TRUNCATE`.

| # | Тест (`func`) | Given | When | Then |
|---|---|---|---|---|
| M-01 | `TestWS41LintNumberingContiguous` | `DefaultSource()` | `Lint` | control = {1,2,3}, tenant = {1,2,3}; нет пропусков и дублей версий; имена `^\d{4}_[a-z0-9_]+\.sql$` |
| M-02 | `TestWS41LintGooseMarkers` | каждый файл | `Lint` | содержит ровно один `-- +goose Up` и один `-- +goose Down`; `Down` непустой; нет `-- +goose NO TRANSACTION` |
| M-03 | `TestWS41LintTenantSchemaQualified` | tenant-файлы | регулярка по `create (table\|index\|unique index\|view\|type)` и `alter table` | каждый объект с префиксом одной из схем `core, org, people, access, modules, files, sched, audit, outbox, fleet, finance` (`tenant_0001_core.sql:8–16`; `tenant_0002_fleet.sql:4–5`); ни одного объекта в `public` |
| M-04 | `TestWS41LintGapMigrationExpandOnly` | `tenant/0003_prototype_gaps.sql`, секция `Up` | поиск `drop table`, `drop column`, `alter column .* type`, `set not null`, `rename` | ни одного совпадения (expand/contract, `02-architecture.md:56`); в `Down` они допустимы |
| M-05 | `TestWS41MirrorDesignSQL` | пары `migrations/control/000N_*.sql` ↔ `design/docs/db/control_000N_*.sql`, `tenant/0001,0002` ↔ `tenant_0001_core.sql`, `tenant_0002_fleet.sql` | взять тело между `-- +goose Up` и `-- +goose Down`, нормализовать (CRLF→LF, хвостовые пробелы, один `\n`) | равно нормализованному файлу дизайна байт-в-байт; при расхождении вывод `diff` первой отличающейся строки |
| M-06 | `TestWS41DraftsNotEmbedded` | `tenant/drafts/README.md` и временный `tenant/drafts/9999_x.sql` в тесте через `fstest.MapFS` + реальный `migrations.Tenant` | `fs.Glob(migrations.Tenant, "drafts/*")` | пусто; `Lint` реального источника не видит `9999` |
| M-07 | `TestWS41PlanPhases` | 12 тенантов (`created_at` по возрастанию), `Plan{CanarySlugs:["alta"], BatchSize:5}`, у двух `schema_version = Target`, у одного `> Target` | `plan(refs, p)` (чистая функция) | фазы: `canary:[alta]`, `batch1:[5]`, `batch2:[4]`; два тенанта в `Skipped`, один в `Failed` с `ErrVersionAhead`; порядок детерминирован (`created_at, id`) |
| M-08 | `TestWS41PlanDefaultCanary` | `CanarySlugs` пуст, 3 тенанта | `plan` | canary = первый по `created_at`; `BatchSize` 0 → 10 |
| M-09 | `TestWS41RolesEnsureIdempotent` | кластер testcontainers, суперпользователь | `EnsureRoles` дважды | в `pg_roles` есть `ortus_migrator` (`rolsuper=false, rolcreatedb=false, rolcanlogin=true`), `ortus_api`, `ortus_worker`, `ortus_provisioner` (`rolcreatedb=true`); второй вызов без ошибки, роли не пересозданы (`oid` те же) |
| M-10 | `TestWS41ControlUpDownUp` | пустая БД `owner ortus_migrator`, соединение ролью `ortus_migrator` | `Up` → `SchemaSnapshot` S1 → `DownTo(0)` → S0 → `Up` → S2 | `Version` = 3; S1 = S2; S0 содержит только `goose_db_version`; `pg_extension` содержит `btree_gist` после up и не содержит после down |
| M-11 | `TestWS41TenantUpDownUp` | то же для `migrations.Tenant` | `Up`/`DownTo(0)`/`Up` | `Version` = 3; 11 схем (`core…outbox` + `fleet, finance`), 36 + 1 таблиц (36 — `10-data-model.md:9`, + `fleet.trip_reviews`); снимки равны; down удаляет все схемы и `btree_gist` |
| M-12 | `TestWS41TwoTenantsDifferentVersions` | tenant A — пустая; tenant B — `UpTo(2)` заранее | `Controller.Rollout(Plan{Target:3})` | обе на 3; `SchemaSnapshot(A) == SchemaSnapshot(B)`; `Report.Done` = [A, B] (мастер-план §5.4 WS-41: «up/down каждой миграции на двух tenant DB разных версий») |
| M-13 | `TestWS41RolloutUpdatesRoutingAndAudit` | 1 тенант, `schema_version 0` | `Rollout` | `tenant_routing.schema_version = 3`, `updated_at` обновлён; в `platform_audit` одна строка `action='tenant.schema.migrate', result='ok', request_id=Report.RunID, details->>'from'='0', 'to'='3'` |
| M-14 | `TestWS41RolloutEnsuresIdentity` | тенант без строки `core.tenant_identity` (свежая БД) | `Rollout` | после 0001 строка `(tenant_id, sentinel)` = значениям из `tenant_routing`; повторный `Rollout` → `Skipped`, строка не задвоена (`singleton` PK, `tenant_0001_core.sql:19–24`) |
| M-15 | `TestWS41RolloutSentinelMismatch` | тенант на версии 3 с `core.tenant_identity.sentinel ≠ tenant_routing.sentinel`, цель 3 (no-op) и цель с фиктивной 4-й миграцией в `fstest.MapFS` | `Rollout` | `Failed` с `errors.Is(err, ErrSentinelMismatch)`; версия БД не изменилась; `platform_audit.result='failed'`, `details->>'error'` содержит `sentinel` |
| M-16 | `TestWS41CanaryFailureStopsBatches` | 3 тенанта; источник с фиктивной миграцией 0004, падающей (`select 1/0`) только у canary (через `Connector`-обёртку, подменяющую fsys для canary) | `Rollout{CanarySlugs:[canary], BatchSize:1}` | `errors.Is(err, ErrCanaryFailed)`; у canary версия осталась 3 (goose транзакция откатилась); у двух остальных `schema_version` и `goose_db_version` не изменились, соединения с ними не открывались (счётчик `Connector.Open` = 1); `platform_audit` содержит одну строку `failed` |
| M-17 | `TestWS41BatchFailureStopOnFailure` | 1 canary ок + 4 тенанта в партиях по 2, падает второй тенант партии 1 | `Rollout{StopOnFailure:true}` | партия 1: один `Done`, один `Failed`; партия 2 не стартовала (`Open` не вызван для её тенантов); с `StopOnFailure:false` — партия 2 выполнена |
| M-18 | `TestWS41RolloutIdempotentAndSkips` | все тенанты на цели | `Rollout` дважды | `Done` пуст, `Skipped` = все; `platform_audit` строк не добавилось; `updated_at` не изменился |
| M-19 | `TestWS41GapMigrationDownWithData` | tenant на 3, вставлена бронь с `source_type null` (разрешено 0003) | `DownTo(2)` | ошибка (`set not null` на данных с `null`, SQLSTATE `23502`); версия осталась 3; после `delete` строки `DownTo(2)` проходит и `reservations_source_pair_chk` исчезает из снимка |
| M-20 | `TestWS41DryRunTouchesNothing` | 2 тенанта на 0 | `Rollout{DryRun:true}` | `Report.Phases` заполнены с `From 0 / To 3`; `Connector.Open` = 0; `schema_version` = 0; `platform_audit` пуст |
| M-21 | `TestWS41StatusDetectsDrift` | тенант мигрирован раннером напрямую (`UpTo(3)`), `tenant_routing.schema_version` = 2 | `Status` | `Actual=3, SchemaVersion=2, Drift=true`; `Rollout{Target:3}` на нём → `Failed` с `ErrSchemaDrift` (routing не «догоняется» молча) |
| M-22 | `TestWS41ConcurrentRolloutsSerialize` | 1 тенант на 0; два `Controller` с разными `RunID` | `Rollout` в двух горутинах одновременно | ровно один `Done`, другой `Skipped` (или `ErrRoutingRace` без изменений); `goose_db_version` без дублей; в `platform_audit` ровно одна строка `ok` для `to=3` (goose session lock + условный `update … where schema_version = $from`) |
| M-23 | `TestWS41ApiRuntimeHasNoDDL` | tenant на 3, гранты применены; соединение ролью `ortus_api` | `create table fleet.x(id int)` / `create schema x` / `create extension pg_trgm` / `alter table fleet.vehicles add column y int` / `drop table fleet.defects` | все пять → SQLSTATE `42501` (`permission denied`); `insert into org.units(kind,name,time_zone) values ('region','Москва','Europe/Moscow')` → ок; `select count(*) from goose_db_version` → ок (чтение) ; `insert into goose_db_version …` → `42501` |
| M-24 | `TestWS41MigrationsRunAsMigratorNotSuper` | соединение ролью `ortus_migrator` (не superuser) | `Up` control и tenant (включая `create extension btree_gist` — trusted extension, PostgreSQL ≥ 13) | успех; тот же `Up` под `ortus_api` → `ErrNotMigrator` до первого SQL |
| M-25 | `TestWS41ProvisionerCanOnlyCreateDB` | роль `ortus_provisioner` | `create database t_probe owner ortus_migrator` → ок; `connect` к tenant DB → `42501`/`3D000`-класс отказа после `revoke connect … from public` | провизионер не читает данных тенанта |
| M-26 | `TestWS41CLIExitCodes` | `run(args, env, …)` против кластера | `control up`; `tenants up --dry-run`; `tenants up` при падающем canary (как M-16); `tenants status --fail-on-drift` при дрейфе; неверный `CONTROL_DB_URL`; `tenants up` под `ortus_api` | коды 0; 0; 2; 3; 4; 5; stdout `status` содержит заголовок `slug  database  routing  actual  drift` и строку тенанта |
| M-27 | `TestWS41CLILogsRedactSecrets` | `CONTROL_DB_URL` с паролем `s3cr3t-pass` | любой вызов `run` с `--log-level debug` | stdout/stderr не содержат `s3cr3t-pass`; содержат `run_id`, `tenant_id`, `from`, `to` |
| M-28 | `TestWS41SchemaInvariantsPG` (табличный, строки I-… ниже) | tenant на 3 и control на 3, соединение `ortus_api` | каждая строка таблицы §6 (г) | ожидаемый SQLSTATE / имя ограничения / число строк |
| M-29 | `TestWS41ImageParametrized` | `PG_TEST_IMAGE=postgres:16.4` (запуск вручную и в CI-матрице) | весь пакет | зелёный; `select version()` в отчёте содержит `16.4`; при `postgres:17` — `17.` (D-38; R15; DP-14) |
| M-30 | `TestWS41UpAllForHarness` | пустые control и 2 tenant DB | `UpAll(ctx, control, a, b)` | все три на последних версиях; повторный вызов — no-op; ошибка на одной tenant DB возвращается с `database_name` в тексте |

Итого скелет: **30 пунктов** (M-01…M-30). Снимаются по одному в порядке §7; `t.Skip` без ссылки на `decisions.md` в финальном коде не остаётся (`tdd-protocol.md` §1).

### (б) Unit (без БД, `go test ./internal/platform/migrate/...`)

- `Lint` L1–L7: L1 нумерация (M-01); L2 маркеры goose (M-02); L3 префикс схемы tenant (M-03); L4 expand-only для `000[3-9]`/`00[1-9]\d` tenant (M-04); L5 зеркало дизайна (M-05); L6 drafts не встроены (M-06); L7 control-файлы не создают схем кроме `public` (регулярка `create schema`) — табличные кейсы: валидный источник → `[]`; фикстуры `fstest.MapFS` с пропуском версии `0001,0003` → `LintError{Rule:"L1"}`; `create table x` в tenant → `L3`; `drop column` в 0003 → `L4`; изменённый байт в копии → `L5`.
- `plan`: M-07, M-08 + кейсы «все на цели» → только `Skipped`; «BatchSize > N» → одна партия; «тенант без строки routing» → не попадает в план (join), в `Status` отмечен как `no-routing`.
- `redact(dsn)` → `postgres://ortus_migrator:***@host/db`; `parseArgs` CLI: `--canary a,b` → `[a b]`, `--to` не число → код 4.

### (в) Компонентные — не применимо (UI нет); аналог — `cli_test.go` (M-26, M-27) через `run()` с перехватом stdout/stderr.

### (г) Интеграционные (`//go:build integration`, testcontainers `postgres:17` / `PG_TEST_IMAGE`)

Табличный `TestWS41SchemaInvariantsPG` (M-28) — построчное зеркало `10-data-model.md:11–22` и БД-уровневых инвариантов 09 §6; каждая строка — отдельный `t.Run` с `t.Parallel()` на своей tenant/control DB:

| Строка | Given/When | Then (SQLSTATE / ограничение) | Источник |
|---|---|---|---|
| I-01a | две брони одной `resource_id`, `occupied` `[10:00,12:00)` и `[11:00,13:00)`, `state='confirmed'` | вторая — `23P01`, `constraint = reservations_no_overlap` | `10:13`; `tenant_0001_core.sql:250–252` |
| I-01b | смежные `[10,12)` и `[12,14)` | обе приняты | `10:14` |
| I-01c | `state='hold'`, `hold_expires_at null` | `23514` (CHECK `:249`) | `10:15` |
| I-01d | первая `released`, вторая пересекающаяся `confirmed` | принята | `10:16` |
| I-01e | `occupied` не содержит `during` | `23514` (`check (occupied @> during)` `:248`) | 09 I-01 |
| I-04a | машина `v` в рейсе `inspection`, второй рейс той же машины `inspection` | `23505`, индекс `trips_active_vehicle_uq` | `10:17`; `tenant_0002_fleet.sql:57–58` |
| I-04b | водитель в двух рейсах `on_route` (с машинами и `started_at`) | `23505`, `trips_active_driver_uq` | `:59–60` |
| I-05 | `update fleet.trips set state='on_route'` без `vehicle_id`/`started_at` | `23514` | `10:18`; `:54` |
| I-12 | `insert access.role_versions … actions = '{"*"}'` | `23514` | `10:19`; `tenant_0001_core.sql:129` |
| I-13a/b | `scope_kind='unit', scope_ref null`; `scope_kind='tenant', scope_ref = uuid` | `23514` оба | `:164` |
| I-30 | две функции `driver` одного `person_id` с пересекающимся `valid` | `23P01` EXCLUDE | `10:20`; `:105` |
| I-29a/b | `fleet.expenses.amount_minor = 0`; `category='fuel', liters null` | `23514` оба | `10:21`; `tenant_0002_fleet.sql:145,158` |
| I-16 | `files.usage limit_bytes = 1000, committed 900`; два `update … reserved_bytes + 200 where … <= limit + activity_reserve returning *` | первый 1 строка, второй 0 строк | `10:22`; `tenant_0001_core.sql:201–212` |
| I-18 | `core.idempotency_keys.key` длиной 7 и 129 | `23514` оба; длина 8 и 128 — ок | `:30` |
| I-24 | control: две `subscription_change_requests` `status='pending'` одного `tenant_id` | `23505`, `scr_one_pending_uq` | `control_0002:70` |
| I-25 | control: две `price_book_versions` с пересекающимся `effective` | `23P01` EXCLUDE | `control_0002:16` |
| I-26 | control: `platform_operators` с `role='owner', status='invited'`; `status='disabled'` без `disabled_at` | `23514` оба | `control_0001:127–128` |
| I-27 | control: `support_grants` `valid` 61 мин без `break_glass`; `approved_by null` без `break_glass`; `actions` с `fleet.earnings.read` | `23514` × 3 | `control_0001:143–145` |
| I-28c | control: `tenant_branding_versions.accent_hex = '#GGGGGG'`; `display_name` из 61 символа | `23514` оба | `control_0003:10–13` |
| G-01 | 0003: `fleet.trip_reviews.steps = '{photos,nope}'` → `23514`; `decision='maybe'` → `23514`; `steps='{photos,odo}'` → ок | | §4.1 п.3 |
| G-02 | 0003: `sched.reservations` c `source_type null, source_id = uuid` → `23514`; оба `null` → ок | | §4.1 п.3; DP-13 |

Изоляция/конкурентность (`tdd-protocol.md` §2 шаг 5) в объёме WS-41: M-22 (два контроллера), M-16/M-17 (частичный отказ rollout), M-25 (провизионер не читает tenant DB). Матрица «актор × объект × 200/403/404» и `scopeQuery` — WS-42, не здесь. `Problem.code` у WS-41 нет (HTTP отсутствует); покрытие каждого экспортируемого `Err*` ≥ 1 тестом: `ErrSentinelMismatch` M-15, `ErrCanaryFailed` M-16, `ErrVersionAhead` M-07, `ErrSchemaDrift` M-21, `ErrRoutingRace` M-22, `ErrNotMigrator` M-24, `ErrSentinelMissing` — кейс в M-15 (строка удалена при версии 3 → `ErrSentinelMissing`).

## 7. Шаги реализации (TDD-циклы; коммиты `test(migrate): …` → `feat(migrate): …` → `refactor(migrate): …`)

| № | Единица | Красный тест | Реализация (минимум) | Рефакторинг | Оценка |
|---|---|---|---|---|---|
| 0 | Зависимости и каркас | — | `chore(deps): goose v3, testcontainers-go + modules/postgres, pgx/v5 (+stdlib), testify, goleak` с пином; пустые пакеты `migrations`, `migrate`, `migratetest`, `cmd/migrate` | — | 0,5 ч |
| 1 | Скелет §6 (а) | 30 функций с `t.Skip`, Given/When/Then в комментариях; `goleak.VerifyTestMain` в `TestMain` интеграционных файлов | коммит `test(migrate): скелет сюиты WS-41 (M-01…M-30)` | — | 1 ч |
| 2 | `Source` + `Lint` L1, L2, L7 | снять M-01, M-02 — красные благодаря стабу `Lint`, возвращающему `[]LintError{{Rule: "stub"}}` (падение на утверждении `Empty`, не на импорте) | `embed.go`; файлы `control/0001–0003`, `tenant/0001–0002` с `Up` = копия дизайна + `Down`; `lint.go` L1/L2/L7 | вынести регулярки на уровень пакета (`golang-code-style`) | 2 ч |
| 3 | Зеркало дизайна | M-05 (красный, пока `Down`-секция случайно попала в сравнение / CRLF) | `normalize()`, чтение `design/docs/db` через `runtime.Caller` вверх до корня репозитория (12 §3.2 R12) | — | 1 ч |
| 4 | L3, L4, L6 | M-03, M-04, M-06 | правила; `drafts/README.md` | таблица правил `[]rule{name, apply}` | 1 ч |
| 5 | `tenant/0003_prototype_gaps.sql` | M-04 (expand-only на новом файле), G-01/G-02 из M-28 (красные: таблиц/колонок нет) | DDL §4.1 п.3 + `Down` | — | 1,5 ч |
| 6 | `migratetest.NewCluster` | M-09 (красный: ролей нет) | testcontainers `postgres.Run(ctx, image, …)`, `WithWaitStrategy(wait.ForLog("database system is ready to accept connections").WithOccurrence(2))`; `PG_TEST_URL` override; сообщение об отсутствии Docker (не skip) | `t.Cleanup` на `Terminate`, один контейнер на пакет (`TestMain`) | 2 ч |
| 7 | Роли | M-09, M-24 (вторая половина), M-25 | `roles/roles.sql`, `EnsureRoles`, проверка `current_user` → `ErrNotMigrator` | — | 1,5 ч |
| 8 | `Runner` | M-10, M-11, M-30 | `goose.NewProvider` на `*sql.DB` (`pgx/v5/stdlib`), `WithSessionLocker`; `SchemaSnapshot` | — | 2 ч |
| 9 | Гранты | M-23 | `grants_control.sql`, `grants_tenant.sql`; `GrantControl/GrantTenant` после `Up` (список схем из `pg_namespace`, не захардкожен) | — | 1,5 ч |
| 10 | `plan` (чистая) | M-07, M-08 | `plan.go` | — | 1 ч |
| 11 | `Controller.Rollout` happy-path | M-12, M-13, M-14, M-18, M-20 | чтение routing, `Connector`, `ensureIdentity`, условный `update`, `platform_audit`, `DryRun` | выделить `migrateOne(ctx, ref) TenantResult` | 3 ч |
| 12 | Отказы | M-15 (+`ErrSentinelMissing`), M-16, M-17, M-19, M-21 | типизированные ошибки, фазы со `StopOnFailure`, `Status`/дрейф | `errors.go` с `var Err…` и `type CanaryError{Tenant}` | 2,5 ч |
| 13 | Конкурентность | M-22 | условный `update … where schema_version = $from` → `ErrRoutingRace`; session lock goose | — | 1 ч |
| 14 | Инварианты схемы | M-28 (все строки) | только тесты (схема уже есть); при падении строки — это дефект копии, не «подгонка» теста (`tdd-protocol.md` §1) | фикстурные вставки минимальных строк (`org.units`, `sched.resources`, `fleet.vehicles`) в helper `seedMinimal(t, db)` | 2,5 ч |
| 15 | CLI | M-26, M-27 | `run()`, подкоманды, коды выхода, `slog` JSON, `redact` | — | 2 ч |
| 16 | Образ 16.4 | M-29 | запуск `$env:PG_TEST_IMAGE="postgres:16.4"; go -C backend test -tags integration -count=1 ./internal/platform/migrate/...`; вывод в evidence | — | 0,5 ч |
| 17 | Линт, README, отчёт | — | `golangci-lint run ./...` (build-tags), `README.md` CLI, `docs/plan/reports/WS-41.md`, строка `status.md` | — | 1,5 ч |

Итого ≈ 28 ч ≈ 2–3 сессии (M). Запрещено: писать `feat` до красного теста; менять копию дизайна для прохождения теста (только новая миграция); `t.Skip` вне скелета.

Шаблон файла скелета и `TestMain` (шаг 1; `golang-testing`: build tag, `goleak`, `t.Parallel()`):

```go
//go:build integration

package migrate_test

import (
	"testing"

	"go.uber.org/goleak"

	"github.com/ortus/ortus-crm/backend/internal/platform/migrate/migratetest"
)

var cluster *migratetest.Cluster

func TestMain(m *testing.M) {
	// Один контейнер postgres на пакет; без Docker — падение с подсказкой, не skip (12 §6 п.11).
	cluster = migratetest.MustCluster()
	defer cluster.Terminate()
	goleak.VerifyTestMain(m)
}

// M-12 · Given tenant A — пустая БД, tenant B — заранее UpTo(2);
// When Controller.Rollout(Plan{Target: 3});
// Then обе на 3, SchemaSnapshot(A) == SchemaSnapshot(B), Report.Done = [A, B].
func TestWS41TwoTenantsDifferentVersions(t *testing.T) {
	t.Parallel()
	t.Skip("WS-41 skeleton M-12 · снимается в шаге §7.11")
}
```

Правило снятия `t.Skip`: удалить строку `t.Skip`, запустить `go -C backend test -tags integration -run TestWS41TwoTenantsDifferentVersions ./internal/platform/migrate/...`, убедиться, что падение — на `require`/`assert` (не компиляция, не panic), коммит `test(migrate): M-12 два тенанта разных версий (red)`; затем минимальный `feat(migrate): …` до зелёного; при необходимости `refactor(migrate): …`. Коммиты одной единицы не смешиваются с другой (`tdd-protocol.md` §1 п.4).

Фикстуры `migratetest` для M-28 (`seedMinimal`): `org.units` (`kind='company'`, `name='Север Логистик'`, `time_zone='Europe/Moscow'`), `people.person_profiles` (`full_name='Илья Васильев'`, `home_unit_id`), `fleet.vehicles` (`plate='А 412 МР 77'`, `body_type='tent'`, `payload_kg=1500`, `volume_m3=16`, `cargo_length_mm=4200` — ГАЗель Next из сида, `mock-data.js:180–188`), `sched.resources` (`kind='vehicle'`, `ref_id` = машина), `fleet.trips` (`number='TR-2026-000208'`, `state='planned'`, `planned=[2026-10-01 09:00+03, 13:00+03)`), `files.usage` (`limit_bytes`, `committed_bytes` по строке I-16). Идентификаторы — UUID v5 от `ortus:<tenant>:<prototype-id>` (D-30) через локальный helper, чтобы WS-52 мог переиспользовать значения.

## 8. Проверка WS (вместо «Проверка страницы»)

Страниц нет → `verification-protocol.md` §1 (Playwright), §3 (визуальная сверка), §4 (MCP) не применяются; проверяющих страниц workflow не запускает (`pages: []`). Обязательные проверки до ревью — §5 (два ревьюера) и §6 (CI). Команды и evidence:

1. Unit: `go -C backend test ./internal/platform/migrate/... ./cmd/migrate/...` → `docs/plan/evidence/migrations/unit.txt`.
2. Integration на 17: `go -C backend test -tags integration -count=1 -race ./internal/platform/migrate/... ./cmd/migrate/...` (Docker Desktop запущен) → `evidence/migrations/integration-17.txt` (последние 40 строк — также в отчёт, `orchestration.md` §5).
3. Integration на 16.4: `$env:PG_TEST_IMAGE = "postgres:16.4"; go -C backend test -tags integration -count=1 ./internal/platform/migrate/...` → `evidence/migrations/integration-16.4.txt`.
4. Стенд WS-02 (ручная проходка — аналог MCP-проходки для backend; каждый шаг → выдержка в evidence):

   ```powershell
   docker compose -f deploy\compose\docker-compose.yml --profile dev up -d --wait postgres
   $env:PG_SUPER_URL = "postgres://ortus_admin:change-me-local@127.0.0.1:5432/ortus_control?sslmode=disable"
   $env:PG_MIGRATOR_PASS = "migrator-local"; $env:PG_API_PASS = "api-local"; $env:PG_WORKER_PASS = "worker-local"; $env:PG_PROVISIONER_PASS = "prov-local"
   go -C backend run ./cmd/migrate roles ensure                      # → evidence/migrations/roles.txt
   $env:CONTROL_DB_URL = "postgres://ortus_migrator:migrator-local@127.0.0.1:5432/ortus_control?sslmode=disable"
   go -C backend run ./cmd/migrate control up                        # → control-status.txt (после `control status`)
   # две tenant DB и строки реестра — временно руками (провизионер — WS-56):
   psql $env:PG_SUPER_URL -c "create database t_alta owner ortus_migrator; create database t_lotos owner ortus_migrator;"
   psql $env:CONTROL_DB_URL -c "insert into tenants(slug,display_name,industry_pack,state) values ('alta','Альта Групп','logistics','trial'),('lotos','SPA «Лотос»','spa','active');"
   psql $env:CONTROL_DB_URL -c "insert into tenant_routing(tenant_id,cluster_ref,database_name,secret_ref,sentinel) select id,'local','t_'||slug,'env:PG_MIGRATOR',gen_random_uuid() from tenants;"
   $env:TENANT_DB_HOST = "127.0.0.1:5432"
   go -C backend run ./cmd/migrate tenants up --dry-run              # → tenants-plan.txt (фазы: canary alta, партия lotos)
   go -C backend run ./cmd/migrate tenants up --canary alta --batch 1 # → tenants-rollout-17.txt
   go -C backend run ./cmd/migrate tenants status                    # → tenants-status.txt
   psql $env:CONTROL_DB_URL -c "select action,target_type,result,details from platform_audit order by id;"   # две строки ok
   psql "postgres://ortus_api:api-local@127.0.0.1:5432/t_alta?sslmode=disable" -c "create table fleet.x(id int);"  # ожидание: permission denied
   ```

   Ожидаемый `tenants status`: две строки `routing 3  actual 3  drift false`; ожидаемый `platform_audit`: `tenant.schema.migrate | tenant | ok | {"database":"t_alta","from":0,"to":3}` и то же для `t_lotos`; ожидаемый последний `psql`: `ERROR:  permission denied for schema fleet` (SQLSTATE 42501).
5. `golangci-lint run ./...` из `backend/` (с `build-tags`), `gofmt`, `go vet` → в отчёт.
6. Сверка с эталоном для backend: таблица M-28 полностью зелёная на 17 и 16.4 = «таблица `10-data-model.md:11–22` воспроизведена».

Отчёт `docs/plan/reports/WS-41.md` по `orchestration.md` §5; раздел «Проверка MCP» содержит «не применимо: `pages: []`, evidence — `docs/plan/evidence/migrations/`».

## 9. Критерии готовности (DoD)

- [ ] Первый коммит ветки начинается с `test(` (12 §6 п.21); все 30 функций M-01…M-30 существуют и зелёные, `t.Skip` нет.
- [ ] `go test ./...` (unit) и `go test -tags integration -race` зелёные локально на `postgres:17` и на `postgres:16.4`; вывод в отчёте дословно (`tdd-protocol.md` §5).
- [ ] `golangci-lint run` exit 0 с `run.build-tags: [integration, isolation, concurrency]` (12 §6 п.13); `gofmt`/`goimports` чисто; `depguard` не нарушен (пакет `migrate` импортирует только stdlib, goose, pgx, testify/testcontainers в тестах).
- [ ] Тела `Up` пяти миграций байт-в-байт равны `design/docs/db/*.sql` (M-05); `design/` не изменён (`git status design/` пуст).
- [ ] `tenant/0003` — только expand (M-04); содержимое ровно по §4.11 (список полей) — ничего сверх.
- [ ] Миграции применяются ролью `ortus_migrator`, не superuser (M-24); `ortus_api` без DDL (M-23); `ortus_provisioner` только `CREATEDB` (M-25).
- [ ] Контроллер: canary → партии, отказ canary останавливает партии (M-16), `schema_version` и `platform_audit` обновляются (M-13), sentinel сверяется (M-15), дрейф обнаруживается (M-21), повтор идемпотентен (M-18), параллельные запуски сериализуются (M-22).
- [ ] `cmd/migrate` коды выхода 0/2/3/4/5 (M-26); секреты не в логах (M-27); `README.md` с переменными §4.1 п.6.
- [ ] Таблица инвариантов M-28 (22 строки) зелёная — все 12 сценариев `10-data-model.md:11–22` воспроизведены на 17.
- [ ] Покрытие пакета `migrate` ≥ 90 % строк (`tdd-protocol.md` §4 — платформенный пакет приравнен к `authz`), `go test -cover` в отчёте.
- [ ] Отчёт `docs/plan/reports/WS-41.md`: таблица «Тест | Слой | Коммит red | Коммит green» на все 30 пунктов; раздел «Контракты, которые я изменил» перечисляет `go.mod`, запросы к интегратору на `Makefile migrate`, `.env.example`, CI-матрицу 16.4/17, `harness.go` → `UpAll`.
- [ ] Строка WS-41 в `docs/plan/status.md` → «готово» со ссылками на отчёт и `evidence/migrations/`.
- [ ] Два ревью `approve` (второй — миграции/роли: expand/contract, гранты, отсутствие DDL у API, сверка `Down`).

## 10. Риски, расхождения, открытые вопросы (поведение по умолчанию)

| # | Вопрос / расхождение | Источники | По умолчанию в WS-41 |
|---|---|---|---|
| Р-1 | Харнесс WS-07 применяет `migrations/control/*.up.sql` и `migrations/tenant/*.up.sql` лексикографически (12 §6 п.12, формат 2.0), а goose хранит `Up`/`Down` в одном файле `NNNN_slug.sql` | 12 §3.2 R4; 12 §3.3 п.10; D-06 | Формат goose (D-06); WS-41 публикует `migrate.UpAll`; интегратор на барьере 1→2 меняет `backend/test/harness.go` `TestMain` на `UpAll` (одна строка); до этого харнесс WS-07 и пакет `migrate` не пересекаются |
| Р-2 | `golang-database` п.12/14: «миграции внешним инструментом», «не создавать схемы» | 12 §4.9; Q-104 | SQL дизайна — авторский вход (копия байт-в-байт); 0003 — по `10-data-model.md`/09 §7 с обязательным вторым ревьюером (CODEOWNERS `migrations/**`) |
| Р-3 | `source_type` для «Перерыва»/«ТО»: nullable или новые значения | DP-13; Q-80; §4.11 | nullable пара с CHECK (§4.1 п.3); значения `sched.block`/`fleet.maintenance` допустимы без миграции (`text` без CHECK) — WS-63 решит при переносе календаря |
| Р-4 | Имя колонки `steps` vs `sections` для разделов возврата смены | 09 §7.1; мастер-план §4.1 (`TripReview.steps[]`) | `steps` (как в контракте 0.2) |
| Р-5 | Поля Q-90 вне списка §4.11: «тип второго фактора оператора» (control), `cargo.kind` рейса (09 §7.2) | Q-90; §4.11 | не в WS-41: MFA-тип → control 0005 (WS-67), `cargo_kind` → tenant 0006 (WS-47); записать в отчёт как передачу |
| Р-6 | Кто вставляет `core.tenant_identity`: provisioner (S1-01) или контроллер | `tenant_0001_core.sql:18`; `13-backlog:46`; `02-architecture.md:52` | контроллер `ensureIdentity` после 0001 из `tenant_routing` (M-14); WS-56 регистрирует routing до вызова контроллера; при наличии строки с другим sentinel — отказ |
| Р-7 | Гранты `worker_runtime` не специфицированы | 14-eng `:81` | тот же DML, что `ortus_api` (control: `public`; tenant: все схемы); сужение — при появлении worker (WS-45) |
| Р-8 | Отдельная роль чтения `finance.*` | `tenant_0002_fleet.sql:5` «позже» | не создаётся; `ortus_api` читает `finance.earnings` — защита AC-05 на уровне `authz`/репозитория (WS-42/48) |
| Р-9 | `create extension btree_gist` в managed PostgreSQL (D-05) | `10:7`; 09 §10 п.2 | локально/CI — trusted extension от владельца БД (`ortus_migrator`); проверка у провайдера — вне WS, отметить в отчёте |
| Р-10 | PostgreSQL 17 vs 16.4 | DP-14; D-38; R15 | по умолчанию 17 (`PG_TEST_IMAGE`), прогон на 16.4 обязателен (M-29); CI-матрица — запрос интегратору (WS-01 владеет CI) |
| Р-11 | `go.mod`, `Makefile`, `.env.example`, CI — чужие файлы | мастер-план §3.3; `orchestration.md` §7 | `go.mod` — отдельный первый коммит с пином, явно в отчёте; остальное — запросы интегратору с готовыми строками (команда `migrate`, 5 переменных, матрица, одна строка в `harness.go`) |
| Р-12 | Docker API из Go на Windows (testcontainers) | Q-107; 12 §7 п.9 | Docker Desktop обязателен; альтернатива — `PG_TEST_URL` на compose `postgres-test` 5433; без базы тесты падают с подсказкой, не skip |
| Р-13 | Control DB без реестра версии (только `goose_db_version`) | `control_0001:42` — реестр только для tenant | так и оставить; `cmd/migrate control status` печатает версию goose; `tenantctx` (WS-40) читает `schema_version` только для tenant |
| Р-14 | Down-миграции на непустых БД (0003 `set not null`) | `02-architecture.md:56` expand/contract | `Down` только для dev/тестов и canary-отката; на данных с `null` падает намеренно (M-19); документировано в README |
| Р-15 | Аудит миграций: `platform_audit.actor_id` null для `system` | `control_0001:151–152` (`actor_id` nullable) | писать `actor_kind='system'`, `actor_id null`, `request_id = RunID` (ULID) |
| Р-16 | Код ошибки для `trips_active_*_uq` (DP-10) | 09 §9 | WS-41 фиксирует только SQLSTATE `23505` и имя индекса (M-28 I-04); маппинг в `Problem.code` — WS-46/47 |

## 11. Промпт запуска (для `agent()` в `workflow.template.js`)

Ты — исполнитель WS-41 «migrations» (backend, волна 1, размер M, 2 ревьюера). Работай в worktree `..\ortus-ws-41` на ветке `ws/ws-41-migrations` от `main`. Прочитай полностью: бриф `docs/plan/ws/WS-41-migrations.md`, `docs/plan/tdd-protocol.md`, `docs/plan/verification-protocol.md` §5–§6, `docs/plan/orchestration.md` §1, §5, §7, мастер-план §3.3, §4.11, §5.4 (карточка WS-41), §8.1 (колонка backend), §8.3; все пять `design/docs/db/*.sql`, `design/docs/10-data-model.md`, 09 §3, §6, §7.1–7.2, §9 DP-10/13/14; `decisions.md` Q-80, Q-90, Q-99, Q-104, Q-106, Q-107, Q-110, Q-111.

Делай строго по брифу §7: коммит 0 — `chore(deps)` с пином; коммит 1 — `test(migrate): скелет сюиты WS-41 (M-01…M-30)` (все 30 функций с `t.Skip`, Given/When/Then в комментариях); дальше снимай `t.Skip` по одному: red (тест падает на утверждении, не на импорте) → green (минимум кода) → refactor, коммиты `test(migrate)/feat(migrate)/refactor(migrate)`. Тела `Up` миграций control 0001–0003 и tenant 0001–0002 — байт-в-байт копия файлов дизайна; `design/` не трогать. `tenant/0003` — ровно поля из §4.1 п.3, только expand. Миграции применяй ролью `ortus_migrator` через testcontainers `postgres:17`; прогони также с `PG_TEST_IMAGE=postgres:16.4`. Тесты с БД — `t.Parallel()`, БД из `t.Name()`, без `TRUNCATE`, без `t.Skip`; без Docker тесты падают с подсказкой. Не меняй файлы вне §2; `go.mod` — только отдельным первым коммитом; `Makefile`, `.env.example`, CI, `backend/test/harness.go` — не трогать, а описать нужные строки в отчёте.

Верни: отчёт `docs/plan/reports/WS-41.md` по `orchestration.md` §5 (таблица red/green на 30 пунктов; дословный вывод `go test ./...`, `go test -tags integration -race` на 17 и 16.4, `golangci-lint run`; раздел «Проверка MCP» = «не применимо, evidence — `docs/plan/evidence/migrations/`»; «Контракты, которые я изменил» с запросами интегратору), файлы evidence по §8, обновлённую строку `status.md`. Если заблокирован (Docker, go.mod) — опиши блокер в отчёте, не обходи.
