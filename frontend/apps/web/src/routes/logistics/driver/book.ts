// W2.22 · Бронь машины водителем (reserve :2555–2566, refresh :2567–2572; S2-03): «Забронировать» → reserveVehicle;
// офлайн — тост «Бронь требует связи с сервером»; 409 reservation_overlap — alert «Конфликт брони» с текстом
// сервера, список не перечитывается до «Обновить список» (03 §10.4); прочие отказы — тост `run`.
import { ProblemError } from '@ortus/api-client';
import { errors, toast as toastText } from '@ortus/texts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { problemCode, useRun } from '../../../shell/run.tsx';
import { useToast } from '../../../shell/toast.tsx';
import { afterChange, reserve, tripsKey, vehiclesKey } from './api.ts';
import type { Plan } from './model.ts';

/** Текст ответа сервера (Problem.detail) или текст словаря по коду. */
export function problemDetail(e: unknown, fallback: string): string {
  return e instanceof ProblemError && e.problem?.detail ? e.problem.detail : fallback;
}

export function useBook(tenantId: string, plan: Plan | null, online: boolean) {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const toast = useToast();
  const [conflict, setConflict] = useState<string | null>(null);

  const book = useCallback(
    async (vehicleId: string): Promise<boolean> => {
      if (!plan) return false;
      if (!online) {
        toast(toastText.driver.reserveNeedsNet, 'error');
        return false;
      }
      setConflict(null);
      try {
        await run(
          `res:${vehicleId}`,
          () => reserve(api, tenantId, plan, vehicleId, crypto.randomUUID()),
          toastText.driver.reserved,
          { quiet: ['reservation_overlap'] },
        );
        await afterChange(qc, tenantId);
        return true;
      } catch (e) {
        if (problemCode(e) === 'reservation_overlap') {
          setConflict(problemDetail(e, errors.problem.reservation_overlap));
        }
        return false;
      }
    },
    [api, qc, run, toast, tenantId, plan, online],
  );

  const refresh = useCallback(async (): Promise<void> => {
    await run(
      'refresh',
      async () => {
        await Promise.all([
          qc.refetchQueries({ queryKey: vehiclesKey(tenantId) }),
          qc.refetchQueries({ queryKey: tripsKey(tenantId) }),
        ]);
      },
      toastText.shell.listRefreshed,
    ).catch(() => undefined);
    setConflict(null);
  }, [run, qc, tenantId]);

  return { conflict, book, refresh };
}
