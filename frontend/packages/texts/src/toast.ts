// W0.14 · Тосты: оболочка (toast :2414, 4200 мс; flush :2527–2551) и okText команд run(…) этапов 0–2.
// Источник: design/Ортус CRM.dc.html :2455–2800, :3323–3324, :3532–3909 (без brandingVM), :3910–3951.
// Список статических тостов заморожен фикстурой test/fixtures/toasts.json.
import { errors } from './errors.ts';
import type { TextTree } from './types.ts';

export const toast = {
  shell: {
    offline: 'Нет связи. Черновики сохраняются на устройстве',
    listRefreshed: 'Список обновлён',
    flushOk: '{label} — принято сервером',
    flushFail: '{label}: {message}',
    conflict: 'Конфликт: {message}',
  },
  driver: {
    reserveNeedsNet: 'Бронь требует связи с сервером',
    reserved: 'Бронь подтверждена сервером. Начните осмотр',
    reservationCancelled: 'Бронь отменена. Машина вернулась в пул',
    departureNeedsNet:
      'Выезд требует подтверждения сервера. Черновик осмотра сохранён на устройстве',
    departureBlocked: 'Выезд заблокирован: дефект отправлен менеджеру',
    departed: 'Выезд подтверждён сервером',
    routeFinished: 'Рейс завершён. Заполните осмотр при сдаче',
    returnSavedLocal: 'Сдача сохранена на устройстве и ещё не принята сервером',
    returnAccepted: 'Сдача принята сервером. Ожидайте приёмки',
    expenseSavedLocal: 'Расход сохранён на устройстве. Отправится при появлении связи',
    expenseAccepted: 'Расход принят сервером',
    newShift: 'Новая демо-смена',
  },
  manager: {
    shiftAccepted: 'Смена принята. Машина вернулась в пул',
    reworkSent: 'Смена возвращена водителю на доработку',
    defectAllowed: 'Выезд разрешён',
    defectConfirmed: 'Неисправность подтверждена, машина снята с рейса',
    vehicleAssigned: 'Машина назначена на рейс {trip}',
    requestSent: 'Запрос отправлен фирме {firm} · уведомления в демо не отправляются',
    firmApproved: 'Фирма {firm} одобрила запрос (демо)',
    firmDeclined: 'Фирма {firm} отклонила запрос (демо)',
    // W2.41 · справочник категорий расходов (no-reference).
    categoryAdded: 'Категория «{label}» добавлена',
    categoryArchived: 'Категория «{label}» убрана в архив',
  },
  company: {
    moduleConnected: 'Модуль «{name}» подключён',
    moduleDisconnected: 'Модуль отключён. История доступна для чтения',
    quota: 'Лимит места: {gb} ГБ',
    trialEnded: 'Пробный период завершён (демо)',
    roleAssigned: 'Роль «{role}» назначена',
    assignmentRemoved: 'Назначение снято',
    inviteCreated: 'Приглашение создано · письмо в демо не отправляется',
    roleCreated: 'Роль создана',
    roleSaved: 'Роль «{role}» сохранена',
    seatRequestCancelled: 'Заявка отменена',
    seatRequestSent: 'Заявка отправлена оператору',
    inviteRevoked: 'Приглашение отозвано, место свободно',
  },
  platform: {
    done: 'Готово · запись добавлена в журнал',
    rejectReasonRequired: 'Напишите причину отказа в поле комментария',
    lockReasonRequired: errors.mock.platform.lockReason,
    operatorActivated: 'Оператор снова активен',
    operatorInviteRevoked: 'Приглашение отозвано',
    operatorRoleChanged: 'Роль изменена: {role}',
    operatorInvited: 'Приглашение отправлено: {email}',
  },
} as const satisfies TextTree;
