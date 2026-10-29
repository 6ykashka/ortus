# Allowlist `repair-catalog` (W6.22)

Сверка «Шаблоны и расценки» со снимком `design-2026-10-19`: `Ортус CRM.dc.html` :1903–1908 и `Ремонт и стройка.dc.html`
`data-screen-label="Шаблоны и расценки"` :614–721, `catVM` :1490–1542. Тексты — дословно из эталона (`texts.ts`). Пиксельная и
структурная сверка в Playwright не заведена (см. allowlist `repair-supply` и отчёт W6.22); сверка выполнена вручную.

- kind: state · target: .ox-rc-tech · mode: both · reason: «Технология графика» собрана из TemplateStage контракта (`ratePerDay`, `pauseDays`): выработка «12/день» без единицы и пауза «раньше на 3 дня» / «пауза 10 дней» без пояснений; в эталоне — текст «12 м²/день» и «после штукатурки пауза 5 дней: сушка» · decision: B-6, Q-W6.22-5 · owner: W6.22
- kind: state · target: .ox-rc-ul:Комплект документов · mode: both · reason: документы шаблона — виды контракта (contract, act, handover_act, warranty); подписи собираются: акты — по разделам шаблона без «Материалов», «Гарантийный паспорт · N месяцев» · decision: B-6, Q-W6.22-5 · owner: W6.22
- kind: label · target: button:Сделать копию · mode: both · reason: имя копии «… · копия» отправляется сервером как есть, как в эталоне; после копии включается правка и показывается сообщение эталона · decision: B-6 · owner: W6.22
- kind: state · target: button:Готово · mode: both · reason: правка шаблона сохраняется по «Готово» одним запросом updateTemplate (If-Match); в эталоне каждое изменение сразу пишется в состояние · decision: B-6, Q-W6.22-6 · owner: W6.22
- kind: state · target: .ox-rc-price · mode: both · reason: цена в строке справочника сохраняется при выходе из поля или Enter (updatePriceItem); неверная цена (≤ 0) возвращается с ошибкой «Укажите цену больше нуля» (в эталоне поле без проверки) · decision: B-6, Q-W6.22-6 · owner: W6.22
- kind: no-reference · target: banner:Не удалось загрузить шаблоны и расценки · mode: both · reason: ошибка загрузки — alert и «Повторить»; в эталоне данные локальные · decision: B-6, Q-W6.22-2 · owner: W6.22
- kind: pixel · target: .ox-rps-seg-btn · mode: both · reason: на телефоне цели нажатия 44 px · decision: PD-28 · owner: W6.22
