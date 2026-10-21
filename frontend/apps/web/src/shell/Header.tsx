// W1.20 · Шапка (:94–146, shellVM :3031–3048; 01-shell.md §10): знак и короткое имя, «пространство бизнеса»
// или «управление платформой», организация (при нескольких — переключатель бизнеса S1-07, no-reference),
// область, пилюля «Нет связи», «Уведомления», «Профиль». Поповеры взаимоисключающие (§16.3).
import { format, shell } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import type { ReactElement, ReactNode } from 'react';

import type { BrandHeader } from './brand.ts';
import type { ScopeView } from './scope.ts';
import { SHELL_TEXT } from './texts.ts';

export type Popover = 'notifications' | 'profile' | 'switcher' | null;

export interface HeaderTenant {
  tenantId: string;
  name: string;
}

export interface HeaderProps {
  chrome: 'light' | 'dark';
  sub: string;
  title: string;
  scope: ScopeView;
  scopeValue: string;
  onScope: (value: string) => void;
  /** Организации для переключателя; переключатель — только при двух и больше. */
  tenants: readonly HeaderTenant[];
  currentTenantId: string | null;
  onSelectTenant: (tenantId: string) => void;
  online: boolean;
  initials: string;
  popover: Popover;
  setPopover: (p: Popover) => void;
  /** Кнопка и поповер «Уведомления» (у оператора нет). */
  inbox?: { button: ReactNode; panel: ReactNode };
  profile: ReactNode;
  /** Знак и «ортус · пространство бизнеса»; у кадра загрузки их нет (top.noLogo не задан, :97, :2823). */
  brand?: boolean;
  /** W4.62: знак по оформлению организации (логотип, знак или буква и короткое имя, :96–100). */
  mark?: BrandHeader;
}

export function Header(p: HeaderProps): ReactElement {
  const toggle = (kind: Exclude<Popover, null>) => p.setPopover(p.popover === kind ? null : kind);
  const switchable = p.tenants.length > 1;
  return (
    <header className="ox-header" data-chrome={p.chrome}>
      <div className="ox-brand">
        {p.brand === false ? null : p.mark?.logoUrl ? (
          <span
            role="img"
            aria-label={p.title}
            className="ox-brand-logo"
            style={{ backgroundImage: `url("${p.mark.logoUrl}")` }}
          />
        ) : (
          <>
            {p.mark?.markUrl ? (
              <span
                className="ox-brand-mark"
                aria-hidden="true"
                style={{ backgroundImage: `url("${p.mark.markUrl}")` }}
              />
            ) : (
              <span className="ox-brand-letter" aria-hidden="true">
                {p.mark?.letter ?? shell.header.brandLetter}
              </span>
            )}
            <div className="ox-brand-text">
              <span className="ox-brand-name">{p.mark?.name ?? shell.header.brandName}</span>
              <span className="ox-brand-sub">{p.sub}</span>
            </div>
          </>
        )}
      </div>
      <div className="ox-org">
        <Icon name="domain" size={20} className="ox-org-icon" />
        <div className="ox-org-text">
          {switchable ? (
            <button
              type="button"
              className="ox-org-switch"
              aria-label={format(SHELL_TEXT.switcher.label, { name: p.title })}
              aria-haspopup="dialog"
              aria-expanded={p.popover === 'switcher'}
              onClick={() => toggle('switcher')}
            >
              <span className="ox-org-name">{p.title}</span>
              <Icon name="expand_more" size={18} />
            </button>
          ) : (
            <span className="ox-org-name">{p.title}</span>
          )}
          {p.scope.kind === 'text' ? <span className="ox-org-scope">{p.scope.text}</span> : null}
        </div>
        {p.scope.kind === 'select' ? (
          <select
            className="ox-scope-select"
            aria-label={shell.a11y.scope}
            value={p.scopeValue}
            onChange={(e) => p.onScope(e.target.value)}
          >
            {p.scope.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : null}
        {switchable && p.popover === 'switcher' ? (
          <div
            className="ox-popover"
            data-kind="switcher"
            role="dialog"
            aria-label={SHELL_TEXT.switcher.title}
          >
            {p.tenants.map((t) => (
              <button
                key={t.tenantId}
                type="button"
                className="ox-switch-item"
                aria-current={t.tenantId === p.currentTenantId ? 'true' : undefined}
                onClick={() => p.onSelectTenant(t.tenantId)}
              >
                {t.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {!p.online ? (
        <span className="ox-offline-pill" role="status">
          <Icon name="cloud_off" size={16} />
          {shell.demo.flags.offline}
        </span>
      ) : null}
      {p.inbox?.button}
      <button
        type="button"
        className="ox-avatar"
        aria-label={shell.header.profile}
        aria-expanded={p.popover === 'profile'}
        onClick={() => toggle('profile')}
      >
        {p.initials}
      </button>
      {p.popover === 'notifications' ? p.inbox?.panel : null}
      {p.popover === 'profile' ? p.profile : null}
    </header>
  );
}

export interface ProfileProps {
  name: string;
  title: string;
  linesTitle: string;
  lines: readonly string[];
  onLogout?: () => void;
  busy?: boolean;
}

export function ProfilePopover(p: ProfileProps): ReactElement {
  return (
    <div className="ox-popover" data-kind="profile" role="dialog" aria-label={shell.header.profile}>
      <div>
        <div className="ox-profile-name">{p.name}</div>
        <div className="ox-profile-title">{p.title}</div>
      </div>
      {p.lines.length ? (
        <div className="ox-profile-lines">
          <span className="ox-profile-lines-title">{p.linesTitle}</span>
          {p.lines.map((l) => (
            <span key={l} className="ox-profile-line">
              {l}
            </span>
          ))}
        </div>
      ) : null}
      {p.onLogout ? (
        <button type="button" className="ox-outline-button" onClick={p.onLogout} disabled={p.busy}>
          <Icon name="logout" size={18} />
          {SHELL_TEXT.logout}
        </button>
      ) : null}
    </div>
  );
}
