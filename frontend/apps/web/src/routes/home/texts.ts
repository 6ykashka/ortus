// W2.25 · Подписи «Главной» по ключам домена (`HomeMsg` из @ortus/domain/home → строка словаря `home`
// @ortus/texts). Домен решает, какая подпись и с какими аргументами; страница собирает строку ICU.
import type { HomeMsg, HomeTextKey } from '@ortus/domain/home';
import { format, home, knowledge, tasks } from '@ortus/texts';

/** Все ключи домена: объект-перечень — компилятор требует каждый ключ `HomeTextKey`. */
const KEYS: Readonly<Record<HomeTextKey, true>> = {
  greeting: true,
  summary: true,
  scopeAll: true,
  'queue.shown': true,
  'queue.criticalDefect': true,
  'queue.defectText': true,
  'queue.shiftWaits': true,
  'queue.shiftWaitsText': true,
  'queue.tripNoDriver': true,
  'queue.tripNoDriverText': true,
  'queue.poolRequested': true,
  'queue.trialEnded': true,
  'queue.trialEndedText': true,
  'queue.trialLeft': true,
  'queue.trialLeftText': true,
  'queue.storageUsed': true,
  'queue.storageText': true,
  'queue.noRole': true,
  'queue.noRoleText': true,
  'queue.chips.blocksDeparture': true,
  'queue.chips.review': true,
  'queue.chips.otherFirm': true,
  'queue.chips.today': true,
  'queue.chips.subscription': true,
  'queue.chips.storage': true,
  'queue.chips.access': true,
  'queue.actions.resolve': true,
  'queue.actions.check': true,
  'queue.actions.openPool': true,
  'queue.actions.findInPool': true,
  'queue.actions.more': true,
  'queue.actions.assign': true,
  'queue.actions.modules': true,
  // W2.73 · S2-20 1g.
  'queue.vehicleChoice': true,
  'queue.vehicleChoiceText': true,
  'queue.noVehicle': true,
  'queue.noVehicleText': true,
  'queue.chips.until': true,
  'queue.chips.tripAt': true,
  'queue.actions.keepVehicle': true,
  'queue.actions.assignVehicle': true,
  // W4.81 · Задачи участника.
  'queue.task': true,
  'queue.taskDue': true,
  'queue.chips.task': true,
  'queue.chips.taskReview': true,
  'queue.actions.open': true,
  'setup.progress': true,
  'setup.module.title': true,
  'setup.module.text': true,
  'setup.module.action': true,
  'setup.roles.title': true,
  'setup.roles.text': true,
  'setup.roles.action': true,
  'setup.invite.title': true,
  'setup.invite.text': true,
  'setup.invite.action': true,
  'work.logistics': true,
  'work.spa': true,
  'work.repair': true,
  'work.tripsToday': true,
  'work.onRoute': true,
  'work.freeVehicles': true,
  'work.freeOf': true,
  'work.awaitingReview': true,
  // W4.81 · Карточка «Задачи».
  'work.tasks': true,
  'work.tasksNew': true,
  'work.tasksProgress': true,
  'work.tasksReview': true,
  'trips.row': true,
  'trips.sub': true,
  'trips.noDriver': true,
  'trips.noVehicle': true,
};

export const HOME_TEXT_KEYS = Object.keys(KEYS) as HomeTextKey[];

/**
 * W4.81 · Подписи «Главной», которые уже есть в словарях других доменов (одна строка — один файл): «Задача» и «На
 * проверке» задач (homeVM :4083, :4113). Словарь `home` их не импортирует — `tasks` и `knowledge` сами ссылаются на него.
 */
const ELSEWHERE: Partial<Record<HomeTextKey, string>> = {
  'queue.chips.task': tasks.board.quickButton,
  'queue.chips.taskReview': knowledge.status.review,
  'work.tasksReview': knowledge.status.review,
};

/** Ключи домена, подписи которых берутся из словарей других доменов (`ELSEWHERE`). */
export const OTHER_DICTIONARY_KEYS = Object.keys(ELSEWHERE) as HomeTextKey[];

function template(key: HomeTextKey): string {
  const other = ELSEWHERE[key];
  if (other !== undefined) return other;
  const value = key
    .split('.')
    .reduce<unknown>((node, k) => (node as Record<string, unknown> | undefined)?.[k], home);
  if (typeof value !== 'string') throw new Error(`home.${key}: нет строки словаря`);
  return value;
}

/** Строка подписи: готовая строка как есть, ключ — шаблон словаря с аргументами. */
export function textOf(msg: string | HomeMsg): string {
  if (typeof msg === 'string') return msg;
  return format(template(msg.key), msg.args ?? {});
}
