// Сравнение бандла с исходником OpenAPI 0.1 (W0.07, бриф §4.1): любое отличие должно быть
// объявлено в api/openapi/source-delta.yaml указателем, и каждая объявленная дельта используется.
import { existsSync } from 'node:fs';
import { DELTA_PATH } from './paths.mjs';
import { escapeToken } from './refs.mjs';
import { readYaml } from './yaml-io.mjs';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Отличия `b` от `a` указателями JSON Pointer. Порядок ключей объекта не важен;
 * массивы сравниваются целиком (указатель — на массив).
 * @returns {{pointer: string, kind: 'add'|'remove'|'change'}[]}
 */
export function diffDocs(a, b, ptr = '', out = []) {
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const p = `${ptr}/${escapeToken(k)}`;
      if (!(k in a)) out.push({ pointer: p, kind: 'add' });
      else if (!(k in b)) out.push({ pointer: p, kind: 'remove' });
      else diffDocs(a[k], b[k], p, out);
    }
  } else if (JSON.stringify(a) !== JSON.stringify(b)) {
    out.push({ pointer: ptr, kind: 'change' });
  }
  return out;
}

export function loadDeltas(path = DELTA_PATH) {
  if (!existsSync(path)) return [];
  return readYaml(path)?.deltas ?? [];
}

const covers = (delta, pointer) =>
  pointer === delta.pointer || pointer.startsWith(delta.pointer + '/');

/**
 * @returns {{errors: string[], diffs: object[]}}
 */
export function checkAgainstSource(bundleDoc, source, deltas) {
  const errors = [];
  for (const d of deltas) {
    for (const f of ['pointer', 'kind', 'source', 'reason']) {
      if (!d[f]) errors.push(`source-delta: у дельты ${d.pointer ?? '?'} нет поля ${f}`);
    }
  }
  const diffs = diffDocs(source, bundleDoc);
  for (const d of diffs) {
    if (!deltas.some((x) => covers(x, d.pointer))) {
      errors.push(`${d.pointer}: отличие от 0.1 (${d.kind}) не объявлено в source-delta.yaml`);
    }
  }
  for (const x of deltas) {
    if (!diffs.some((d) => covers(x, d.pointer))) {
      errors.push(`${x.pointer}: дельта не используется (бандл здесь совпадает с 0.1)`);
    }
  }
  return { errors, diffs };
}
