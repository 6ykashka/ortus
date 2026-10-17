# Allowlist `driver-cars` (W2.22)

Страница «Автомобили» водителя, эталон `Ортус CRM.dc.html` pg.cars :850–867, снимок `design-stage-2`
(`e2e/visual/driver.visual.spec.ts`: подписи совпадают, пиксели — 0 px на 390 и 1440 без крошки эталона).

- kind: pixel · target: .ox-dr-head · mode: both · reason: крошка подразделения «Москва / Север Логистик» — только при org_units.read; у шаблона «Водитель» права нет, крошки нет (на сверке пикселей крошка эталона убирается) · decision: Q-26 · owner: W2.22
- kind: pixel · target: .ox-dr-pill · mode: both · reason: видимая высота кнопки фильтра — 40 px эталона, область нажатия расширена до 46 px без изменения вида (цели ≥ 44 px на 390) · decision: PD-28 · owner: W2.22
- kind: no-reference · target: .ox-dr .ox-empty · mode: both · reason: нет рейса на сегодня — «Рейсов на сегодня нет» вместо списка (совместимость считается к рейсу смены) · decision: B-6 · owner: W2.22
