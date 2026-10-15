#!/usr/bin/env node
// W1.45 · Problem matcher-ы, которые действуют в job CI, и симулятор раннера GitHub Actions.
//
// Зачем: matcher `go` из actions/setup-go принимает любую строку вида `<что-то>.go: <текст>` за ошибку
// (номер строки в шаблоне необязателен). Имена подтестов `operations.gen.go: …` в TAP давали шесть
// аннотаций X на зелёной job unit (критика этапа 1, П-9). Matcher нужен для настоящих падений
// `go test`, поэтому его не выключаем: имена тестов не должны с ним совпадать (охрана —
// problem-matchers.test.mjs).
//
// Локально: `corepack pnpm run test 2>&1 | node tools/ci/problem-matchers.mjs` (или путь к логу) —
// печатает строки, которые раннер пометил бы ##[error]/##[warning]; код 1, если такие есть.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Откуда скопированы шаблоны: action и SHA должны совпадать с `uses:` в .github/workflows/ci.yml. */
export const SOURCES = Object.freeze([
  {
    action: 'actions/setup-go',
    sha: 'b7ad1dad31e06c5925ef5d2fc7ad053ef454303e', // v7.0.0
    file: 'matchers.json',
  },
  {
    action: 'actions/setup-node',
    sha: '820762786026740c76f36085b0efc47a31fe5020', // v7.0.0
    file: '.github/tsc.json, .github/eslint-stylish.json, .github/eslint-compact.json',
  },
]);

/** Дословные копии problemMatcher из файлов SOURCES. */
export const MATCHERS = Object.freeze([
  {
    owner: 'go',
    pattern: [
      {
        regexp: '^\\s*(.+\\.go):(?:(\\d+):(\\d+):)? (.*)',
        file: 1,
        line: 2,
        column: 3,
        message: 4,
      },
    ],
  },
  {
    owner: 'tsc',
    pattern: [
      {
        regexp:
          '^([^\\s].*)[\\(:](\\d+)[,:](\\d+)(?:\\):\\s+|\\s+-\\s+)(error|warning|info)\\s+TS(\\d+)\\s*:\\s*(.*)$',
        file: 1,
        line: 2,
        column: 3,
        severity: 4,
        code: 5,
        message: 6,
      },
    ],
  },
  {
    owner: 'eslint-stylish',
    pattern: [
      { regexp: '^\\s*([^\\s].*)$', file: 1 },
      {
        regexp: '^\\s+(\\d+):(\\d+)\\s+(error|warning|info)\\s+(.*)\\s\\s+(.*)$',
        line: 1,
        column: 2,
        severity: 3,
        message: 4,
        code: 5,
        loop: true,
      },
    ],
  },
  {
    owner: 'eslint-compact',
    pattern: [
      {
        regexp:
          '^(.+):\\sline\\s(\\d+),\\scol\\s(\\d+),\\s([Ee]rror|[Ww]arning|[Ii]nfo)\\s-\\s(.+)\\s\\((.+)\\)$',
        file: 1,
        line: 2,
        column: 3,
        severity: 4,
        message: 5,
        code: 6,
      },
    ],
  },
]);

const FIELDS = ['file', 'line', 'column', 'severity', 'code', 'message'];
// eslint-disable-next-line no-control-regex -- раннер снимает цветовые escape-последовательности
const ANSI_RE = /\u001b\[[0-9;]*m/g;

/**
 * Сопоставитель одного matcher-а — как IssueMatcher раннера (actions/runner): однострочный шаблон
 * совпадает сразу; многострочный идёт с конца, последний шаблон с `loop` сохраняет начатое совпадение.
 */
function compile(matcher) {
  const patterns = matcher.pattern.map((p) => ({ ...p, re: new RegExp(p.regexp) }));
  const take = (p, m, into = {}) => {
    for (const f of FIELDS) if (p[f] && m[p[f]] !== undefined) into[f] = m[p[f]];
    return into;
  };
  let state = new Array(patterns.length).fill(null);
  return (line) => {
    if (patterns.length === 1) {
      const m = patterns[0].re.exec(line);
      return m ? take(patterns[0], m) : null;
    }
    for (let i = patterns.length - 1; i >= 0; i--) {
      const running = i > 0 ? state[i - 1] : null;
      if (i > 0 && !running) continue;
      const p = patterns[i];
      const last = i === patterns.length - 1;
      const m = p.re.exec(line);
      if (m) {
        if (last) {
          state = new Array(patterns.length).fill(null);
          if (p.loop) state[i - 1] = running;
          return take(p, m, { ...running });
        }
        state[i] = take(p, m, { ...running });
      } else if (!last) {
        state[i] = null;
      }
    }
    return null;
  };
}

/**
 * Прогоняет строки лога через matcher-ы так, как это делает раннер: первый совпавший matcher
 * забирает строку. Возвращает аннотации; logLine — номер строки (с 1).
 */
export function annotate(lines, matchers = MATCHERS) {
  const compiled = matchers.map((m) => ({ owner: m.owner, match: compile(m) }));
  const out = [];
  lines.forEach((raw, idx) => {
    const line = String(raw).replace(ANSI_RE, '');
    for (const { owner, match } of compiled) {
      const hit = match(line);
      if (hit) {
        out.push({
          owner,
          severity: (hit.severity ?? 'error').toLowerCase(),
          ...hit,
          logLine: idx + 1,
        });
        break;
      }
    }
  });
  return out;
}

export function format(a) {
  const where = [a.file, a.line, a.column].filter((x) => x !== undefined && x !== '').join(':');
  return `${a.logLine}: [${a.owner}] ${a.severity} ${where} — ${a.message ?? ''}`;
}

function main(argv) {
  const src = argv[0] && argv[0] !== '-' ? argv[0] : 0; // 0 — stdin
  const lines = readFileSync(src, 'utf8').split(/\r?\n/);
  const found = annotate(lines);
  for (const a of found) process.stdout.write(`${format(a)}\n`);
  process.stdout.write(`аннотаций: ${found.length}\n`);
  return found.length > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
