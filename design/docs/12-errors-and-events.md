# 12. Ошибки, события и соглашения API — версия 0.2

Дополнение к `03-api-guide.md` от 1 октября 2026 года. В OpenAPI 0.1 схема `Problem` содержит поле `code`, но перечень кодов не зафиксирован. Ниже — предлагаемый реестр. После утверждения его нужно добавить в YAML как `enum` и сгенерировать константы для Go и TypeScript.

## Формат ошибки

`application/problem+json` (RFC 9457):

```json
{
  "type": "https://docs.ortus.example/errors/reservation_overlap",
  "title": "Машина уже забронирована",
  "status": 409,
  "code": "reservation_overlap",
  "detail": "Выберите другую машину или обновите список.",
  "requestId": "01J9Z4…",
  "violations": [{ "field": "window.until", "code": "before_start", "message": "Окончание раньше начала" }],
  "retryable": true
}
```

- `title` и `detail` безопасны для показа пользователю и не содержат чужих ID, SQL, токенов, ключей хранилища.
- Интерфейс выбирает текст по `code`, а не по `title`. Для неизвестного `code` используется общий текст статуса.
- `requestId` показывается в интерфейсе мелким шрифтом с кнопкой «Скопировать».

## Реестр кодов

| HTTP | code | Когда | Что делает интерфейс |
|---|---|---|---|
| 400 | `malformed_request` | Неразбираемый JSON, неверный параметр | Общая ошибка, не повторять |
| 400 | `unknown_field` | В теле поле, которого нет в DTO | Ошибка разработки, логировать |
| 401 | `session_expired` | Нет или истекла сессия | Перелогин с возвратом на экран |
| 402 | `feature_requires_plan` | Функция недоступна по тарифу | Владельцу — «Продлить», остальным — «Обратитесь к владельцу» |
| 403 | `forbidden_action` | Нет действия ни в одной роли | AccessGate «Нет права» |
| 403 | `module_not_installed` | Модуль не подключён | AccessGate «Модуль не подключён» |
| 403 | `module_read_only` | Модуль в draining/read_only | Баннер «Только чтение» |
| 403 | `tenant_read_only` | Тенант в read_only | Баннер, разрешены чтение и экспорт |
| 403 | `tenant_suspended` | Тенант приостановлен | Экран блокировки |
| 403 | `function_blocked` | Функция `driver` закрывает действие | Не показывать пункт; при прямом вызове — общий отказ |
| 403 | `csrf_failed` / `origin_not_allowed` | Нет или неверен CSRF/Origin | Перезагрузить страницу |
| 404 | `not_found` | Нет объекта или он вне области | Одинаково для чужих и несуществующих ID |
| 409 | `reservation_overlap` | Интервал занят | Конфликт брони, «Обновить список» |
| 409 | `resources_unavailable` | Не весь комплект ресурсов свободен | Список недоступных без чужих деталей |
| 409 | `reservation_expired` | Hold истёк до выезда | «Бронь истекла, забронируйте снова» |
| 409 | `vehicle_incompatible` | Не проходит масса/объём/длина/температура | Причины по проверкам |
| 409 | `inspection_incomplete` | Нет обязательных фото/пунктов | Список недостающего |
| 409 | `blocking_defect_open` | Открыт блокирующий дефект | «Выезд заблокирован, ждёт менеджера» |
| 409 | `photo_not_ready` | Файл не в состоянии ready | Показать статус загрузки |
| 409 | `invalid_transition` | Переход статуса не разрешён | Перечитать объект |
| 409 | `separation_of_duties_conflict` | Финансовое право + функция driver | Объяснение в диалоге назначения |
| 409 | `delegation_exceeds_grant` | Назначающий выдаёт больше, чем имеет | Подсветить лишние права |
| 409 | `last_owner_required` | Попытка снять последнего владельца | Объяснение |
| 409 | `quota_exceeded` | Нет места под загрузку | Владельцу — увеличить, остальным — сообщить |
| 409 | `downgrade_below_usage` | Новая квота ниже занятого | Сколько освободить |
| 409 | `idempotency_key_reused` | Тот же ключ, другой payload | Ошибка клиента, новый ключ |
| 409 | `idempotency_in_progress` | Команда ещё выполняется | Ждать `Retry-After` |
| 410 | `public_token_expired` / `nonce_used` | Публичная ссылка истекла | Экран «Ссылка недействительна» |
| 412 | `revision_mismatch` | Устаревший If-Match | «Данные изменились», показать свежую версию |
| 413 | `payload_too_large` | Превышен размер | Лимит в тексте |
| 422 | `validation_failed` | Ошибки полей | Ошибки у полей из `violations` |
| 422 | `odometer_decrease` | Пробег меньше начального | Ошибка у поля «Пробег» |
| 422 | `amount_invalid` | Сумма ≤ 0 или вне границ | Ошибка у поля «Сумма» |
| 428 | `revision_required` | Нет If-Match | Ошибка разработки |
| 429 | `rate_limited` | Лимит запросов | Ждать `Retry-After` |
| 503 | `dependency_unavailable` | Недоступна control DB, хранилище или IdP | «Сервис временно недоступен»; sensitive writes fail closed |

Клиентские состояния без HTTP-ответа: `offline` (нет сети, черновик на устройстве) и `timeout` (ответ не получен, результат неизвестен — перечитать перед повтором с тем же Idempotency-Key).

## Доменные события (outbox)

Имя: `<модуль>.<сущность>.<событие>.v<версия>`. Payload содержит ID и минимальные атрибуты, без restricted-полей. Потребитель идемпотентен через `outbox.inbox`.

| Событие | Потребители |
|---|---|
| `access.assignment.granted.v1`, `access.assignment.revoked.v1` | Инвалидация кеша прав, realtime, аудит |
| `access.policy.bumped.v1` | Закрытие подписок realtime, сброс курсоров |
| `modules.installation.state_changed.v1` | Меню, Data Hub, автоматизации |
| `files.object.ready.v1`, `files.object.rejected.v1` | Осмотры, формы, usage |
| `fleet.reservation.held.v1` / `.confirmed.v1` / `.expired.v1` / `.released.v1` | Календарь, уведомления |
| `fleet.inspection.submitted.v1` | Формы (ответ «Осмотр машины»), задачи |
| `fleet.defect.blocking_reported.v1` | Задача менеджеру «Срочно», уведомление |
| `fleet.trip.started.v1` / `.submitted.v1` / `.accepted.v1` / `.rework_requested.v1` | Очередь приёмки, календарь, уведомления |
| `fleet.expense.claimed.v1` / `.verified.v1` | Касса (предложение операции, S4) |
| `fleet.transfer.approved.v1` / `.revoked.v1` / `.expired.v1` | Временные grants, уведомления |
| `tenant.state_changed.v1` (control plane) | Баннеры, режим чтения |

## Дополнительные соглашения

| Тема | Правило |
|---|---|
| Имена в JSON | camelCase; enum — snake_case строки |
| Пути | Множественное число, kebab-case: `/fleet/driver-pool` |
| Версия API | `/api/v1`; несовместимое изменение — новый путь или новый ресурс, `Deprecation` + `Sunset` заголовки за 90 дней |
| Обратная совместимость | Добавление необязательного поля в ответ — совместимо; клиент игнорирует неизвестные поля ответа |
| Заголовки | `Idempotency-Key` (UUID v4) на всех изменяющих; `If-Match` на изменение ревизии; `X-Request-Id` в ответе всегда |
| Списки | Курсорная пагинация `?cursor=&limit=` (по умолчанию 50, максимум 200); `total` — только если дёшево и разрешено |
| Фильтры | `?filter[state]=on_route&sort=-startedAt`; набор фильтров объявлен в схеме |
| Даты | RFC 3339 UTC; date-only — `YYYY-MM-DD` |
| Линтер контракта | Spectral: каждая операция имеет `operationId`, `x-permissions` из `11-permissions.yaml`, `x-scope`, ответы 4xx через `Problem` |
