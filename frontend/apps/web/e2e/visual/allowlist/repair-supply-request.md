# Allowlist `repair-supply-request` (W6.22)

Форма «Новая заявка на материал» — без эталона: в `Ремонт и стройка.dc.html` создать заявку негде (разбор dor/repair.md §1.3, §5 п. 6).
Пиксельной и структурной сверки нет; e2e и проходка MCP обязательны.

- kind: no-reference · target: form:Новая заявка на материал · mode: both · reason: форма прораба — поля «Материал», «Количество», «Нужно к», «Отправить заявку снабжению», ошибки и тост «Заявка отправлена снабжению»; дорисовать в прототипе — design-requests «repair-supply-request» · decision: B-6, Q-W4.00-repair-6, Q-W6.22-6 · owner: W6.22
- kind: state · target: select:Материал · mode: both · reason: справочник расценок прорабу не открыт (listPriceItems требует estimates.edit): список материалов — из прежних заявок объекта · decision: B-6, Q-W4.00-repair-6, Q-W6.22-6 · owner: W6.22
