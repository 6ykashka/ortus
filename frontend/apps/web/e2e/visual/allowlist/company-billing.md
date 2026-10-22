# Allowlist `company-billing` (W4.61)

Сверка «Подписки и мест» владельца (`/t/<tenantId>/billing`) со снимком `design-2026-10-19` (`Ортус CRM.dc.html`
pg.billing :1454–1528) у владельцев «Альты» и «Лотоса». Сравнивается область `#ox-main` на высоком окне; шапка и меню
— `shell` (W1.20). Формат — `frontend/packages/e2e-kit/src/allowlist.ts`. Записи с пометкой «эталон приводится»
выполняет `e2e/visual/company-billing.visual.spec.ts` до снимка.

## Данные, которых нет в контракте

- kind: label · target: .ox-bl-title — подпись под именем · mode: both · reason: должности участника в контракте нет (Member): подпись — рабочая функция (Member.workProfiles: «Водитель»…), иначе почта (как W1.23), иначе «Должность не указана» эталона; эталон приводится · decision: PD-22, Q-W4.61-3 · owner: W4.61
- kind: label · target: .ox-bl-note — «Приглашение отправлено · место зарезервировано» · mode: both · reason: срока приглашения в Member нет — запасной текст эталона «Приглашение отправлено» (billingVM :3951), эталон показывает «Приглашение до 06.10»; эталон приводится · decision: PD-22, Q-W4.61-3 · owner: W4.61
- kind: label · target: button:Отозвать · mode: both · reason: операции отзыва приглашения в контракте нет (эскиз 17-го документа — DELETE /tenants/{tenantId}/invitations/{id}); кнопка не показывается до контрактного PR стюарда; эталон приводится · decision: PD-22, Q-W4.61-2 · owner: W4.61
- kind: out-of-stage · target: .ox-bl-free — карточки бригады «… · карточка без входа (бригада)» · mode: mock · reason: бригады — модуль «Ремонт и стройка» (этап 6): в сиде MSW «Альты» карточек без входа нет; механизм есть (участник active без userId); эталон приводится · decision: PD-50, Q-W4.61-3 · owner: W4.61 · expires: stage-6

## Состояния без эталона

- kind: no-reference · target: .ox-pk-skeleton — status:Загрузка · mode: both · reason: загрузки страницы в эталоне нет; под шапкой — скелетон трёх блоков без текста · decision: PD-22, Q-W4.61-7 · owner: W4.61
- kind: no-reference · target: alert:Не удалось загрузить подписку: {ошибка} · mode: both · reason: ошибка чтения подписки, сетки, заявок или участников — текст по коду и «Повторить» · decision: PD-22, Q-W4.61-7 · owner: W4.61
- kind: label · target: button:Повторить · mode: both · reason: кнопка ошибки загрузки без эталона · decision: PD-22, Q-W4.61-7 · owner: W4.61
