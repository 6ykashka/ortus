// W1.22 · Принятие приглашения `/auth/invitation#token=…` (S1-06, no-reference до B-6 №2; ссылка письма W1.41,
// Q-W1.41-3). Токен — из фрагмента в sessionStorage вкладки, фрагмент убирается из адреса. inspectInvitation → бизнес,
// маска почты, срок, статус. Ожидает: без входа — «Войти и принять» (startLogin, возврат сюда), с входом — «Принять
// приглашение» (acceptInvitation) → перечитать /me/context → стартовая страница бизнеса и тост. Отказы — на экране.
import { type components, type MeContext, ProblemError, unwrap } from '@ortus/api-client';
import { errors, format } from '@ortus/texts';
import { Banner, Button } from '@ortus/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { useApi } from '../../app/api.tsx';
import { ME_CONTEXT_KEY, useMe } from '../../shell/me.ts';
import { problemCode, problemText, useBusy, useRun } from '../../shell/run.tsx';
import { AuthFrame } from './AuthFrame.tsx';
import { browser } from './browser.ts';
import {
  forgetInvitationToken,
  peekInvitationToken,
  rememberInvitationToken,
  tokenFromHash,
} from './invitation-token.ts';
import { startLoginUrl } from './login-url.ts';
import { INVITATION_TEXT as T } from './texts.ts';

type Preview = components['schemas']['InvitationPreview'];

export const INVITATION_PATH = '/auth/invitation';
const invitationKey = (token: string) => ['auth', 'invitation', token] as const;

const AT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/** Ответы принятия, которые показывает экран (тоста нет); прочие (нет связи, 429, 5xx) — тост `run`. */
const QUIET = [
  'forbidden_action',
  'seats_exhausted',
  'invalid_transition',
  'public_token_expired',
  'not_found',
  'session_expired',
  'tenant_suspended',
  'tenant_read_only',
] as const;

type Final = 'expired' | 'notFound';

/** После «Повторить» кнопка исчезает вместе с экраном сбоя: фокус переносится на заголовок нового экрана. */
const FocusTitle = createContext(false);

function Screen({ title, children }: { title: string; children?: ReactNode }): ReactElement {
  const focus = useContext(FocusTitle);
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus, title]);
  return (
    <AuthFrame labelledBy="h-invitation">
      <h1 ref={ref} id="h-invitation" className="ox-auth-title" tabIndex={-1}>
        {title}
      </h1>
      {children}
    </AuthFrame>
  );
}

function Closed({
  title,
  text,
  link,
}: {
  title: string;
  text: string;
  link: { to: string; label: string };
}): ReactElement {
  useEffect(() => forgetInvitationToken(), []);
  return (
    <Screen title={title}>
      <p className="ox-auth-text">{text}</p>
      <Link to={link.to} className="ox-auth-link">
        {link.label}
      </Link>
    </Screen>
  );
}

const TO_LOGIN = { to: '/auth/login', label: T.toLogin };

function Expired({ tenant }: { tenant?: string }): ReactElement {
  return (
    <Closed
      title={T.expiredTitle}
      text={tenant ? format(T.expiredText, { tenant }) : T.expiredUnknown}
      link={TO_LOGIN}
    />
  );
}

const NotFound = (): ReactElement => (
  <Closed title={T.notFoundTitle} text={T.notFoundText} link={TO_LOGIN} />
);

/** Отказ принятия, который показывает экран. */
function AcceptFailure({ code, email }: { code: string; email: string }): ReactElement {
  if (code === 'forbidden_action') {
    return (
      <Banner tone="danger" title={T.mismatchTitle} text={format(T.mismatchText, { email })} />
    );
  }
  const text =
    code === 'invalid_transition'
      ? T.closed
      : ((errors.problem as Record<string, string>)[code] ?? errors.fallback);
  return <Banner tone="danger" title={T.failedTitle} text={text} />;
}

function Pending({
  token,
  preview,
  onFinal,
}: {
  token: string;
  preview: Preview;
  onFinal: (f: Final) => void;
}): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const run = useRun();
  const navigate = useNavigate();
  const me = useMe();
  const accepting = useBusy('acceptInvitation');
  const leavingAccount = useBusy('logout');
  const [leaving, setLeaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const tenant = preview.tenantName;

  const signIn = () => {
    setLeaving(true);
    browser.assign(startLoginUrl(INVITATION_PATH));
  };

  const accept = async () => {
    setFailure(null);
    let result: components['schemas']['InvitationAcceptance'];
    try {
      result = await run(
        'acceptInvitation',
        async () =>
          unwrap(
            await api.POST('/api/v1/auth/invitations/accept', {
              params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
              body: { token },
            }),
          ),
        format(T.joined, { tenant }),
        { quiet: QUIET },
      );
    } catch (e) {
      const code = problemCode(e);
      if (code === 'public_token_expired') onFinal('expired');
      else if (code === 'not_found') onFinal('notFound');
      else if (code === 'session_expired') void qc.invalidateQueries({ queryKey: ME_CONTEXT_KEY });
      else if ((QUIET as readonly string[]).includes(code)) setFailure(code);
      if (code === 'invalid_transition') {
        void qc.invalidateQueries({ queryKey: invitationKey(token) });
      }
      return;
    }
    forgetInvitationToken();
    // Новое членство — в /me/context: перечитать до перехода, иначе оболочка увидит старый список организаций.
    await qc.invalidateQueries({ queryKey: ME_CONTEXT_KEY, refetchType: 'all' });
    await navigate({ to: '/t/$tenantId', params: { tenantId: result.tenantId } });
  };

  // Выход и новый вход: у провайдера OIDC своя сессия — без его выхода он снова впустит тот же аккаунт.
  const otherAccount = async () => {
    const r = await run('logout', async () =>
      unwrap(
        await api.POST('/api/v1/auth/logout', {
          params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
        }),
      ),
    ).catch(() => null);
    if (!r) return;
    setLeaving(true);
    browser.assign(r.endSessionUrl ?? startLoginUrl(INVITATION_PATH));
  };

  // 401 (сессия потеряна, в т. ч. при принятии): перечитанный /me/context — ошибка, а TanStack Query хранит прежние
  // данные. Прежний пользователь не показывается — экран переходит в вид «не вошёл».
  const signedOut = me.error instanceof ProblemError && me.error.status === 401;
  const user: MeContext | undefined = signedOut ? undefined : me.data;

  return (
    <Screen title={format(T.pendingTitle, { tenant })}>
      <p className="ox-auth-text">
        {format(T.pendingText, {
          email: preview.invitedEmailMasked,
          date: AT.format(new Date(preview.expiresAt)),
        })}
      </p>
      {failure ? <AcceptFailure code={failure} email={preview.invitedEmailMasked} /> : null}
      {user ? (
        <>
          <p className="ox-auth-text">{format(T.signedIn, { name: user.displayName })}</p>
          <div className="ox-auth-actions">
            <Button
              size="lg"
              loading={accepting}
              loadingLabel={T.accepting}
              disabled={accepting || leaving}
              onPress={() => void accept()}
            >
              {T.accept}
            </Button>
            <Button
              size="lg"
              variant="ghost"
              loading={leavingAccount}
              disabled={accepting || leaving}
              onPress={() => void otherAccount()}
            >
              {T.otherAccount}
            </Button>
          </div>
        </>
      ) : null}
      {signedOut ? (
        <>
          <p className="ox-auth-text">{T.signedOut}</p>
          <div className="ox-auth-actions">
            <Button
              size="lg"
              loading={leaving}
              loadingLabel={T.signingIn}
              disabled={leaving}
              onPress={signIn}
            >
              {T.signInAccept}
            </Button>
          </div>
        </>
      ) : null}
      {me.isError && !signedOut ? (
        <Banner
          tone="danger"
          title={T.meErrorTitle}
          text={problemText(me.error)}
          action={{ label: T.retry, onPress: () => void me.refetch() }}
        />
      ) : null}
      {me.isPending ? (
        <p className="ox-auth-note" role="status">
          {T.loading}
        </p>
      ) : null}
    </Screen>
  );
}

export default function InvitationPage(): ReactElement {
  const api = useApi();
  const navigate = useNavigate();
  const hash = useLocation({ select: (l) => l.hash });
  const [token, setToken] = useState(() => peekInvitationToken(hash));
  const [final, setFinal] = useState<Final | null>(null);
  // Новая ссылка в открытой вкладке меняет только фрагмент (страница не перезагружается): её токен заменяет прежний.
  // При рендере — только чтение фрагмента; запись во вкладку — в эффекте ниже.
  const [seenHash, setSeenHash] = useState(hash);
  if (hash !== seenHash) {
    setSeenHash(hash);
    const next = tokenFromHash(hash);
    if (next && next !== token) {
      setToken(next);
      setFinal(null);
    }
  }

  // Токен ссылки — во вкладку. Layout-эффект идёт раньше пассивных эффектов экранов «уже принято», «истекло»,
  // «отозвано», которые токен забывают: запись не вернёт забытый токен.
  useLayoutEffect(() => {
    const fromLink = tokenFromHash(hash);
    if (fromLink) rememberInvitationToken(fromLink);
  }, [hash]);

  // Фрагмент со ссылкой письма убирается из адреса (истории), токен уже во вкладке.
  useEffect(() => {
    if (hash) void navigate({ to: INVITATION_PATH, replace: true });
  }, [hash, navigate]);

  const inspect = useQuery({
    queryKey: invitationKey(token ?? ''),
    enabled: token !== null && final === null,
    retry: false,
    staleTime: Infinity,
    queryFn: async (): Promise<Preview> =>
      unwrap(await api.POST('/api/v1/auth/invitations/inspect', { body: { token: token ?? '' } })),
  });

  // «Повторить» после сбоя проверки: заголовок экрана, который придёт на смену сбою, получает фокус. Пока перечитывание
  // идёт (или снова не удалось), фокус остаётся на кнопке.
  const [retried, setRetried] = useState(false);
  const retry = () => {
    setRetried(true);
    void inspect.refetch();
  };

  const view = (): ReactElement => {
    if (!token || final === 'notFound') return <NotFound />;
    if (final === 'expired') return <Expired tenant={inspect.data?.tenantName} />;
    if (inspect.isPending) {
      return (
        <AuthFrame labelledBy="h-invitation">
          <p id="h-invitation" className="ox-auth-note" role="status">
            {T.loading}
          </p>
        </AuthFrame>
      );
    }
    if (inspect.isError) {
      const code = problemCode(inspect.error);
      if (code === 'not_found' || code === 'validation_failed') return <NotFound />;
      return (
        <Screen title={T.loadErrorTitle}>
          <p className="ox-auth-text">{problemText(inspect.error)}</p>
          <div className="ox-auth-actions">
            <Button size="lg" variant="secondary" onPress={retry}>
              {T.retry}
            </Button>
          </div>
        </Screen>
      );
    }
    const preview = inspect.data;
    const tenant = preview.tenantName;
    switch (preview.status) {
      case 'pending':
        return <Pending token={token} preview={preview} onFinal={setFinal} />;
      case 'accepted':
        return (
          <Closed
            title={T.acceptedTitle}
            text={format(T.acceptedText, { tenant })}
            link={{ to: '/', label: T.openWorkspace }}
          />
        );
      case 'expired':
        return <Expired tenant={tenant} />;
      case 'revoked':
        return (
          <Closed title={T.revokedTitle} text={format(T.revokedText, { tenant })} link={TO_LOGIN} />
        );
    }
  };

  return <FocusTitle.Provider value={retried && !inspect.isError}>{view()}</FocusTitle.Provider>;
}
