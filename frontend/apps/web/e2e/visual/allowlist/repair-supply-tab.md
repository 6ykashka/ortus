# Allowlist `repair-supply-tab` (W6.22)

Вкладка «Снабжение» карточки объекта — `Ремонт и стройка.dc.html` `data-screen-label="Снабжение"` :532–545, `supMeta` :1590. Встраивает
карточка объекта W6.20 (`SupplyTab`). Пиксельной сверки до слияния карточки нет.

- kind: state · target: .ox-rps-row · mode: both · reason: заявки только своего объекта (эталон: всегда `obj-42`); строка состояния — `requestMeta` без имени прораба (в SupplyRequest нет) · decision: B-6, Q-W4.00-repair-1, Q-W6.22-3 · owner: W6.22
- kind: label · target: button:Списать на объект · mode: both · reason: действие consumeSupplyRequest (право supply.request или work_logs.review); «Демо: прораб забрал» не переносится · decision: B-6, PD-54, Q-W4.00-repair-9 · owner: W6.22
