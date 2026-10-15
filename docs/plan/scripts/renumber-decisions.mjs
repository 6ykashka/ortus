// Перенумерация решений плана реализации: D-13…D-52 → PD-13…PD-52 (W0.00, план v2 §6, B-3).
//
// Зачем: номера D-13…D-34 заняты решениями комплекта (16-raid-glossary) и плана 27,
// а старый план (docs/plan) использовал D-13…D-52 для других решений
// (docs/plan/v2/analysis/C-docs-and-stages.md «Коллизии номеров решений»).
// В файлах старого плана нет ссылок на решения комплекта с номером ≥ 13
// (design/ 03.10 содержит только D-01…D-12), поэтому замена по номеру однозначна.
// После W0.02 (эталон 14.10) анализы docs/plan/analysis/01–03 ссылаются на D-23 комплекта: такие
// ссылки узнаются по контексту строки (KIT_DECISIONS или пометка «D-NN комплекта», W0.17) и не меняются.
//
// Запуск из корня репозитория:
//   node docs/plan/scripts/renumber-decisions.mjs          — переписать файлы, вывести счётчики
//   node docs/plan/scripts/renumber-decisions.mjs --check  — только посчитать; код 1, если есть что менять
// Скрипт идемпотентен: PD-NN повторно не меняется. docs/plan/v2/** не трогается.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..')

// Таблица соответствия «старый → новый». Номер сохраняется; исключение — кандидат D-53
// из WS-14 (deep link `?modal=`): PD-53…PD-60 заняты решениями плана v2 §7.
export const MAPPING = new Map([
  ...Array.from({ length: 40 }, (_, i) => [`D-${i + 13}`, `PD-${i + 13}`]),
  ['D-53', 'PD-61'],
])

// D-NN, перед которым нет буквы/цифры/подчёркивания (иначе это PD-, XD- и т. п.),
// а после — нет цифры (D-130).
const RE = /(?<![A-Za-z0-9_])D-(\d{2})(?!\d)/g

// Текст между `<!-- renumber:off -->` и `<!-- renumber:on -->` не меняется:
// так помечены таблица «было → стало» и ссылки на решения комплекта D-13…D-34.
const OFF = '<!-- renumber:off -->'
const ON = '<!-- renumber:on -->'

// W0.17 · Решения комплекта D-13+ (design/docs/16-raid-glossary.md), на которые ссылаются файлы
// старого плана после W0.00 (анализы 14.10 W0.02). Номер совпадает с решением плана (PD-NN), поэтому
// ссылка комплекта узнаётся по теме в той же строке (абзац Markdown — одна строка). Новое решение
// комплекта добавляется сюда с темой и узким контекстом; иначе в тексте пишется «D-NN комплекта».
export const KIT_DECISIONS = new Map([
  [
    'D-23',
    {
      // PD-23 плана — «менеджер пакетов pnpm»: контекст меню и модулей с ним не пересекается.
      title: 'Что видно в меню владельца при разных состояниях отраслевого модуля (16-raid-glossary:45)',
      context: /меню|модул|moduleOn|on\/ro\/off|navForBase|Отключены · только чтение/i,
    },
  ],
])

/** Ссылка D-NN в строке — на решение комплекта: пометка «комплекта» рядом или тема из KIT_DECISIONS. */
function isKitRef(id, line) {
  const marked = new RegExp(`${id}\\s+комплект|комплекта[\\s,:(«]+${id}(?!\\d)`).test(line)
  if (marked) return true
  return KIT_DECISIONS.get(id)?.context.test(line) ?? false
}

function replaceSegment(segment) {
  let count = 0
  let kit = 0
  const text = segment
    .split('\n')
    .map((line) =>
      line.replace(RE, (whole) => {
        const next = MAPPING.get(whole)
        if (!next) return whole
        if (isKitRef(whole, line)) {
          kit++
          return whole
        }
        count++
        return next
      }),
    )
    .join('\n')
  return { text, count, kit }
}

export function renumber(text) {
  let out = ''
  let count = 0
  let kit = 0
  let rest = text
  while (rest.length) {
    const off = rest.indexOf(OFF)
    const head = off === -1 ? rest : rest.slice(0, off)
    const r = replaceSegment(head)
    out += r.text
    count += r.count
    kit += r.kit
    if (off === -1) break
    const on = rest.indexOf(ON, off)
    const end = on === -1 ? rest.length : on + ON.length
    out += rest.slice(off, end)
    rest = rest.slice(end)
  }
  return { text: out, count, kit }
}

const listMd = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .map((f) => join(dir, f))
    : []

// Область перенумерации — старый план. docs/plan/v2/** (анализы, статус, план v2) не входит:
// там D-NN используется в обоих смыслах и правится вручную.
export function targetFiles(root = REPO) {
  const plan = join(root, 'docs', 'plan')
  const top = [
    'decisions.md',
    '00-master-plan.md',
    'README.md',
    'orchestration.md',
    'tdd-protocol.md',
    'verification-protocol.md',
    'status.md',
    'workflow.template.js',
  ].map((f) => join(plan, f))
  const sub = ['ws', 'drafts', 'analysis'].flatMap((d) => listMd(join(plan, d)))
  return [...top, ...sub].map((f) => relative(root, f))
}

function main(argv) {
  const check = argv.includes('--check')
  let total = 0
  let files = 0
  let kitTotal = 0
  for (const rel of targetFiles()) {
    const abs = join(REPO, rel)
    if (!existsSync(abs)) continue
    const src = readFileSync(abs, 'utf8')
    const { text, count, kit } = renumber(src)
    kitTotal += kit
    if (!count) continue
    total += count
    files++
    console.log(`${String(count).padStart(4)}  ${rel.replace(/\\/g, '/')}`)
    if (!check) writeFileSync(abs, text, 'utf8')
  }
  console.log(`${check ? 'осталось' : 'заменено'}: ${total} ссылок в ${files} файлах`)
  console.log(`комплекта: ${kitTotal} ссылок (по контексту строки, не меняются; KIT_DECISIONS)`)
  if (check && total > 0) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
