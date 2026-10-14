# Статус WS v2

Состояния: `не начат` · `в работе` · `на проверке` · `возвращён` · `готово` · `блокирован`. Исполнитель обновляет свою строку, интегратор — строку на выходе подволны. Карточки WS — `00-parallel-plan.md` §4.

| WS | Этап · подволна | Дорожка | Состояние | Ветка | Отчёт | Evidence | Примечание |
|---|---|---|---|---|---|---|---|
| W0.00 | 0 · 0a | И | готово | ws/W0.00 → main `6f2dcf8`, тег `stage-0-W0.00` | [reports/W0.00.md](reports/W0.00.md) | node --test docs/plan/scripts 37/37, renumber --check 0, lint, typecheck, test:repo 114/114, go test, golangci-lint — 0 | Префикс PD- (B-3). Ревью (раунд 2): одобрено, 5 minor (правки плана v2 §0 п.1, §3.6, §6, §8 ждут подтверждения человека; вердикт PD-49 «слот/полоса»; HTTP_ADDR проверяющего в stand; поведение контрактных WS, design-stage-0 по умолчанию и полос — описать; после W0.01 и W0.02 повторить renumber --check) |
| W0.01 | 0 · 0a | Ч | готово | ws/W0.01 → main `c4bee69`, тег `stage-0-W0.01` | [reports/W0.01.md](reports/W0.01.md) | node --test docs/adr 107/107, docs/plan/scripts 37/37, renumber --check 0, lint, typecheck, test:repo 114/114, go test, golangci-lint — 0 | ADR-0001 (URL-схема) принят; ADR-0002…0013 (D-01…D-12) — «предложено», ждут ответов владельца: B-2 (сначала D-05, D-08), B-4 (PD-53), B-5 (D-29…D-34), пересмотр Q — `questions-for-po.md`. Ревью (раунд 1): одобрено, 8 minor (значения Q-22/Q-04/Q-50 предложены W0.01, а не планом 27 — пометить; тест не проверяет «Нужно к»; docs/adr/*.test.mjs не в test:repo/CI → W0.04; Q-79 vs диапазон Q-72…Q-81; questions-for-po.md вне «Владеет»; search-параметры ADR-0001 предварительные; пути к файлам комплекта от корня; после W0.02 прогнать тест W0.01) |
| W0.03 | 0 · 0a | И | готово | ws/W0.03 → main `cfd1b78`, тег `stage-0-W0.03` | [reports/W0.03.md](reports/W0.03.md) | lint, typecheck, test 114/114, build, go vet — 0 | ★ первый. Ревью: одобрено, 6 minor (depguard vs 14-engineering:53 до первого backend-модуля; порты в CLAUDE.md vs §3.6; тест git status design/ в pre-push; pre-push без базы молча пропускает smoke; долгий test; check-icu без владельца → W0.04/W0.05) |
| W0.02 | 0 · 0b | И | не начат | — | — | — | полный эталон ждёт B-1 |
| W0.04 | 0 · 0b | И | готово, есть блокеры | ws/W0.04 → main `094c25f`, тег `stage-0-W0.04` | [reports/W0.04.md](reports/W0.04.md) | lint, typecheck, test (repo 114/114, ci 85/85, go test) — 0 | Блокер: нет git remote, workflow на GitHub не запускался, защиту main (7 обязательных job) настроить нельзя. Ревью: одобрено, 6 minor (e2e не включится сам после W0.05: скрипт в apps/web, а не в корне; Spectral ищет api/spectral.yaml, у W0.07 api/.spectral.yaml, нет lint:api/validate:api; тест dry-run упадёт в unit, если W0.09 раньше W0.15; отступления TDD; package.json/lock правил исполнитель; cancel-in-progress на main, e2e в режиме mock) |
| W0.05 | 0 · 0b | И | готово, есть блокеры | ws/W0.05 → main `8fffa6d`, тег `stage-0-W0.05` | [reports/W0.05.md](reports/W0.05.md) | lint, typecheck, test (repo, ci 85/85, tools/__tests__ 52/52, e2e-kit 57/57, go test), build — 0; e2e:harness (слот 9, E2E_OWN_REFERENCE=1) 20 passed / 2 skipped | Блокеры: H11 (фикстура app(?persona=)) — fixme до W0.09 (контракт: сборка --mode e2e, html[data-e2e-persona]); инструменты mcp__playwright__* появятся у агентов только после перезапуска сессии; Stop-хук verify-pages в .claude/settings.json и CI-job (allowlist-lint, test:tools, e2e:harness) не добавлены — интегратор/W0.04. Вопросы: локальные marked/js-yaml/mermaid для офлайн Документация.dc.html (по умолчанию нет); Stop-хук блокирует или напоминает (по умолчанию напоминает). При слиянии: test объединён (test:ci + test:tools), lock перегенерирован; правки tools/repo (pre-push --pass-with-no-tests, workspace.test.mjs) приняты интегратором. Ревью: одобрено, 7 minor (запись в tools/repo без согласования; ветка красная 13 коммитов; reuseExistingServer эталона для проверяющего на 4173 — давать свой порт или E2E_OWN_REFERENCE=1; H4 не проверяет появление «Загрузка»; самотест слабее §6(б) в H1/H9/H10; 204 на favicon без флагов; parseLine без явной ошибки на поле без «:») |
| W0.06 | 0 · 0b | И | готово | ws/W0.06 → main `9524000`, тег `stage-0-W0.06` | [reports/W0.06.md](reports/W0.06.md) | lint, typecheck, test (repo, ci 85/85, tools 52/52, stand 23/23, пакеты, go test), go test -tags integration (PostgreSQL 17.11 и 16.4, testcontainers), check-migrations (control 3, tenant 2), go mod tidy -diff — 0 | ★ Слияние без конфликтов. Интегратор в том же коммите: up/down/migrate/seed корневого package.json → `node deploy/compose/stand.mjs <цель>`, test:stand (входит в test), заглушки стенда убраны из backend-make.test.mjs, строка команд в CLAUDE.md. Стенд слота 0: в старом `.env` нет TENANT_DB_URL — `stand.mjs init --slot 0 --force` или строка вручную; после reseed secret_ref = env:TENANT_DB_URL (ortus_api), W0.09 берёт DSN оттуда через migrations.TenantDSN, MIGRATOR_DB_URL в рантайме не использовать. Записать в decisions.md (по умолчанию действуют): CONNECT отозван у PUBLIC (provisioner/мониторинг — явные гранты в W1.02); insert-only для platform_audit, audit.events, access.role_versions, fleet.checklist_versions, files.quota_ledger, outbox.events только для API (worker — UPDATE/DELETE); down только с --yes и запрещён при APP_ENV=prod\|production; MinIO из pgsty/* по digest (только локальный стенд, D-04/D-05); сдвиг портов 100 × slot, слот 0 — интегратор; PD-30 UUID v5 (NameSpaceURL, `ortus:<scope>:<id>`) — то же правило для W0.12; значения сида, которых нет в прототипе. Ревью (раунд 2, два ревьюера): одобрено, 13 minor (границы слов в маскировании без `=`/`:`; cmd/seed без редактора вывода; insert-only не покрывает price_book_versions и tenant_branding_versions — правило для владельцев таблиц; down-guard fail-open → allowlist в W1.02; runtime-роли пишут tenant_routing/tenant_identity — решить в W0.09/W1.02; бриф: ids_test.go vs data_test.go, ErrNotMigrator — только ortus_migrator, healthcheck MinIO; отступления TDD cfd810a, e121bd6/b0fb39a признаны) |
| W0.07 | 0 · 0b | К | не начат | — | — | — | ★ стюард |
| W0.10 | 0 · 0b | Ф | готово | ws/W0.10 → main `f5f01d0`, тег `stage-0-W0.10` | [reports/W0.10.md](reports/W0.10.md) | lint, typecheck, test (repo, tokens 54/54, ui 87/87, domain, go test), build, build.mjs --check, gen-barrel.mjs --check, fetch-fonts.mjs --verify — 0 | Блокеры исполнителя закрыты на main: проверка @stub в workspace.test.mjs ослаблена, tools/design-preview.js уже ESM (W0.05); MCP-проход не делался (визуальная сверка — скриптом Playwright). При слиянии: конфликт только в pnpm-lock.yaml — lock из main, перегенерирован install. Вопросы: эталон шести компонентов (витрина vs рендер CRM, PD-28); DataTable.mobile cards vs Q-41 и цвет счётчика Tabs — W1.21; лицензия Material Symbols — Apache 2.0, поправить формулировку PD-21; Field.unit vs TextInput.unit. Ревью: одобрено, 7 minor (рамки Banner по витрине, а не по LINE CRM; OWNERS vs карточки W1.20/W1.21/W1.23, каталог RoleEditor vs role-editor; слот брифа 9 вместо 5 по §8; gen-barrel в пакете vs tools/gen-barrel §3.5; Card: перекрытие ссылок в children, причина без aria-describedby, selected без aria-current; jsdom 29.1.1 вместо 30.1.2 из-за Node 22.19; после W0.02 перевести contract.test на design/ и удалить копию components.md) |
| W0.11 | 0 · 0b | Д | готово | ws/W0.11 → main `d8f656e`, тег `stage-0-W0.11` | [reports/W0.11.md](reports/W0.11.md) | install --frozen-lockfile, lint, typecheck, test (repo, domain vitest 226/226, покрытие строк 100 %, ветвей 98,63 %; go test) — 0 | PD-53 по умолчанию (can с объектом; гейты разделов через canAny — ждёт решения владельца, B-4); единый entryHas (PD-60) и прораб по id — по умолчанию, вопросы в отчёте. Ревью: одобрено, 6 minor (маркер `@stub Owner: W0.11` в domain/src/index.ts держится проверкой W0.03 — ослабить и убрать; parity.test без red-фазы, после W0.02 дополнить 14.10; clock.test проверяет env TZ, а не рантайм; «объект» в PD-53 vs 11 видов Scope — сверить для W1.04; vitest 4.1.11 тянет vite 8.3.4 — выровнять с W0.05/W0.09/W0.10; слот 10 в брифе vs 6 в §8) |
| W0.16 | 0 · 0b | Т | готово, есть блокеры | ws/W0.16 → main `3c05261`, тег `stage-0-W0.16` | [reports/W0.16.md](reports/W0.16.md) | lint, typecheck, test (domain 226/226, go test), node --test backend/test/load 194/194, check-k6 (Docker, smoke 2 итерации, 155 checks, http_req_failed 0) — 0 | Блокеры: вход сценариев на stage (dev-провайдер противоречит PD-18/Q-102/ADR-0004) — решение интегратора/техлида до W3.01, до него прогон W3.01 на stage заблокирован; корневые действия интегратора не сделаны — test:load в корневом test, CI-job check-k6 (W0.04), backend/test/load/results/ в .prettierignore. Вопросы: D-08 (заглушки A-01…A-18), A-22 (кто бронирует машину; по умолчанию водитель), A-23 (механизм dev-входа, W0.09/W1.03), A-24 (доля объёма 0,9), железо stage (D-05). Ревью (раунд 2): одобрено, 5 minor (shiftsPerHour занижен float-погрешностью, тест подогнан 13/70 вместо 14/71; devLoginAllowed пропускает имя без точек, напр. http://stage:8080; driverShift со своей бронью берёт пробег по умолчанию; нет повторного входа после 401 у менеджера и шумного владельца; check-k6 сверяет имена порогов, а не выражения) |
| W0.08 | 0 · 0c | К | не начат | — | — | — | |
| W0.09 | 0 · 0c | Б | не начат | — | — | — | ★ выход этапа 0 |
| W0.12 | 0 · 0c | Д | не начат | — | — | — | |
| W0.14 | 0 · 0c | Ф | не начат | — | — | — | |
| W0.15 | 0 · 0c | Т | не начат | — | — | — | |
| W0.13 | 0 · 0d | Д | не начат | — | — | — | |
| W1.00 | 1 · опер. | К + DoR | не начат | — | — | — | |
| W1.01 | 1 · 1a | Б | не начат | — | — | — | |
| W1.02 | 1 · 1a | Б | не начат | — | — | — | ★ 2 ревьюера |
| W1.03 | 1 · 1a | Б | не начат | — | — | — | |
| W1.20 | 1 · 1a | Ф | не начат | — | — | — | |
| W1.21 | 1 · 1a | Ф | не начат | — | — | — | |
| W1.04 | 1 · 1b | Б | не начат | — | — | — | ★ 2 ревьюера |
| W1.11 | 1 · 1b | Б | не начат | — | — | — | |
| W1.22 | 1 · 1b | Ф | не начат | — | — | — | no-reference до B-6 |
| W1.23 | 1 · 1b | Ф | не начат | — | — | — | |
| W1.25 | 1 · 1b | Ф | не начат | — | — | — | |
| W1.05 | 1 · 1c | Б | не начат | — | — | — | |
| W1.06 | 1 · 1c | Б | не начат | — | — | — | 2 ревьюера |
| W1.07 | 1 · 1c | Б | не начат | — | — | — | PD-58 |
| W1.08 | 1 · 1c | Б | не начат | — | — | — | |
| W1.09 | 1 · 1c | Б | не начат | — | — | — | ★ |
| W1.10 | 1 · 1c | Б | не начат | — | — | — | |
| W1.24 | 1 · 1c | Ф | не начат | — | — | — | |
| W1.30 | 1 · 1d | Т | не начат | — | — | — | выход этапа 1 |
| W2.00 | 2 · опер. | К + DoR | не начат | — | — | — | |
| W2.01 | 2 · опер. | Б | не начат | — | — | — | |
| W2.02 | 2 · 2a | Б | не начат | — | — | — | ★ 2 ревьюера |
| W2.04 | 2 · 2a | Б | не начат | — | — | — | ★ |
| W2.20 | 2 · 2a | Ф | не начат | — | — | — | |
| W2.22 | 2 · 2a | Ф | не начат | — | — | — | |
| W2.25 | 2 · 2a | Ф | не начат | — | — | — | |
| W2.31 | 2 · 2a | Т + Ч | не начат | — | — | — | |
| W2.03 | 2 · 2b | Б | не начат | — | — | — | |
| W2.05 | 2 · 2b | Б | не начат | — | — | — | ★ |
| W2.07 | 2 · 2b | Б | не начат | — | — | — | |
| W2.09 | 2 · 2b | Б | не начат | — | — | — | |
| W2.21 | 2 · 2b | Ф | не начат | — | — | — | |
| W2.23 | 2 · 2b | Ф | не начат | — | — | — | |
| W2.26 | 2 · 2b | Ф | не начат | — | — | — | |
| W2.06 | 2 · 2c | Б | не начат | — | — | — | ★ 2 ревьюера |
| W2.08 | 2 · 2c | Б | не начат | — | — | — | |
| W2.24 | 2 · 2c | Ф | не начат | — | — | — | |
| W2.30 | 2 · 2c | Т | не начат | — | — | — | |
| W2.32 | 2 · 2d | Т | не начат | — | — | — | выход этапа 2 |
| W3.00…W3.07 | 3 | И, Т, Ч | не начат | — | — | — | |
| W4.00…W4.90 | 4 | все | не начат | — | — | — | DoR ждёт B-1 |
| W5.00…W5.90 | 5 | все | не начат | — | — | — | |
| W6.00…W6.90 | 6 | все | не начат | — | — | — | |
| W7.00…W7.90 | 7 | все | не начат | — | — | — | |

## Выходы этапов

| Этап | Критерий (план 27) | Состояние | Дата | Критик |
|---|---|---|---|---|
| 0 | Запрос проходит браузер → BFF → API → tenant DB с проверкой права | не пройден | — | — |
| 1 | AC-01, 02, 10, 11 (+07); владелец сам настраивает структуру и роли и приглашает сотрудников | не пройден | — | — |
| 2 | Смена водителя на телефоне и у менеджера на stage; AC-03…06, 12 | не пройден | — | — |
| 3 | Пилотная компания работает в prod-pilot | не пройден | — | — |
| 4 | «Осмотр → ответ формы → задача менеджеру» на stage | не пройден | — | — |
| 5 | Салон: запись, техкарта, касса со сменами | не пройден | — | — |
| 6 | Объект от замера до сдачи | не пройден | — | — |
| 7 | По каждому модулю отдельно | не пройден | — | — |
