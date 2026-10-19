// api/openapi/screens.yaml — «ключ экрана → операции» (план v2 §3.4, бриф §4.7).
// С W1.00 (DoR этапа 1) у экранов этапа 1 есть stories (истории бэклога) и reference (эталон снимка
// design-stage-1 или no-reference), а истории без экрана перечислены в storiesWithoutScreen с причиной.
// С W2.00 то же правило действует для экранов этапа 2 (снимок design-stage-2).
import { operationsById } from './inventory.mjs';

const STORY = /^S\d-\d\d$/;
const REFERENCE = /^(design-stage-\d+ · |no-reference)/;
/** С W4.02 (этап 4): эталон — снимок с датой (тег design-2026-10-19) или этапа; историй бэклога у этапа 4 нет. */
const SNAPSHOT_REFERENCE = /^(design-(stage-\d+|\d{4}-\d{2}-\d{2}) · |no-reference)/;

/** @returns {string[]} ошибки «<экран>: …» */
export function checkScreens(doc, screens) {
  const errors = [];
  const ops = operationsById(doc);
  for (const [key, s] of Object.entries(screens?.screens ?? {})) {
    if (!/^[a-z]+(-[a-z]+)*$/.test(key)) errors.push(`${key}: ключ не kebab-case`);
    if (!s?.title) errors.push(`${key}: нет title`);
    if (!Number.isInteger(s?.stage)) errors.push(`${key}: нет stage`);
    if (!/^W\d\.\d\d$/.test(s?.ws ?? '')) errors.push(`${key}: ws не ID WS`);
    for (const op of s?.operations ?? []) {
      if (!ops.has(op)) errors.push(`${key}: операции ${op} нет в бандле`);
    }
    // DoR этапа 1 (W1.00) и этапа 2 (W2.00): истории и эталон обязательны.
    if (s?.stage === 1 || s?.stage === 2) {
      if (!Array.isArray(s.stories) || !s.stories.length) errors.push(`${key}: нет stories`);
      for (const st of s.stories ?? []) {
        if (!STORY.test(st)) errors.push(`${key}: история ${st} не в формате S<этап>-<nn>`);
      }
      if (!REFERENCE.test(s.reference ?? '')) {
        errors.push(`${key}: reference — «design-stage-N · …» или «no-reference …»`);
      }
    }
    // Этапы 4+ (W4.02): эталон обязателен — снимок W4.00 «design-<дата> · <файл> · <фрагмент>».
    if (Number.isInteger(s?.stage) && s.stage >= 4 && !SNAPSHOT_REFERENCE.test(s.reference ?? '')) {
      errors.push(`${key}: reference — «design-<снимок> · …» или «no-reference …»`);
    }
  }
  for (const [st, reason] of Object.entries(screens?.storiesWithoutScreen ?? {})) {
    if (!STORY.test(st)) errors.push(`storiesWithoutScreen: ${st} не в формате S<этап>-<nn>`);
    if (String(reason ?? '').length < 20) errors.push(`storiesWithoutScreen: ${st} без причины`);
  }
  return errors;
}
