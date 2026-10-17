// W1.23 · «Почему доступно» (S1-14, AUTH-04; no-reference: design-requests «modal-explain-access»): проверки
// x-authorization-order по порядку с решающей, назначения с этим правом и причина несовпадения (PD-53), отметка
// «есть назначения вне вашей области» без подробностей (hiddenGrants). Данные — ответ explainAccess страницы.
import type { components } from '@ortus/api-client';
import { format, shell } from '@ortus/texts';
import { Dialog, Icon } from '@ortus/ui';
import type { ReactElement } from 'react';

import { scopeLabel, type Units, untilDate } from '../../routes/company/users/model.ts';
import { PEOPLE_TEXT } from '../../routes/company/users/texts.ts';

type S = components['schemas'];
const E = PEOPLE_TEXT.explain;

export interface ExplainDialogProps {
  memberName: string;
  /** Подпись проверяемого действия («Просматривать машины»), а не ключ права. */
  actionLabel: string;
  explanation: S['AccessExplanation'];
  units: Units;
  /** Имена групп по id (назначение «через группу»). */
  groups: ReadonlyMap<string, string>;
  onClose: () => void;
}

export function ExplainDialog({
  memberName,
  actionLabel,
  explanation: x,
  units,
  groups,
  onClose,
}: ExplainDialogProps): ReactElement {
  return (
    <Dialog
      open
      onClose={onClose}
      title={E.title}
      footer={
        <button type="button" className="ox-dlg-btn" onClick={onClose}>
          {shell.modal.close}
        </button>
      }
    >
      <div className="ox-dlg">
        <span className="ox-dlg-sub">
          {format(E.subtitle, { name: memberName, action: actionLabel })}
        </span>
        <div className="ox-dlg-block">
          <span className="ox-dlg-caps" id="explain-checks">
            {E.checks}
          </span>
          <ol className="ox-explain-checks" aria-labelledby="explain-checks">
            {x.checks.map((c) => {
              const decisive = !x.allowed && c.check === x.decisiveCheck;
              return (
                <li key={c.check} data-passed={c.passed ? '' : undefined}>
                  <Icon name={c.passed ? 'check_circle' : 'cancel'} size={18} />
                  <span>
                    <span className="ox-explain-step">
                      {E.step[c.check]} — {c.passed ? E.passed : E.failed}
                      {decisive ? ` · ${E.decisive}` : ''}
                    </span>
                    {c.detail ? <span className="ox-dlg-hint">{c.detail}</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="ox-dlg-block">
          <span className="ox-dlg-caps">{E.grants}</span>
          {x.grants.length ? (
            <ul className="ox-dlg-list">
              {x.grants.map((g, i) => {
                const group = g.groupId ? groups.get(g.groupId) : undefined;
                const parts = [
                  g.roleName,
                  scopeLabel(g.scope, units),
                  g.validUntil ? format(PEOPLE_TEXT.until, { date: untilDate(g.validUntil) }) : '',
                  group ? format(PEOPLE_TEXT.via, { group }) : '',
                  g.mismatch ? E.mismatch[g.mismatch] : '',
                ].filter(Boolean);
                return (
                  <li
                    key={g.assignmentId ?? `${g.roleId}-${i}`}
                    data-matches={g.matches ? '' : undefined}
                  >
                    {parts.join(' · ')}
                  </li>
                );
              })}
            </ul>
          ) : (
            <span>{E.noGrants}</span>
          )}
          {x.hiddenGrants ? <span className="ox-dlg-hint">{E.hidden}</span> : null}
        </div>
      </div>
    </Dialog>
  );
}
