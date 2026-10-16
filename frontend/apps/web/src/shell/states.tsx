// W1.20 · Глобальные состояния оболочки (01-shell.md §7): скелетон «Загружаем рабочее пространство…» (:182–190),
// ошибка загрузки «Не удалось загрузить модули прототипа: …» (:191–193), «Нужен вход» (каркас W0.09, вход —
// W1.22), «Страница не найдена» (ADR-0001: неизвестный маршрут и чужая организация — 404), заглушка страницы.
import { screenLabels, shell, format } from '@ortus/texts';
import type { PageKey } from '@ortus/domain/nav';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { T } from '../app/texts.ts';
import { SHELL_TEXT } from './texts.ts';

export function BootSkeleton(): ReactElement {
  return (
    <div className="ox-skeleton" role="status" aria-label={shell.a11y.loading}>
      <div className="ox-skeleton-bar" />
      <div className="ox-skeleton-bar" data-size="title" />
      <div className="ox-skeleton-bar" data-size="card" />
      <div className="ox-skeleton-bar" data-size="block" />
      <span className="ox-skeleton-text">{shell.boot.loading}</span>
    </div>
  );
}

export function LoadError({ text }: { text: string }): ReactElement {
  return (
    <div className="ox-load-error" role="alert">
      {format(shell.boot.loadError, { error: text })}
    </div>
  );
}

export function SignInNeeded(): ReactElement {
  return (
    <section className="ox-signin">
      <p>{T.signInNeeded}</p>
      <Link to="/auth/login">{T.signIn}</Link>
    </section>
  );
}

export function NotFound(): ReactElement {
  return (
    <section aria-labelledby="h-not-found">
      <h1 id="h-not-found" className="ox-page-title">
        {SHELL_TEXT.notFound.title}
      </h1>
      <p className="ox-page-text">{SHELL_TEXT.notFound.text}</p>
    </section>
  );
}

const SCREEN_LABEL = screenLabels.byPage as Partial<Record<PageKey, string>>;

/**
 * 404 вне оболочки: чужая или неизвестная организация, неизвестный путь (ADR-0001). Меню нет — выход по
 * ссылке на «/» (стартовая страница организации по умолчанию или «Организации» оператора).
 */
export function GlobalNotFound(): ReactElement {
  return (
    <main className="ox-lost">
      <section aria-labelledby="h-not-found" className="ox-lost-card">
        <h1 id="h-not-found" className="ox-page-title">
          {SHELL_TEXT.notFound.title}
        </h1>
        <p className="ox-page-text">{SHELL_TEXT.notFound.global}</p>
        <Link to="/" className="ox-lost-link">
          {SHELL_TEXT.notFound.home}
        </Link>
      </section>
    </main>
  );
}

/** Заглушка страницы, которой ещё нет (`routes/**` своих WS): заголовок — подпись пункта меню. */
export function PageStub({ page, title }: { page: PageKey; title: string }): ReactElement {
  return (
    <section aria-labelledby={`h-${page}`} data-screen-label={SCREEN_LABEL[page]}>
      <h1 id={`h-${page}`} className="ox-page-title">
        {title}
      </h1>
    </section>
  );
}
