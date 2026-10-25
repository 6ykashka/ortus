// W4.70 · Каркас страниц заполнения формы (сотрудник и гость, no-reference — Q-W4.00-forms-19): страница без оболочки
// с рендером формы по центру, состояния вместо формы (заголовок, пояснение, действие), загрузка и сообщение отправки.
import '../forms.css';
import './fill.css';

import { forms as F } from '@ortus/texts';
import type { ReactElement, ReactNode } from 'react';

import { Glyph } from '../parts.tsx';

/** Страница заполнения: `embed` — встраивание `?embed=1` (только форма, без фона и отступов страницы). */
export function FillFrame({
  embed = false,
  children,
}: {
  embed?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <main className="ox-fm ox-ff" data-embed={embed ? '' : undefined}>
      {children}
    </main>
  );
}

export function FillLoading(): ReactElement {
  return (
    <p className="ox-ff-loading" role="status">
      {F.fill.loading}
    </p>
  );
}

/** Состояние вместо формы: значок, заголовок, пояснение и действие (повтор, «Открыть заново»). */
export function FillState(p: {
  icon: string;
  title: string;
  text?: string;
  action?: { label: string; onClick: () => void };
}): ReactElement {
  return (
    <section className="ox-ff-state" aria-labelledby="h-ff-state">
      <Glyph name={p.icon} size={40} />
      <h1 id="h-ff-state">{p.title}</h1>
      {p.text ? <p>{p.text}</p> : null}
      {p.action ? (
        <button
          type="button"
          className="ox-fm-btn"
          data-variant="primary"
          onClick={p.action.onClick}
        >
          {p.action.label}
        </button>
      ) : null}
    </section>
  );
}

/** Сообщение отправки над формой (нет связи, отказ без вопроса). */
export function FillAlert({ text }: { text: string | null }): ReactElement | null {
  return text ? (
    <p className="ox-ff-alert" role="alert">
      {text}
    </p>
  ) : null;
}
