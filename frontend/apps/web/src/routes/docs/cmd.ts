// W7.25 · Команды диалогов «Документов»: ошибки 422 — под полем (нарушение поля, затем detail), 409/412/404 — тост
// оболочки и перечитывание, диалог открыт; успех — тост после ответа сервера (`run`, quiet для validation_failed).
import { ProblemError } from '@ortus/api-client';
import { useState } from 'react';

import { problemCode, problemText, useRun } from '../../shell/run.tsx';

/** Отказы, после которых данные на экране устарели: перечитать (тост — у `run`). */
const STALE = new Set(['invalid_transition', 'revision_mismatch', 'not_found', 'document_locked']);

/** Нарушения 422 по полям формы: `field → текст`; без своего поля — общий текст. */
export function violationsOf(e: unknown): { byField: Record<string, string>; general?: string } {
  if (!(e instanceof ProblemError) || e.code !== 'validation_failed') return { byField: {} };
  const byField: Record<string, string> = {};
  let general: string | undefined;
  for (const v of e.problem?.violations ?? []) {
    const key = v.field.replace(/\[\d+\].*$/, '').replace(/\..*$/, '');
    if (key && !byField[key]) byField[key] = v.message;
    else general ??= v.message;
  }
  if (!Object.keys(byField).length) general ??= e.problem?.detail ?? problemText(e);
  return general === undefined ? { byField } : { byField, general };
}

/** Текст ошибки команды: первое нарушение поля, затем пояснение сервера, затем текст по коду. */
export function reasonOf(e: unknown): string {
  const v = violationsOf(e);
  const first = Object.values(v.byField)[0];
  if (first) return first;
  if (v.general) return v.general;
  return e instanceof ProblemError ? (e.problem?.detail ?? problemText(e)) : problemText(e);
}

export interface Command {
  busy: boolean;
  fields: Record<string, string>;
  general: string | undefined;
  failures: number;
  exec: <R>(
    key: string,
    fn: () => Promise<R>,
    ok: string | null,
  ) => Promise<{ ok: true; value: R } | { ok: false }>;
  clear: () => void;
}

export function useCommand(refresh: () => Promise<unknown>): Command {
  const run = useRun();
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | undefined>();
  const [failures, setFailures] = useState(0);
  const exec: Command['exec'] = async (key, fn, ok) => {
    setBusy(true);
    setFields({});
    setGeneral(undefined);
    try {
      const value = await run(key, fn, ok, { quiet: ['validation_failed'] });
      await refresh();
      setBusy(false);
      return { ok: true, value };
    } catch (e) {
      const v = violationsOf(e);
      setFields(v.byField);
      setGeneral(v.general);
      if (STALE.has(problemCode(e))) void refresh();
      setBusy(false);
      setFailures((n) => n + 1);
      return { ok: false };
    }
  };
  const clear = (): void => {
    setFields({});
    setGeneral(undefined);
  };
  return { busy, fields, general, failures, exec, clear };
}
