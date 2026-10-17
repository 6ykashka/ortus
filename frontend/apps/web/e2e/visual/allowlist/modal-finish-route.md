# Allowlist `modal-finish-route` (W2.22)

Диалог «Завершить рейс {номер}?» — диалог подтверждения эталона (confirm :2179–2201, finishRoute :2586–2596) на общем
`ConfirmModal` W1.24 (пиксели диалога сверены W1.24, `allowlist/modules.md`). Подписи и поведение — e2e
`e2e/modal-finish-route.spec.ts` (заголовок, текст, «Внимание», «Отмена», Escape, подложка, отказ команды, 390).

- kind: state · target: button:Завершить рейс · mode: both · reason: команда finishTripRoute с If-Match свежего getTripPlan; отказ — тост по коду, диалог остаётся открытым, фокус на подтверждении (эталон закрывает диалог до ответа) · decision: PD-29 · owner: W2.22
