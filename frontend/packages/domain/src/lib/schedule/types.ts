// Типы библиотеки графика (design/Ремонт и стройка.dc.html:956–997, W6.10). Библиотека чистая:
// календарь, этапы, связи и план передаются явно; ни БД, ни часов, ни ApiError здесь нет.

/** Этап графика (`GST` эталона). */
export interface ScheduleStage {
  id: string;
  name: string;
  /** Длительность по базовому плану, рабочих дней. У вехи всегда 1. */
  dur: number;
  /** Веха: этап без длительности (сдача объекта). */
  ms?: boolean;
  /** Номер раздела (фазы) графика: индекс в `phases`. */
  ph?: number;
  /** Исполнитель по умолчанию. */
  who?: string;
  /** Фактическое начало (день), если этап уже идёт: его не сдвинуть. */
  as?: number;
  /** Принятая доля объёма 0…1. */
  acc?: number;
  /** Доля объёма на приёмке 0…1. */
  pen?: number;
  /** Текст прогресса («20 из 38 точек принято…»). */
  prog?: string;
  /** Строка сметы, из которой собран этап. */
  est?: string;
  /** Как посчитана длительность. */
  calc?: string;
  /** Заявка снабжения, без которой этап не начать. */
  sup?: string;
}

/** Связь «окончание → начало» с паузой (`lag > 0`) или опережением (`lag < 0`), рабочих дней. */
export interface ScheduleLink {
  from: string;
  to: string;
  lag: number;
  note?: string;
}

export interface ScheduleModel {
  stages: readonly ScheduleStage[];
  links: readonly ScheduleLink[];
}

/** Правки к базовому плану: сдвиг начала, длительность, пауза по связи (`o` эталона). */
export interface Plan {
  off: Record<string, number>;
  dur: Record<string, number>;
  lag: Record<string, number>;
}

/** Расчёт этапа: `es` — раннее начало, `lf`/`ls` — позднее окончание/начало, `fl` — запас. */
export interface StageTiming {
  es: number;
  /** Этап-предшественник, определяющий начало (`bind`). */
  bind: string | null;
  dur: number;
  start: number;
  end: number;
  lf: number;
  ls: number;
  fl: number;
}

export type Timings = Record<string, StageTiming>;

export type IssueTone = 'warn' | 'danger';

/** Заявка снабжения, привязанная к этапу. */
export interface SupplyRef {
  id: string;
  st: 'request' | 'reserved' | 'ordered' | 'bought' | 'issued' | 'used';
  item: string;
  qty: string | number;
  /** Номер закупки для `ordered`. */
  pur?: string;
}

export interface StageIssue {
  id: string;
  icon: string;
  tone: IssueTone;
  short: string;
  text: string;
  start: number;
}

/** Запись «Истории изменений» графика. */
export interface ScheduleLogEntry {
  at: string;
  who: string;
  text: string;
  reason: string;
}
