# Статус рабочих потоков

> **Заменён `v2/status.md` (план v2 §6).** Таблица ниже — состояние реестра старого плана на 14.10.2026, она больше не обновляется.

Обновляется исполнителем (своя строка) и интегратором на барьере волны (`orchestration.md` §6 п.4). Состояния: `не начат` · `в работе` · `на проверке` · `возвращён` · `готово` · `блокирован`. Колонки evidence — ссылки на `docs/plan/evidence/<key>/` (фаза 1) и `…/phase2/` (фаза 2, PD-52). Реестр и карточки WS — `00-master-plan.md` §5.

| WS | slug | волна | kind | состояние | ветка | отчёт | evidence ф.1 | evidence ф.2 | ревью | примечание |
|---|---|---|---|---|---|---|---|---|---|---|
| WS-00 | analysis-fixes | 0 | quality | не начат | — | — | — | — | — | до генерации e2e-скелетов |
| WS-01 | repo-skeleton | 0 | infra | не начат | — | — | — | — | — | первый в волне 0 |
| WS-02 | compose-stand | 0 | infra | не начат | — | — | — | — | — | |
| WS-03 | contract-core | 0 | contract | не начат | — | — | — | — | — | 2 ревьюера |
| WS-04 | tokens-ui-contract | 0 | ui-kit | не начат | — | — | — | — | — | |
| WS-05 | domain-seed-port | 0 | domain | не начат | — | — | — | — | — | |
| WS-06 | mock-adapter-port | 0 | domain | не начат | — | — | — | — | — | после WS-05 |
| WS-07 | e2e-harness-mcp | 0 | infra | не начат | — | — | — | — | — | |
| WS-08 | texts-dictionary | 0 | contract | не начат | — | — | — | — | — | |
| WS-10 | shell | 1 | shell | не начат | — | — | — | — | — | ключи shell, modal-confirm, modal-sheet |
| WS-11 | docs-site | 1 | docs-site | не начат | — | — | — | — | — | 6 ключей docs-* |
| WS-12 | ui-core | 1 | ui-kit | не начат | — | — | — | — | — | |
| WS-13 | ui-domain | 1 | ui-kit | не начат | — | — | — | — | — | |
| WS-14 | modals-people | 1 | pages | не начат | — | — | — | — | — | modal-assign, modal-invite, modal-createRole |
| WS-40 | backend-platform | 1 | backend | не начат | — | — | — | — | — | |
| WS-41 | migrations | 1 | backend | не начат | — | — | — | — | — | 2 ревьюера |
| WS-15 | contract-delta | 2 | contract | не начат | — | — | — | — | — | 2 ревьюера |
| WS-20 | company | 2 | pages | не начат | — | — | — | — | — | modules, users, billing |
| WS-21 | branding | 2 | pages | не начат | — | — | — | — | — | branding |
| WS-22 | logistics-manager | 2 | pages | не начат | — | — | — | — | — | fleet, pool, review, modal-request |
| WS-23 | logistics-driver | 2 | pages | не начат | — | — | — | — | — | today, cars |
| WS-24 | home | 2 | pages | не начат | — | — | — | — | — | home |
| WS-25 | forms | 2 | pages | не начат | — | — | — | — | — | forms |
| WS-26 | tasks | 2 | pages | не начат | — | — | — | — | — | tasks |
| WS-27 | platform-orgs | 2 | pages | не начат | — | — | — | — | — | tenants, usage, requests |
| WS-28 | platform-accounts-plans | 2 | pages | не начат | — | — | — | — | — | accounts, plans |
| WS-29 | core-modules | 2 | pages | не начат | — | — | — | — | — | calendar, knowledge, data, files |
| WS-30 | spa-cash | 2 | pages | не начат | — | — | — | — | — | spa, cash |
| WS-31 | repair-object | 2 | pages | не начат | — | — | — | — | — | repair |
| WS-32 | repair-child | 2 | pages | не начат | — | — | — | — | — | repair-tabs (карта 06b) |
| WS-42 | authz | 2 | backend | не начат | — | — | — | — | — | 2 ревьюера |
| WS-43 | control-tenants | 2 | backend | не начат | — | — | — | — | — | |
| WS-44 | access-people-org | 2 | backend | не начат | — | — | — | — | — | после интерфейсов WS-42 |
| WS-45 | modules-files-services | 2 | backend | не начат | — | — | — | — | — | после интерфейсов WS-42 |
| WS-51 | http-adapter-msw | 2 | integration | не начат | — | — | — | — | — | core после WS-06, delta после WS-15 |
| WS-46 | fleet-core | 3 | backend | не начат | — | — | — | — | — | |
| WS-47 | fleet-shift | 3 | backend | не начат | — | — | — | — | — | после WS-46 |
| WS-48 | fleet-review-earnings | 3 | backend | не начат | — | — | — | — | — | 2 ревьюера; после WS-47 |
| WS-49 | fleet-pool | 3 | backend | не начат | — | — | — | — | — | |
| WS-50 | datasets | 3 | backend | не начат | — | — | — | — | — | |
| WS-52 | go-seed | 3 | backend | не начат | — | — | — | — | — | |
| WS-53 | e2e-full-stand | 3 | integration | не начат | — | — | — | — | — | 11 ключей S0–S2, phase2 |
| WS-54 | keycloak-oidc | 3 | backend | не начат | — | — | — | — | — | по PD-41; 2 ревьюера |
| WS-55 | journeys-e2e | 3 | quality | не начат | — | — | — | — | — | не авторы экранов |
| WS-56 | provisioning | 3 | backend | не начат | — | — | — | — | — | 2 ревьюера |
| WS-60 | be-forms | 4 | backend | не начат | — | — | — | — | — | |
| WS-61 | be-tasks | 4 | backend | не начат | — | — | — | — | — | |
| WS-62 | be-knowledge | 4 | backend | не начат | — | — | — | — | — | |
| WS-63 | be-calendar | 4 | backend | не начат | — | — | — | — | — | |
| WS-64 | be-spa-inventory | 4 | backend | не начат | — | — | — | — | — | |
| WS-65 | be-cash | 4 | backend | не начат | — | — | — | — | — | 2 ревьюера |
| WS-66 | be-repairs | 4 | backend | не начат | — | — | — | — | — | |
| WS-67 | be-branding-billing-platform-ops | 4 | backend | не начат | — | — | — | — | — | 2 ревьюера |
| WS-68 | pwa-offline | 4 | pages | не начат | — | — | — | — | — | today-offline |
| WS-69 | load-restore | 4 | quality | не начат | — | — | — | — | — | |
| WS-70 | notify-realtime | 4 | backend | не начат | — | — | — | — | — | |
| WS-71 | inspection-automation | 4 | backend | не начат | — | — | — | — | — | |
| WS-72 | csv-import | 4 | backend | не начат | — | — | — | — | — | S1-10 backend-only |

## Барьеры волн

| Барьер | Состояние | Дата | Критик | Ссылка |
|---|---|---|---|---|
| 0 → 1 | не пройден | — | — | `critique/wave-0.md` |
| 1 → 2 | не пройден | — | — | `critique/wave-1.md` |
| 2 → 3 | не пройден | — | — | `critique/wave-2.md` |
| 3 → 4 | не пройден | — | — | `critique/wave-3.md` |
