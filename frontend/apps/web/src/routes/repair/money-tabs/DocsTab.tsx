// W6.24 · Вкладка «Документы» (`repair-docs`, эталон «Ремонт и стройка.dc.html» :513–529): договор, акты и счета объекта,
// чипы состояний, «Отправить на подпись» (код из SMS заказчику), сноска про простую электронную подпись.
// «Демо: подписано по SMS» не переносится (Q-W4.00-repair-9): подписывает заказчик в своём кабинете (W6.26).
// Вне макета: «Сдать объект» по подписанному акту сдачи (handOverRepairProject, Q-W6.24-3).
import { format } from '@ortus/texts';
import { Banner, ConfirmDialog, Button, Icon } from '@ortus/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useBusy, useRun } from '../../../shell/run.tsx';
import { afterChange, handOver, requestSignature, useDocuments, useProject } from './api.ts';
import { type DocRowView, docRows, handOverDoc, ruDate } from './model.ts';
import { Head, Loaded, Section, StatusChip, type TabProps, useMay } from './shared.tsx';
import { MONEY_TEXT } from './texts.ts';

const T = MONEY_TEXT.docs;

function DocItem(p: {
  row: DocRowView;
  canSend: boolean;
  onSend: (id: string, name: string) => Promise<void>;
}): ReactElement {
  const { row } = p;
  const busy = useBusy(`doc:${row.id}`);
  return (
    <li className="ox-mt-doc" id={`ox-doc-${row.id}`} tabIndex={-1}>
      <Icon name={row.icon} size={22} className="ox-mt-doc-icon" />
      <div className="ox-mt-doc-main">
        <span className="ox-mt-name">{row.name}</span>
        <span className="ox-mt-meta">{row.meta}</span>
      </div>
      <StatusChip chip={row.chip} />
      {p.canSend ? (
        <div className="ox-mt-actions">
          <Button
            aria-label={format(T.sendNamed, { name: row.name })}
            loading={busy}
            onPress={() => void p.onSend(row.id, row.name)}
          >
            {T.send}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export default function DocsTab({ tenantId, projectId }: TabProps): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const docs = useDocuments(tenantId, projectId);
  const project = useProject(tenantId, projectId);
  const maySend = useMay('repairs.documents.send', 'repairs.estimates.edit');
  const mayHand = useMay('repairs.projects.hand_over', 'repairs.projects.manage');
  const handing = useBusy('hand-over');
  const [confirm, setConfirm] = useState(false);

  const send = async (id: string, name: string): Promise<void> => {
    try {
      await run(`doc:${id}`, () => requestSignature(api, tenantId, id), format(T.sent, { name }));
    } catch {
      // Ошибку показал тост `run`.
    } finally {
      await afterChange(qc, tenantId, projectId);
      // Кнопка исчезла: фокус на строку документа, чтобы не уйти на body.
      requestAnimationFrame(() => document.getElementById(`ox-doc-${id}`)?.focus());
    }
  };

  const hand = async (actId: string): Promise<void> => {
    try {
      await run('hand-over', () => handOver(api, tenantId, projectId, actId), T.handOverDone);
      setConfirm(false);
    } catch {
      // Ошибку показал тост `run`; диалог остаётся открытым.
    } finally {
      await afterChange(qc, tenantId, projectId);
    }
  };

  return (
    <Section id="h-docs" label={T.title}>
      <Head id="h-docs" title={T.title} intro={T.intro} />
      <Loaded query={docs}>
        {(list) => {
          const rows = docRows(list, project.data?.clientName);
          const act = project.data ? handOverDoc(list, project.data.status) : undefined;
          const warranty = project.data?.warrantyUntil;
          return (
            <>
              {project.data?.status === 'handed_over' && warranty ? (
                <Banner
                  tone="ok"
                  title={T.handedOver}
                  text={format(T.warranty, { date: ruDate(warranty) })}
                />
              ) : null}
              {rows.length === 0 ? (
                <div className="ox-mt-card ox-mt-empty">{T.empty}</div>
              ) : (
                <div className="ox-mt-card">
                  <ul className="ox-mt-list" aria-label={T.listAria}>
                    {rows.map((d) => (
                      <DocItem key={d.id} row={d} canSend={d.canSend && maySend} onSend={send} />
                    ))}
                  </ul>
                </div>
              )}
              <span className="ox-mt-note">{T.note}</span>
              {act && mayHand ? (
                <div className="ox-mt-actions">
                  <Button icon="key" onPress={() => setConfirm(true)}>
                    {T.handOver}
                  </Button>
                </div>
              ) : null}
              <ConfirmDialog
                open={confirm && !!act}
                onClose={() => setConfirm(false)}
                onConfirm={() => act && void hand(act.id)}
                title={T.handOverTitle}
                text={T.handOverText}
                icon="key"
                confirmLabel={T.handOver}
                cancelLabel={T.cancel}
                busy={handing}
              />
            </>
          );
        }}
      </Loaded>
    </Section>
  );
}
