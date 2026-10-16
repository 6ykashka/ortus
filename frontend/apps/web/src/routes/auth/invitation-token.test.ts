// W1.22 · Токен приглашения: из фрагмента ссылки письма `#token=` (W1.41, Q-W1.41-3) в sessionStorage вкладки —
// переживает уход к провайдеру входа и не попадает ни в URL запросов, ни в путь возврата.
import { afterEach, describe, expect, it } from 'vitest';

import {
  forgetInvitationToken,
  INVITATION_TOKEN_KEY,
  peekInvitationToken,
  rememberInvitationToken,
  tokenFromHash,
} from './invitation-token.ts';

const TOKEN = 'inv_d79d3e928ef456668c55d8cf04be9bcf';

afterEach(() => sessionStorage.clear());

describe('tokenFromHash — фрагмент ссылки письма', () => {
  it('#token=<base64url 32…256> — токен', () => {
    expect(tokenFromHash(`#token=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(`token=${TOKEN}`)).toBe(TOKEN);
  });

  it('нет фрагмента, другой ключ, короткий, длинный или с чужими символами — нет токена', () => {
    for (const h of [
      '',
      '#',
      '#t=abc',
      '#token=short',
      `#token=${'a'.repeat(257)}`,
      '#token=a+b/c=' + 'x'.repeat(40),
    ]) {
      expect(tokenFromHash(h), h).toBeNull();
    }
  });
});

describe('peekInvitationToken и rememberInvitationToken — фрагмент или хранилище вкладки', () => {
  it('peek только читает: токен из фрагмента, хранилище не меняется', () => {
    expect(peekInvitationToken(`#token=${TOKEN}`)).toBe(TOKEN);
    expect(sessionStorage.getItem(INVITATION_TOKEN_KEY)).toBeNull();
  });

  it('remember сохраняет токен в sessionStorage', () => {
    rememberInvitationToken(TOKEN);
    expect(sessionStorage.getItem(INVITATION_TOKEN_KEY)).toBe(TOKEN);
  });

  it('без фрагмента — токен из хранилища (возврат после входа)', () => {
    sessionStorage.setItem(INVITATION_TOKEN_KEY, TOKEN);
    expect(peekInvitationToken('')).toBe(TOKEN);
  });

  it('новый фрагмент сильнее сохранённого токена', () => {
    sessionStorage.setItem(INVITATION_TOKEN_KEY, TOKEN);
    const other = 'B'.repeat(43);
    expect(peekInvitationToken(`#token=${other}`)).toBe(other);
  });

  it('испорченный токен в хранилище не используется', () => {
    sessionStorage.setItem(INVITATION_TOKEN_KEY, 'nope');
    expect(peekInvitationToken('')).toBeNull();
  });

  it('forgetInvitationToken очищает хранилище', () => {
    sessionStorage.setItem(INVITATION_TOKEN_KEY, TOKEN);
    forgetInvitationToken();
    expect(sessionStorage.getItem(INVITATION_TOKEN_KEY)).toBeNull();
  });
});
