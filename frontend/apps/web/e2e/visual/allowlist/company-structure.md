# Allowlist `company-structure` (W1.54)

Экрана «Структура» нет в прототипе (B-6, `docs/plan/v2/design-requests.md` «company-structure · перенос»; S1-08): в
эталоне регионы и фирмы только читаются (область в шапке, «Область» назначения). Пиксельной и структурной сверки нет;
e2e (`e2e/company-structure.spec.ts`) и проходка Playwright MCP обязательны. Разметка — компоненты `@ortus/ui`
(`Button`, `Banner`, `EmptyState`, `Skeleton`, `Status`, `Dialog`, `Field`, `TextInput`, `Select`), шапка страницы —
как у других страниц «Компании» этапа.

- kind: no-reference · target: h1:Структура · mode: both · reason: страница «Структура» — дерево регион → фирма → подразделение (listOrgUnits), вид узла, «В архиве»; дорисовать в прототипе — design-requests «company-structure · перенос» · decision: B-6, Q-W1.54-2 · owner: W1.54
- kind: no-reference · target: button:Добавить регион · mode: both · reason: создание узла верхнего уровня и дочернего («Добавить в «…»») — диалог «Новое подразделение» с полями «Название» и «Вид» (вид по умолчанию — следующий уровень), createOrgUnit с Idempotency-Key · decision: B-6, Q-W1.54-3, Q-W1.54-9 · owner: W1.54
- kind: no-reference · target: dialog:Перенести · mode: both · reason: перенос — «Куда перенести» (активные узлы вне поддерева, кроме текущего родителя), предпросмотр «Влияние на доступ» (previewOrgUnitMove: вложенные подразделения, сотрудники, «Получат доступ» / «Потеряют доступ», «Ещё N — вне вашей области просмотра»), «Перенести» только после расчёта · decision: B-6, Q-W1.54-4, Q-W1.54-5 · owner: W1.54
- kind: no-reference · target: button:Повторить · mode: both · reason: ошибка listOrgUnits — alert «Не удалось загрузить структуру: …» и «Повторить»; загрузка — скелетон под заголовком (role=status «Загрузка»); пусто — «Структура пока пуста» · decision: B-6, Q-W1.54-6 · owner: W1.54
- kind: state · target: .ox-str · mode: both · reason: организация только для чтения — под заголовком текст словаря tenant_read_only, команды недоступны; без org_units.manage — команд нет, пояснение «Изменять структуру может владелец или сотрудник с правом на структуру.» · decision: B-6, Q-W1.54-7, Q-W1.54-8 · owner: W1.54
