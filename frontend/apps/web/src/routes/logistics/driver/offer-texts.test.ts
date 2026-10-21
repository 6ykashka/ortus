// W2.74 · Дословность подписей S2-20 водителя (1c–1e) по макету `design/Временный водитель - варианты.dc.html`
// (снимок 19.10b, тег design-2026-10-19b): статическая подпись есть в макете целиком, у шаблона — каждая постоянная
// часть между {…}; шаблоны с данными макета дают те же строки, что его конкатенации (renderVals :516–628). Тексты без
// эталона (названия фирм водителю не видны, чек-лист этапа 2, связь) — отдельным списком, в макете их нет.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { format } from '@ortus/texts';
import { describe, expect, it } from 'vitest';

import { OFFER, OFFER_NO_REFERENCE } from './offer-texts.ts';

const DESIGN = readFileSync(
  join(import.meta.dirname, '../../../../../../../design/Временный водитель - варианты.dc.html'),
  'utf8',
);
/** Текст макета без разметки (ссылка «чат рейса Р-211» — внутри фразы) и с одиночными пробелами. */
const PLAIN = DESIGN.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');

const parts = (s: string): string[] =>
  s
    .split(/\{[^}]+\}/)
    .map((p) => p)
    .filter((p) => p.trim().length > 0);

const leaves = (o: object, prefix = ''): [string, string][] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'string'
      ? [[`${prefix}${k}`, v] as [string, string]]
      : leaves(v, `${prefix}${k}.`),
  );

describe('подписи 1c–1e дословно из макета', () => {
  for (const [path, value] of leaves(OFFER)) {
    it(`${path} «${value}»`, () => {
      for (const p of parts(value)) expect(PLAIN.includes(p), `нет в макете: «${p}»`).toBe(true);
    });
  }
});

describe('шаблоны с данными макета — строки макета', () => {
  const cases: [string, string, Record<string, string>, string][] = [
    [
      'chooseUntil',
      OFFER.chooseUntil,
      { time: '13:30' },
      'До 13:30. Вторую бронь снимем сразу после выбора.',
    ],
    [
      'otherCar',
      OFFER.otherCar,
      { trip: 'Р-211' },
      'Нужна другая машина — напишите логисту в чат рейса Р-211.',
    ],
    ['sheetTitle', OFFER.sheetTitle, { model: 'Hyundai HD-35' }, 'Берёте Hyundai HD-35?'],
    [
      'sheetSub',
      OFFER.sheetSub,
      { plate: 'Н 384 ТК 77', mine: OFFER.mine.usual },
      'Н 384 ТК 77 · ваша обычная',
    ],
    [
      'release',
      OFFER.release,
      {
        model: 'Ford Transit',
        plate: 'М 608 КТ 77',
        to: format(OFFER.releaseTo, { firm: 'Север Логистик' }),
      },
      'Бронь Ford Transit М 608 КТ 77 снимется, машина вернётся в Север Логистик.',
    ],
    [
      'whoBoth',
      OFFER.whoBoth,
      { trip: 'Север Логистик', car: 'Юг Транс' },
      'Осмотр и дефекты увидят Север Логистик (рейс) и Юг Транс (машина).',
    ],
    ['whoTrip', OFFER.whoTrip, { trip: 'Север Логистик' }, 'Осмотр увидит Север Логистик.'],
    [
      'held',
      OFFER.held,
      { model: 'Hyundai HD-35', time: '18:00' },
      'Бронь подтверждена сервером · Hyundai HD-35 до 18:00',
    ],
    [
      'released',
      OFFER.released,
      { model: 'Ford Transit', plate: 'М 608 КТ 77', time: '13:12' },
      'Ford Transit М 608 КТ 77 освобождена в 13:12',
    ],
    [
      'inspectionSub',
      OFFER.inspectionSub,
      { model: 'Hyundai HD-35', plate: 'Н 384 ТК 77', mine: OFFER.mine.usual },
      'Hyundai HD-35 · Н 384 ТК 77 · ваша обычная',
    ],
    [
      'inspectWhoBoth',
      OFFER.inspectWhoBoth,
      { trip: 'Север Логистик', car: 'Юг Транс' },
      'Осмотр увидят Север Логистик (рейс) и Юг Транс (машина).',
    ],
    [
      'oneUsual',
      OFFER.oneUsual + OFFER.oneNoConfirm,
      { firm: 'Юг Транс' },
      'Юг Транс выдал вашу машину на этот рейс. Подтверждать бронь не нужно: первый снимок осмотра закрепит её за вами.',
    ],
    [
      'noneText',
      OFFER.noneText,
      { home: 'Юг Транс', trip: 'Север Логистик' },
      'Юг Транс выдал вас на рейс без обычной машины. Логист Север Логистик поставит машину, придёт уведомление.',
    ],
  ];
  for (const [name, tpl, values, expected] of cases) {
    it(`${name} → ${expected}`, () => expect(format(tpl, values)).toBe(expected));
  }
  it('конкатенации макета: «Берёте » + модель + «?», «Бронь подтверждена сервером · » + модель + « до 18:00»', () => {
    expect(DESIGN).toContain("title: 'Берёте ' + pc.model + '?'");
    expect(DESIGN).toContain("banner: 'Бронь подтверждена сервером · ' + pc.model + ' до 18:00'");
    expect(DESIGN).toContain("relText: oc.model + ' ' + oc.plate + ' освобождена в 13:12'");
  });
});

describe('тексты без эталона (no-reference)', () => {
  it('ни одной строки нет в макете целиком: замены фирм, чек-листа и связи', () => {
    const values = {
      model: 'Ford Transit',
      plate: 'М 608 КТ 77',
      time: '13:12',
      n: '5',
      trip: 'Р-211',
    };
    // «в свою фирму.» — окончание фразы листа 1d (в «Правилах» макета есть «возвращается в свою фирму.»): сверяется
    // фраза целиком.
    const sentences = leaves(OFFER_NO_REFERENCE).map(([path, value]): [string, string] =>
      path === 'releaseToOwn'
        ? [path, format(OFFER.release, { ...values, to: value })]
        : [path, format(value, values)],
    );
    for (const [path, sample] of sentences) {
      expect(PLAIN.includes(sample), `${path} есть в макете — перенести в OFFER`).toBe(false);
    }
  });
  it('пункт листа об осмотре — состав чек-листа этапа 2 (Q-W2.70-3), а не «6 фото … температура»', () => {
    expect(format(OFFER_NO_REFERENCE.next, { n: '5' })).toBe(
      'Дальше осмотр: 5 фото, пробег, топливо и чек-лист.',
    );
  });
});
