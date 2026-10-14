// Генератор design/docs/design-system/tokens.json (+ prototype.json) → src/tokens.css и src/tokens.ts.
// Правила имён — как в tokens.css 0.2; вывод совпадает с форматом Prettier, чтобы `prettier --check` и
// drift-тест не спорили. Без зависимостей (Node 22).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

export const DESIGN_TOKENS_JSON = here('../../../../design/docs/design-system/tokens.json');
export const DESIGN_TOKENS_CSS = here('../../../../design/docs/design-system/tokens.css');
export const PROTOTYPE_JSON = here('../prototype.json');
export const OUT_CSS = here('../src/tokens.css');
export const OUT_TS = here('../src/tokens.ts');

const PROTOTYPE_EXT = 'ortus.prototype';

/** Листья дерева W3C Design Tokens (узлы с `$value`) в порядке объявления. */
export function collect(tree, path = []) {
  const leaves = [];
  for (const [key, node] of Object.entries(tree)) {
    if (key.startsWith('$') || node === null || typeof node !== 'object') continue;
    const at = [...path, key];
    if ('$value' in node) {
      const leaf = { path: at, value: node.$value };
      if (node.$description !== undefined) leaf.description = node.$description;
      const proto = node.$extensions?.[PROTOTYPE_EXT];
      if (proto !== undefined) leaf.prototype = proto;
      leaves.push(leaf);
    } else {
      leaves.push(...collect(node, at));
    }
  }
  return leaves;
}

/** Имя CSS-переменной по пути токена (правила tokens.css 0.2). */
export function cssVarName(path) {
  const [group, a, b, c] = path;
  const fail = () => {
    throw new Error(`нет правила имени для токена ${path.join('.')}`);
  };
  switch (group) {
    case 'color':
      if (a === 'tone' && b && c) return `--ox-${b}-${c}`;
      return a && !b ? `--ox-${a}` : fail();
    case 'font': {
      const prefix = { family: 'font', size: 'fs', 'line-height': 'lh', weight: 'fw' }[a];
      return prefix && b ? `--ox-${prefix}-${b}` : fail();
    }
    case 'space':
    case 'radius':
    case 'shadow':
    case 'motion':
      return a ? `--ox-${group}-${a}` : fail();
    case 'size':
      return a ? `--ox-${a}` : fail();
    case 'breakpoint':
      return a ? `--ox-bp-${a}` : fail();
    case 'icon':
      return a === 'set' ? '--ox-icon-set' : fail();
    default:
      return fail();
  }
}

const quoteFamily = (name) => (/\s/.test(name) ? `'${name}'` : name);

/** Значение CSS в нормализованном виде Prettier (hex в нижнем регистре, `rgba(a, b, c, 0.x)`). */
export function cssValue(value) {
  if (Array.isArray(value)) return value.map(quoteFamily).join(', ');
  if (typeof value === 'number') return String(value);
  const text = String(value);
  if (/^[A-Za-z]+(\s[A-Za-z]+)+$/.test(text)) return `'${text}'`;
  return text
    .replace(/#[0-9A-Fa-f]{3,8}\b/g, (hex) => hex.toLowerCase())
    .replace(/(rgba?|hsla?)\(([^)]*)\)/g, (_, fn, args) => {
      const parts = args.split(',').map((p) => p.trim().replace(/^\./, '0.'));
      return `${fn}(${parts.join(', ')})`;
    });
}

const section = (path) => (path[0] === 'color' && path[1] === 'tone' ? 'tone' : path[0]);

function declarations(leaves, withRef) {
  const lines = [];
  let prev;
  for (const leaf of leaves) {
    const sec = section(leaf.path);
    if (prev !== undefined && sec !== prev) lines.push('');
    prev = sec;
    const ref =
      withRef && leaf.prototype ? ` /* ${leaf.prototype.ref} · ${leaf.prototype.decision} */` : '';
    lines.push(`  ${cssVarName(leaf.path)}: ${cssValue(leaf.value)};${ref}`);
  }
  return lines;
}

export function generateCss(base, prototype) {
  const baseLeaves = collect(base);
  const protoLeaves = collect(prototype);
  const motion = baseLeaves.filter((l) => l.path[0] === 'motion');
  const out = [
    '/* Ортус · дизайн-токены v0.2 — CSS custom properties.',
    '   Сгенерировано scripts/build.mjs из design/docs/design-system/tokens.json и prototype.json;',
    '   не править руками: corepack pnpm --filter @ortus/tokens gen */',
    ':root {',
    ...declarations(baseLeaves, false),
    '}',
    '',
  ];
  if (protoLeaves.length > 0) {
    out.push(
      '/* Алиасы рендера прототипа (PD-28): значений нет в tokens.json 0.2 */',
      ':root {',
      ...declarations(protoLeaves, true),
      '}',
      '',
    );
  }
  out.push(
    '@media (prefers-reduced-motion: reduce) {',
    '  :root {',
    ...motion.map((l) => `    ${cssVarName(l.path)}: 0ms;`),
    '  }',
    '}',
    '',
    ':focus-visible {',
    '  outline: 2px solid var(--ox-focus);',
    '  outline-offset: 2px;',
    '}',
    '',
  );
  return out.join('\n');
}

const camel = (key) => key.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
const tsKey = (key) => (/^[A-Za-z_$][\w$]*$/.test(key) || /^\d+$/.test(key) ? key : `'${key}'`);
const tsString = (s) =>
  s.includes("'") && !s.includes('"') ? JSON.stringify(s) : `'${s.replace(/'/g, "\\'")}'`;

/** Числа из `12px` / `120ms`; составные значения остаются строками. */
function tsScalar(value, numeric) {
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return tsString(cssValue(value));
  const m = numeric ? /^(-?\d+(?:\.\d+)?)(px|ms)$/.exec(value) : null;
  return m ? m[1] : tsString(String(value));
}

function tsObject(name, entries, suffix = ' as const') {
  return [
    `export const ${name} = {`,
    ...entries.map(([k, v]) => `  ${tsKey(k)}: ${v},`),
    `}${suffix};`,
    '',
  ];
}

export function generateTs(base, prototype) {
  const leaves = [...collect(base), ...collect(prototype)];
  const pick = (pred, numeric, keyOf = (l) => l.path.at(-1)) =>
    leaves.filter(pred).map((l) => [keyOf(l), tsScalar(l.value, numeric)]);
  const isGroup =
    (...prefix) =>
    (l) =>
      prefix.every((p, i) => l.path[i] === p);

  const tones = {};
  for (const l of leaves.filter(isGroup('color', 'tone'))) {
    const [, , toneName, part] = l.path;
    (tones[toneName] ??= []).push(`${part}: ${tsScalar(l.value, false)}`);
  }
  const iconSet = leaves.find(isGroup('icon', 'set'));
  const protoRefs = leaves
    .filter((l) => l.prototype)
    .map((l) => [cssVarName(l.path), tsString(l.prototype.ref)]);

  return [
    '// Сгенерировано scripts/build.mjs из design/docs/design-system/tokens.json и prototype.json.',
    '// Не править руками: corepack pnpm --filter @ortus/tokens gen',
    '',
    "export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';",
    '',
    ...tsObject(
      'color',
      pick(
        (l) => l.path[0] === 'color' && l.path[1] !== 'tone',
        false,
        (l) => camel(l.path[1]),
      ),
    ),
    ...tsObject(
      'tone',
      Object.entries(tones).map(([k, parts]) => [k, `{ ${parts.join(', ')} }`]),
      ' as const satisfies Record<Tone, { bg: string; fg: string; border: string }>',
    ),
    ...tsObject('fontFamily', pick(isGroup('font', 'family'), false)),
    ...tsObject('fontSize', pick(isGroup('font', 'size'), true)),
    ...tsObject('fontWeight', pick(isGroup('font', 'weight'), true)),
    ...tsObject('lineHeight', pick(isGroup('font', 'line-height'), true)),
    ...tsObject('space', pick(isGroup('space'), true)),
    ...tsObject('radius', pick(isGroup('radius'), true)),
    ...tsObject('shadow', pick(isGroup('shadow'), false)),
    ...tsObject(
      'sizes',
      pick(isGroup('size'), true, (l) => camel(l.path[1])),
    ),
    ...tsObject('breakpoints', pick(isGroup('breakpoint'), true)),
    ...tsObject('motion', pick(isGroup('motion'), true)),
    `export const iconSet = ${tsString(String(iconSet?.value ?? ''))};`,
    '',
    '/** Переменные-алиасы рендера прототипа (PD-28) → строка эталона. */',
    ...tsObject('prototype', protoRefs),
    "/** `cssVar('accent')` → `var(--ox-accent)`. */",
    'export const cssVar = (name: string): string => `var(--ox-${name})`;',
    '',
  ].join('\n');
}

export function generate(base, prototype) {
  return { css: generateCss(base, prototype), ts: generateTs(base, prototype) };
}

export function readTokens() {
  return {
    base: JSON.parse(readFileSync(DESIGN_TOKENS_JSON, 'utf8')),
    prototype: JSON.parse(readFileSync(PROTOTYPE_JSON, 'utf8')),
  };
}
