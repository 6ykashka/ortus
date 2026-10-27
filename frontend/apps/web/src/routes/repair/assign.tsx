// W6.20 · Диалог «Назначить прораба?» (modal-assign-foreman, «Ортус CRM.dc.html» assignForeman :4429): что произойдёт,
// «Назначить» (assignRepairForeman), тост «Прораб назначен: …»; без сотрудника с профилем «прораб» — «Нет сотрудника
// с ролью «Прораб»» и «Открыть пользователей». Один кандидат — как эталон; несколько — выбор в диалоге (Q-W6.20-4).
import type { components } from '@ortus/api-client';
import { ConfirmDialog } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useEffect, useId, useState } from 'react';

import { useApi } from '../../app/api.tsx';
import { useShell } from '../../shell/context.tsx';
import { useBusy, useRun } from '../../shell/run.tsx';
import { useToast } from '../../shell/toast.tsx';
import { afterRepairChange, assignForeman, useForemanCandidates } from './api.ts';
import { serverText } from './parts.tsx';
import { REPAIR_TEXT as T } from './texts.ts';

type S = components['schemas'];

const QUIET: readonly string[] = ['invalid_transition', 'validation_failed'];

export function AssignForemanDialog(p: {
  tenantId: string;
  project: Pick<S['RepairProject'], 'id' | 'name'>;
  onClose: () => void;
}): ReactElement {
  const { tenantId, project } = p;
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const toast = useToast();
  const { go } = useShell();
  const found = useForemanCandidates(tenantId, true);
  const candidates = found.data ?? [];
  const [picked, setPicked] = useState<string>('');
  const selectId = useId();
  const key = `repair-assign:${project.id}`;
  const busy = useBusy(key);
  const chosen = candidates.find((m) => m.id === picked) ?? candidates[0];

  // Обход ConfirmDialog (packages/ui, вне WS): область «Что произойдёт» даёт 2 px переполнения и становится
  // прокручиваемой без tabIndex (axe scrollable-region-focusable). Пока диалог открыт, repair.css снимает прокрутку.
  useEffect(() => {
    document.body.dataset.oxRepairAssign = '1';
    return () => {
      delete document.body.dataset.oxRepairAssign;
    };
  }, []);

  // Пока кандидаты грузятся, диалог не открываем: иначе «Отмена» и «Выполняем…» неактивны.
  if (found.isPending) return <></>;

  if (candidates.length === 0) {
    return (
      <ConfirmDialog
        open
        icon="person_off"
        title={T.assign.noneTitle}
        text={T.assign.noneText}
        confirmLabel={T.assign.noneConfirm}
        onClose={p.onClose}
        onConfirm={() => {
          p.onClose();
          go('users');
        }}
      />
    );
  }

  const confirm = async (): Promise<void> => {
    if (!chosen) return;
    try {
      await run(
        key,
        () => assignForeman(api, tenantId, project.id, chosen.id),
        T.assign.done.replace('{name}', chosen.displayName),
        { quiet: QUIET },
      );
    } catch (e) {
      // Уже назначен другим (409) или объект закрыт: текст сервера, данные перечитываются.
      const text = serverText(e);
      if (text) toast(text, 'error');
    } finally {
      await afterRepairChange(qc, tenantId);
      p.onClose();
    }
  };

  return (
    <ConfirmDialog
      open
      icon="engineering"
      title={T.assign.title}
      text={
        <>
          {project.name}
          {chosen ? ` · ${chosen.displayName}` : ''}
          {candidates.length > 1 ? (
            <label className="ox-rp-select-row" htmlFor={selectId}>
              {T.assign.choose}
              <select
                id={selectId}
                value={chosen?.id ?? ''}
                onChange={(e) => setPicked(e.target.value)}
              >
                {candidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </>
      }
      consequences={[
        {
          title: T.assign.what,
          items: [
            { icon: 'home_work', tone: 'info', text: T.assign.items[0] },
            { icon: 'add_task', tone: 'info', text: T.assign.items[1] },
            { icon: 'lock', tone: 'neutral', text: T.assign.items[2] },
          ],
        },
      ]}
      confirmLabel={T.assign.confirm}
      busy={busy || !chosen}
      onClose={p.onClose}
      onConfirm={() => void confirm()}
    />
  );
}
