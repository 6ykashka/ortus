// Справочники «Ремонта и стройки» (design/Ремонт и стройка.dc.html, Ортус CRM.dc.html 19.10):
// статусы допработ и отметок, причины отклонения, чипы статусов. Тексты — дословно из эталона.
import type { ToneKey } from '../../core/types/index.ts';
import type { MovementKind, SupplyState } from './supply-seed.ts';
import type { ChangeStatus, EstimateState, WorkLogStatus } from './types.ts';

export const CHANGE_STATUSES: readonly ChangeStatus[] = [
  'proposed',
  'priced',
  'sent',
  'signed',
  'rejected',
];

/** Причины отклонения допработы (`REJ`): прораб увидит причину во вкладке «Работы». */
export const CHANGE_REJECT_REASONS: readonly string[] = [
  'Работа уже есть в смете',
  'Заказчик отказался',
  'Сделаем по гарантии',
  'Не согласовано с заказчиком',
];

export interface StatusChip {
  label: string;
  tone: ToneKey;
  icon: string;
}

/** Чипы статусов допработы в карточке объекта (`CO_ST`). */
export const CHANGE_CHIPS: Readonly<Record<ChangeStatus, StatusChip>> = {
  proposed: { label: 'Ждёт оценки офиса', tone: 'warn', icon: 'pending' },
  priced: { label: 'Оценивается в смете', tone: 'info', icon: 'edit_note' },
  sent: { label: 'Допсоглашение у заказчика', tone: 'warn', icon: 'sms' },
  signed: { label: 'Подписано заказчиком', tone: 'ok', icon: 'verified' },
  rejected: { label: 'Отклонено', tone: 'neutral', icon: 'block' },
};

/** Чипы статусов отметки (`LS`); «Возвращён» — RS-09, в эталоне 1a кнопка «Вернуть». */
export const LOG_CHIPS: Readonly<Record<WorkLogStatus, StatusChip>> = {
  Принят: { label: 'Принят', tone: 'ok', icon: 'check_circle' },
  'На проверке': { label: 'На проверке', tone: 'warn', icon: 'pending' },
  Возвращён: { label: 'Возвращён', tone: 'neutral', icon: 'undo' },
};

/** Единицы допработы в форме прораба. */
export const CHANGE_UNITS: readonly string[] = ['шт', 'м', 'м²', 'компл'];

/** Подписи состояния сметы объекта-черновика в списке и «Требует решения». */
export const ESTIMATE_LABEL: Readonly<Record<EstimateState, string>> = {
  none: 'Смета не собрана',
  draft: 'Черновик сметы',
  sent: 'Смета у заказчика',
  approved: 'Смета согласована',
};

/** Чипы статусов заявки снабжения (SUPX). */
export const SUPPLY_CHIPS: Readonly<Record<SupplyState, StatusChip>> = {
  request: { label: 'Ждёт решения снабжения', tone: 'warn', icon: 'pending' },
  reserved: { label: 'К выдаче со склада', tone: 'info', icon: 'inventory_2' },
  ordered: { label: 'В закупке', tone: 'info', icon: 'shopping_cart' },
  bought: { label: 'Закуплено', tone: 'info', icon: 'shopping_bag' },
  issued: { label: 'Выдано со склада', tone: 'info', icon: 'move_to_inbox' },
  used: { label: 'Списано на объект', tone: 'ok', icon: 'check_circle' },
};

/** Виды движений склада (MK); движения не редактируются — ошибка исправляется обратным. */
export const MOVEMENT_KINDS: Readonly<Record<MovementKind, StatusChip>> = {
  receipt: { label: 'Приход на склад', tone: 'info', icon: 'input' },
  buy: { label: 'Закупка на объект', tone: 'info', icon: 'shopping_bag' },
  issue: { label: 'Выдача со склада', tone: 'neutral', icon: 'output' },
  return: { label: 'Возврат на склад', tone: 'ok', icon: 'undo' },
  move: { label: 'Перемещение', tone: 'neutral', icon: 'swap_horiz' },
  use: { label: 'Списание в работу', tone: 'neutral', icon: 'construction' },
};
