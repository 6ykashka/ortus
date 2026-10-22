// W2.25 · Источник «Требует решения» модуля «Логистика» (homeVM :4053–4058; 05 §5.5 строки 1–3): блокирующий
// дефект на проверке → «Решить», сданная смена → «Проверить» (оба — «Приёмка смен» ?trip=, ADR-0001), рейс без
// водителя → «Найти в пуле» / «Открыть пул» при запросе в пул. Права и область проверяет сервер (W2.09, MSW W2.00).
// W2.73 (S2-20, 1g): водитель ещё не выбрал машину → «Оставить …»; нет машины → «Поставить машину».
import { hhmm } from '../time.ts';
import type { DecisionItemLike, HomeMsg, HomeSource, HomeTarget } from '../types.ts';

const p = (item: DecisionItemLike, name: string): string => item.params[name] ?? '';

/** «Ford Transit» из «Ford Transit · М 608 КТ 77» (params hostVehicle / homeVehicle — модель · номер). */
const model = (label: string): string => label.split(' · ')[0] ?? label;

const time = (iso: string, timeZone: string): string => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : hhmm(new Date(t), timeZone);
};

const CYRILLIC_WORD = /^[А-ЯЁ][а-яё-]+$/;
/** Мужские имена на «-а», «-я» (склоняются как женские, но род мужской). */
const MALE_A = new Set(['Илья', 'Никита', 'Кузьма', 'Фома', 'Лука', 'Савва', 'Данила', 'Гаврила']);
/** Женские имена на «-ь» (не склоняются). */
const FEMALE_SOFT = new Set(['Любовь', 'Нинель', 'Адель', 'Ассоль']);
/** Мужские имена с беглой гласной: винительный падеж — словарём («Павел» → «Павла», «Лев» → «Льва»). */
const FLEETING: ReadonlyMap<string, string> = new Map([
  ['Павел', 'Павла'],
  ['Пётр', 'Петра'],
  ['Петр', 'Петра'],
  ['Лев', 'Льва'],
]);
/** Несклоняемые фамилии: на «-ых», «-их» («Черных», «Долгих»), «-аго», «-яго», «-ово» и на гласную, кроме «-а», «-я». */
const INDECLINABLE = /(ых|их|аго|яго|ово)$/;

/**
 * Женский род по имени (первое слово на «-а», «-я», кроме мужских имён, или женское имя на «-ь») или по фамилии на
 * «-ова», «-ева», «-ина», «-ая»; иначе — мужской.
 */
function female(words: readonly string[]): boolean {
  const first = words[0] ?? '';
  if (FEMALE_SOFT.has(first)) return true;
  if (CYRILLIC_WORD.test(first) && /[ая]$/.test(first)) return !MALE_A.has(first);
  return words.some((w) => CYRILLIC_WORD.test(w) && /(ов|ев|ёв|ин|ын)а$|ая$/.test(w));
}

/**
 * Слово в винительном падеже (одушевлённое): «Олег» → «Олега», «Котова» → «Котову», «Невский» → «Невского». Женского
 * рода склоняются только слова на «-а», «-я» («Анна Шевчук» → «Анну Шевчук», «Любовь» — как есть).
 */
function accWord(w: string, fem: boolean): string {
  if (!CYRILLIC_WORD.test(w)) return w;
  if (INDECLINABLE.test(w)) return w;
  if (!fem && FLEETING.has(w)) return FLEETING.get(w) ?? w;
  if (/ая$/.test(w)) return w.replace(/ая$/, 'ую');
  if (/а$/.test(w)) return w.replace(/а$/, 'у');
  if (/я$/.test(w) && !/ий$/.test(w)) return w.replace(/я$/, 'ю');
  if (fem) return w;
  if (/(ск|цк)ий$/.test(w)) return w.replace(/ий$/, 'ого');
  if (/ий$/.test(w)) return w.replace(/ий$/, 'ия');
  if (/[йь]$/.test(w)) return w.replace(/[йь]$/, 'я');
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(w)) return `${w}а`;
  return w;
}

/**
 * W2.73 · Имя водителя в винительном падеже для «{фирма} выдал {кого} без обычной машины» (1g :488: «Олега
 * Тарасова»). Эвристика по окончаниям русских имён и фамилий с родом по имени; беглая гласная частых имён — словарём,
 * фамилии на «-ых», «-их» не склоняются; слова не с кириллицы — как есть (Q-W2.73-4).
 */
export const accusative = (name: string): string => {
  const words = name.split(' ');
  const fem = female(words);
  return words.map((w) => accWord(w, fem)).join(' ');
};

const review = (item: DecisionItemLike): HomeTarget => ({
  page: 'review',
  search: { trip: item.object?.entityId ?? '' },
});

export const source: HomeSource = {
  id: 'fleet',
  moduleKey: 'fleet',
  stage: 2,
  kinds: {
    'fleet.blocking_defect': (item) => ({
      icon: 'report',
      tag: { key: 'queue.chips.blocksDeparture' },
      title: { key: 'queue.criticalDefect', args: { trip: p(item, 'tripNumber') } },
      text: {
        key: 'queue.defectText',
        args: {
          zone: p(item, 'zone'),
          description: p(item, 'description'),
          driver: p(item, 'driverName'),
        },
      },
      action: { label: { key: 'queue.actions.resolve' }, target: review(item) },
    }),
    'fleet.trip_review': (item) => ({
      icon: 'fact_check',
      tag: { key: 'queue.chips.review' },
      title: { key: 'queue.shiftWaits', args: { trip: p(item, 'tripNumber') } },
      text: { key: 'queue.shiftWaitsText', args: { driver: p(item, 'driverName') } },
      action: { label: { key: 'queue.actions.check' }, target: review(item) },
    }),
    'fleet.trip_without_driver': (item, ctx) => {
      const pooled = p(item, 'poolRequest') === 'pending';
      const starts = Date.parse(p(item, 'startsAt'));
      const time = Number.isNaN(starts) ? '' : hhmm(new Date(starts), ctx.timeZone);
      const tag: HomeMsg = pooled
        ? { key: 'queue.chips.otherFirm' }
        : { key: 'queue.chips.today', args: { time } };
      const text: HomeMsg = pooled
        ? { key: 'queue.poolRequested', args: { firm: p(item, 'poolHome') } }
        : {
            key: 'queue.tripNoDriverText',
            args: { title: p(item, 'title'), cargo: p(item, 'cargo') },
          };
      return {
        icon: 'person_search',
        tag,
        title: { key: 'queue.tripNoDriver', args: { trip: p(item, 'tripNumber') } },
        text,
        action: {
          label: { key: pooled ? 'queue.actions.openPool' : 'queue.actions.findInPool' },
          target: { page: 'pool' },
        },
      };
    },
    // W2.73 · S2-20 1g («Временный водитель - варианты.dc.html» :476–491): карточка «Главной» — переход (команды у
    // карточки нет, Q-W2.73-2): «Оставить …» — «Ресурсный пул» ?trip= (там «Оставить …» в карточке перевода),
    // «Поставить машину» — «Рабочее место логиста» ?trip=.
    'fleet.vehicle_choice_pending': (item, ctx) => {
      const host = model(p(item, 'hostVehicle'));
      return {
        icon: 'schedule',
        tag: {
          key: 'queue.chips.until',
          args: { time: time(p(item, 'chooseUntil'), ctx.timeZone) },
        },
        title: { key: 'queue.vehicleChoice', args: { trip: p(item, 'tripNumber') } },
        text: {
          key: 'queue.vehicleChoiceText',
          args: {
            driver: p(item, 'driverName'),
            firm: p(item, 'homeOrgUnitName'),
            host,
            home: model(p(item, 'homeVehicle')),
          },
        },
        action: {
          label: { key: 'queue.actions.keepVehicle', args: { vehicle: host } },
          target: { page: 'pool', search: { trip: item.object?.entityId ?? '' } },
        },
      };
    },
    'fleet.trip_without_vehicle': (item, ctx) => ({
      icon: 'no_crash',
      tag: { key: 'queue.chips.tripAt', args: { time: time(p(item, 'startsAt'), ctx.timeZone) } },
      title: { key: 'queue.noVehicle', args: { trip: p(item, 'tripNumber') } },
      text: {
        key: 'queue.noVehicleText',
        args: { firm: p(item, 'homeOrgUnitName'), driver: accusative(p(item, 'driverName')) },
      },
      action: {
        label: { key: 'queue.actions.assignVehicle' },
        target: { page: 'fleet', search: { trip: item.object?.entityId ?? '' } },
      },
    }),
  },
};
