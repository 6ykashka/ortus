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

/** URL файла эталона: каждый сегмент пути кодируется (кириллица, пробелы). */
export function referenceUrl(base: string, file: string, hash = ''): string {
  const path = file
    .split('/')
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join('/');
  return `${base.replace(/\/+$/, '')}/${path}${hash}`;
}
