# Allowlist `platform-usage` (W4.61)

Сверка «Использования» оператора (`/platform/usage`) со снимком `design-2026-10-19` (`Ортус CRM.dc.html` pg.usage
:869–943). Сравнивается область `#ox-main` на высоком окне; шапка и меню — `shell` (W1.20). Формат —
`frontend/packages/e2e-kit/src/allowlist.ts`. Записи с пометкой «эталон приводится» выполняет
`e2e/visual/platform-usage.visual.spec.ts` до снимка.

## Данные сценарного сервера

- kind: label · target: .ox-us-tile-value «Входили за 7 дней» и колонка «Входили за 7 дней» · mode: mock · reason: MSW считает входы участников не позже «сейчас» сида (01.10 10:30): у «Лотоса» 12 из 23, у «Ремстрой Плюс» 2 из 5, всего 21 из 57; эталон считает все входы демо-генератора fillAccounts до вечера 01.10 (34 из 57); эталон приводится · decision: PD-22, Q-W4.07-7 · owner: W4.61

## Порядок и вид

- kind: state · target: .ox-us-signal — порядок «Требуют внимания» · mode: both · reason: контракт сортирует сигналы по уровню и названию организации; страница, как эталон, — по уровню, затем в порядке организаций ответа и видов проверок; «никто не входил» у приостановленной не показывается (ветка else эталона), дни последнего входа приостановленной — по lastSignInAt · decision: PD-22, Q-W4.61-5 · owner: W4.61
- kind: pixel · target: .ox-us-sorts, .ox-us-module-orgs на 390 · mode: both · reason: на телефоне ряды пилюль сортировки (34 px) разведены на 12 px (эталон 6 px), чипы организаций (32 px) — на 14 px, чтобы области нажатия 44 px соседних рядов не перекрывались (цели ≥ 44 px, verification-protocol §1 п. 3); на 1440 — как эталон · decision: PD-28 · owner: W4.61

## Состояния без эталона

- kind: no-reference · target: .ox-pk-skeleton — status:Загрузка · mode: both · reason: загрузки страницы в эталоне нет (04 §4.6 — только общая); под показанной шапкой — скелетон трёх блоков без текста · decision: PD-22, Q-W4.61-7 · owner: W4.61
- kind: no-reference · target: alert:Не удалось загрузить данные: {ошибка} · mode: both · reason: ошибка чтения getPlatformUsage — текст по коду и «Повторить»; нет связи — «Нет связи с сервером. Проверьте подключение.» · decision: PD-22, Q-W4.61-7 · owner: W4.61
- kind: label · target: button:Повторить · mode: both · reason: кнопка ошибки загрузки без эталона (предыдущая запись) · decision: PD-22, Q-W4.61-7 · owner: W4.61
- kind: no-reference · target: text:Нет права на использование платформы… · mode: both · reason: 403 getPlatformUsage (роль оператора без platform.tenants.read; у ролей сида право есть у всех) — текст раздела без «Повторить», как «Заявки на тариф» (бриф §5, возврат 1) · decision: PD-22, Q-W4.61-15 · owner: W4.61
