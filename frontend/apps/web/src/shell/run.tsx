// W1.20 · Хук команд оболочки (run :2419–2434; контракт хоста модулей A §2): `run(key, fn, okText?, {quiet})`.
//   успех → тост okText (только после ответа сервера); ошибка → тост текстом @ortus/texts по Problem.code,
//   «нет связи» — тоном warn, прочее — error; коды из `quiet` не тостятся (их показывает страница);
//   исключение всегда пробрасывается. 403 по праву, модулю или состоянию организации — права изменились:
//   /me/context перечитывается (меню и гейты).
import { ProblemError } from '@ortus/api-client';
import { errors } from '@ortus/texts';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactElement,
  type ReactNode,
  use,
  useCallback,
  useMemo,
  useState,
} from 'react';

import { ME_CONTEXT_KEY } from './me.ts';
import { useToast } from './toast.tsx';

export interface RunOptions {
  /** Коды, которые показывает сама страница: тоста нет, исключение пробрасывается. */
  quiet?: readonly string[];
}

export type Run = <R>(
  key: string,
  fn: () => Promise<R>,
  okText?: string | null,
  options?: RunOptions,
) => Promise<R>;

/** Код ошибки команды: Problem.code, `offline` для сетевого сбоя, `http<статус>` без тела. */
export function problemCode(e: unknown): string {
  if (e instanceof ProblemError) return e.code || `http${e.status}`;
  if (e instanceof TypeError) return 'offline';
  return 'unknown';
}

/** Текст тоста ошибки: по коду, затем по статусу, затем «Ошибка» (:2431). */
export function problemText(e: unknown): string {
  const code = problemCode(e);
  if (code === 'offline') return errors.client.offline;
  const byCode = (errors.problem as Record<string, string>)[code];
  if (byCode) return byCode;
  if (e instanceof ProblemError) {
    const byStatus = (errors.http as Record<string, string>)[`http${e.status}`];
    if (byStatus) return byStatus;
  }
  return errors.fallback;
}

/** Ответы, после которых права участника могли измениться. */
const RECHECK = new Set([
  'forbidden_action',
  'module_not_installed',
  'module_read_only',
  'tenant_read_only',
  'tenant_suspended',
]);

interface RunState {
  /** Идущие команды: ключ → число одновременных вызовов. */
  busy: ReadonlyMap<string, number>;
  begin: (key: string) => void;
  end: (key: string) => void;
}

const RunContext = createContext<RunState | null>(null);

const bump = (m: ReadonlyMap<string, number>, key: string, by: 1 | -1): Map<string, number> => {
  const next = new Map(m);
  const n = (next.get(key) ?? 0) + by;
  if (n > 0) next.set(key, n);
  else next.delete(key);
  return next;
};

export function RunProvider({ children }: { children: ReactNode }): ReactElement {
  const [busy, setBusy] = useState<ReadonlyMap<string, number>>(() => new Map());
  const begin = useCallback((key: string) => setBusy((m) => bump(m, key, 1)), []);
  const end = useCallback((key: string) => setBusy((m) => bump(m, key, -1)), []);
  const value = useMemo(() => ({ busy, begin, end }), [busy, begin, end]);
  return <RunContext value={value}>{children}</RunContext>;
}

function useRunState(): RunState {
  const s = use(RunContext);
  if (!s) throw new Error('useRun: нет RunProvider');
  return s;
}

export function useRun(): Run {
  const { begin, end } = useRunState();
  const toast = useToast();
  const qc = useQueryClient();
  return useCallback<Run>(
    async (key, fn, okText, options = {}) => {
      begin(key);
      try {
        const r = await fn();
        end(key);
        if (okText) toast(okText, 'ok');
        return r;
      } catch (e) {
        end(key);
        const code = problemCode(e);
        if (!options.quiet?.includes(code)) {
          toast(problemText(e), code === 'offline' ? 'warn' : 'error');
        }
        if (RECHECK.has(code)) void qc.invalidateQueries({ queryKey: ME_CONTEXT_KEY });
        throw e;
      }
    },
    [qc, begin, end, toast],
  );
}

/** Идёт команда `key` (без ключа — любая). */
export function useBusy(key?: string): boolean {
  const { busy } = useRunState();
  return key === undefined ? busy.size > 0 : busy.has(key);
}
