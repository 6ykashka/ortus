// Бандлер контракта (W0.07, PD-56): api/openapi/ortus.yaml + paths/<tag>.yaml +
// components/<группа>/<вид>.yaml → один документ OpenAPI 3.1 с внутренними ссылками.
//
// Правила раскладки (бриф §4.1):
// - корень: пути — `$ref: paths/<tag>.yaml#/<путь>`, компонентов в корне нет;
// - компоненты: components/<группа>/<вид>.yaml, вид ∈ KINDS, ключ верхнего уровня — имя;
// - ссылка `<относительный файл компонентов>#/<Имя>[/…]` → `#/components/<вид>/<Имя>[/…]`;
// - имя уникально внутри вида во всех группах.
import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { BUNDLE_PATH, ROOT_SPEC } from './paths.mjs';
import { fragment, mapRefs, parseRef, resolveTokens } from './refs.mjs';
import { readYaml, renderYaml } from './yaml-io.mjs';

/** Виды компонентов в порядке исходника 0.1. */
export const KINDS = ['securitySchemes', 'parameters', 'headers', 'responses', 'schemas'];

export const BUNDLE_HEADER = [
  'Сгенерировано: node tools/gen/contract.mjs из api/openapi/ (W0.07). Руками не править.',
  'Исходник: api/openapi/ortus.yaml, paths/<tag>.yaml, components/<группа>/<вид>.yaml.',
].join('\n');

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Собирает бандл.
 * @param {string} rootPath корень раскладки (ortus.yaml)
 * @returns {object} документ OpenAPI с внутренними ссылками
 */
export function bundle(rootPath = ROOT_SPEC) {
  const rootDir = dirname(rootPath);
  const compDir = join(rootDir, 'components');
  const cache = new Map();
  const load = (file) => {
    if (!cache.has(file)) cache.set(file, readYaml(file));
    return cache.get(file);
  };

  /** Ссылка из файла `from` → внутренняя ссылка бандла. */
  const internal = (from) => (ref) => {
    const { file, tokens } = parseRef(ref);
    const target = file ? resolve(dirname(from), file) : from;
    const rel = relative(compDir, target);
    const parts = rel.split(sep);
    const kind = basename(target, '.yaml');
    if (parts.length !== 2 || rel.startsWith('..') || !KINDS.includes(kind)) {
      throw new Error(
        `${relative(rootDir, from)}: ссылка ${ref} не указывает на components/<группа>/<вид>.yaml`,
      );
    }
    if (tokens.length === 0)
      throw new Error(`${relative(rootDir, from)}: ссылка ${ref} без имени компонента`);
    resolveTokens(load(target), tokens, relative(rootDir, target));
    return fragment(['components', kind, ...tokens]);
  };

  const components = Object.fromEntries(KINDS.map((k) => [k, {}]));
  const origin = new Map();
  const groups = existsSync(compDir) ? readdirSync(compDir).sort(byName) : [];
  for (const group of groups) {
    for (const kind of KINDS) {
      const file = join(compDir, group, `${kind}.yaml`);
      if (!existsSync(file)) continue;
      for (const [name, value] of Object.entries(load(file) ?? {})) {
        const key = `${kind}/${name}`;
        if (origin.has(key)) {
          throw new Error(`дубликат компонента ${key}: группы ${origin.get(key)} и ${group}`);
        }
        origin.set(key, group);
        components[kind][name] = mapRefs(value, internal(file));
      }
    }
  }

  const root = load(rootPath);
  const paths = {};
  for (const [p, item] of Object.entries(root.paths ?? {})) {
    const { file, tokens } = parseRef(item.$ref);
    const target = resolve(rootDir, file);
    paths[p] = mapRefs(resolveTokens(load(target), tokens, file), internal(target));
  }

  const sortedComponents = {};
  for (const kind of KINDS) {
    const names = Object.keys(components[kind]).sort(byName);
    if (names.length) {
      sortedComponents[kind] = Object.fromEntries(names.map((n) => [n, components[kind][n]]));
    }
  }

  const out = {};
  for (const [k, v] of Object.entries(root)) {
    if (k === 'components') throw new Error('корень раскладки не должен содержать components');
    out[k] = k === 'paths' ? paths : v;
    if (k === 'paths') out.components = sortedComponents;
  }
  return out;
}

/** Текст бандла: заголовок + YAML через Prettier, LF. */
export async function serializeBundle(doc) {
  return renderYaml(doc, BUNDLE_PATH, BUNDLE_HEADER);
}
