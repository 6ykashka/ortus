// W0.14 · Логистика, водитель: «Моя смена» (страница «Сегодня»), «Автомобили», фото-слот, осмотр, расходы,
// сдача, офлайн-очередь. Источник: design/Ортус CRM.dc.html :663–867, :2493–2640, photoVM :3384–3401,
// carCards :3403–3420, driverVM :3422–3531. Тосты — toast.driver; сообщения сервера — errors.mock.logistics.
// Общие подписи логистики («Машина», «Рейс», «Маршрут», «Расходы») — здесь; logistics-manager ссылается.
import { errors } from './errors.ts';
import { shell } from './shell.ts';
import type { TextTree } from './types.ts';

export const logisticsDriver = {
  today: {
    title: 'Моя смена',
    stepsAria: 'Этапы смены',
    steps: {
      vehicle: 'Машина',
      inspection: 'Осмотр',
      trip: 'Рейс',
      return: 'Сдача',
      review: shell.nav.bottom.review,
    },
    conflictTitle: shell.demo.flags.conflict,
    refresh: 'Обновить список',
    choose: 'Выберите машину',
    chooseHint: 'Машины вашей фирмы. Неподходящие отмечены с причиной.',
    fits: 'Подходит рейсу: масса, объём, длина и температура',
    noneTitle: 'Нет подходящих свободных машин',
    noneHint:
      'Обновите список позже или обратитесь к логисту — он может назначить машину другой фирмы через пул.',
    reservedLine: 'Бронь подтверждена сервером · {details}',
    cancelReservation: 'Отменить бронь',
    rework: 'Менеджер вернул смену на доработку',
    reworkFix: 'Исправить: {steps}',
    blocked: 'Выезд заблокирован',
    blockedText:
      'Критический дефект «{defect}» отправлен менеджеру на проверку. Машина недоступна для выезда.',
    blockedHint:
      'Менеджер может разрешить выезд, если дефект некритичный, или снять машину с рейса.',
    otherVehicle: 'Выбрать другую машину',
    route: 'Маршрут',
    stopsMarked: 'Отмечено {done} из {total}',
    load: 'погрузка {volume} м³',
    unload: 'выгрузка {volume} м³',
    arrived: 'Прибыл',
    undo: shell.actions.revert,
  },

  vehicle: {
    assignedByManager: 'Назначена логистом',
    yours: 'Ваша бронь',
    checking: 'Проверяем на сервере…',
    confirmReserve: 'Подтвердить бронь',
    reserve: 'Забронировать',
    inShift: 'Машина в вашей смене',
    shiftRunning: 'Смена уже идёт',
    unfit: 'Не подходит рейсу',
    unavailable: 'Бронь недоступна',
    noCooling: 'без охлаждения',
  },

  notes: {
    offlineReserve: 'Нет связи: бронь требует подтверждения сервера.',
    trialReserve: 'Пробный период организации завершён: новые брони недоступны.',
    moduleReserve: 'Модуль «Логистика» отключён: новые брони недоступны.',
    offlineDeparture:
      'Нет связи: выезд требует подтверждения сервера. Черновик сохранён на устройстве.',
    offlineReturn:
      'Нет связи: сдача сохранится на устройстве и отправится позже. До подтверждения сервера машина не считается сданной.',
  },

  inspection: {
    departure: 'Осмотр перед выездом',
    return: 'Осмотр при сдаче',
    photos: 'Фото · {n} из 5',
    retry: 'Повторить',
    demoPhoto: 'Демо: добавить фото',
    photoHint: 'Нажмите на слот, чтобы снять камерой или выбрать файл. Файлы остаются в браузере.',
    fuel: 'Уровень топлива',
    checklist: 'Чек-лист',
    defects: 'Дефекты',
    addDefect: 'Добавить дефект',
    noDefects: 'Не отмечены',
    criticalChip: 'Критический — выезд невозможен',
    removeDefect: 'Удалить дефект',
    where: 'Где',
    description: 'Описание',
    descriptionPlaceholder: 'Например: трещина на лобовом стекле справа',
    critical: 'Критический — машина не может выехать',
    add: 'Добавить',
    defectRequired: 'Опишите дефект',
    commentForManager: 'Комментарий для менеджера',
    lastOdometer: 'Последний зафиксированный пробег: {km} км',
    departureOdometer: 'Пробег при выезде: {km} км — значение не может быть меньше',
    sending: 'Отправляем…',
    sendToManager: 'Отправить на проверку менеджеру',
    depart: 'Выехать на маршрут',
    submitReturn: shell.demo.guidePanel.steps.submitted,
    saveReturnLocal: 'Сохранить сдачу на устройстве',
  },

  photo: {
    empty: 'Не снято',
    uploading: 'Загрузка {progress}%',
    failed: 'Ошибка загрузки',
    queued: 'На устройстве · ждёт связи',
    readyDemo: 'Загружено · демо',
    ready: 'Загружено',
    aria: '{label}: {status}. Нажмите, чтобы снять или выбрать фото',
  },

  expenses: {
    title: 'Расходы',
    add: shell.demo.guidePanel.steps.expense,
    empty: 'Расходов пока нет',
    category: 'Категория',
    amount: 'Сумма, ₽',
    date: 'Дата',
    liters: 'Литры',
    litersPlaceholder: 'Необяз.',
    comment: 'Комментарий',
    commentPlaceholder: 'Например: АЗС на Ленинградском шоссе',
    receipt: 'Фото чека',
    demoReceipt: 'Демо-фото чека',
    receiptShort: 'Чек',
    save: 'Сохранить расход',
    saveLocal: 'Сохранить на устройстве',
  },

  finish: {
    note: 'После завершения рейса нужен осмотр при сдаче.',
    action: 'Завершить рейс',
  },

  finishDialog: {
    title: 'Завершить рейс {trip}?',
    text: 'Дальше — осмотр при сдаче: 5 фото, пробег, топливо и чек-лист.',
    attention: 'Внимание',
    stopsMarked: 'Отмечено точек: {done} из {total}. Убедитесь, что доставка выполнена.',
  },

  states: {
    awaitingReview: 'Ожидает приёмки менеджером',
    awaitingText: 'Сервер принял сдачу. Машина вернётся в пул свободных после приёмки.',
    demoAsManager: 'Демо: открыть как логист',
    savedLocal: 'Сдача сохранена на устройстве',
    savedLocalText:
      'Сервер ещё не принял сдачу, поэтому машина не считается сданной. Отправка начнётся автоматически, когда появится связь.',
    accepted: 'Смена принята',
    acceptedText: 'Менеджер подтвердил осмотр и расходы. Машина снова доступна для назначения.',
    newShift: 'Начать новую демо-смену',
    left: 'Осталось: {missing}',
    criticalNote: 'Отмечен критический дефект. Выезд будет заблокирован, осмотр уйдёт менеджеру.',
  },

  outbox: {
    returnLabel: 'Сдача машины',
    sending: 'Отправляется…',
    sendError: 'Ошибка отправки: {message}',
    pending: 'Ожидает отправки',
    accepted: 'Принято сервером',
    chips: {
      local: 'Локальный черновик',
      sending: 'Отправляется',
      error: errors.fallback,
      device: 'На устройстве',
    },
    lostNet: 'Связь снова пропала',
    photosFailed: 'Не все фото загрузились — повторите',
  },

  cars: {
    intro: 'Машины вашей фирмы и их состояние. Бронь подтверждает сервер.',
    empty: 'По фильтру машин нет',
    fitTrip: 'Подходят к рейсу',
  },

  /**
   * W2.40: категории расходов — коды TripExpenseCreate.kind контракта 0.5.1-stage2 (ответ владельца 17.10 на
   * D-12 комплекта, ADR-0013). «Топливо», «Мойка» — EXPENSE_CAT эталона; остальные — из ответа (Q-W2.40-3).
   */
  expenseKinds: {
    fuel: 'Топливо',
    wash: 'Мойка',
    parking: 'Парковка',
    toll: 'Платная дорога',
    tire_service: 'Шиномонтаж и мелкий ремонт',
    other: 'Прочее',
  },
} as const satisfies TextTree;
