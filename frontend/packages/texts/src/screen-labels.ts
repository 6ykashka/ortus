// W0.14 · Невидимый атрибут data-screen-label секции страницы (скриншот-протокол, PD-37).
// prototype — 6 значений главного файла эталона 14.10 (:869, :945, :987, :1161, :1254, :1454), дословно.
// byPage — страницы этапов 0–2: значения эталона либо схема «<Роль> · <подпись меню со строчной>»
// (роль — персонаж рабочего места, бриф §10 п.5); tenants — «Оператор · организации» (Q-43, придумано).
// Только добавление; пишет стюард контракта этапа (план v2 §3.5).
import type { TextTree } from './types.ts';

const prototype = {
  usage: 'Оператор · использование',
  requests: 'Оператор · заявки',
  accounts: 'Оператор · пользователи',
  plans: 'Оператор · тарифная сетка',
  branding: 'Владелец · оформление',
  billing: 'Владелец · подписка и места',
} as const satisfies TextTree;

export const screenLabels = {
  scheme: '{role} · {label}',
  prototype,
  byPage: {
    home: 'Владелец · главная',
    modules: 'Владелец · модули и место',
    users: 'Владелец · пользователи и роли',
    billing: prototype.billing,
    branding: prototype.branding,
    fleet: 'Логист · рабочее место логиста',
    pool: 'Логист · ресурсный пул',
    review: 'Логист · приёмка смен',
    today: 'Водитель · сегодня',
    cars: 'Водитель · автомобили',
    tenants: 'Оператор · организации',
    usage: prototype.usage,
    requests: prototype.requests,
    accounts: prototype.accounts,
    plans: prototype.plans,
  },
} as const satisfies TextTree;
