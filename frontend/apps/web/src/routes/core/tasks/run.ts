// W4.12 · Команды «Задач»: тост ошибки — сообщение модуля дословно (`detail` сервера: эталон показывает текст ошибки
// модуля — «Задачи и проекты.dc.html»:340, оболочка гасит только коды validation, transition, forbidden). Прочие коды
// («нет связи», 412, 429…) — тосты оболочки (`useRun`).
import { ProblemError } from '@ortus/api-client';
import { errors } from '@ortus/texts';
import { useCallback } from 'react';

import { problemCode, problemText, useRun } from '../../../shell/run.tsx';
import { TOAST_MS, type ToastTone, useToast } from '../../../shell/toast.tsx';

/**
 * Второй тост — когда погаснет первый: тост оболочки один, и новый сразу затёр бы предыдущий («Задача … создана»,
 * затем «Не прикреплено: …» — Q-W4.12-6).
 */
export function toastNext(
  toast: (text: string, tone?: ToastTone) => void,
  text: string,
  tone: ToastTone = 'error',
): void {
  setTimeout(() => toast(text, tone), TOAST_MS);
}

/** Коды, у которых экран показывает текст сервера (сообщение модуля), а не общий текст по коду. */
export const DETAIL_CODES = [
  'validation_failed',
  'invalid_transition',
  'forbidden_action',
  'not_found',
  'conflict',
  'delegation_exceeds_grant',
] as const;

/**
 * Текст ошибки для формы или тоста: у 422 — сообщение первого поля (`detail` проверки схемы может быть общим), иначе
 * сообщение сервера, иначе текст оболочки по коду.
 */
export function detailOf(e: unknown): string {
  if (!(e instanceof ProblemError)) return problemText(e);
  // Коды оболочки (429, 412, 5xx…) — её текст по коду, как в тосте (сообщение модуля — только у DETAIL_CODES).
  if (!(DETAIL_CODES as readonly string[]).includes(e.code)) return problemText(e);
  const field = e.code === 'validation_failed' ? e.problem?.violations?.[0]?.message : undefined;
  return field || e.problem?.detail || problemText(e);
}

export type TasksRun = <R>(
  key: string,
  fn: () => Promise<R>,
  okText?: string | null,
  o?: { inline?: boolean },
) => Promise<R>;

/**
 * Все коды ошибок, которые знает оболочка (реестр Problem, статусы без тела, «нет связи»): форма с `inline` показывает
 * любую ошибку сама, и тоста оболочки поверх неё нет (ревью W4.12 r1: «нет связи» не дважды).
 */
const ALL_CODES: readonly string[] = [
  ...Object.keys(errors.problem),
  ...Object.keys(errors.http),
  'offline',
  'unknown',
];

/**
 * `run` оболочки с текстом сервера для отказов модуля. `inline` — ошибку показывает форма (панель «Новый проект»,
 * диалог «Новая задача»): тоста нет ни по одному коду, текст — `detailOf`. Исключение всегда пробрасывается.
 */
export function useTasksRun(): TasksRun {
  const run = useRun();
  const toast = useToast();
  return useCallback<TasksRun>(
    async (key, fn, okText, o = {}) => {
      try {
        return await run(key, fn, okText, { quiet: o.inline ? ALL_CODES : DETAIL_CODES });
      } catch (e) {
        const code = problemCode(e);
        if (!o.inline && (DETAIL_CODES as readonly string[]).includes(code)) {
          toast(detailOf(e), 'error');
        }
        throw e;
      }
    },
    [run, toast],
  );
}
