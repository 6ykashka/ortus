#!/usr/bin/env node
// W0.04 · Детерминизм ICU (старый WS-01 §4.7): числа, сортировка и даты ru-RU в Europe/Moscow
// должны совпадать на dev-машине и в CI, иначе e2e и снимки текстов расходятся.
//
// CLI: node tools/ci/check-icu.mjs  →  «icu <ver> tz <ver> ok», exit 0, либо провалы, exit 1.
// CHECK_ICU_FAKE=1 подставляет сломанный Intl (проверка самого CLI).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_COLLATOR = {
  localeCompare: (a, b, locale, opts) => a.localeCompare(b, locale, opts),
};

/** Демо-«сейчас» прототипа: 1 октября 2026, 10:30 МСК — четверг (старый WS-01 ошибочно писал «среда»). */
const DEMO_NOW = new Date('2026-10-01T10:30:00+03:00');

/** Проверки по порядку; failures — тексты провалов. collator подменяется в тестах. */
export function checkIcu({ Intl: intl, versions, collator = DEFAULT_COLLATOR }) {
  const failures = [];
  if (!versions?.icu) failures.push('process.versions.icu пуст (small-icu?)');

  if (new intl.NumberFormat('ru-RU').format(84370) !== '84\u00A0370') {
    failures.push('NumberFormat ru-RU: ожидался U+00A0');
  }

  const cmp = (a, b, opts) => collator.localeCompare(a, b, 'ru', opts);
  if (!(cmp('ё', 'е') > 0 && cmp('е', 'ё') < 0)) failures.push('ё/е: ожидался порядок е < ё');

  const sorted = ['10', '9', '1'].sort((a, b) => cmp(a, b, { numeric: true }));
  if (sorted.join(',') !== '1,9,10') failures.push('numeric: ожидалось 1, 9, 10');

  const day = new intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Moscow',
  }).format(DEMO_NOW);
  if (!day.includes('четверг') || !day.includes('1 октября')) {
    failures.push(`DateTimeFormat ru-RU: ожидалось «четверг, 1 октября», получено «${day}»`);
  }

  const time = new intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(DEMO_NOW);
  if (time !== '10:30')
    failures.push(`DateTimeFormat Europe/Moscow: ожидалось 10:30, получено «${time}»`);

  return { ok: failures.length === 0, failures };
}

function fakeEnv() {
  const fake = Object.create(Intl);
  fake.NumberFormat = function (locale, opts) {
    const real = new Intl.NumberFormat(locale, opts);
    return { format: (n) => real.format(n).replace(/\u00A0/g, ' ') };
  };
  return { Intl: fake, versions: { ...process.versions, icu: undefined } };
}

export function main(env = process.env) {
  const input = env.CHECK_ICU_FAKE === '1' ? fakeEnv() : { Intl, versions: process.versions };
  const r = checkIcu(input);
  if (!r.ok) {
    for (const f of r.failures) console.error(`check-icu: ${f}`);
    return 1;
  }
  console.log(`icu ${process.versions.icu} tz ${process.versions.tz} ok`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
