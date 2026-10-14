// Каталог прав api/permissions.yaml (W0.07, бриф §4.4): плоский индекс и инварианты.
import { listOperations } from './inventory.mjs';
import { PERMISSIONS_PATH } from './paths.mjs';
import { readYaml } from './yaml-io.mjs';

/** Виды областей, допустимые в `scopes` каталога (11 + склад из SQL tenant 0001). */
export const SCOPE_KINDS = [
  'tenant',
  'unit',
  'project',
  'self',
  'resource',
  'warehouse',
  'chat',
  'relation',
];

export function loadCatalog(path = PERMISSIONS_PATH) {
  return readYaml(path);
}

/** @returns {Map<string, object>} ключ → действие с полем module */
export function flattenActions(catalog) {
  const out = new Map();
  for (const [module, m] of Object.entries(catalog.modules ?? {})) {
    for (const [key, a] of Object.entries(m.actions ?? {})) {
      if (out.has(key))
        throw new Error(`ключ ${key} в двух модулях: ${out.get(key).module}, ${module}`);
      out.set(key, { module, ...a });
    }
  }
  return out;
}

/**
 * Инварианты каталога. `doc` — бандл OpenAPI, `prototypeKeys` — ключи прав прототипа (фикстура).
 * @returns {string[]} ошибки
 */
export function checkCatalog(catalog, doc, prototypeKeys = []) {
  const errors = [];
  let actions;
  try {
    actions = flattenActions(catalog);
  } catch (e) {
    return [e.message];
  }
  const levels = new Set(catalog.levels ?? []);
  for (const [key, a] of actions) {
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(key)) errors.push(`${key}: имя ключа`);
    if (!a.label) errors.push(`${key}: нет label`);
    if (a.module === 'platform') {
      if (a.scopes || a.level) errors.push(`${key}: у platform.* нет scopes и level`);
      continue;
    }
    if (!levels.has(a.level)) errors.push(`${key}: level ${a.level} вне levels`);
    for (const s of a.scopes ?? []) {
      if (!SCOPE_KINDS.includes(s))
        errors.push(`${key}: область ${s} вне ${SCOPE_KINDS.join(', ')}`);
    }
    if (!a.scopes?.length) errors.push(`${key}: нет scopes`);
  }
  for (const o of listOperations(doc)) {
    for (const k of o.op['x-permissions'] ?? []) {
      if (!actions.has(k)) errors.push(`${o.operationId}: x-permissions ${k} нет в каталоге`);
    }
    // Второе машиночитаемое расширение авторизации: право на изменение отдельного поля тела.
    for (const [field, k] of Object.entries(o.op['x-field-permissions'] ?? {})) {
      if (!actions.has(k)) {
        errors.push(`${o.operationId}: x-field-permissions.${field} ${k} нет в каталоге`);
      }
    }
  }
  for (const [name, t] of Object.entries(catalog.role_templates ?? {})) {
    for (const k of [...(t.actions ?? []), ...(t.optional_restricted ?? [])]) {
      if (!actions.has(k)) errors.push(`role_templates.${name}: ${k} нет в каталоге`);
    }
  }
  const renames = catalog.prototype_renames ?? {};
  for (const [k, v] of Object.entries(renames)) {
    if (actions.has(k)) errors.push(`prototype_renames.${k}: ключ есть в каталоге`);
    if (v === null) continue;
    for (const t of [v].flat()) {
      if (!actions.has(t)) errors.push(`prototype_renames.${k} → ${t}: нет в каталоге`);
    }
  }
  const pending = catalog.prototype_pending ?? {};
  for (const [k, v] of Object.entries(pending)) {
    if (actions.has(k)) errors.push(`prototype_pending.${k}: ключ уже в каталоге`);
    if (!/^W\d\.\d\d /.test(String(v)))
      errors.push(`prototype_pending.${k}: «${v}» — нужен ID шага`);
  }
  for (const k of prototypeKeys) {
    if (!actions.has(k) && !(k in renames) && !(k in pending)) {
      errors.push(
        `ключ прототипа ${k}: нет ни в каталоге, ни в prototype_renames, ни в prototype_pending`,
      );
    }
  }
  return errors;
}
