// Dev-вход e2e (PD-54, бриф W0.05 §4.4): в сборке `--mode e2e` параметр `?persona=<id>` на любом маршруте
// выполняет вход dev-провайдером BFF до первого рендера; готовность — `<html data-e2e-persona="<id>">`.
// Неудача входа не останавливает рендер: она возвращается вызывающему и отмечается
// `<html data-e2e-login-error="…">`. В остальных сборках параметр игнорируется. Демо-панель прототипа
// не переносится (R-08).
import { devLogin, type ApiClientOptions } from '@ortus/api-client';

export const PERSONA_PARAM = 'persona';
const PERSONA_RE = /^[a-z0-9][a-z0-9@.-]{0,63}$/;

/** Итог dev-входа: персонаж из адреса (если был) и текст ошибки входа (если вход не удался). */
export interface DevLoginOutcome {
  persona?: string;
  error?: string;
}

/** Персонаж из URL — только в e2e-сборке и только допустимого вида. */
export function personaFromUrl(url: string, mode: string): string | undefined {
  if (mode !== 'e2e') return undefined;
  const p = new URL(url).searchParams.get(PERSONA_PARAM) ?? '';
  return PERSONA_RE.test(p) ? p : undefined;
}

/**
 * Выполняет dev-вход персонажа из адреса окна, убирает параметр из адреса и отмечает готовность.
 * Никогда не отклоняется: ошибка входа (401, нет API) возвращается в `error`.
 */
export async function devLoginFromLocation(
  mode: string,
  o: ApiClientOptions = {},
): Promise<DevLoginOutcome> {
  const persona = personaFromUrl(window.location.href, mode);
  if (!persona) return {};
  try {
    await devLogin(persona, o);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    document.documentElement.dataset.e2eLoginError = error;
    console.error(`dev-вход «${persona}» не выполнен: ${error}`);
    return { persona, error };
  }
  const url = new URL(window.location.href);
  url.searchParams.delete(PERSONA_PARAM);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  document.documentElement.dataset.e2ePersona = persona;
  return { persona };
}
