// Справочники «Обращений» (service.js 19.10:66–87).
import type { Channel, RequestKind, RequestPriority, RequestStatus } from './types.ts';

export const SVC_ST: Readonly<
  Record<RequestStatus, { label: string; client: string; tone: string; icon: string }>
> = {
  new: { label: 'Новое', client: 'Получили', tone: 'info', icon: 'radio_button_unchecked' },
  work: { label: 'В работе', client: 'Отвечаем', tone: 'neutral', icon: 'pending' },
  wait: {
    label: 'Ждёт клиента',
    client: 'Ждём вашего ответа',
    tone: 'warn',
    icon: 'hourglass_top',
  },
  resolved: { label: 'Решено', client: 'Решено', tone: 'ok', icon: 'check_circle' },
  closed: { label: 'Закрыто', client: 'Закрыто', tone: 'neutral', icon: 'lock' },
};

export const SVC_FLOW: Readonly<Record<RequestStatus, readonly RequestStatus[]>> = {
  new: ['work', 'wait', 'resolved'],
  work: ['wait', 'resolved'],
  wait: ['work', 'resolved'],
  resolved: ['work', 'closed'],
  closed: [],
};

export const SVC_KIND: Readonly<Record<RequestKind, { label: string; icon: string }>> = {
  complaint: { label: 'Жалоба', icon: 'report' },
  claim: { label: 'Претензия', icon: 'gavel' },
  question: { label: 'Вопрос', icon: 'help' },
  idea: { label: 'Предложение', icon: 'lightbulb' },
  thanks: { label: 'Благодарность', icon: 'favorite' },
  warranty: { label: 'Гарантийный случай', icon: 'verified_user' },
  cargo: { label: 'Повреждение или недостача груза', icon: 'inventory_2' },
};

/** Канал: подпись и иконка. */
export const SVC_CH: Readonly<Record<Channel, readonly [label: string, icon: string]>> = {
  sms: ['SMS', 'sms'],
  bot: ['Бот в Telegram', 'smart_toy'],
  cabinet: ['Кабинет заказчика', 'home_work'],
  widget: ['Виджет на сайте', 'web'],
  phone: ['Звонок', 'call'],
  qr: ['QR в салоне', 'qr_code_2'],
};

export const SVC_PRIO: Readonly<Record<RequestPriority, string>> = {
  low: 'Низкий',
  normal: 'Средний',
  high: 'Высокий',
};

export const OUTCOMES: readonly string[] = [
  'Устранено',
  'Разъяснено',
  'Компенсация',
  'Не подтвердилось',
  'Дубль',
];
export const OUTCOMES_ABOUT: readonly string[] = ['Подтвердилась', 'Не подтвердилась'];
export const COMPENSATIONS: readonly string[] = [
  'Скидка 20% на следующий визит',
  'Скидка 10% на следующую работу',
  'Бесплатное повторное посещение',
  'Возврат денег — через кассу',
];

/** Итоги решения: у жалобы на сотрудника — только «Подтвердилась» / «Не подтвердилась». */
export const outcomesFor = (r: { about?: string | undefined }): readonly string[] =>
  r.about ? OUTCOMES_ABOUT : OUTCOMES;

/** Текст ошибки недопустимого перехода (`svcTransition`) или `null`. */
export function flowError(from: RequestStatus, to: RequestStatus): string | null {
  if ((SVC_FLOW[from] ?? []).includes(to)) return null;
  return 'Из статуса «' + SVC_ST[from].label + '» в «' + SVC_ST[to].label + '» перейти нельзя';
}
