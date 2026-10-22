// W4.61 · Общие запросы страниц шага 4.6: ключи кэша (все запросы оператора — под `['platform']`, как W1.25 и
// бейдж меню «Заявки на тариф»), страницы списка по курсору, команда с тостом и перечитыванием, текст ошибки
// команды по коду и полю (Problem.violations) — тексты эталона вместо общего текста кода.
import { ProblemError } from '@ortus/api-client';
import { toast as TOAST } from '@ortus/texts';
import { type QueryKey, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { problemCode, problemText, useRun } from '../../../shell/run.tsx';
import { useToast } from '../../../shell/toast.tsx';

export const PLATFORM_KEY = ['platform'] as const;

/** Курсорный список контракта целиком, не больше `max` страниц. */
export async function allPages<T>(
  load: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
  max = 20,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < max; i++) {
    const p = await load(cursor);
    out.push(...p.items);
    if (!p.nextCursor) break;
    cursor = p.nextCursor;
  }
  return out;
}

/** Заголовок идемпотентности команды. */
export const idem = (): { 'Idempotency-Key': string } => ({
  'Idempotency-Key': crypto.randomUUID(),
});

/** Текст отказа команды по коду и полю; `undefined` — общий текст оболочки по коду. */
export type ErrorTexts = Readonly<
  Record<string, string | ((e: ProblemError) => string | undefined)>
>;

/** Сообщение нарушения поля `field` из Problem.violations. */
export function violation(e: unknown, field?: string): string | undefined {
  if (!(e instanceof ProblemError)) return undefined;
  const v = e.problem?.violations ?? [];
  return (field ? v.find((x) => x.field === field) : v[0])?.message;
}

export interface CommandOptions {
  /** Тексты отказов по Problem.code (вместо общего текста кода). */
  texts?: ErrorTexts;
  /** Что перечитать после ответа (успех или отказ); по умолчанию — все запросы оператора. */
  invalidate?: QueryKey;
}

/**
 * Команда страницы: `run` оболочки (busy, тост успеха, тост ошибки по коду), затем перечитывание данных — и после
 * отказа (409/412: показанное устарело). Коды из `texts` тостятся текстом страницы. Исключение пробрасывается.
 */
export function useCommand(): <R>(
  key: string,
  fn: () => Promise<R>,
  okText?: string | null,
  o?: CommandOptions,
) => Promise<R> {
  const run = useRun();
  const qc = useQueryClient();
  const toast = useToast();
  return useCallback(
    async <R>(
      key: string,
      fn: () => Promise<R>,
      okText?: string | null,
      o: CommandOptions = {},
    ) => {
      const queryKey = o.invalidate ?? PLATFORM_KEY;
      const texts = o.texts ?? {};
      try {
        return await run(
          key,
          async () => {
            const r = await fn();
            await qc.invalidateQueries({ queryKey });
            return r;
          },
          okText === undefined ? TOAST.platform.done : okText,
          { quiet: Object.keys(texts) },
        );
      } catch (e) {
        const code = problemCode(e);
        const t = texts[code];
        if (t !== undefined && e instanceof ProblemError) {
          const text = typeof t === 'function' ? t(e) : t;
          toast(text ?? problemText(e), 'error');
        }
        if (e instanceof ProblemError) void qc.invalidateQueries({ queryKey });
        throw e;
      }
    },
    [run, qc, toast],
  );
}
