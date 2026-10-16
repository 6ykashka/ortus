// W1.22 · Рамка экранов входа и приглашения: без оболочки (шапки и меню нет — пользователь ещё не в организации),
// карточка по центру с знаком «Ортус» и тостом оболочки (команды `run` показывают ошибки тостом).
import './auth.css';

import type { ReactElement, ReactNode } from 'react';

import { ToastHost } from '../../shell/toast.tsx';
import { LOGIN_TEXT } from './texts.ts';

export function AuthFrame({
  labelledBy,
  children,
}: {
  labelledBy: string;
  children: ReactNode;
}): ReactElement {
  return (
    <main className="ox-auth" aria-labelledby={labelledBy}>
      <section className="ox-auth-card">
        <div className="ox-auth-brand">
          <span className="ox-auth-mark" aria-hidden="true">
            О
          </span>
          {LOGIN_TEXT.brand}
        </div>
        {children}
      </section>
      <ToastHost />
    </main>
  );
}
