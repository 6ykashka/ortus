// W1.22 · Токен приглашения. Ссылка письма несёт его во фрагменте `#token=` (W1.41, Q-W1.41-3): фрагмент не уходит
// на сервер и в журналы. Экран кладёт токен в sessionStorage вкладки — он переживает уход к провайдеру входа и
// возврат (`returnTo=/auth/invitation` без токена: путь возврата попадает в URL startLogin и журналы BFF).
// В API токен идёт только в теле inspectInvitation и acceptInvitation (InvitationToken: 32…256 символов).

export const INVITATION_TOKEN_KEY = 'ortus:invitation-token';
const TOKEN = /^[A-Za-z0-9_-]{32,256}$/;

const valid = (t: string | null | undefined): string | null => (t && TOKEN.test(t) ? t : null);

/** Токен из фрагмента ссылки (`#token=…`), если он допустимого вида. */
export function tokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  return valid(params.get('token'));
}

function read(): string | null {
  try {
    return sessionStorage.getItem(INVITATION_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Запомнить токен во вкладке (переживает уход к провайдеру входа). Вызывается из эффекта, не при рендере. */
export function rememberInvitationToken(token: string): void {
  try {
    sessionStorage.setItem(INVITATION_TOKEN_KEY, token);
  } catch {
    // Хранилище недоступно (приватный режим): токен живёт до ухода со страницы.
  }
}

/** Токен из фрагмента или сохранённый ранее; иначе `null`. Только чтение — безопасно при рендере. */
export function peekInvitationToken(hash: string): string | null {
  return tokenFromHash(hash) ?? valid(read());
}

/** Забыть токен: приглашение принято или больше не действует. */
export function forgetInvitationToken(): void {
  try {
    sessionStorage.removeItem(INVITATION_TOKEN_KEY);
  } catch {
    // см. write
  }
}
