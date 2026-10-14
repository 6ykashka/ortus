// Часы домена (B §1 п. 9, факт 8). Единственное место, где читается системное время:
// модули получают Clock через ModuleCtx и форматируют время только здесь — всегда в Москве.

export interface Clock {
  now(): Date;
}

export interface ManualClock extends Clock {
  set(iso: string): void;
  advance(ms: number): void;
}

/** Часовой пояс всех дат домена — не зависит от TZ машины. */
export const TZ = 'Europe/Moscow';

/**
 * Пять демо-«сейчас» эталона 14.10: ядро (`api.js`), касса (`CASH_DAY`), база знаний и документы
 * (`KB_TODAY`/`DOC_TODAY`), чаты (`db.chats.now`, минуты от 01.10 00:00), обращения (`SVC_BASE`).
 */
export const DEMO = {
  now: '2026-10-01T10:30:00+03:00',
  cashDay: '01.10',
  kbToday: '01.10.2026',
  docToday: '01.10.2026',
  chatNow: 665,
  svcBase: '2026-10-01T16:24:00+03:00',
} as const;

const DAY_MS = 86_400_000;

function parse(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error('Некорректное время: «' + iso + '»');
  return t;
}

export function fixedClock(iso: string): Clock {
  const t = parse(iso);
  return { now: () => new Date(t) };
}

export function manualClock(iso: string): ManualClock {
  let t = parse(iso);
  return {
    now: () => new Date(t),
    set: (next) => {
      t = parse(next);
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

export const systemClock: Clock = { now: () => new Date() };

/** База плюс реальный дрейф от момента создания (так считает `svcNow()` обращений). */
export function driftClock(baseIso: string, real: Clock = systemClock): Clock {
  const base = parse(baseIso);
  const start = real.now().getTime();
  return { now: () => new Date(base + (real.now().getTime() - start)) };
}

export const demoClock: Clock = fixedClock(DEMO.now);

const PARTS = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

interface MskParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

function msk(d: Date): MskParts {
  const out: MskParts = { year: '', month: '', day: '', hour: '', minute: '' };
  for (const p of PARTS.formatToParts(d)) {
    if (p.type in out) out[p.type as keyof MskParts] = p.value;
  }
  return out;
}

export const hhmm = (c: Clock): string => {
  const p = msk(c.now());
  return p.hour + ':' + p.minute;
};

export const ddmm = (c: Clock): string => {
  const p = msk(c.now());
  return p.day + '.' + p.month;
};

export const ddmmyyyy = (c: Clock): string => {
  const p = msk(c.now());
  return p.day + '.' + p.month + '.' + p.year;
};

export const ddmmHHMM = (c: Clock): string => ddmm(c) + ' ' + hhmm(c);

export const plusDaysDdMm = (c: Clock, n: number): string =>
  ddmm(fixedClock(new Date(c.now().getTime() + n * DAY_MS).toISOString()));

/** Минуты от 00:00 по Москве дня `day` (`'2026-10-01'`). */
export const minutesSince = (c: Clock, day: string): number =>
  Math.floor((c.now().getTime() - parse(day + 'T00:00:00+03:00')) / 60_000);

/** «Сейчас» чатов: минуты от 01.10.2026 00:00 (в эталоне `db.chats.now = 665`). */
export const chatMinutes = (c: Clock): number => minutesSince(c, '2026-10-01');
