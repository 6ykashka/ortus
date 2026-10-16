// W1.22 · Экран входа `/auth/login?next=&error=&signedOut=` (S1-05, no-reference до B-6 №1; ADR-0001). «Войти» —
// навигация на BFF startLogin (OIDC Code + PKCE): дальше провайдер и `completeLogin`, который возвращает на `next`.
// На загрузке экран не обращается к API (после «Выйти» оболочки W1.49 запросов быть не должно). `?error=<code>` —
// исход неудачного входа (Problem.code или код OAuth провайдера); `?signedOut=1` — выход выполнен (B-6 №1,
// Q-W1.22-11). Без сети «Войти» не уводит вкладку на страницу ошибки браузера: экран показывает «Нет связи».
import { Banner, Button } from '@ortus/ui';
import { useLocation } from '@tanstack/react-router';
import { type ReactElement, useEffect, useState } from 'react';

import { AuthFrame } from './AuthFrame.tsx';
import { browser } from './browser.ts';
import { isOperatorPath, safeNext, startLoginUrl } from './login-url.ts';
import { LOGIN_TEXT as T } from './texts.ts';

/** Текст ошибки входа по коду из адреса: только собственные ключи словаря (`__proto__` и т. п. — «иная»). */
const failedText = (code: string): string =>
  Object.hasOwn(T.failed, code) ? (T.failed[code] ?? T.failedOther) : T.failedOther;

function LoginError({ code, back }: { code: string; back: boolean }): ReactElement {
  if (code === 'session_expired') {
    return (
      <Banner
        tone="warn"
        role="status"
        title={T.expiredTitle}
        text={back ? T.expiredBack : T.expired}
      />
    );
  }
  return <Banner tone="danger" title={T.failedTitle} text={failedText(code)} />;
}

export default function LoginPage(): ReactElement {
  const searchStr = useLocation({ select: (l) => l.searchStr });
  const params = new URLSearchParams(searchStr);
  const next = safeNext(params.get('next'));
  const error = params.get('error');
  const signedOut = params.get('signedOut') === '1';
  const [leaving, setLeaving] = useState(false);
  const [offline, setOffline] = useState(false);
  useEffect(() => browser.warmIconFont(), []);

  const signIn = () => {
    if (!browser.online()) {
      setOffline(true);
      return;
    }
    setOffline(false);
    setLeaving(true);
    browser.assign(startLoginUrl(next));
  };

  return (
    <AuthFrame labelledBy="h-login">
      <h1 id="h-login" className="ox-auth-title">
        {T.title}
      </h1>
      <p className="ox-auth-text">{isOperatorPath(next) ? T.leadOperator : T.lead}</p>
      {error ? (
        <LoginError code={error} back={next !== '/'} />
      ) : signedOut ? (
        <Banner tone="ok" role="status" title={T.signedOutTitle} text={T.signedOutText} />
      ) : null}
      {offline ? (
        <Banner tone="warn" role="alert" title={T.offlineTitle} text={T.offlineText} />
      ) : null}
      <div className="ox-auth-actions">
        <Button
          size="lg"
          loading={leaving}
          loadingLabel={T.signingIn}
          disabled={leaving}
          onPress={signIn}
        >
          {T.signIn}
        </Button>
      </div>
      <p className="ox-auth-note">{T.note}</p>
    </AuthFrame>
  );
}
