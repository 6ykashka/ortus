package modulesreg

// catalogText is the tenant part of api/permissions.yaml in catalog order, transcribed for the trusted module
// manifests and the availability levels: «module <key> | <label> | <depends_on…>», then one line per action
// «<key> | <label> | <level> | <scopes…> | <sensitivity>». TestCatalogMatchesPermissions (cmd/api) guards it against
// the catalog: the steward changes the catalog — the test turns red and this table is updated.
const catalogText = `module core.members | Пользователи и доступ |
  members.read | Просматривать участников | view | tenant unit | normal
  members.invite | Приглашать | create | tenant unit | sensitive
  members.manage | Приостанавливать и переводить | edit | tenant unit | sensitive
  roles.read | Просматривать роли | view | tenant unit | normal
  roles.manage | Создавать и изменять роли | settings | tenant | sensitive
  roles.assign | Назначать роли | settings | tenant unit | sensitive
  org_units.read | Просматривать структуру | view | tenant unit | normal
  org_units.manage | Изменять структуру | settings | tenant unit | sensitive
module core.modules | Модули и подписка |
  modules.read | Просматривать модули | view | tenant | normal
  modules.manage | Подключать и отключать | settings | tenant | normal
  modules.settings.read | Читать настройки | view | tenant | normal
  modules.settings.manage | Изменять настройки | settings | tenant | sensitive
  billing.read | Видеть подписку и место | view | tenant | sensitive
  billing.manage | Менять тариф и квоту | settings | tenant | normal
  branding.manage | Менять оформление | settings | tenant | normal
module core.files | Файлы |
  files.read | Открывать файлы | view | tenant unit self | normal
  files.upload | Загружать | create | tenant unit self | normal
module core.data | Данные |
  data.catalog.read | Видеть наборы данных | view | tenant unit | normal
  data.query | Строить выборки | view | tenant unit | normal
  data.export | Выгружать | export | tenant unit | sensitive
module core.tasks | Задачи |
  tasks.projects.read | Видеть проекты | view | tenant unit project | normal
  tasks.projects.manage | Управлять проектами | settings | tenant unit project | normal
  tasks.read | Читать задачи | view | tenant unit project self | normal
  tasks.create | Создавать задачи | create | tenant unit project | normal
  tasks.update | Изменять задачи | edit | tenant unit project self | normal
  tasks.transition | Менять статус | edit | tenant unit project self | normal
  tasks.approve | Согласовывать | review | tenant unit project | normal
  tasks.members.manage | Управлять участниками | settings | tenant unit project | sensitive
  tasks.workflow.manage | Настраивать процесс | settings | tenant unit project | normal
  tasks.automation.manage | Настраивать автоматизацию | settings | tenant unit project | sensitive
module core.forms | Формы |
  forms.read | Видеть формы | view | tenant unit project | normal
  forms.create | Создавать формы | create | tenant unit project | normal
  forms.manage | Изменять черновики | edit | tenant unit project | normal
  forms.publish | Публиковать версии | settings | tenant unit project | normal
  forms.publish_public | Публичные ссылки | settings | tenant unit | sensitive
  forms.responses.read | Читать ответы | view | tenant unit project self | normal
  forms.responses.review | Проверять ответы | review | tenant unit project | normal
  forms.responses.assign | Назначать ответственного за ответ | edit | tenant unit project | normal
module core.calendar | Календарь |
  calendar.availability.read | Видеть занятость | view | tenant unit self | normal
  calendar.bookings.read | Видеть записи | view | tenant unit self | normal
  calendar.bookings.create | Бронировать | create | tenant unit self | normal
  calendar.bookings.manage | Переносить и отменять | edit | tenant unit self | normal
module core.knowledge | База знаний |
  knowledge.read | Читать | view | tenant unit project space page relation | normal
  knowledge.create | Создавать | create | tenant unit project space page | normal
  knowledge.update | Редактировать | edit | tenant unit project space page relation | normal
  knowledge.publish | Публиковать | review | tenant unit project space page | normal
  knowledge.organize | Перемещать и архивировать | edit | tenant unit space | normal
  knowledge.access.manage | Доступ к страницам | settings | tenant unit space | sensitive
  knowledge.members.manage | Участники пространства | settings | tenant unit space | sensitive
  knowledge.automation.manage | Настраивать автоматизацию | settings | tenant unit space | sensitive
  knowledge.spaces.manage | Создавать пространства | settings | tenant unit | normal
module core.chat | Чаты |
  chat.read | Читать чаты | view | tenant unit chat relation self | normal
  chat.write | Писать сообщения | create | tenant unit chat relation self | normal
  chat.direct | Личные чаты | create | tenant unit | normal
  chat.files.send | Отправлять файлы и медиа | create | tenant unit chat relation | normal
  chat.polls.create | Создавать опросы | create | tenant unit chat relation | normal
  chat.create | Создавать групповые чаты | edit | tenant unit | normal
  chat.announce | Объявления | review | tenant unit chat | normal
  chat.moderate | Модерировать | review | tenant unit chat | normal
  chat.members.manage | Управлять участниками | settings | tenant unit chat | sensitive
  chat.settings.manage | Настраивать чат | settings | tenant unit chat | normal
  chat.receipts.read | Видеть | view | tenant unit chat | normal
  chat.ephemeral.send | Временные и одноразовые сообщения | create | tenant unit chat | sensitive
  chat.pdn.read | Видеть ПДн без маски | view | tenant unit | restricted
  chat.export | Выгружать историю | export | tenant unit chat | sensitive
  chat.external | Чаты с клиентами и подрядчиками | settings | tenant unit | sensitive
  chat.retention.manage | Сроки хранения | settings | tenant unit | sensitive
  chat.hold.manage | Удержание для проверки | settings | tenant | normal
  chat.audit.read | Журнал и удалённые сообщения | view | tenant | restricted
  chat.policy.manage | Политики чатов организации | settings | tenant | normal
module logistics | Логистика | core.calendar core.files core.forms
  fleet.vehicles.read | Видеть машины | view | tenant unit resource | normal
  fleet.vehicles.manage | Вести автопарк | settings | tenant unit | normal
  fleet.reservations.read | Видеть брони | view | tenant unit self | normal
  fleet.reservations.create | Бронировать машину | create | tenant unit self | normal
  fleet.reservations.manage | Ставить и снимать брони | edit | tenant unit self | normal
  fleet.reservations.choose | Выбирать машину из предложенных | create | self | normal
  fleet.inspections.read | Видеть осмотры | view | tenant unit self | normal
  fleet.inspections.submit | Проводить осмотр | create | tenant unit self | normal
  fleet.inspections.review | Решать по дефектам | review | tenant unit | normal
  fleet.trips.read | Видеть рейсы | view | tenant unit self | normal
  fleet.trips.start | Начинать рейс | create | tenant unit self | normal
  fleet.trips.return | Сдавать машину | create | tenant unit self | normal
  fleet.trips.review | Принимать смены | review | tenant unit | normal
  fleet.routes.read | Видеть маршруты | view | tenant unit self | normal
  fleet.routes.manage | Планировать маршруты | edit | tenant unit | normal
  fleet.expenses.read | Видеть расходы | view | tenant unit self | normal
  fleet.expenses.create | Добавлять расходы | create | tenant unit self | normal
  fleet.expenses.review | Проверять расходы | review | tenant unit | normal
  fleet.driver_transfers.read | Видеть запросы пула | view | tenant unit | normal
  fleet.driver_transfers.request | Запрашивать водителя | edit | tenant unit | normal
  fleet.driver_transfers.approve | Одобрять передачу | review | tenant unit | sensitive
  fleet.earnings.read | Видеть начисления | view | tenant unit | restricted
  fleet.earnings.manage | Изменять начисления | edit | tenant unit | restricted
module repairs | Ремонт и стройка | core.files core.tasks
  repairs.projects.read | Видеть объекты | view | tenant unit project | normal
  repairs.projects.manage | Вести объекты | settings | tenant unit | normal
  repairs.work_logs.read | Видеть отметки | view | tenant unit project | normal
  repairs.work_logs.submit | Отмечать работу | create | project | normal
  repairs.work_logs.review | Принимать объём | review | tenant unit project | normal
  repairs.finance.read | Видеть финансы объекта | view | tenant unit project | restricted
  repairs.schedule.read | Видеть график | view | tenant unit project | normal
  repairs.schedule.shift | Переносить этапы | edit | tenant unit project | normal
  repairs.schedule.baseline | Менять базовый план | settings | tenant unit | normal
  repairs.estimates.edit | Составлять сметы | edit | tenant unit project | restricted
  repairs.catalog.manage | Вести шаблоны и расценки | settings | tenant | normal
  repairs.changes.submit | Предлагать допработы | create | project | normal
  repairs.supply.request | Просить материал | create | project | normal
  repairs.supply.manage | Вести снабжение | edit | tenant unit | normal
  repairs.measurements.edit | Вводить замер | edit | tenant unit project | normal
  repairs.documents.send | Отправлять документы на подпись | edit | tenant unit project | sensitive
  repairs.crew.accrue | Начислять бригаде по акту | edit | tenant unit project | restricted
  repairs.crew.pay | Выплачивать бригаде через кассу | review | tenant unit project | restricted
  repairs.subcontractors.manage | Открывать доступ подрядчикам | settings | tenant unit project | sensitive
  repairs.client_link.manage | Выпускать и отзывать ссылку кабинета заказчика | settings | tenant unit project | sensitive
  repairs.projects.hand_over | Сдавать объекты | review | tenant unit project | normal
module inventory | Склад и материалы |
  inventory.items.read | Видеть номенклатуру и остатки | view | tenant unit warehouse | normal
  inventory.items.manage | Вести номенклатуру | settings | tenant unit | normal
  inventory.warehouses.manage | Вести склады | settings | tenant unit | normal
  inventory.consumption.override | Менять фактический расход материалов | edit | tenant unit warehouse | sensitive
  inventory.movements.read | Видеть движения | view | tenant unit warehouse | normal
  inventory.movements.post | Проводить движения | create | tenant unit warehouse | normal
  inventory.consume | Списывать материалы по услуге | create | tenant unit warehouse | normal
module spa | Салон и SPA | core.calendar core.forms inventory cash
  spa.services.read | Видеть услуги | view | tenant unit | normal
  spa.services.manage | Вести услуги и техкарты | settings | tenant unit | normal
  spa.appointments.read | Видеть визиты | view | tenant unit self | normal
  spa.appointments.create | Записывать клиентов | create | tenant unit self | normal
  spa.appointments.perform | Отмечать выполнение | edit | tenant unit self | normal
  spa.appointments.complete | Завершать с учётом материалов | review | tenant unit | normal
module cash | Касса |
  cash.read | Видеть кассы и операции | view | tenant unit account | normal
  cash.balance.read | Видеть остаток и ожидаемую сумму | view | tenant unit account | sensitive
  cash.post | Вносить приход и расход | create | tenant unit account | normal
  cash.proposals.post | Проводить предложения модулей | create | tenant unit account | normal
  cash.shift.operate | Открывать и закрывать смену | create | unit account | normal
  cash.refund | Возвраты клиентам | edit | tenant unit account | sensitive
  cash.transfer | Перемещать и сдавать выручку | edit | tenant unit account | sensitive
  cash.advance.issue | Выдавать под отчёт | edit | tenant unit | sensitive
  cash.approve | Согласовывать расходы | review | tenant unit | normal
  cash.reconcile | Сверять и принимать расхождения | review | tenant unit account | normal
  cash.reverse | Сторнировать | review | tenant unit account | sensitive
  cash.payroll.post | Выплаты зарплаты и начислений | edit | tenant unit | restricted
  cash.reports.finance | ДДС и прибыль по направлениям | view | tenant unit | restricted
  cash.accounts.manage | Кассы, статьи и лимиты | settings | tenant unit | sensitive
  cash.period.close | Закрывать период | settings | tenant | sensitive
  cash.advance.self | Свой подотчёт — остаток и отчёт чеками | create | self | normal
  cash.export | Выгружать операции кассы | export | tenant unit account | sensitive
`
