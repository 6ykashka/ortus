// Персонажи и подписи демо-панели эталона (design/Ортус CRM.dc.html:29–66) и dev-вход ?persona=
// реализации (PD-54: демо-панель не переносится, персонаж выбирается только в e2e-сборке).

export const PERSONAS = [
  'operator',
  'owner',
  'manager',
  'driver',
  'therapist',
  'foreman',
  'owner@t-lotos',
  'therapist@t-lotos',
] as const;

export type Persona = (typeof PERSONAS)[number];

/** Подписи опций select «Персонаж» дословно (`:34–45`). Две «Массажист · Анна Морозова» — выбор по value. */
export const PERSONA_LABEL: Readonly<Record<Persona, string>> = {
  operator: 'Оператор платформы',
  owner: 'Владелец · Дарья Зимина',
  manager: 'Логист · Марина Котова',
  driver: 'Водитель · Илья Васильев',
  therapist: 'Массажист · Анна Морозова',
  foreman: 'Прораб · Алексей Соколов',
  'owner@t-lotos': 'Владелец · Ирина Белова',
  'therapist@t-lotos': 'Массажист · Анна Морозова',
};

/** Опции select «Ширина» (`:51–54`). */
export const WIDTH_LABEL = {
  auto: 'По окну',
  390: '390 · телефон',
  768: '768 · планшет',
  1440: '1440 · компьютер',
} as const;

export type FrameWidth = keyof typeof WIDTH_LABEL;

/** Порядок опций «Ширина» (у объекта числовые ключи идут раньше строковых). */
export const WIDTHS: readonly FrameWidth[] = ['auto', 390, 768, 1440];

/** Флажки панели (`:63–65`). */
export const FLAG_LABEL = {
  offline: 'Нет связи',
  conflictNext: 'Конфликт брони',
  failUploadNext: 'Сбой загрузки фото',
} as const;

export const PANEL = '[aria-label="Панель демонстрации"]';

/** Главный файл эталона; модульные `.dc.html` передаются в reference(file) явно. */
export const MAIN_REFERENCE = 'Ортус CRM.dc.html';

/** Параметр dev-входа реализации. */
export const PERSONA_PARAM = 'persona';

export function isPersona(value: string): value is Persona {
  return (PERSONAS as readonly string[]).includes(value);
}

/** Маршрут реализации с dev-входом: `/t/t-alta/home?persona=owner` (только e2e-сборка). */
export function personaUrl(route: string, persona: Persona): string {
  if (!isPersona(persona)) throw new Error(`persona=${String(persona)}: неизвестный персонаж`);
  const url = new URL(route, 'http://e2e.invalid');
  url.searchParams.set(PERSONA_PARAM, persona);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Тело dev-входа нового человека (W1.50): subject вне сида, адрес и имя аккаунта. */
export interface NewcomerLogin {
  persona: string;
  email: string;
  displayName: string;
}

/** Префикс subject нового человека. */
export const NEWCOMER_PREFIX = 'new-';

/** Форма subject dev-провайдера (`userSubject`, backend/internal/platform/session/dev/dev.go). */
const DEV_SUBJECT = /^[a-z0-9][a-z0-9@._-]{0,63}$/;
/** Голый адрес local@domain без имени, комментариев и пробелов (сервер проверяет строже, net/mail). */
const BARE_EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+$/;

/**
 * Тело dev-входа нового человека: `POST /api/v1/dev/login` с ним на стенде `APP_ENV=dev|e2e` создаёт аккаунт при
 * первом входе (issuer `urn:ortus:dev`), повторный вход с тем же адресом — тот же аккаунт. Только режим `stand`:
 * MSW-вход режима `mock` принимает лишь `{persona}`.
 */
export function newcomer(email: string, displayName: string): NewcomerLogin {
  const address = email.trim().toLowerCase();
  if (address.length > 254 || !BARE_EMAIL.test(address)) {
    throw new Error(`newcomer: email ${JSON.stringify(email)} — не адрес local@domain`);
  }
  const name = displayName.trim();
  if (!name) throw new Error('newcomer: displayName пустой');
  const persona = NEWCOMER_PREFIX + address.replace(/[^a-z0-9@._-]/g, '-');
  if (!DEV_SUBJECT.test(persona)) {
    throw new Error(`newcomer: subject ${persona} длиннее 64 символов — короче адрес`);
  }
  return { persona, email: address, displayName: name };
}

/** subject нового человека: `new-…` в форме subject dev-провайдера. */
export function isNewcomerSubject(value: string): boolean {
  return (
    value.length > NEWCOMER_PREFIX.length &&
    value.startsWith(NEWCOMER_PREFIX) &&
    DEV_SUBJECT.test(value)
  );
}

/** URL файла эталона: каждый сегмент пути кодируется (кириллица, пробелы). */
export function referenceUrl(base: string, file: string, hash = ''): string {
  const path = file
    .split('/')
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join('/');
  return `${base.replace(/\/+$/, '')}/${path}${hash}`;
}
