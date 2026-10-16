// W1.22 · Адрес входа BFF: путь возврата по шаблону `returnTo` контракта startLogin (api/openapi/paths/auth.yaml),
// вход оператора по `/platform…` (Q-W1.03-1).
import { describe, expect, it } from 'vitest';

import { isOperatorPath, safeNext, startLoginUrl } from './login-url.ts';

describe('safeNext — путь возврата после входа', () => {
  it('относительный путь приложения остаётся как есть (с запросом и фрагментом)', () => {
    expect(safeNext('/t/t-alta/users?tab=roles')).toBe('/t/t-alta/users?tab=roles');
    expect(safeNext('/')).toBe('/');
    expect(safeNext('/auth/invitation')).toBe('/auth/invitation');
  });

  it('нет пути, чужой сайт, «\\», пробелы, управляющие символы, > 512 — корень', () => {
    for (const bad of [
      null,
      undefined,
      '',
      'users',
      '//evil.example/x',
      'https://evil.example/',
      '/\\evil.example',
      '/a\\b',
      '/a b',
      '/a\tb',
      '/a\u0000b',
      '/' + 'a'.repeat(512),
    ]) {
      expect(safeNext(bad), String(bad)).toBe('/');
    }
  });
});

describe('startLoginUrl — навигация на BFF startLogin', () => {
  it('returnTo кодируется в запросе', () => {
    expect(startLoginUrl('/t/t-alta/users?tab=roles')).toBe(
      '/api/v1/auth/login?returnTo=%2Ft%2Ft-alta%2Fusers%3Ftab%3Droles',
    );
    expect(startLoginUrl('/')).toBe('/api/v1/auth/login?returnTo=%2F');
  });

  it('кривой путь заменяется корнем', () => {
    expect(startLoginUrl('//evil.example')).toBe('/api/v1/auth/login?returnTo=%2F');
  });
});

describe('isOperatorPath — вход управления платформой', () => {
  it('/platform и /platform/… — оператор, остальное — нет', () => {
    expect(isOperatorPath('/platform')).toBe(true);
    expect(isOperatorPath('/platform/tenants')).toBe(true);
    expect(isOperatorPath('/platformx')).toBe(false);
    expect(isOperatorPath('/t/t-alta/home')).toBe(false);
  });
});
