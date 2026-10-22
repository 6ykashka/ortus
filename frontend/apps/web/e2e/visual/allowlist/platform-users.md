# Allowlist `platform-users` (W4.61)

Сверка «Пользователей платформы» оператора (`/platform/accounts`) со снимком `design-2026-10-19` (`Ортус CRM.dc.html`
pg.accounts :987–1159). Сравнивается область `#ox-main` на высоком окне: все аккаунты, организация «Ремстрой Плюс»,
«Ортус · Платформа»; шапка и меню — `shell` (W1.20). Формат — `frontend/packages/e2e-kit/src/allowlist.ts`.

## Выбор и адрес

- kind: state · target: aside:Карточка аккаунта — выбор по умолчанию · mode: both · reason: без `?account=` выбран первый аккаунт списка (ветка `list[0]` accountsVM :3629); эталон открывается с демо-выбором «Анна Морозова» (accSel). Сверка открывает реализацию с `?account=` Анны · decision: PD-22, Q-W4.61-4 · owner: W4.61
- kind: state · target: ?org= и ?account= — выбранная организация и аккаунт в адресе · mode: both · reason: выбор сохраняется в адресе страницы (ADR-0001), в эталоне — состояние accOrg и accSel; поиск и фильтр — состояние страницы, как эталон · decision: PD-22, Q-W4.61-4 · owner: W4.61
- kind: state · target: .ox-acc-pop — popover «Организации аккаунта» · mode: both · reason: участия строки читаются карточкой аккаунта (getPlatformUser: в строках каталога их нет): в «Все аккаунты» popover появляется после ответа по наведению или фокусу; в организации участия строк читаются сразу (чип участия) · decision: PD-22, Q-W4.61-10 · owner: W4.61
- kind: state · target: aside:Карточка аккаунта до ответа getPlatformUser · mode: both · reason: пока карточка аккаунта читается, показаны данные строки списка без участий (без эталона: эталон берёт данные синхронно) · decision: PD-22, Q-W4.61-10 · owner: W4.61

## Тексты без эталона

- kind: no-reference · target: toast:Причина блокировки — от 5 до 500 символов · mode: both · reason: причина блокировки короче 5 символов (контракт PlatformUserLock.reason 5–500); пустая — тост эталона «Укажите причину блокировки» · decision: PD-22, Q-W4.07-11 · owner: W4.61
- kind: no-reference · target: toast:Вход уже заблокирован, Второй фактор не настроен · mode: both · reason: повтор команды на устаревших данных (409) — тексты из api/CHANGELOG «Отличия от эталона» · decision: PD-22, Q-W4.07-11 · owner: W4.61
- kind: no-reference · target: alert:Не удалось загрузить аккаунты: {ошибка}, alert:Не удалось загрузить операторов: {ошибка} · mode: both · reason: ошибка чтения каталога или операторов — текст по коду и «Повторить» · decision: PD-22, Q-W4.61-7 · owner: W4.61
- kind: label · target: button:Повторить · mode: both · reason: кнопка ошибки загрузки без эталона · decision: PD-22, Q-W4.61-7 · owner: W4.61
- kind: no-reference · target: text:Нет права на каталог аккаунтов…, text:Нет права на список операторов… · mode: both · reason: 403 listPlatformUsers или listPlatformOperators (роль без platform.users.read; у ролей сида право есть у всех) — текст раздела без «Повторить», как «Заявки на тариф» (бриф §5, возврат 1) · decision: PD-22, Q-W4.61-15 · owner: W4.61
- kind: no-reference · target: .ox-pk-skeleton — status:Загрузка · mode: both · reason: загрузки списка в эталоне нет; скелетон блока списка без текста · decision: PD-22, Q-W4.61-7 · owner: W4.61
