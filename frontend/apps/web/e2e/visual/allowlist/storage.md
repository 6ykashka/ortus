# Allowlist `storage` (W1.24)

Экрана «Хранилище» нет в прототипе (B-6 №5, `docs/plan/v2/design-requests.md`; S1-22). Пиксельной и структурной сверки
нет; e2e (`e2e/storage.spec.ts`) и проходка Playwright MCP обязательны. Разметка — карточки «Место организации»
«Модулей и места» (`Ортус CRM.dc.html` :258–279), группы разбивки — подписи эталона (`ortus/mock-data.js` :150–152).

- kind: no-reference · target: h1:Хранилище · mode: both · reason: страница «Хранилище» — занято, лимит, резерв начатых загрузок, ожидающее уменьшение, разбивка по видам файлов и модулям, расчёт смены лимита с ценой (requestStorageChange quote → commit); дорисовать в прототипе — design-requests №5 · decision: B-6, Q-W1.24-3 · owner: W1.24
- kind: no-reference · target: button:Рассчитать · mode: both · reason: смена лимита двумя шагами контракта: расчёт (цена, срок расчёта) и «Применить»; ниже занятого — отказ сервера текстом в карточке · decision: B-6, Q-W1.24-3 · owner: W1.24
- kind: label · target: .ox-st-groups .ox-st-label · mode: both · reason: подпись группы photos одна для всех организаций — «Фото осмотров и отчётов»; в эталоне у «SPA «Лотос»» — «Фото работ и техкарты» (ortus/mock-data.js :60), подпись — данные сида, контракт отдаёт только ключ группы (как allowlist/modules.md) · decision: PD-22, Q-W1.24-16 · owner: W1.24
- kind: no-reference · target: .ox-st-modules · mode: both · reason: «По модулям» — модули с ключом, которого клиент не знает, сведены в одну строку «Прочее» в конце (ключ модуля API пользователю не выводится) · decision: B-6, Q-W1.24-20 · owner: W1.24
- kind: no-reference · target: button:Повторить · mode: both · reason: ошибка getStorageUsage или getStorageBreakdown — alert «Не удалось загрузить данные: …» и «Повторить» · decision: B-6, Q-W1.24-13 · owner: W1.24
- kind: state · target: .ox-st-quote · mode: both · reason: «Применить» по истёкшему или не найденному расчёту (409 invalid_transition, 422 validation_failed) — тост по коду, расчёт убирается, фокус на «Рассчитать»; загрузка — свой скелетон под заголовком (role=status «Загрузка»), блоки разбивки на месте (aria-busy) · decision: B-6, Q-W1.24-22, Q-W1.24-23 · owner: W1.24
