// W1.23 · Кнопка подвала диалогов «Пользователей и ролей». На время команды — `aria-disabled` с защитой в
// обработчике, а не нативный `disabled`: браузер снимает фокус с выключенной кнопки на body, фокус уходит из
// диалога, и Escape его не закрывает (возврат 16.10 №2, verification-protocol §1.3). Нативный `disabled` — только
// для постоянного запрета (например, «Пригласить» без свободных мест).
import type { ReactElement, ReactNode } from 'react';

export interface DlgButtonProps {
  children: ReactNode;
  onPress: () => void;
  /** Идёт команда: кнопка недоступна, но держит фокус. */
  busy?: boolean;
  /** Постоянный запрет (нативный `disabled`). */
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}

export function DlgButton({
  children,
  onPress,
  busy = false,
  disabled = false,
  primary = false,
  danger = false,
}: DlgButtonProps): ReactElement {
  return (
    <button
      type="button"
      className="ox-dlg-btn"
      data-primary={primary ? '' : undefined}
      data-danger={danger ? '' : undefined}
      disabled={disabled}
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy && !disabled) onPress();
      }}
    >
      {children}
    </button>
  );
}
