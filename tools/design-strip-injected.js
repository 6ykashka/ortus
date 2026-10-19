// Удаляет блоки <style data-omelette-injected>…</style> и <script data-omelette-injected>…</script>,
// которые слой выдачи Claude Design вставляет в HTML, и возвращает канонический исходник.
//   node tools/design-strip-injected.js <dir>
// Блок, вставленный сразу после <head>, снимается вместе с окружающими переводами строки, а между
// <head> и следующей строкой остаётся ровно один перевод строки. `GetFile` 19.10 отдаёт
// `<head>\n<style …>…<script …>…</script>\n\n<meta …>`, экспорт 03.10 — то же с одним `\n` после блока;
// канон в обоих случаях — `<head>\n<meta …>` (размер совпадает с ListFiles, W2.70).
// Снимаются только сами блоки, пробелы перед ними и концы их строк (`[ \t]*\n`): отступ следующей строки
// сохраняется (возврат 1 W2.70). Ограничение: пустую строку сразу после <head> в каноне восстановить
// нельзя — формат 03.10 с ней неотличим от формата GetFile без неё; сверяйте размер с ListFiles.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const BLOCK =
  '(?:<style data-omelette-injected>[\\s\\S]*?<\\/style>|<script data-omelette-injected>[\\s\\S]*?<\\/script>)';
const AFTER_HEAD = new RegExp(`(<head>)\\n*(?:[ \\t]*${BLOCK}(?:[ \\t]*\\n)*)+`, 'g');
const STYLE = /<style data-omelette-injected>[\s\S]*?<\/style>/g;
const SCRIPT = /<script data-omelette-injected>[\s\S]*?<\/script>\n?/g;

/** Канонический исходник HTML без служебных блоков; HTML без блоков возвращается как есть. */
export function stripInjected(src) {
  return src.replace(AFTER_HEAD, '$1\n').replace(STYLE, '').replace(SCRIPT, '');
}

const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
  );

/** Очищает все `.html` каталога; возвращает строки отчёта. */
export function stripDir(root) {
  const lines = [];
  for (const f of walk(root).filter((p) => p.endsWith('.html'))) {
    const src = readFileSync(f, 'utf8');
    const out = stripInjected(src);
    if (out !== src) {
      writeFileSync(f, out);
      lines.push(
        `stripped ${relative(root, f)}: ${Buffer.byteLength(src)} -> ${Buffer.byteLength(out)} bytes`,
      );
    }
  }
  return lines;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2];
  if (!root) {
    console.error('usage: node tools/design-strip-injected.js <dir>');
    process.exit(2);
  }
  for (const line of stripDir(root)) console.log(line);
}
