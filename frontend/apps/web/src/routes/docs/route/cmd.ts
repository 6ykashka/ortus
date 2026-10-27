// W7.26 · Команда блока маршрута: ошибки диалога — внутри диалога (без тоста), остальное — тост оболочки `run`;
// успех — тост только после ответа сервера. После любой команды данные документа и маршрута перечитываются.
import { ProblemError } from '@ortus/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { problemCode, problemText, useRun } from '../../../shell/run.tsx';
import { docsKey } from './api.ts';

/** Отказы, чей текст сервера (`detail`) точнее общего: «Сейчас решение ждут: …», «Осталось попыток: 2». */
const DETAIL = new Set([
  'validation_failed',
  'forbidden_action',
  'sign_code_invalid',
  'invalid_transition',
  'separation_of_duties_conflict',
]);

/** Текст ошибки команды для показа рядом с формой. */
export function errorText(e: unknown): string {
  if (e instanceof ProblemError && DETAIL.has(e.code)) {
    const v = e.problem?.violations?.[0]?.message;
    return v ?? e.problem?.detail ?? problemText(e);
  }
  return problemText(e);
}

/** Коды, которые показывает сам диалог (тоста нет). */
export const DIALOG_CODES = [
  'validation_failed',
  'separation_of_duties_conflict',
  'invalid_transition',
  'sign_code_invalid',
  'rate_limited',
  'dependency_unavailable',
  'forbidden_action',
] as const;

/** Устаревшие данные: после этих отказов экран перечитывается. */
const STALE = new Set(['invalid_transition', 'not_found', 'forbidden_action', 'revision_mismatch']);

export function useCommand(tenantId: string) {
  const run = useRun();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  const refresh = (): Promise<unknown> =>
    qc.invalidateQueries({ queryKey: [...docsKey(tenantId)] });

  /**
   * Выполняет команду. `quiet` — коды, которые показывает вызывающий (в `error`); возвращает результат или
   * `undefined` при отказе. Успех — тост `ok`.
   */
  async function exec<R>(
    key: string,
    fn: () => Promise<R>,
    ok: string | null,
    quiet: readonly string[] = [],
  ): Promise<R | undefined> {
    setBusy(key);
    setError(undefined);
    try {
      const r = await run(key, fn, ok, { quiet });
      await refresh();
      setBusy(null);
      return r;
    } catch (e) {
      setBusy(null);
      if (quiet.includes(problemCode(e))) setError(errorText(e));
      if (STALE.has(problemCode(e))) void refresh();
      return undefined;
    }
  }

  return { busy, error, setError, exec, refresh };
}
