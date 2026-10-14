// api/openapi/screens.yaml — «ключ экрана → операции» (план v2 §3.4, бриф §4.7).
import { operationsById } from './inventory.mjs';

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
  }
  return errors;
}
