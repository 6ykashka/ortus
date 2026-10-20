// W4.41 · Подписи «Календаря» без эталона (no-reference, allowlist/core-calendar.md): неделя и навигация по датам
// (Q-W4.06-4 — эталон рисует только день), города поясов кроме Москвы (CAL-05). Подписи эталона — домен
// `@ortus/texts` `calendar`; ошибка загрузки и «Повторить» — общий `LoadFailed` страниц ядра (W1.24).

export const CAL_TEXT = {
  periodAria: 'Период',
  day: 'День',
  week: 'Неделя',
  today: 'Сегодня',
  prev: { day: 'Предыдущий день', week: 'Предыдущая неделя' },
  next: { day: 'Следующий день', week: 'Следующая неделя' },
  /** «28 сентября — 4 октября 2026». */
  weekTitle: '{from} — {to}',
  /** Столбец дня недели: «Пн, 28.09». */
  dayHead: '{wd}, {date}',
  /** aria-label блока брони в неделе: «Классический массаж · Мария К., чт 01.10, 10:00–11:00». */
  weekBlockAria: '{title}, {day}, {from}–{to}',
  /** Города поясов ресурсов (IANA) в строке даты; Москва — подпись эталона `calendar.city.moscow`. */
  cities: {
    'Europe/Kaliningrad': 'Калининград',
    'Europe/Samara': 'Самара',
    'Europe/Volgograd': 'Волгоград',
    'Europe/Saratov': 'Саратов',
    'Europe/Ulyanovsk': 'Ульяновск',
    'Europe/Astrakhan': 'Астрахань',
    'Europe/Kirov': 'Киров',
    'Asia/Yekaterinburg': 'Екатеринбург',
    'Asia/Omsk': 'Омск',
    'Asia/Novosibirsk': 'Новосибирск',
    'Asia/Barnaul': 'Барнаул',
    'Asia/Tomsk': 'Томск',
    'Asia/Novokuznetsk': 'Новокузнецк',
    'Asia/Krasnoyarsk': 'Красноярск',
    'Asia/Irkutsk': 'Иркутск',
    'Asia/Chita': 'Чита',
    'Asia/Yakutsk': 'Якутск',
    'Asia/Vladivostok': 'Владивосток',
    'Asia/Sakhalin': 'Южно-Сахалинск',
    'Asia/Magadan': 'Магадан',
    'Asia/Kamchatka': 'Петропавловск-Камчатский',
    'Asia/Anadyr': 'Анадырь',
  } as Readonly<Record<string, string>>,
} as const;
