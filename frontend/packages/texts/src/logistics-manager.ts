// W0.14 · Логистика, логист и владелец: «Рабочее место логиста», «Ресурсный пул», «Приёмка смен»,
// диалоги «Запросить водителя» и «Принять смену». Источник: design/Ортус CRM.dc.html :428–662,
// :2264–2272, accept/rework/decideDefect :2764–2790, fleetVM :3249–3307, poolVM :3309–3328,
// reviewVM :3330–3382, modalVM request :4035–4037. Тосты — toast.manager.
import { company } from './company.ts';
import { home } from './home.ts';
import { logisticsDriver } from './logistics-driver.ts';
import { shell } from './shell.ts';
import type { TextTree } from './types.ts';

/** W2.41 · Признак категории расходов (ExpenseCategory.commentRequired): строка списка и флажок формы. */
const COMMENT_REQUIRED = 'Комментарий обязателен';

export const logisticsManager = {
  fleet: {
    intro:
      'Подбор машины под рейс: доступность, грузоподъёмность, объём, длина кузова и температура.',
    emptyScope: 'В выбранной области нет рейсов',
    emptyScopeHint:
      'Смените область в верхней панели — рейсы демо запланированы в «Москва / Север Логистик».',
    tripsAria: 'Рейсы',
    pick: 'Подбор транспорта · {trip}',
    filterAria: shell.a11y.filter,
    filters: { all: 'Все', fit: 'Подходят', free: 'Свободны' },
    stats: {
      free: 'свободно',
      busy: 'в брони или рейсе',
      review: 'ждут приёмки',
      unavailable: 'недоступно',
    },
    assign: 'Назначить на рейс',
    assignedTo: 'Назначена на {trip}',
    unfit: 'Не подходит',
    unavailable: 'Недоступна',
    loadShown: 'Загрузка показана',
    showLoad: 'Показать загрузку',
    noMatch:
      'По фильтру машин нет. Сбросьте фильтр или запросите машину у другой фирмы через логиста региона.',
    compatNote:
      'Совместимость считается по сумме объёма и массы груза. Это не 3D-укладка и не проверка осевой нагрузки. Окончательно бронь подтверждает сервер.',
    pickVehicle: 'Выберите машину, чтобы увидеть загрузку',
    trip: {
      cargo: 'Груз',
      requirements: 'Требования',
      driver: 'Водитель',
      vehicle: logisticsDriver.today.steps.vehicle,
      route: logisticsDriver.today.route,
      notAssigned: 'Не назначен',
      notChosen: 'Не выбрана',
      driverPicks: 'Выберет водитель при брони или назначит логист',
      findDriver: 'Найти водителя в пуле',
      legs: 'Маршрут и загрузка по участкам',
      volume: 'Объём',
      mass: 'Масса',
      body: 'Кузов от {length} м{temp, select, none { · без температурного режима} other { · {temp}}}',
      load: 'Погрузка +{volume} м³ · {mass} т',
      unload: 'Выгрузка −{volume} м³ · {mass} т',
      afterStop: 'В кузове после точки: {volume} м³ · {mass} т',
    },
    navigator: 'Передать в навигатор · интеграция не подключена',
    // W2.20 · шаблоны значений fleetVM :3263–3304 (конкатенации эталона).
    crumbAll: home.scopeAll,
    crumbRegion: 'Регион {region}',
    tripTitle: '{trip} · {title}',
    tabSub: '{window} · {state}',
    vehicleSub: '{body} · {unit} · {depot}',
    stateNote: '{state} · {note}',
    check: '{label}: {value}{need, select, none {} other { (нужно {need})}}',
    legFor: 'Для {model} · {volume} м³ · {mass} т. Объём и масса считаются раздельно.',
    tripWhen: '{date} · {window}',
    cargoValue: '{kind} · {mass} т · {volume} м³',
    vehicleValue: '{model} · {plate}',
    routeValue:
      '{count, plural, one {# точка} few {# точки} many {# точек} other {# точки}} · {km} км',
  },

  pool: {
    crumb: 'Москва / межфирменный ресурсный пул', // захардкожено в эталоне :525
    intro:
      'Свободные водители других фирм группы. Показан минимум сведений, разрешённый владеющей фирмой. Запрос не даёт доступа до одобрения.',
    free: 'Свободен',
    terms: 'Условия',
    requestFor: 'Запросить на рейс {trip}',
    pending: 'Ожидает решения менеджера фирмы {firm}. Доступа к водителю пока нет.',
    demoAnswer: 'Демо: ответ фирмы-владельца',
    approve: 'Одобрить',
    decline: 'Отклонить',
    declined: 'Запрос отклонён. Можно запросить другого водителя.',
    chips: { sent: 'Запрос отправлен', temporary: 'Временно назначен', rejected: 'Отклонён' },
    tempAssigned:
      '{driver} назначен на рейс {trip} до {until}. Доступ ограничен этим рейсом; история и начисления остаются в фирме {firm}.',
    hiddenTitle: 'Что скрыто в пуле',
    hidden: {
      contacts: 'ФИО и личный телефон — до одобрения',
      rates: 'Ставки и начисления другой фирмы',
      history: 'История рейсов и текущие задания',
      documents: 'Документы сверх согласованного объёма',
    },
    afterApproval:
      'После одобрения создаётся временное назначение на конкретный рейс со сроком. История и начисления остаются в домашней фирме.',
    // W2.23 · шаблоны pg.pool :528 (design-stage-2), тосты saveRequest :2819 и демо-ответа :3314–3315 без демо-хвостов (PD-54).
    qualHome: '{qual} · {home}',
    requestSent: 'Запрос отправлен фирме {firm}',
    firmApproved: 'Фирма {firm} одобрила запрос',
    firmDeclined: 'Фирма {firm} отклонила запрос',
    // W2.73 · S2-20 (D-35), «Временный водитель - варианты.dc.html» design-2026-10-19b: 1b — входящий запрос фирмы
    // водителя (:197–228, b :571–576); 1f — итог запроса у логиста (:426–460, f :609–625).
    incoming: {
      who: '{name} · {driver}',
      asks: '{firm} просит на рейс {trip}',
      waiting: 'Ждёт решения',
      when: 'Когда',
      whenValue: '{date}, {window} · доступ до {until}',
      carChoice: 'Их {host} или ваша {home} — на выбор водителя',
      carHost: 'Их {host} · {plate}',
      carHome: 'Ваша {home} · {plate}',
      yours: 'Ваша машина',
      freeFor: 'Свободна {window}',
      holdChoice:
        'Удерживается на {window}, пока водитель выбирает (до {until}). Не выберет её — сразу вернётся к вам.',
      holdHome: 'Занята на {window} рейсом {trip} {firm}.',
      defects:
        'Осмотры и дефекты по этому рейсу видите вы. Решение по блокирующему дефекту — тоже за вами.',
      opens: 'Что откроется {firm}',
      opensDriver: 'Имя и телефон водителя до {until}',
      opensVehicle: 'По машине: модель, номер, габариты, осмотры этого рейса',
      hidden: 'Начисления, история рейсов, другие машины {firm}',
      approveWithVehicle: 'Одобрить с машиной',
      driverOnly: 'Только водителя',
      note: 'Отклонить можно только с причиной. Начисления по рейсу ведутся отдельной записью, {firm} их не получает автоматически.',
    },
    transfer: {
      accessValue: 'До {until}, только этот рейс',
      vehicles: 'Машины рейса',
      usualFirm: '{firm} · обычная машина водителя',
      ourFirm: '{firm} · наша',
      chosen: 'Выбрана · {time}',
      released: 'Освобождена · {time}',
      none: 'Машины нет: {firm} выдал водителя без обычной машины.',
      assignVehicle: home.queue.actions.assignVehicle,
      journal: 'Журнал',
      requested:
        'Вы запросили водителя. Машина: {mode, select, host_or_home {наша {host}, можно свою обычную} host {наша {host}} other {обычная машина водителя}}.',
      approved:
        '{firm} одобрил {what, select, both {водителя с машиной.} driver {только водителя, без машины.} other {водителя.}}',
      holds: 'Брони до выбора на {window}: {host} и {home}.',
      chose: 'Водитель выбрал {chosen}. {other} освобождена.',
      one: 'Бронь {vehicle} на {window}.',
      noVehicle: 'Машины нет, рейс попал в «Требует решения».',
      deadline:
        'Если водитель не выбирает до {until}, остаётся {host}, а {home} возвращается в {firm}.',
    },
  },

  review: {
    intro:
      'Фото до и после, пробег, дефекты и расходы. Машина возвращается в пул свободных только после приёмки.',
    empty: 'Нет смен на проверке',
    emptyHint:
      'Когда водитель сдаст машину, смена появится здесь. В демо переключитесь на водителя и пройдите смену.',
    demoAsDriver: 'Демо: открыть как водитель',
    critical: 'Критический дефект · {vehicle}',
    criticalText:
      'Выезд заблокирован до решения. Машина недоступна для броней. Чек-лист приложения не заменяет обязательный технический допуск.',
    allowDeparture: 'Дефект некритичный — разрешить выезд',
    confirmDefect: 'Подтвердить неисправность',
    vehicleRemoved: 'Машина снята с рейса',
    photos: 'Фото до и после',
    before: 'Перед выездом',
    after: 'При сдаче',
    stats: {
      odometerStart: 'Пробег при выезде',
      driven: 'Пройдено',
      fuel: logisticsDriver.expenseKinds.fuel, // «Топливо» — одна строка, один файл (W2.40)
    },
    inspection: 'Осмотр и дефекты',
    noDefects: 'Дефекты не отмечены',
    driverComment: 'Комментарий водителя:',
    expenses: 'Расходы в пути',
    noExpenses: 'Расходов нет',
    total: 'Итого заявлено',
    earnings: 'Начисление водителю за рейс',
    earningsNote:
      'Видно владельцу и менеджеру с правом fleet.earnings.read в своей области. Водителю не показывается и не передаётся.',
    decision: 'Решение',
    remarks: 'Замечания для водителя',
    remarksPlaceholder: 'Например: переснимите фото слева — не виден бампер',
    reworkWhat: 'Что вернуть на доработку',
    rework: 'Вернуть на доработку',
    accept: 'Принять смену',
    reworkSteps: {
      photos: 'Фото при сдаче',
      odometer: 'Пробег',
      expenses: logisticsDriver.expenses.title,
      checklist: 'Чек-лист и дефекты',
    },
    acceptedAt: 'Смена принята в {time}. Машина вернулась в пул свободных.',
    returned: 'Возвращено водителю: «{comment}». Исправить: {steps}.',
    acceptDialog: {
      title: 'Принять смену {trip}?',
      text: 'Осмотр, пробег и расходы будут подтверждены.',
      vehicleBack: 'Машина вернётся в пул свободных',
      expenses: 'Расходы станут принятыми; кассовые операции создаются отдельно',
      earnings: 'Будет создано начисление водителю. Его видят владелец и уполномоченный менеджер',
    },
  },

  request: {
    title: 'Запросить водителя',
    trip: logisticsDriver.today.steps.trip,
    period: 'Срок',
    periodValue: 'Временно, до 18:00 01.10', // захардкожено в эталоне design-stage-2 :4027
    approver: 'Согласует',
    approverValue: 'Менеджер фирмы {firm}',
    comment: 'Комментарий для фирмы-владельца',
    commentPlaceholder: shell.form.optional,
    note: 'После одобрения создаётся временное назначение только на этот рейс. История и начисления водителя остаются в его фирме.',
    submit: 'Отправить запрос',
    // W2.23 · шаблоны modalVM :4027 и openRequest :2816 (конкатенации эталона design-stage-2).
    driverValue: '{driver} · {firm}',
    tripValue: '{trip} · {title} · {window}',
    periodUntil: 'Временно, до {until}',
    // W2.73 · S2-20 (D-35) 1a — блок «Машина» (Временный водитель - варианты.dc.html :145–183, renderVals
    // :531–559; design-2026-10-19b).
    driverQualValue: '{driver} · {firm} · {qual}',
    tripDateValue: '{trip} · {title} · {date}, {window}',
    cargo: 'Груз',
    cargoValue:
      '{mass} т · {volume} м³ · кузов от {length} м{temp, select, none {} other { · {temp}}}',
    access: home.queue.chips.access,
    accessValue: 'С одобрения до {until}, только этот рейс',
    vehicle: logisticsDriver.today.steps.vehicle,
    home: 'Едет на своей обычной',
    homeSpecs: '{body} · {mass} т · {volume} м³ · кузов {length} м · {temp}',
    noCooling: logisticsDriver.vehicle.noCooling,
    noCoolingReason: 'нет охлаждения',
    homeFits: 'Подходит рейсу · свободна {window}',
    homeNoFit: 'Не подходит рейсу: {reason}',
    homeApprove: 'Машину тоже согласует {firm}.',
    host: 'Ставим нашу машину',
    hostFits: 'подходит',
    hostCount:
      'Рейсу подходит {fit} из {free} {free, plural, one {свободной машины} few {свободных машин} many {свободных машин} other {свободных машин}}{firm, select, none {} other { {firm}}}.',
    choice: 'Можно взять свою обычную',
    choiceHint: 'Водитель выберет в день рейса до {until}: {host} или свою {home}.',
    choiceOff: 'Недоступно: обычная машина не подходит рейсу, {reason}.',
    after: 'Что произойдёт после одобрения',
    sum: {
      blocked: 'Обычная машина не подходит рейсу. Выберите «Ставим нашу машину».',
      choiceHolds:
        'Две брони до выбора на {window}: {host} и {home}. До рейса {brand} работает в {firm}.',
      choiceUntil: 'Водитель выберет машину до {until}. Вторая бронь снимется сразу.',
      choiceDefault: 'Не выберет — останется {host}, {brand} вернётся в {firm}.',
      host: 'Бронь {host} на {window}.',
      hostStart: 'Водителю нечего подтверждать: он сразу начинает осмотр.',
      home: 'Бронь {home} на {window}, если {firm} одобрит машину.',
      homeOnly: 'Одобрят только водителя — рейс попадёт в «Требует решения», машину поставите вы.',
      access:
        'Доступ водителя — только к рейсу {trip} до {until}. История и начисления остаются в {firm}.',
    },
  },

  // W2.41 · «Категории расходов» (company-expense-categories, ответ владельца 17.10 на D-12 комплекта, ADR-0013):
  // справочник тенанта. Экрана в эталоне нет (no-reference, Q-W2.40-3) — подписи по умолчанию исполнителя.
  expenseCategories: {
    intro:
      'Категории, которые водители выбирают в расходах рейса. Шесть категорий есть у каждой организации, свои можно добавить и убрать в архив.',
    activeAria: 'Активные категории',
    archivedAria: 'Категории в архиве',
    commentRequired: COMMENT_REQUIRED,
    seeded: 'Набор по умолчанию',
    notArchivable: 'Не убирается в архив',
    archive: 'В архив',
    archiveNamed: 'Убрать в архив: {label}',
    archiveDialog: {
      title: 'Убрать «{label}» в архив?',
      text: 'Водители больше не смогут выбрать её в новых расходах. Расходы с этой категорией сохранятся.',
      confirm: 'Убрать в архив',
    },
    showArchive: 'Показать архив ({n})',
    hideArchive: 'Скрыть архив',
    archivedSince: 'В архиве с {date}',
    archiveEmpty: 'В архиве пока нет категорий',
    readOnly: 'Организация только для чтения: категории можно посмотреть, но не изменить.',
    loadFailed: 'Не удалось загрузить категории: {error}',
    retry: logisticsDriver.inspection.retry,
    form: {
      title: 'Новая категория',
      name: company.dialogs.createRole.name,
      namePlaceholder: 'Например: Стоянка на ночь',
      nameRequired: 'Укажите название категории',
      commentRequired: COMMENT_REQUIRED,
      commentHint: 'Водитель не сохранит расход без комментария.',
      add: logisticsDriver.inspection.add,
    },
  },
  /**
   * W2.71 (0.6.3-stage2, S2-20): заголовки уведомлений о машине для временного водителя — фирме машины («выбрана»,
   * «освобождена»), логисту фирмы рейса («водитель выбрал»), водителю («машину поставили», «выберите машину»).
   * Без эталона (no-reference, Q-W2.70-13); те же заголовки — MSW `OFFER_NOTIFY`, backend W2.72.
   */
  vehicleOfferNotify: {
    chosen: 'Машина {vehicle} выбрана на рейс {trip}',
    released: 'Машина {vehicle} освобождена: рейс {trip}',
    driverChose: 'Водитель выбрал машину на рейс {trip}: {vehicle}',
    assigned: 'Машину поставили на рейс {trip}: {vehicle}',
    choose: 'Выберите машину на рейс {trip}',
  },
} as const satisfies TextTree;
