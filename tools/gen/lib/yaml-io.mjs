// Чтение и запись YAML/JSON конвейера контракта: вывод всегда через Prettier с конфигом
// репозитория, чтобы `prettier --check .` и проверка дрейфа видели одни и те же байты.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as prettier from 'prettier';
import YAML from 'yaml';

export function readYaml(path) {
  return YAML.parse(readFileSync(path, 'utf8'), { maxAliasCount: -1 });
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * YAML без якорей и переносов длинных строк; ключи — в порядке объекта. Строки, которые парсер
 * YAML 1.1 прочёл бы иначе (`12:30`, `yes`, `on`), берутся в кавычки — для потребителей на Go.
 */
export function toYaml(value) {
  return YAML.stringify(value, { lineWidth: 0, aliasDuplicateObjects: false, version: '1.1' });
}

/** Форматирует текст Prettier'ом по расширению `filepath` (конфиг — .prettierrc.json корня). */
export async function format(text, filepath) {
  const config = (await prettier.resolveConfig(filepath)) ?? {};
  return prettier.format(text, { ...config, filepath });
}

export async function renderYaml(value, filepath, header = '') {
  const head = header
    ? header
        .split('\n')
        .map((l) => `# ${l}`.trimEnd())
        .join('\n') + '\n'
    : '';
  return format(head + toYaml(value), filepath);
}

export async function renderJson(value, filepath) {
  return format(JSON.stringify(value, null, 2), filepath);
}

export function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}
