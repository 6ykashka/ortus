// Подписи сроков и времени «Обращений» (service.js 19.10:45–64, Обращения.dc.html:493 — подстановка
// в шаблон). Время — по Москве (или поясу календаря), а не по часовому поясу браузера.
import { plural } from '../../core/format.ts';
import { DAY_MS, MINUTE_MS, MSK_OFFSET_MIN, dayStartMs, type WorkCalendar } from './calendar.ts';

const MSK = MSK_OFFSET_MIN * MINUTE_MS;

const MON = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

const p2 = (n: number): string => String(n).padStart(2, '0');

/** `16:24`, `9:05`: час без ведущего нуля. */
export function hm(ms: number, off: number = MSK): string {
  const d = new Date(ms + off);
  return d.getUTCHours() + ':' + p2(d.getUTCMinutes());
}

/** `1 октября`. */
export function dayLabel(ms: number, off: number = MSK): string {
  const d = new Date(ms + off);
  return d.getUTCDate() + ' ' + (MON[d.getUTCMonth()] as string);
}

/** «сегодня, 9:05», «вчера, 15:40», «26 сентября, 14:20». */
export function when(ms: number, now: number, off: number = MSK): string {
  const a = dayStartMs(ms, off);
  const b = dayStartMs(now, off);
  if (a === b) return 'сегодня, ' + hm(ms, off);
  if (a + DAY_MS === b) return 'вчера, ' + hm(ms, off);
  return dayLabel(ms, off) + ', ' + hm(ms, off);
}

/** Крайний срок: сегодня — время; ближе трёх суток — день и время; дальше — день. */
export function dueText(ms: number, now: number, off: number = MSK): string {
  if (dayStartMs(ms, off) === dayStartMs(now, off)) return hm(ms, off);
  return dayLabel(ms, off) + (ms - now < 3 * DAY_MS ? ', ' + hm(ms, off) : '');
}

const days = (d: number): string => d + ' ' + plural(d, 'день', 'дня', 'дней');

/** Длительность в рабочем времени: «48 мин», «3 ч 40 мин», «9 раб. дней». */
export function dur(mins: number, cal?: Pick<WorkCalendar, 'from' | 'to' | 'days'>): string {
  const m = Math.max(0, Math.round(mins));
  const perDay = cal ? cal.to - cal.from : 1440;
  if (m < 60) return m + ' мин';
  if (m < perDay) {
    const mm = m % 60;
    return Math.floor(m / 60) + ' ч' + (mm ? ' ' + mm + ' мин' : '');
  }
  const d = Math.floor(m / perDay);
  const label = plural(d, 'день', 'дня', 'дней');
  return d + ' ' + (cal && cal.days.length < 7 ? 'раб. ' : '') + label;
}

/** Календарная длительность (просрочка): «5 мин», «2 ч 5 мин», «2 дня». */
export function span(mins: number): string {
  const m = Math.round(mins);
  if (m < 60) return m + ' мин';
  if (m < 1440) {
    const mm = m % 60;
    return Math.floor(m / 60) + ' ч' + (mm ? ' ' + mm + ' мин' : '');
  }
  return days(Math.floor(m / 1440));
}

export interface TemplateVars {
  /** Имя и фамилия клиента: подставляется первое слово. */
  name: string;
  key: string;
  /** Подпись срока (`slaHead.until`), например «до 11:00» или «был до 10:00». */
  until: string;
}

/** Шаблон ответа: `{имя}`, `{номер}`, `{срок}` — первое вхождение каждого, как `String.replace` эталона. */
export function fillTemplate(text: string, v: TemplateVars): string {
  const first = (v.name || '').split(' ')[0] as string;
  const until = v.until ? v.until.replace(/^был /, '') : 'в течение рабочего дня';
  return text
    .replace('{имя}', () => first)
    .replace('{номер}', () => v.key)
    .replace('{срок}', () => until);
}
