// W0.14 · «Главная»: начало работы, «Требует решения», «Сегодня в работе», «Рейсы сегодня», события.
// Источник: design/Ортус CRM.dc.html :1708–1779, homeVM :4043–4135 (источники этапов 0–2: логистика,
// подписка, место, доступ). Подписи других доменов — ссылками на файлы-владельцы.
import { company } from './company.ts';
import { gate } from './gate.ts';
import { logisticsDriver } from './logistics-driver.ts';
import { platform } from './platform.ts';
import { shell } from './shell.ts';
import type { TextTree } from './types.ts';

export const home = {
  demoDate: 'Среда, 1 октября', // захардкожено в эталоне :4126 (Q-61: станет вычисляемой датой)
  dateLine: '{date} · {scope}',
  scopeAll: '{tenant} · все подразделения',
  greeting: '{part, select, morning {Доброе утро} day {Добрый день} other {Добрый вечер}}, {name}',
  summary:
    '{n, plural, =0 {Срочных вопросов нет.} other {Требует решения: #. Сначала то, что блокирует работу.}}',

  setup: {
    title: 'Начало работы',
    progress: '{done} из {total}',
    module: {
      title: 'Подключить отраслевой модуль',
      text: 'Например, «Логистика» — машины, рейсы, осмотры и приёмка смен',
      action: shell.nav.items.modules,
    },
    roles: {
      title: 'Назначить роли с областью',
      text: 'Подключение модуля не выдаёт доступ: сотрудникам нужна роль на фирму или регион',
      action: company.users.assignRole,
    },
    invite: {
      title: 'Пригласить сотрудников',
      text: 'Рабочих бригады можно вести карточками без аккаунта',
      action: company.users.invite,
    },
  },

  queue: {
    title: 'Требует решения',
    shown: 'показано {shown} из {total}',
    empty: 'Решений не требуется. Новые вопросы появятся здесь.',
    chips: {
      blocksDeparture: 'Блокирует выезд',
      review: shell.nav.bottom.review,
      otherFirm: 'Ждёт другой фирмы',
      today: 'Сегодня {time}',
      subscription: 'Подписка',
      storage: platform.tenants.fields.storage,
      access: 'Доступ',
      // W2.73 · S2-20 1g («Временный водитель - варианты.dc.html» :479, :487; design-2026-10-19b).
      until: 'до {time}',
      tripAt: 'рейс в {time}',
    },
    // W2.73 · S2-20 1g: водитель ещё не выбрал машину, нет машины (:476–491).
    vehicleChoice: '{trip}: водитель ещё не выбрал машину',
    vehicleChoiceText:
      '{driver}, {firm}. Не выберет — останется {host}, {home} вернётся в {firm}. Написать водителю можно в чате рейса.',
    noVehicle: '{trip}: нет машины',
    noVehicleText:
      '{firm} выдал {driver} без обычной машины. Водитель получит уведомление и сразу начнёт осмотр.',
    criticalDefect: 'Критический дефект · рейс {trip}',
    defectText: '{zone}: {description} · {driver}', // :4053
    shiftWaits: 'Смена {trip} ждёт приёмки',
    shiftWaitsText: '{driver} · машина не вернётся в пул до решения',
    tripNoDriver: 'Рейс {trip} без водителя',
    tripNoDriverText: '{title} · {cargo}', // :4057
    poolRequested: 'Запрос в пул отправлен, решение за фирмой {firm}',
    trialEnded: company.modules.trial.restrictedTitle,
    trialEndedText: 'Новые операции ограничены, данные сохранены',
    trialLeft:
      'Пробный период: осталось {days, plural, one {# день} few {# дня} many {# дней} other {# дня}}',
    trialLeftText: 'До {date}. После окончания история останется доступной для чтения',
    storageUsed: 'Занято {pct}% места',
    storageText: '{used} из {quota} ГБ',
    noRole:
      '{n, plural, one {# сотрудник} few {# сотрудника} many {# сотрудников} other {# сотрудника}} без роли',
    noRoleText: '{names} — нет доступа к модулям',
    retry: logisticsDriver.inspection.retry,
    actions: {
      resolve: 'Решить',
      check: 'Проверить',
      openPool: 'Открыть пул',
      findInPool: 'Найти в пуле',
      more: 'Подробнее',
      assign: company.dialogs.assign.submit,
      modules: shell.nav.items.modules,
      // W2.73 · S2-20 1g (:482, :490).
      keepVehicle: 'Оставить {vehicle}',
      assignVehicle: 'Поставить машину',
    },
  },

  work: {
    title: 'Сегодня в работе',
    logistics: shell.nav.groups.logistics,
    spa: shell.nav.items.spa,
    repair: shell.nav.groups.repair,
    tripsToday: 'Рейсов сегодня',
    onRoute: 'В пути',
    freeVehicles: 'Свободных машин',
    freeOf: '{free} из {total}',
    awaitingReview: 'Ждут приёмки',
    off: gate.chips.moduleOff,
    connect: company.modules.industry.connect,
  },

  trips: {
    title: 'Рейсы сегодня',
    row: '{trip} · {title}', // :4134
    sub: '{driver} · {vehicle}',
    noDriver: 'без водителя',
    noVehicle: 'машина не выбрана',
  },

  events: {
    title: 'Последние события',
    empty: 'Событий пока нет',
  },
} as const satisfies TextTree;
