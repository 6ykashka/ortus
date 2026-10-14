// События участникам (`event(text, to, sensitive)` эталона, api.js:53): новые сверху,
// id `e<seq>` из общего счётчика, время — по часам домена, а не `new Date()`.
import { hhmm, type Clock } from './clock.ts';
import { createIdGen, type IdGen } from './ids.ts';
import type { CoreDb, DomainEvent } from './types/index.ts';

export interface EmitOpts {
  /** Чувствительное событие (начисления) — видно только с правом финансов. */
  sensitive?: string;
  /** Подразделение события для проверки `canEarnings`. */
  unit?: string;
}

export type Emit = (text: string, to: readonly string[], opts?: EmitOpts) => DomainEvent;

export function createEmitter(
  getDb: () => CoreDb,
  clock: Clock,
  ids: IdGen = createIdGen(getDb),
): Emit {
  return (text, to, opts = {}) => {
    const db = getDb();
    const ev: DomainEvent = {
      id: ids.next('e'),
      at: hhmm(clock),
      text,
      to: [...to],
      sensitive: opts.sensitive ?? null,
    };
    if (opts.unit) ev.unit = opts.unit;
    (db.events ??= []).unshift(ev);
    return ev;
  };
}
