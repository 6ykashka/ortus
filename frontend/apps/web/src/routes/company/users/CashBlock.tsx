// W5.33 · Блок «Касса · остаток и лимиты» редактора роли (Ортус CRM.dc.html :373–379, VM roleEditorVM :3202–3205;
// 02-company §6.12): флажки `cash.balance.read` («Видеть остаток и ожидаемую сумму смены») и `cash.advance.self`
// («Только свой подотчёт»; у роли с функцией «Водитель» включён и заблокирован) и три лимита суммы без согласования
// (расход, возврат, выдача под отчёт; при «Только свой подотчёт» не показываются). Флажки — ключи прав роли.
// Суммы лимитов контракт 0.12.0-stage5 в роли не хранит (`Role` — только `permissions`; `limit: amount` каталога
// прав без носителя): поля показаны, но недоступны, пока стюард контракта не добавит поле (Q-W5.33-2).
import { company } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { type ReactElement, useId } from 'react';

import { CASH_BALANCE, CASH_SELF, withFlag } from './catalog.ts';
import { PEOPLE_TEXT } from './texts.ts';

const E = company.users.editor;

const LIMITS = [
  { key: 'out', label: E.cashLimits.out },
  { key: 'refund', label: E.cashLimits.refund },
  { key: 'advance', label: E.cashLimits.advance },
] as const;

export interface CashBlockProps {
  /** Права роли (ключи контракта). */
  permissions: readonly string[];
  /** Роль с функцией «Водитель»: «Только свой подотчёт» включён и заблокирован. */
  driver: boolean;
  readOnly: boolean;
  onChange: (permissions: string[]) => void;
}

export function CashBlock({
  permissions,
  driver,
  readOnly,
  onChange,
}: CashBlockProps): ReactElement {
  const id = useId();
  const self = driver || permissions.includes(CASH_SELF);
  return (
    <div
      role="group"
      className="ox-role-cash"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-note`}
    >
      <div className="ox-role-cash-head">
        <Icon name="account_balance_wallet" size={20} />
        <strong id={`${id}-title`}>{E.cash}</strong>
      </div>
      <span id={`${id}-note`} className="ox-role-cash-note">
        {E.cashNote}
      </span>
      <label className="ox-role-cash-flag">
        <input
          type="checkbox"
          checked={permissions.includes(CASH_BALANCE)}
          disabled={readOnly}
          onChange={(e) => onChange(withFlag(permissions, CASH_BALANCE, e.target.checked))}
        />
        <span className="ox-role-cash-flag-text">
          <span>{E.cashBalance}</span>
          <code>{CASH_BALANCE}</code>
        </span>
      </label>
      <label className="ox-role-cash-flag">
        <input
          type="checkbox"
          checked={self}
          disabled={readOnly || driver}
          onChange={(e) => onChange(withFlag(permissions, CASH_SELF, e.target.checked))}
        />
        <span className="ox-role-cash-flag-text">
          <span>{E.cashSelf}</span>
          <code>{CASH_SELF}</code>
        </span>
      </label>
      {self ? null : (
        <>
          <div className="ox-role-cash-limits">
            {LIMITS.map((l) => (
              <label key={l.key} className="ox-role-cash-limit">
                {l.label}
                <input inputMode="numeric" disabled placeholder={E.cashNoLimit} />
              </label>
            ))}
          </div>
          <span className="ox-role-cash-note">{E.cashLimitsNote}</span>
          <span className="ox-role-cash-note" data-muted="">
            {PEOPLE_TEXT.cashLimitsUnsaved}
          </span>
        </>
      )}
    </div>
  );
}
