// W0.01 · проверки решений этапа 0: ADR D-01…D-12 и ADR-0001, журнал docs/plan/decisions.md
// (PD-53…PD-60, индекс D-01…D-12, кандидаты D-29…D-34), список вопросов владельцу продукта.
//
// Запуск из корня репозитория: node --test "docs/adr/*.test.mjs"
// Зависимостей нет (node:test, node:fs). Источники истины читаются из файлов репозитория:
// design/docs/16-raid-glossary.md (D-01…D-12), docs/plan/v2/00-parallel-plan.md §7 (PD-53…PD-60),
// docs/plan/v2/analysis/D-plan-reconciliation.md §5.3 (Q на пересмотр).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ADR_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(ADR_DIR, '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const readOr = (rel) => (existsSync(join(ROOT, rel)) ? read(rel) : '');

const DECISIONS = 'docs/plan/decisions.md';
const QUESTIONS = 'docs/plan/v2/questions-for-po.md';
const OFF = '<!-- renumber:off -->';
const ON = '<!-- renumber:on -->';

// --- помощники разбора markdown ---------------------------------------------------------------

/** Текст от заголовка, который начинается с `prefix`, до следующего заголовка того же или выше уровня. */
function section(text, prefix) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith(prefix));
  if (start === -1) return '';
  const level = prefix.match(/^#+/)[0].length;
  const stop = lines.findIndex(
    (l, i) => i > start && /^#+ /.test(l) && l.match(/^#+/)[0].length <= level,
  );
  return lines.slice(start, stop === -1 ? undefined : stop).join('\n');
}

const cells = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/** Все таблицы фрагмента: [{ header: string[], rows: string[][] }]. */
function tables(text) {
  const out = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) {
      cur = null;
      continue;
    }
    if (!cur) {
      cur = { header: cells(line), rows: [] };
      out.push(cur);
    } else if (!/^\|[\s:|-]+\|$/.test(line.trim())) {
      cur.rows.push(cells(line));
    }
  }
  return out;
}

const rowsOf = (text) => tables(text).flatMap((t) => t.rows.map((r) => ({ header: t.header, r })));

/** Q-60…Q-63, Q-67 → ['Q-60','Q-61','Q-62','Q-63','Q-67']. */
function expandQ(cell) {
  const ids = [];
  for (const m of cell.matchAll(/Q-(\d+)(?:…Q-(\d+))?/g)) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let n = a; n <= b; n++) ids.push(`Q-${String(n).padStart(2, '0')}`);
  }
  return ids;
}

// --- источники истины ---------------------------------------------------------------------------

const KIT = new Map(
  read('design/docs/16-raid-glossary.md')
    .split('\n')
    .filter((l) => /^\| D-(0[1-9]|1[0-2]) \|/.test(l))
    .map((l) => {
      const [id, question, proposal, who, blocks] = cells(l);
      return [id, { question, proposal, who, blocks }];
    }),
);

const PLAN_PD = section(read('docs/plan/v2/00-parallel-plan.md'), '## 7. ')
  .split('\n')
  .filter((l) => /^\| PD-\d+ \|/.test(l))
  .map((l) => cells(l));

const Q_REVISE = (() => {
  const s53 = section(read('docs/plan/v2/analysis/D-plan-reconciliation.md'), '### 5.3');
  const head = s53.split('**Остаются в силе**')[0];
  return [...new Set(tables(head).flatMap((t) => t.rows.flatMap((r) => expandQ(r[0]))))];
})();

const adrFiles = existsSync(ADR_DIR) ? readdirSync(ADR_DIR).filter((f) => /^\d{4}-/.test(f)) : [];
const adrByNo = (no) => adrFiles.filter((f) => f.startsWith(`${no}-`));
const pad = (n) => String(n).padStart(4, '0');
const linkedAdr = (cell) => (cell.match(/\d{4}-[a-z0-9-]+\.md/) ?? [])[0];

it('источники разобраны: 12 решений комплекта, 8 PD плана v2 §7, Q на пересмотр', () => {
  assert.equal(KIT.size, 12);
  assert.deepEqual(
    PLAN_PD.map((r) => r[0]),
    ['PD-53', 'PD-54', 'PD-55', 'PD-56', 'PD-57', 'PD-58', 'PD-59', 'PD-60'],
  );
  assert.ok(Q_REVISE.includes('Q-03') && Q_REVISE.includes('Q-120') && Q_REVISE.length > 30);
});

// --- 1. ADR D-01…D-12 ---------------------------------------------------------------------------

describe('ADR D-01…D-12 (docs/adr/0002…0013)', () => {
  for (const [id, kit] of KIT) {
    const no = pad(Number(id.slice(2)) + 1);
    describe(`${no} ↔ ${id}`, () => {
      const files = adrByNo(no);
      const text = files.length === 1 ? readFileSync(join(ADR_DIR, files[0]), 'utf8') : '';
      const lines = text.split('\n');

      it('один файл NNNN-<slug>.md, slug латиницей через дефис', () => {
        assert.equal(files.length, 1, `файлы ${no}-*: ${files.join(', ') || 'нет'}`);
        assert.match(files[0], /^\d{4}-[a-z0-9]+(-[a-z0-9]+)*\.md$/);
      });

      it(`заголовок «# ${no}. ${id} · …», статус и дата по шаблону`, () => {
        assert.match(lines[0] ?? '', new RegExp(`^# ${no}\\. ${id} · \\S`));
        assert.match(text, /^Статус: (предложено|принято|заменено \d{4})/m);
        assert.match(text, /^Дата: \d{4}-\d{2}-\d{2} · /m);
      });

      it('разделы шаблона по порядку: Контекст, Варианты, Решение, Последствия', () => {
        const order = ['## Контекст', '## Варианты', '## Решение', '## Последствия'].map((h) =>
          lines.indexOf(h),
        );
        assert.ok(
          order.every((i) => i > 0),
          `нет раздела: ${order}`,
        );
        assert.deepEqual(
          [...order].sort((a, b) => a - b),
          order,
        );
      });

      it('в «Вариантах» не меньше двух нумерованных вариантов', () => {
        const variants = section(text, '## Варианты')
          .split('\n')
          .filter((l) => /^\d+\. \S/.test(l));
        assert.ok(variants.length >= 2, `вариантов: ${variants.length}`);
      });

      it('«Решение» даёт рекомендацию = предложение по умолчанию из 16', () => {
        const decision = section(text, '## Решение');
        assert.match(decision, /Рекомендация/);
        if (!/^Статус: предложено/m.test(text)) return;
        if (kit.proposal === '—') {
          assert.match(decision, /предложения по умолчанию нет/);
          assert.match(decision, /допущени/);
        } else {
          assert.ok(decision.includes(kit.proposal), `нет дословно: «${kit.proposal}»`);
        }
      });

      it('строки «Решение комплекта», «Кто решает», «Блокирует» по 16', () => {
        assert.match(text, new RegExp(`^Решение комплекта: ${id}\\b`, 'm'));
        const who = lines.find((l) => l.startsWith('Кто решает: ')) ?? '';
        assert.ok(who.includes(kit.who), `«Кто решает» без «${kit.who}»`);
        const blocks = lines.find((l) => l.startsWith('Блокирует: ')) ?? '';
        assert.ok(blocks, 'нет строки «Блокирует:»');
        if (kit.blocks !== '—') assert.ok(blocks.includes(kit.blocks), `без «${kit.blocks}»`);
      });
    });
  }
});

// --- 2. ADR-0001 --------------------------------------------------------------------------------

describe('ADR-0001 · URL-схема (PD-25)', () => {
  const files = adrByNo('0001');
  const text = files.length === 1 ? readFileSync(join(ADR_DIR, files[0]), 'utf8') : '';

  it('файл 0001-url-scheme.md, заголовок и статус «принято» (решение плана PD-25)', () => {
    assert.deepEqual(files, ['0001-url-scheme.md']);
    assert.match(text.split('\n')[0], /^# 0001\. URL-схема/);
    assert.match(text, /^Статус: принято/m);
    for (const h of ['## Контекст', '## Варианты', '## Решение', '## Последствия']) {
      assert.ok(text.includes(`\n${h}\n`), `нет ${h}`);
    }
  });

  it('ссылки на решения и вопросы: PD-25, PD-24, PD-54, PD-30, Q-39, Q-101', () => {
    for (const ref of ['PD-25', 'PD-24', 'PD-54', 'PD-30', 'Q-39', 'Q-101']) {
      assert.ok(text.includes(ref), `нет ${ref}`);
    }
  });

  it('маршруты организации: ключи МП §4.7 и новые ключи итерации 14.10', () => {
    const keys = [
      'home',
      'modules',
      'users',
      'billing',
      'branding',
      'fleet',
      'pool',
      'review',
      'today',
      'cars',
      'forms',
      'tasks',
      'calendar',
      'knowledge',
      'data',
      'files',
      'spa',
      'cash',
      'repair',
      'chat',
      'docs',
      'service',
      'repair-catalog',
      'repair-supply',
      'cash-self',
    ];
    const missing = keys.filter((k) => !text.includes(`/t/:tenantId/${k}\``));
    assert.deepEqual(missing, []);
  });

  it('маршруты оператора и входа', () => {
    for (const p of ['tenants', 'usage', 'requests', 'accounts', 'plans']) {
      assert.ok(text.includes(`/platform/${p}`), `нет /platform/${p}`);
    }
    for (const p of ['login', 'callback', 'dev']) {
      assert.ok(text.includes(`/auth/${p}`), `нет /auth/${p}`);
    }
  });

  it('персонаж — dev-вход ?persona= только в e2e-сборке (PD-54), демо-панель не переносится', () => {
    const line = text.split('\n').find((l) => l.includes('?persona=')) ?? '';
    assert.match(line, /PD-54/);
    assert.match(line, /e2e/);
    assert.doesNotMatch(text, /через демо-панель и `\?persona=`/);
  });
});

// --- 3. Индекс ADR ------------------------------------------------------------------------------

describe('индекс docs/adr/README.md', () => {
  const text = existsSync(join(ADR_DIR, 'README.md'))
    ? readFileSync(join(ADR_DIR, 'README.md'), 'utf8')
    : '';
  it('ссылается на шаблон и на каждый ADR', () => {
    assert.ok(text.includes('TEMPLATE.md'));
    assert.ok(adrFiles.length >= 13, `ADR: ${adrFiles.length}`);
    for (const f of adrFiles) assert.ok(text.includes(`(${f})`), `нет ссылки на ${f}`);
  });
});

// --- 4–6. Журнал decisions.md -------------------------------------------------------------------

describe('журнал docs/plan/decisions.md', () => {
  const text = readOr(DECISIONS);

  it('PD-53…PD-60: 8 строк по порядку, решение и «почему» дословно из плана v2 §7', () => {
    const rows = rowsOf(section(text, '## Решения плана v2 PD-53…PD-60'));
    assert.deepEqual(
      rows.map(({ r }) => r[0]),
      PLAN_PD.map((r) => r[0]),
    );
    for (const [i, { header, r }] of rows.entries()) {
      const [id, decision, why] = PLAN_PD[i];
      assert.equal(r[header.indexOf('Решение по умолчанию')], decision, id);
      assert.equal(r[header.indexOf('Почему')], why, id);
    }
  });

  it('индекс D-01…D-12 → ADR: 12 строк, ссылки на существующие ADR', () => {
    const rows = rowsOf(section(text, '## Решения комплекта D-01…D-12'));
    assert.deepEqual(
      rows.map(({ r }) => r[0]),
      [...KIT.keys()],
    );
    for (const { header, r } of rows) {
      const f = linkedAdr(r[header.indexOf('ADR')] ?? '');
      assert.ok(f && adrFiles.includes(f), `${r[0]}: нет ADR (${f})`);
    }
  });

  it('кандидаты D-29…D-34: 6 строк, «кандидат», без PD-29…PD-34', () => {
    const sec = section(text, '## Кандидаты комплекта D-29…D-34');
    const rows = rowsOf(sec);
    assert.deepEqual(
      rows.map(({ r }) => r[0]),
      ['D-29', 'D-30', 'D-31', 'D-32', 'D-33', 'D-34'],
    );
    assert.match(sec, /кандидат/);
    assert.doesNotMatch(text, /\bPD-(29|3[0-4])\b.*кандидат/);
  });

  it('кандидаты D-29…D-34 внутри renumber:off, скрипт W0.00 ничего не меняет', async () => {
    const idx = text.indexOf('## Кандидаты комплекта D-29…D-34');
    assert.ok(idx > 0, 'нет раздела');
    const off = text.lastIndexOf(OFF, idx);
    assert.ok(off !== -1 && text.indexOf(ON, off) > idx, 'заголовок вне renumber:off');
    const lastRow = text.indexOf('| D-34 |', idx);
    assert.ok(text.indexOf(ON, off) > lastRow, 'таблица выходит за renumber:on');
    const { renumber } = await import('../plan/scripts/renumber-decisions.mjs');
    assert.equal(renumber(text).count, 0);
  });
});

// --- 7. Вопросы владельцу продукта --------------------------------------------------------------

describe('вопросы владельцу продукта (docs/plan/v2/questions-for-po.md)', () => {
  const text = readOr(QUESTIONS);
  const defaultsOf = (sec) =>
    rowsOf(sec).map(({ header, r }) => ({
      id: r[0],
      def: r[header.findIndex((h) => h.startsWith('По умолчанию'))] ?? '',
      header,
      r,
    }));

  it('разделы B-2, B-4, B-5 и «Пересмотр Q»', () => {
    for (const h of ['## 1. B-2', '## 2. B-4', '## 3. B-5', '## 4. Пересмотр Q']) {
      assert.ok(text.includes(`\n${h}`), `нет «${h}»`);
    }
  });

  it('B-2: D-01…D-12 со ссылкой на ADR и значением по умолчанию', () => {
    const rows = defaultsOf(section(text, '## 1. B-2'));
    assert.deepEqual(rows.map((x) => x.id).sort(), [...KIT.keys()].sort());
    for (const { id, def, header, r } of rows) {
      assert.ok(def && def !== '—', `${id}: пусто «По умолчанию»`);
      const f = linkedAdr(r[header.indexOf('ADR')] ?? '');
      assert.ok(f && adrFiles.includes(f), `${id}: нет ADR`);
    }
  });

  it('B-4: PD-53 со значением по умолчанию', () => {
    const rows = defaultsOf(section(text, '## 2. B-4'));
    const pd = rows.find((x) => x.id === 'PD-53');
    assert.ok(pd && pd.def, 'нет строки PD-53');
  });

  it('B-5: D-29…D-34 со значением по умолчанию', () => {
    const rows = defaultsOf(section(text, '## 3. B-5'));
    assert.deepEqual(
      rows.map((x) => x.id),
      ['D-29', 'D-30', 'D-31', 'D-32', 'D-33', 'D-34'],
    );
    for (const { id, def } of rows) assert.ok(def && def !== '—', `${id}: пусто`);
  });

  it('пересмотр Q: все Q из D-plan-reconciliation §5.3, у каждой строки значение по умолчанию', () => {
    const rows = defaultsOf(section(text, '## 4. Пересмотр Q'));
    const covered = new Set(rows.flatMap((x) => expandQ(x.id)));
    assert.deepEqual(
      Q_REVISE.filter((q) => !covered.has(q)),
      [],
    );
    for (const { id, def } of rows) assert.ok(def && def !== '—', `${id}: пусто`);
  });
});

// --- 8. Гигиена ---------------------------------------------------------------------------------

describe('гигиена файлов W0.01', () => {
  const files = [
    ...adrFiles.map((f) => `docs/adr/${f}`),
    'docs/adr/README.md',
    'docs/adr/adr-journal.test.mjs',
    DECISIONS,
    QUESTIONS,
    'docs/plan/v2/ws/W0.01.md',
    'docs/plan/v2/reports/W0.01.md',
  ].filter((f) => existsSync(join(ROOT, f)));

  for (const f of files) {
    it(`${f}: UTF-8 без BOM, LF, финальный перевод строки`, () => {
      const buf = readFileSync(join(ROOT, f));
      assert.ok(!(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf), 'BOM');
      const s = buf.toString('utf8');
      assert.ok(!s.includes('\r'), 'CR');
      assert.ok(s.endsWith('\n'), 'нет финального \\n');
    });
  }
});
