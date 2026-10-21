// W4.50 · Журнал «Выгрузки» страницы «Данные» (07-ux-and-data §3; no-reference — B-6, allowlist core-data.md):
// последние задания участника (владелец — всех) под подвалом таблицы, когда они есть. Опрос — пока есть очередь;
// «Скачать» — короткая ссылка сервера и файл хранилища (права перепроверяются); «Отменить» и «Отозвать» —
// revokeDatasetExportJob по ревизии строки. Журнал запрашивается только у участника, который может выгружать
// (listDatasetExportJobs требует data.export). Возврат 1: отказ 409 и 404 команды — тост текстом контракта
// (Problem.detail: «Права изменились — выгрузка отозвана…», «Выгрузка уже завершена.»), после любого отказа журнал
// перечитывается (сервер мог отозвать задание); первая загрузка не удалась — строка ошибки и «Повторить».
import { ProblemError } from '@ortus/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Icon, Status } from '@ortus/ui';
import type { ReactElement } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useShell } from '../../../shell/context.tsx';
import { problemCode, problemText, useBusy, useRun } from '../../../shell/run.tsx';
import { useToast } from '../../../shell/toast.tsx';
import { LoadFailed, useRetryFocus } from '../../company/modules/ui.tsx';
import { downloadJob, jobsKey, revokeJob, useJobs, useOwnPerson } from './api.ts';
import { type JobTone, jobView } from './jobs.ts';
import { DATA_TEXT } from './texts.ts';

const T = DATA_TEXT.jobs;

const TONE: Readonly<Record<JobTone, 'ok' | 'info' | 'warn' | 'danger' | 'neutral'>> = {
  ok: 'ok',
  info: 'info',
  warn: 'warn',
  error: 'danger',
  muted: 'neutral',
};

/** Отказы команд журнала с текстом контракта в Problem.detail: показывает страница, а не общий текст реестра. */
const OWN_TEXT = ['invalid_transition', 'not_found'] as const;

/** Сохранение файла выгрузки браузером: Blob как есть (с BOM) и имя файла сервера. */
function save(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ExportJournal({
  tenantId,
  enabled,
}: {
  tenantId: string;
  /** Участник может выгружать (хоть у одного набора exportAllowed). */
  enabled: boolean;
}): ReactElement | null {
  const api = useApi();
  const run = useRun();
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useShell();
  const jobs = useJobs(tenantId, enabled);
  const list = jobs.data ?? [];
  // Автор задания — профиль участника; без права на список участников журнал — только свои задания (сервер).
  const authors = new Set(list.map((j) => j.requestedByMemberId));
  const own = useOwnPerson(tenantId, me.userId, authors.size > 0);
  const mine = (author: string): boolean =>
    own.data ? own.data === author : own.isError || authors.size === 1;
  const busyDownload = useBusy('data:job:download');
  const busyStop = useBusy('data:job:stop');
  const retry = useRetryFocus(jobs.isSuccess, () => document.getElementById('h-data-jobs'));

  if (!enabled) return null;

  const failed = jobs.isError && !jobs.data;
  if (!list.length && !failed) return null;

  /** Отказ команды: свой текст контракта — тостом warn (прочее уже показал run); журнал перечитывается. */
  const refused = (e: unknown): void => {
    if ((OWN_TEXT as readonly string[]).includes(problemCode(e))) {
      const detail = e instanceof ProblemError ? e.problem?.detail : undefined;
      toast(detail ?? problemText(e), 'warn');
    }
    void qc.invalidateQueries({ queryKey: jobsKey(tenantId) });
  };

  const download = (id: string): void =>
    void run(
      'data:job:download',
      async () => {
        const f = await downloadJob(api, tenantId, id);
        save(f.blob, f.fileName);
      },
      null,
      { quiet: OWN_TEXT },
    ).catch(refused);

  const stop = (id: string, revision: number, cancel: boolean): void =>
    void run(
      'data:job:stop',
      async () => {
        await revokeJob(api, tenantId, id, revision);
        await qc.invalidateQueries({ queryKey: jobsKey(tenantId) });
      },
      cancel ? T.cancelled : T.revoked,
      { quiet: OWN_TEXT },
    ).catch(refused);

  return (
    <section aria-labelledby="h-data-jobs" className="ox-dt-jobs">
      <h2 id="h-data-jobs" className="ox-dt-jobs-title" tabIndex={-1}>
        {T.title}
      </h2>
      {failed ? (
        <LoadFailed
          error={jobs.error}
          describedBy="h-data-jobs"
          onRetry={retry(() => jobs.refetch())}
        />
      ) : (
        <ul className="ox-dt-jobs-list">
          {list.map((j) => {
            const v = jobView(j, mine(j.requestedByMemberId));
            return (
              <li key={v.id} className="ox-dt-job">
                <div className="ox-dt-job-main">
                  <div className="ox-dt-job-head">
                    <strong className="ox-dt-job-title">{v.title}</strong>
                    <span className="ox-dt-job-at">{v.at}</span>
                  </div>
                  <div className="ox-dt-job-meta">
                    <Status tone={TONE[v.tone]}>{v.state}</Status>
                    {v.detail ? <span className="ox-dt-job-detail">{v.detail}</span> : null}
                  </div>
                </div>
                {v.download || v.stop ? (
                  <div className="ox-dt-job-actions">
                    {v.download ? (
                      <button
                        type="button"
                        className="ox-dt-btn"
                        disabled={busyDownload}
                        onClick={() => download(v.id)}
                      >
                        <Icon name="download" size={18} />
                        {T.download}
                      </button>
                    ) : null}
                    {v.stop ? (
                      <button
                        type="button"
                        className="ox-dt-btn"
                        disabled={busyStop}
                        onClick={() => stop(v.id, v.revision, v.stop === 'cancel')}
                      >
                        {v.stop === 'cancel' ? T.cancel : T.revoke}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
