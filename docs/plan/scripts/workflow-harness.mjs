// Фейковая среда Workflow для тестов docs/plan/workflow.template.js (W0.00).
// Повторяет семантику хуков из справочника Workflow: agent, parallel (барьер, null при ошибке),
// pipeline (без барьера между стадиями, стадия получает (prev, item, index)), phase, log.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const TEMPLATE = resolve(HERE, '..', 'workflow.template.js')
export const source = () => readFileSync(TEMPLATE, 'utf8')

// Копия скрипта без `export`: тело выполняется внутри async-функции, как в Workflow.
export const stripExport = (src) => src.replace(/^export\s+/gm, '')
export const PARAMS = ['args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget']

export function wrappedCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'ortus-wf-'))
  const file = join(dir, 'workflow.check.js')
  writeFileSync(file, `(async function (${PARAMS.join(', ')}) {\n${stripExport(source())}\n})\n`, 'utf8')
  return file
}

export function metaLiteral(src = source()) {
  const start = src.indexOf('export const meta =')
  if (start === -1) throw new Error('нет export const meta')
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    if (src[i] === '}') depth--
    if (depth === 0) return new Function(`return (${src.slice(open, i + 1)})`)()
  }
  throw new Error('meta не закрыт')
}

const tick = () => new Promise((r) => setTimeout(r, 1))

export function report(id, extra = {}) {
  return {
    ws: id,
    branch: `ws/${id}`,
    reportPath: `docs/plan/v2/reports/${id}.md`,
    done: true,
    pagesDelivered: [],
    fixmeLeft: [],
    contractsChanged: [],
    testRunsOk: true,
    stage: 0,
    step: '0.x',
    stories: [],
    contractPr: '',
    isolationRows: [],
    mode: 'mock',
    ...extra,
  }
}

// behavior(call) → результат агента; по умолчанию всё принимается.
export function defaultBehavior(call) {
  const [kind, id, page, mode] = call.label.split('#')[0].split(':')
  if (kind === 'contract' || kind === 'ws' || kind === 'fix') return report(id)
  if (kind === 'verify')
    return {
      page,
      e2eGreen: true,
      visualMatch: true,
      mcpWalkDone: true,
      a11yOk: true,
      discrepancies: [],
      evidenceDir: `docs/plan/evidence/${page}/verify/`,
      verdict: 'accept',
      mode: mode || 'mock',
      stage: 0,
    }
  if (kind === 'review') return { ws: id, blocking: [], nonBlocking: [], tddOrderOk: true, verdict: 'approve' }
  if (kind === 'integrate') return 'влито'
  if (kind === 'critic') return { gaps: [] }
  return null
}

export async function run(args, behavior = defaultBehavior) {
  const calls = []
  const active = {}
  const maxActive = {}
  const phases = []
  const logs = []
  let clock = 0
  async function agent(prompt, opts = {}) {
    const label = opts.label || ''
    const kind = label.split('#')[0].split(':')[0]
    const call = { prompt, opts, label, kind, start: clock++ }
    calls.push(call)
    active[kind] = (active[kind] || 0) + 1
    maxActive[kind] = Math.max(maxActive[kind] || 0, active[kind])
    try {
      await tick()
      await tick()
      return await behavior(call)
    } finally {
      active[kind]--
      call.end = clock++
    }
  }
  async function parallel(thunks) {
    return Promise.all(
      thunks.map(async (t) => {
        try {
          return await t()
        } catch {
          return null
        }
      }),
    )
  }
  async function pipeline(items, ...stages) {
    return Promise.all(
      items.map(async (item, i) => {
        let r = item
        for (const s of stages) {
          try {
            r = await s(r, item, i)
          } catch {
            return null
          }
        }
        return r
      }),
    )
  }
  const phase = (t) => phases.push(t)
  const log = (m) => logs.push(m)
  const budget = { total: null, spent: () => 0, remaining: () => Infinity }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const fn = new AsyncFunction(...PARAMS, stripExport(source()))
  const out = await fn(args, agent, parallel, pipeline, phase, log, budget)
  return { out, calls, maxActive, phases, logs }
}
