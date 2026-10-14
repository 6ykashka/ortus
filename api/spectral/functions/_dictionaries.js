// Общий загрузчик словарей правил Spectral Ортуса. Словари вшиты в модуль _dictionaries.gen.js
// (генерирует node tools/gen/contract.mjs из api/permissions.yaml и api/errors.yaml; свежесть
// проверяет contract.mjs --check), поэтому правила не читают файлы и не зависят от каталога
// запуска Spectral (CI, плагины IDE).
import data from './_dictionaries.gen.js';

/** @returns {{permissions: string[], problemCodes: string[]}} */
export function dictionaries() {
  return data;
}
