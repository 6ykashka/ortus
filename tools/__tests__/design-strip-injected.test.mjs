// tools/design-strip-injected.js: удаление служебных блоков слоя выдачи Claude Design (W2.70).
// Снимок 19.10b: после старой очистки у 23 файлов `GetFile` оставался лишний перевод строки после <head>.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { load, runNode, tempDir } from './_util.mjs';

// Импорт не должен запускать CLI. До W2.70 скрипт сразу обходил process.argv[2] и выходил с кодом 2
// без аргумента, поэтому на время импорта подставляется пустой каталог: красный тест падает на
// утверждении, а не на импорте (tdd-protocol.md §1).
const savedArgv = process.argv.slice();
process.argv[2] = tempDir('ortus-strip-import-');
const mod = await load('tools/design-strip-injected.js');
process.argv.splice(0, process.argv.length, ...savedArgv);

const STYLE = '<style data-omelette-injected>html,body{background:transparent}</style>';
const SCRIPT =
  '<script data-omelette-injected>(()=>{{const n=new URL(location.href);}})()</script>';
const HEAD = '<!DOCTYPE html>\n<html>\n<head>\n';
const REST = '<meta charset="utf-8">\n<title>x</title>\n</head>\n<body></body>\n</html>\n';
const CANON = HEAD + REST;

describe('stripInjected', () => {
  it('экспортирует чистую функцию stripInjected', () => {
    assert.equal(mod.__loadError, undefined, String(mod.__loadError));
    assert.equal(typeof mod.stripInjected, 'function');
  });

  it('формат GetFile 19.10b: блок после <head> и пустая строка — канонический исходник', () => {
    const raw = HEAD + STYLE + SCRIPT + '\n\n' + REST;
    assert.equal(mod.stripInjected?.(raw), CANON);
  });

  it('формат 03.10: блок и один перевод строки — канонический исходник', () => {
    const raw = HEAD + STYLE + SCRIPT + '\n' + REST;
    assert.equal(mod.stripInjected?.(raw), CANON);
  });

  it('HTML без служебных блоков не меняется (байт в байт)', () => {
    const blank = HEAD + '\n' + REST;
    assert.equal(mod.stripInjected?.(CANON), CANON);
    assert.equal(mod.stripInjected?.(blank), blank);
  });

  // Возврат 1 W2.70: `\s*` после блока съедал отступ следующей строки.
  it('следующая строка с отступом: отступ сохраняется (форматы GetFile 19.10b и 03.10)', () => {
    const indented = HEAD + '  ' + REST.replace('\n<title>', '\n  <title>');
    assert.equal(
      mod.stripInjected?.(
        HEAD + STYLE + SCRIPT + '\n\n' + '  ' + REST.replace('\n<title>', '\n  <title>'),
      ),
      indented,
    );
    assert.equal(
      mod.stripInjected?.(
        HEAD + STYLE + SCRIPT + '\n' + '  ' + REST.replace('\n<title>', '\n  <title>'),
      ),
      indented,
    );
    assert.equal(mod.stripInjected?.(HEAD + '\t' + REST), HEAD + '\t' + REST);
    assert.equal(mod.stripInjected?.(HEAD + STYLE + SCRIPT + '\n\t' + REST), HEAD + '\t' + REST);
  });

  it('блоки с отступом и пробелами в конце строки снимаются целиком, отступ следующей строки остаётся', () => {
    const raw = HEAD + '  ' + STYLE + '  \n  ' + SCRIPT + ' \n\n    ' + REST;
    assert.equal(mod.stripInjected?.(raw), HEAD + '    ' + REST);
  });

  it('блок не сразу после <head> удаляется, соседние строки остаются', () => {
    const raw = HEAD + '<meta charset="utf-8">\n' + STYLE + SCRIPT + '\n<title>x</title>\n';
    assert.equal(mod.stripInjected?.(raw), HEAD + '<meta charset="utf-8">\n<title>x</title>\n');
  });
});

describe('CLI node tools/design-strip-injected.js <dir>', () => {
  it('переписывает только .html, размер совпадает с каноническим', () => {
    const dir = tempDir('ortus-strip-');
    mkdirSync(join(dir, 'sub'));
    const html = join(dir, 'sub', 'Файл.dc.html');
    const js = join(dir, 'support.js');
    writeFileSync(html, HEAD + STYLE + SCRIPT + '\n\n' + REST);
    writeFileSync(js, STYLE);
    const r = runNode('tools/design-strip-injected.js', [dir]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(html, 'utf8'), CANON);
    assert.equal(readFileSync(js, 'utf8'), STYLE);
    assert.match(r.stdout, new RegExp(`-> ${Buffer.byteLength(CANON)} bytes`));
  });

  it('без каталога — код 2 и подсказка', () => {
    const r = runNode('tools/design-strip-injected.js', []);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /usage/);
  });
});
