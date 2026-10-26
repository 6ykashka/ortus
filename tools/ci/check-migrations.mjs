#!/usr/bin/env node
// W0.04 · Проверка нумерации миграций goose: backend/migrations/{control,tenant}/NNNN_<slug>.sql.
// Правила — план v2 §3.5 («Миграции») и PD-59: номер выдаёт стюард из блока этапа,
// номера уникальны и без дыр. Черновики (tenant/drafts/) номера не имеют и не проверяются.
//
// «Без дыр» при резерве блоков: внутри блока номера идут подряд от его начала, каждый блок
// до последнего занятого непуст; незанятый хвост закрытого блока дырой не считается.
//
// CLI: node tools/ci/check-migrations.mjs [--root <каталог репозитория>]
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Блоки tenant: этап 0 — база v0.2 (W0.06), этапы 1–7 — §3.5 плана (этап 3 без миграций). */
export const TENANT_BLOCKS = [
  { stage: 0, from: 1, to: 2 },
  { stage: 1, from: 3, to: 9 },
  { stage: 2, from: 10, to: 19 },
  { stage: 4, from: 20, to: 39 },
  { stage: 5, from: 40, to: 49 },
  { stage: 6, from: 50, to: 59 },
  { stage: 7, from: 60, to: 69 },
];

/**
 * Этапы, которые ещё не влиты, хотя блок после них уже занят: пустой блок такого этапа не ошибка. Номер, выданный в нём
 * позже, раннер goose без out-of-order на БД выше не накатит (api/README.md). Сейчас таких нет: этап 5 влит (W5.00).
 */
export const PENDING_STAGES = new Set([]);

/** Блоки control: база v0.2 — 0001–0003; дальше «0004+ по тому же принципу» без границ (§3.5). */
export const CONTROL_BLOCKS = [
  { stage: 0, from: 1, to: 3 },
  { stage: '1+', from: 4, to: 9999 },
];

/** Этапы, чьи блоки могут быть пусты ниже занятого: пусто — этапы 5 и 6 влиты (W5.00, W6.00). */
export const RESERVE_STAGES = [];

export const BLOCKS = { control: CONTROL_BLOCKS, tenant: TENANT_BLOCKS };

const NAME_RE = /^(\d{4})_[a-z0-9][a-z0-9_]*\.sql$/;

const pad = (n) => String(n).padStart(4, '0');
const span = (b) => `${pad(b.from)}–${pad(b.to)}`;
const label = (b) => `этапа ${b.stage}: ${span(b)}`;

/** Ошибки нумерации одной БД. names — имена файлов каталога (только верхний уровень). */
export function checkDb(db, names, blocks = BLOCKS[db]) {
  const errors = [];
  const byNumber = new Map();
  for (const name of names) {
    const m = NAME_RE.exec(name);
    if (!m) {
      errors.push(`${db}/${name}: имя не по шаблону NNNN_<slug>.sql`);
      continue;
    }
    const n = Number(m[1]);
    byNumber.set(n, [...(byNumber.get(n) ?? []), name]);
  }

  const numbers = [...byNumber.keys()].sort((a, b) => a - b);
  for (const n of numbers) {
    const files = byNumber.get(n);
    if (files.length > 1) errors.push(`${db}: номер ${pad(n)} повторяется: ${files.join(', ')}`);
  }

  const used = blocks.map(() => []);
  for (const n of numbers) {
    const i = blocks.findIndex((b) => n >= b.from && n <= b.to);
    if (i < 0) errors.push(`${db}: ${byNumber.get(n)[0]} вне блоков этапов (план §3.5)`);
    else used[i].push(n);
  }

  const last = used.findLastIndex((u) => u.length > 0);
  blocks.forEach((b, i) => {
    if (i > last) return;
    // Блоки с признаком reserve (этапы 5 и 6, пока не влиты в ветку этапа 7) могут быть пусты ниже занятого.
    if (used[i].length === 0 && RESERVE_STAGES.includes(b.stage)) return;
    if (used[i].length === 0) {
      if (PENDING_STAGES.has(b.stage)) return;
      const l = blocks[last];
      errors.push(
        `${db}: блок этапа ${b.stage} (${span(b)}) пуст, а занят блок этапа ${l.stage} (${span(l)})`,
      );
      return;
    }
    const max = used[i].at(-1);
    const missing = [];
    for (let n = b.from; n <= max; n++) if (!byNumber.has(n)) missing.push(pad(n));
    if (missing.length) errors.push(`${db}: дыра — нет ${missing.join(', ')} (блок ${label(b)})`);
  });

  return errors;
}

/** Проверка обеих БД. */
export function checkMigrations({ control = [], tenant = [] }) {
  return {
    errors: [...checkDb('control', control), ...checkDb('tenant', tenant)],
    counts: { control: control.length, tenant: tenant.length },
  };
}

/** Имена *.sql верхнего уровня каталога; подкаталоги (drafts/) и прочие файлы не считаются. */
export function listMigrations(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort();
}

export function main(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--root');
  const root = resolve(i >= 0 ? argv[i + 1] : process.cwd());
  const base = join(root, 'backend', 'migrations');
  if (!existsSync(base)) {
    console.log('migrations: нет backend/migrations — пропуск');
    return 0;
  }
  const r = checkMigrations({
    control: listMigrations(join(base, 'control')),
    tenant: listMigrations(join(base, 'tenant')),
  });
  if (r.errors.length) {
    for (const e of r.errors) console.error(e);
    return 1;
  }
  console.log(`migrations: control ${r.counts.control}, tenant ${r.counts.tenant} — ок`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
