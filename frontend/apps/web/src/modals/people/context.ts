// W1.23 · Общее диалогов «Пользователей и ролей»: что страница передаёт диалогу (данные, подразделения,
// модули, кто я), текст ошибки сервера внутри диалога (`detail` или нарушение поля, как `e.message` эталона
// :2735) и коды, которые диалог показывает сам (без тоста, run :2419–2434 `quiet`).
import { ProblemError } from '@ortus/api-client';

import type { AccessData, Refresh } from '../../routes/company/users/data.ts';
import type { Member, Units } from '../../routes/company/users/model.ts';
import { problemText } from '../../shell/run.tsx';

export interface PeopleCtx {
  tenantId: string;
  tenantName: string;
  data: AccessData;
  units: Units;
  /** Подключён ли подключаемый модуль (`fleet`, `spa`, `repairs`) — /me/context. */
  installed: (moduleKey: string) => boolean;
  /** Карточка участника того, кто вошёл (Member.userId = MeContext.userId). */
  me: Member | undefined;
  /** Тот, кто вошёл, — владелец бизнеса (listOwners). */
  meOwner: boolean;
  /** Перечитать данные страницы (без аргумента — всё; с частями — только их). */
  refresh: Refresh;
  /**
   * Есть ли у вошедшего право хотя бы в одной области (`useCan` оболочки): действия без права не показываются
   * (возврат 16.10 №3), команду по объекту проверяет сервер.
   */
  can: (permission: string) => boolean;
}

/** Текст отказа для диалога: нарушение поля, затем `detail` сервера, затем словарь ошибок. */
export function problemMessage(e: unknown): string {
  if (e instanceof ProblemError) {
    const violation = e.problem?.violations?.[0]?.message;
    if (e.code === 'validation_failed' && violation) return violation;
    if (e.problem?.detail) return e.problem.detail;
  }
  return problemText(e);
}

/** Код ошибки команды (`offline` — сетевой сбой). */
export const codeOf = (e: unknown): string =>
  e instanceof ProblemError ? e.code : e instanceof TypeError ? 'offline' : 'unknown';
