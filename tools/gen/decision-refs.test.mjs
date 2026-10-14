// W0.07 · Ссылки на решения в файлах стюарда контракта однозначны (docs/plan/decisions.md, шапка):
// решения плана — `PD-NN`, а голый `D-NN` — номер комплекта (16-raid-glossary, кандидаты плана 27).
// Номера пересекаются (D-30 комплекта — «Осмотр», PD-30 плана — «UUID Go-сида»), поэтому голый
// `D-NN` допустим только как явная ссылка на комплект: в строке есть слово «комплект» или вид
// `(docs/NN, D-NN)`, скопированный из 11-permissions.yaml. Скрипт перенумерации W0.00
// (`docs/plan/scripts/renumber-decisions.mjs --check`) смотрит только docs/plan — этот тест
// покрывает api/** и tools/gen/**.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { abs, ROOT } from './lib/paths.mjs';

const TEXT = /\.(ya?ml|md|json|mjs|js)$/;
const BARE = /(^|[^\p{L}\p{N}_-])D-(\d{2})\b/gu;
const KIT_LINE = /комплект/i;
const KIT_DOC_REF = /docs\/\d+, D-\d{2}\b/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (TEXT.test(name)) out.push(p);
  }
  return out;
}

/** Голые `D-NN` вне явных ссылок на комплект: ["путь:строка: D-NN"]. */
function bareRefs(path, lines = readFileSync(path, 'utf8').split('\n')) {
  const found = [];
  lines.forEach((line, i) => {
    if (KIT_LINE.test(line)) return;
    const rest = line.replace(new RegExp(KIT_DOC_REF, 'g'), '');
    for (const m of rest.matchAll(BARE)) {
      found.push(`${relative(ROOT, path).replaceAll('\\', '/')}:${i + 1}: D-${m[2]}`);
    }
  });
  return found;
}

describe('ссылки на решения плана — PD-NN', () => {
  it('api/** и tools/gen/** не содержат голых D-NN (кроме ссылок на комплект)', () => {
    const files = [...walk(abs('api')), ...walk(abs('tools/gen'))];
    assert.deepEqual(
      files.flatMap((f) => bareRefs(f)),
      [],
    );
  });

  it('бриф и отчёт W0.07 не содержат голых D-NN (кроме ссылок на комплект)', () => {
    const files = ['docs/plan/v2/ws/W0.07.md', 'docs/plan/v2/reports/W0.07.md'].map(abs);
    assert.deepEqual(
      files.flatMap((f) => bareRefs(f)),
      [],
    );
  });

  it('строки Q-W0.07-* в docs/plan/decisions.md ссылаются на решения плана как PD-NN', () => {
    const path = abs('docs/plan/decisions.md');
    const lines = readFileSync(path, 'utf8')
      .split('\n')
      .map((l) => (l.startsWith('| Q-W0.07-') ? l : ''));
    assert.ok(lines.some(Boolean), 'нет строк Q-W0.07-* в decisions.md');
    assert.deepEqual(bareRefs(path, lines), []);
  });
});
