// JSON Pointer (RFC 6901) и ссылки `$ref` вида `<файл>#<указатель>`.

export const escapeToken = (t) => String(t).replaceAll('~', '~0').replaceAll('/', '~1');
export const unescapeToken = (t) => t.replaceAll('~1', '/').replaceAll('~0', '~');

export const pointer = (tokens) => tokens.map((t) => '/' + escapeToken(t)).join('');

/** Фрагмент URI для указателя: `{` и `}` кодируются (шаблоны путей OpenAPI). */
export const fragment = (tokens) =>
  '#' + pointer(tokens).replaceAll('{', '%7B').replaceAll('}', '%7D');

export function parsePointer(ptr) {
  if (ptr === '' || ptr === '/') return ptr === '' ? [] : [''];
  if (!ptr.startsWith('/')) throw new Error(`указатель должен начинаться с «/»: ${ptr}`);
  return ptr.slice(1).split('/').map(unescapeToken);
}

/** `<файл>#<указатель>` → { file, tokens } (файл может быть пустым — тот же документ). */
export function parseRef(ref) {
  const i = ref.indexOf('#');
  const file = i < 0 ? ref : ref.slice(0, i);
  const frag = i < 0 ? '' : decodeURIComponent(ref.slice(i + 1));
  return { file, tokens: parsePointer(frag) };
}

export function resolveTokens(doc, tokens, label = '') {
  let cur = doc;
  for (const t of tokens) {
    if (cur === null || typeof cur !== 'object' || !(t in cur)) {
      throw new Error(`не найдено ${pointer(tokens)} в ${label}`);
    }
    cur = cur[t];
  }
  return cur;
}

/** Объект Discriminator OpenAPI: `propertyName` и `mapping` (значение → ссылка на схему). */
const isDiscriminator = (k, v) =>
  k === 'discriminator' &&
  v !== null &&
  typeof v === 'object' &&
  typeof v.propertyName === 'string' &&
  v.mapping !== null &&
  typeof v.mapping === 'object';

/**
 * Глубокий обход с заменой ссылок: `$ref` и значения `discriminator.mapping` (это тоже ссылки
 * на схемы). `fn(ref)` возвращает новое значение ссылки.
 */
export function mapRefs(node, fn) {
  if (Array.isArray(node)) return node.map((x) => mapRefs(x, fn));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') out[k] = fn(v);
      else if (isDiscriminator(k, v)) {
        out[k] = {
          ...v,
          mapping: Object.fromEntries(Object.entries(v.mapping).map(([m, ref]) => [m, fn(ref)])),
        };
      } else out[k] = mapRefs(v, fn);
    }
    return out;
  }
  return node;
}

/** Все значения `$ref` в узле. */
export function collectRefs(node, out = []) {
  if (Array.isArray(node)) node.forEach((x) => collectRefs(x, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') out.push(v);
      else collectRefs(v, out);
    }
  }
  return out;
}
