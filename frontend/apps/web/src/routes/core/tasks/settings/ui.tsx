// W4.13 · Общее вкладок проекта: команда с тостом (эталон показывает тостом текст ошибки модуля для validation,
// transition и forbidden — :339–341; здесь — detail сервера по Problem.code, прочее — тост оболочки по коду),
// скелетон загрузки, идентификатор участника «я» (кнопки «Исключить» не у себя).
import { type components, ProblemError } from '@ortus/api-client';
import { shell } from '@ortus/texts';
import { type ReactElement, useCallback } from 'react';

import { problemCode, problemText, useRun } from '../../../../shell/run.tsx';
import { useShell } from '../../../../shell/context.tsx';
import { useToast } from '../../../../shell/toast.tsx';

type S = components['schemas'];

/** Коды, текст которых — detail сервера (сообщение модуля эталона). */
const DETAIL = [
  'validation_failed',
  'invalid_transition',
  'forbidden_action',
  'delegation_exceeds_grant',
  'conflict',
];

/** Текст ошибки сервера: detail, первое нарушение поля, иначе текст оболочки по коду. */
export function detailOf(e: unknown): string {
  if (e instanceof ProblemError) {
    const p = e.problem;
    const text = p?.detail ?? p?.violations?.[0]?.message;
    if (text) return text;
  }
  return problemText(e);
}

export type Command = <R>(
  key: string,
  fn: () => Promise<R>,
  okText?: string | null,
  o?: { inline?: (text: string) => void; settle?: () => void },
) => Promise<R | undefined>;

/**
 * Команда вкладки: успех — тост okText; отказ с текстом сервера — тост этим текстом (или в форму, `inline`);
 * прочее — тост оболочки (нет связи, лимит). Исключение не пробрасывается: результат undefined.
 * `settle` — ключ идемпотентности отработан (W2.23): после любого ответа сервера, но не после «нет связи» —
 * повтор той же команды несёт тот же Idempotency-Key.
 */
export function useCommand(): Command {
  const run = useRun();
  const toast = useToast();
  return useCallback<Command>(
    async (key, fn, okText, o = {}) => {
      try {
        const r = await run(key, fn, okText, { quiet: DETAIL });
        o.settle?.();
        return r;
      } catch (e) {
        if (problemCode(e) !== 'offline') o.settle?.();
        if (DETAIL.includes(problemCode(e))) {
          const text = detailOf(e);
          if (o.inline) o.inline(text);
          else toast(text, 'error');
        }
        return undefined;
      }
    },
    [run, toast],
  );
}

export function Skeleton(): ReactElement {
  return (
    <div className="ox-tset-skel" role="status" aria-label={shell.a11y.loading}>
      {[0, 1, 2].map((i) => (
        <span key={i} className="ox-tset-skel-line" />
      ))}
    </div>
  );
}

/**
 * Участник «я» в организации: по userId в списке сотрудников (у кого members.read), иначе — по имени входа среди
 * участников проекта (id участника в /me/context нет).
 */
export function useMeMember(
  people: readonly S['Member'][] | undefined,
  rows: readonly S['TaskProjectMember'][],
): string | undefined {
  const { me } = useShell();
  const byUser = people?.find((m) => m.userId === me.userId)?.id;
  if (byUser) return byUser;
  return rows.find((m) => m.displayName === me.displayName)?.memberId;
}
