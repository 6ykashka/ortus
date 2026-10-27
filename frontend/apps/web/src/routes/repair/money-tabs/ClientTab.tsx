// W6.24 · Вкладка «Кабинет заказчика» (`repair-client`, эталон «Ремонт и стройка.dc.html» :590–611): состояние личной
// ссылки, «Отозвать ссылку» / «Выпустить новую ссылку» и превью кабинета 420 px (готовность по закрытым актам, этапы,
// фотоотчёт, «Подписать по SMS» — не кнопка, оплачено). Превью собрано из данных объекта (токена у владельца нет,
// Q-W6.24-7); публичная страница кабинета — W6.26. Адрес новой ссылки показывается один раз (Q-W6.24-6).
import { format } from '@ortus/texts';
import { Button, Icon, Skeleton } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useBusy, useRun } from '../../../shell/run.tsx';
import { useToast } from '../../../shell/toast.tsx';
import {
  afterChange,
  issueLink,
  revokeLink,
  useClientLink,
  useDocuments,
  useFinance,
  useLastAcceptedLog,
  useProject,
  useScheduleStages,
} from './api.ts';
import { firstName, linkView, longDay, previewStages, readinessByActs, rub } from './model.ts';
import { Denied, Head, Loaded, Section, type TabProps, useCaps, useMay } from './shared.tsx';
import { MONEY_TEXT } from './texts.ts';

const T = MONEY_TEXT.client;

function Preview({ tenantId, projectId }: TabProps): ReactElement {
  const project = useProject(tenantId, projectId);
  const docs = useDocuments(tenantId, projectId);
  const fin = useFinance(tenantId, projectId, true);
  const schedule = useScheduleStages(tenantId, projectId, true);
  const lastLog = useLastAcceptedLog(tenantId, projectId, true);
  const p = project.data;
  if (!p || !docs.data) return <Skeleton lines={4} />;
  const pct = readinessByActs(docs.data);
  const name = firstName(p.clientName ?? '');
  const stages = previewStages(schedule.data?.stages ?? [], {
    ...(p.dueOn ? { dueOn: p.dueOn } : {}),
    ...(p.forecastDueOn ? { forecastDueOn: p.forecastDueOn } : {}),
  });
  const waiting = docs.data.find((d) => d.state === 'sms');
  const photoDay = lastLog.data;
  return (
    <div role="group" aria-label={T.previewAria} className="ox-mt-preview">
      <div className="ox-mt-preview-brand">
        <span className="ox-mt-preview-mark" aria-hidden="true">
          {T.brandMark}
        </span>
        <span>{T.brand}</span>
      </div>
      <div>
        <strong className="ox-mt-preview-title">{p.name}</strong>
        <div className="ox-mt-greeting">
          {name ? format(T.greeting, { name, pct }) : format(T.greetingAnon, { pct })}
        </div>
      </div>
      <div
        className="ox-mt-bar"
        role="progressbar"
        aria-label="Готовность"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, pct)}
      >
        <span style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <ul className="ox-mt-list">
        {stages.map((s) => (
          <li key={s.name} className="ox-mt-stage" data-tone={s.tone}>
            <Icon name={s.icon} size={18} />
            <span className="ox-mt-stage-name">{s.name}</span>
            <span className="ox-mt-stage-when">{s.when}</span>
          </li>
        ))}
      </ul>
      <div className="ox-mt-photos" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <span className="ox-mt-note">
        {photoDay ? format(T.photoCaption, { date: longDay(photoDay) }) : T.photoEmpty}
      </span>
      {waiting ? (
        <div className="ox-mt-sign">
          <span>{format(T.signWaits, { title: waiting.title })}</span>
          <span className="ox-mt-sign-fake">{T.sign}</span>
        </div>
      ) : null}
      {fin.data ? (
        <div className="ox-mt-paid">
          <span>{T.paid}</span>
          <strong>
            {format(T.paidOf, {
              paid: rub(fin.data.received.amountMinor),
              contract: rub(fin.data.contract.amountMinor),
            })}
          </strong>
        </div>
      ) : null}
    </div>
  );
}

export default function ClientTab({ tenantId, projectId }: TabProps): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const toast = useToast();
  const { finance } = useCaps();
  const link = useClientLink(tenantId, projectId, finance);
  const project = useProject(tenantId, projectId);
  const may = useMay('repairs.client_link.manage');
  const busy = useBusy('client-link');
  const [issued, setIssued] = useState<string | null>(null);
  if (!finance) return <Denied />;

  const act = async (kind: 'revoke' | 'issue'): Promise<void> => {
    try {
      if (kind === 'revoke') {
        await run('client-link', () => revokeLink(api, tenantId, projectId), T.revoked);
        setIssued(null);
      } else {
        const r = await run('client-link', () => issueLink(api, tenantId, projectId), T.issued);
        setIssued(r.url);
      }
    } catch {
      // Ошибку показал тост `run`.
    } finally {
      await afterChange(qc, tenantId, projectId);
    }
  };

  const copy = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      toast(T.copied, 'ok');
    } catch {
      // Буфер недоступен (нет разрешения): адрес остаётся на экране для ручного копирования.
    }
  };

  return (
    <Section id="h-cl" label="Кабинет заказчика">
      <Head id="h-cl" title={T.title} intro={T.intro} />
      <Loaded query={link}>
        {(l) => {
          if (!project.data) return <Skeleton lines={2} />;
          const v = linkView(l, {
            status: project.data.status,
            ...(project.data.clientName ? { clientName: project.data.clientName } : {}),
          });
          return (
            <>
              <div className="ox-mt-link" data-tone={v.tone}>
                <Icon name={v.icon} size={20} />
                <span className="ox-mt-link-text">{v.text}</span>
                {v.action && may ? (
                  <Button
                    variant="secondary"
                    loading={busy}
                    onPress={() => v.action && void act(v.action.kind)}
                  >
                    {v.action.label}
                  </Button>
                ) : null}
              </div>
              {issued ? (
                <div className="ox-mt-url">
                  <span className="ox-mt-url-label">{T.urlLabel}</span>
                  <span className="ox-mt-url-value">{issued}</span>
                  <Button variant="secondary" onPress={() => void copy(issued)}>
                    {T.copy}
                  </Button>
                  <span className="ox-mt-note">{T.urlNote}</span>
                </div>
              ) : null}
              {l.active && project.data.status !== 'handed_over' ? (
                <Preview tenantId={tenantId} projectId={projectId} />
              ) : null}
            </>
          );
        }}
      </Loaded>
    </Section>
  );
}
