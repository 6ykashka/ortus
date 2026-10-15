// api/openapi/screens.yaml — «ключ экрана → операции» (план v2 §3.4, бриф §4.7).
// С W1.00 (DoR этапа 1) у экранов этапа 1 есть stories (истории бэклога) и reference (эталон снимка
// design-stage-1 или no-reference), а истории без экрана перечислены в storiesWithoutScreen с причиной.
import { operationsById } from './inventory.mjs';

const STORY = /^S\d-\d\d$/;
const REFERENCE = /^(design-stage-\d+ · |no-reference)/;

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
    if (s?.stage === 1) {
      if (!Array.isArray(s.stories) || !s.stories.length) errors.push(`${key}: нет stories`);
      for (const st of s.stories ?? []) {
        if (!STORY.test(st)) errors.push(`${key}: история ${st} не в формате S<этап>-<nn>`);
      }
      if (!REFERENCE.test(s.reference ?? '')) {
        errors.push(`${key}: reference — «design-stage-N · …» или «no-reference …»`);
      }
    }
  }
  for (const [st, reason] of Object.entries(screens?.storiesWithoutScreen ?? {})) {
    if (!STORY.test(st)) errors.push(`storiesWithoutScreen: ${st} не в формате S<этап>-<nn>`);
    if (String(reason ?? '').length < 20) errors.push(`storiesWithoutScreen: ${st} без причины`);
  }
  return errors;
}
