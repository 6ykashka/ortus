// W1.20 · AccessGate (разметка :195–203, gateVM :3053–3081; 01-shell.md §12). Тексты — `@ortus/texts` gate.
// Кнопки «Демо: открыть как владелец» не переносятся (PD-54): действие есть только у владельца —
// «Открыть «Модули и место»». Отказ «вне области» (no_scope) — для объекта: `<PageDenied reason="no_scope" />`.
import type { PageAccess } from '@ortus/domain/nav';
import { format, gate } from '@ortus/texts';
import { Button, Icon } from '@ortus/ui';
import type { ReactElement } from 'react';

import { moduleName, navLabel } from './labels.ts';

type Deny = Extract<PageAccess, { kind: 'deny' }>;

interface GateView {
  tone: 'neutral' | 'warn';
  icon: 'extension_off' | 'lock';
  chip: string;
  title: string;
  text: string;
}

function view(d: Deny): GateView {
  const name = d.domainModule ? moduleName(d.domainModule) : d.label ? navLabel(d.label) : '';
  if (d.reason === 'no_scope') {
    return {
      tone: 'warn',
      icon: 'lock',
      chip: gate.chips.noPermission,
      title: gate.reason.noScope.label,
      text: gate.reason.noScope.text,
    };
  }
  if (d.reason === 'no_permission') {
    const review = d.title === 'noReview';
    return {
      tone: 'warn',
      icon: 'lock',
      chip: gate.chips.noPermission,
      title:
        d.branch === 'A'
          ? format(gate.a.titleNoPermission, { name })
          : review
            ? gate.b.titleNoReview
            : format(gate.b.titleNoRole, { name }),
      text:
        d.branch === 'A' ? gate.a.textNoPermission : format(gate.b.textNoPermission, { review }),
    };
  }
  const texts = d.branch === 'A' ? gate.a : gate.b;
  return {
    tone: 'neutral',
    icon: 'extension_off',
    chip: d.chip === 'moduleDisabled' ? gate.chips.moduleDisabled : gate.chips.moduleOff,
    title: format(texts.titleModuleOff, { name }),
    text: d.owner ? texts.textOwner : texts.textOther,
  };
}

export interface AccessGateProps {
  access: Deny;
  /** Перейти в «Модули и место» (владелец, модуль не подключён или отключён). */
  onOpenModules?: () => void;
}

export function AccessGate({ access, onOpenModules }: AccessGateProps): ReactElement {
  const v = view(access);
  const action = access.owner && access.reason !== 'no_permission' && onOpenModules;
  return (
    <div className="ox-gate" data-tone={v.tone} data-reason={access.reason}>
      <span className="ox-gate-circle">
        <Icon name={v.icon} size={28} />
      </span>
      <span className="ox-gate-chip">{v.chip}</span>
      <h1 className="ox-gate-title">{v.title}</h1>
      <p className="ox-gate-text">{v.text}</p>
      {action ? (
        // Кнопка карточки :200 — min-height 44, padding 0 18px (у Button @ortus/ui — 0 16px).
        <span className="ox-gate-action">
          <Button onPress={onOpenModules}>{gate.actions.openModules}</Button>
        </span>
      ) : null}
    </div>
  );
}

/** Отказ страницы по объекту: право есть, объект вне области назначения (`no_scope`). */
export function PageDenied({ reason = 'no_scope' }: { reason?: 'no_scope' }): ReactElement {
  return (
    <AccessGate
      access={{
        kind: 'deny',
        reason,
        branch: 'B',
        chip: 'noPermission',
        title: 'noRole',
        domainModule: null,
        label: null,
        owner: false,
      }}
    />
  );
}
