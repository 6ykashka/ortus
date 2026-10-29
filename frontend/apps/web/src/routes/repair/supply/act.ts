// W6.22 · Команда снабжения со страницы: ответ сервера → сообщение-подтверждение (`hb.note` эталона) и перечитывание
// заявок, закупок, остатков и объектов. Ошибку показывает `run` (тост по Problem.code); без права или в режиме чтения
// кнопки недоступны, поэтому лишних запросов нет.
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useRun } from '../../../shell/run.tsx';
import { refreshSupply } from './api.ts';

export type Act = <R>(
  key: string,
  fn: () => Promise<R>,
  note: (result: R) => string,
) => Promise<boolean>;

export function useAct(tenantId: string, onNote: (text: string) => void): Act {
  const run = useRun();
  const qc = useQueryClient();
  return useCallback<Act>(
    async (key, fn, note) => {
      try {
        const result = await run(key, fn);
        onNote(note(result));
        return true;
      } catch {
        return false;
      } finally {
        await refreshSupply(qc, tenantId);
      }
    },
    [run, qc, tenantId, onNote],
  );
}
