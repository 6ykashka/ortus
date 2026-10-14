// Тесты шаблона docs/plan/workflow.template.js под план v2 (§6, §8): W0.00.
// Запуск: node --test "docs/plan/scripts/*.test.mjs"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, defaultBehavior, metaLiteral, source, wrappedCopy, report } from './workflow-harness.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLAN = 'docs/plan/v2/00-parallel-plan.md'
const ws = (id, slot, extra = {}) => ({ id, slot, kind: 'infra', brief: `docs/plan/v2/ws/${id}.md`, pages: [], ...extra })
const baseArgs = (list, extra = {}) => ({
  stage: 0,
  subwave: '0b',
  plan: PLAN,
  reference: { dir: 'design', tag: 'design-stage-1', port: 4173 },
  ws: list,
  ...extra,
})

test('node --check проходит на копии без export, обёрнутой в async-функцию', () => {
  const r = spawnSync(process.execPath, ['--check', wrappedCopy()], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})

test('meta — чистый литерал, и каждая фаза из скрипта объявлена в meta.phases', () => {
  const meta = metaLiteral()
  assert.ok(meta.name && meta.description)
  const titles = new Set(meta.phases.map((p) => p.title))
  const src = source()
  const used = new Set([
    ...[...src.matchAll(/phase\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]),
    ...[...src.matchAll(/phase:\s*'([^']+)'/g)].map((m) => m[1]),
  ])
  for (const t of used) assert.ok(titles.has(t), `фаза «${t}» не объявлена в meta.phases`)
  for (const t of ['Контракт', 'Исполнение', 'Проверка страниц', 'Ревью', 'Возврат', 'Интеграция', 'Критика'])
    assert.ok(titles.has(t), `нет фазы «${t}»`)
})

test('пустой args.ws и отсутствие args.stage — ошибка', async () => {
  await assert.rejects(run(baseArgs([])), /args\.ws/)
  const noStage = baseArgs([ws('W0.04', 1)])
  delete noStage.stage
  await assert.rejects(run(noStage), /args\.stage/)
})

test('повтор слота или ID в args.ws — ошибка', async () => {
  await assert.rejects(run(baseArgs([ws('W0.04', 1), ws('W0.05', 1)])), /слот/)
  await assert.rejects(run(baseArgs([ws('W0.04', 1), ws('W0.04', 2)])), /W0\.04/)
})

test('стадия 0 допустима (stage: 0 не считается отсутствующим)', async () => {
  const { out } = await run(baseArgs([ws('W0.04', 1)]))
  assert.equal(out.stage, 0)
  assert.equal(out.subwave, '0b')
})

test('фаза «Контракт»: стюард исполняется до исполнителей, которым нужен контракт (needsContract: true, dependsOn)', async () => {
  const { calls } = await run(
    baseArgs([
      ws('W0.04', 1, { needsContract: true }),
      ws('W0.07', 4, { kind: 'contract', reviewers: 2 }),
      ws('W0.10', 5, { dependsOn: ['W0.07'] }),
    ]),
  )
  const contract = calls.find((c) => c.label === 'contract:W0.07')
  assert.ok(contract, 'нет агента contract:W0.07')
  assert.equal(contract.opts.phase, 'Контракт')
  const executors = calls.filter((c) => c.kind === 'ws')
  assert.equal(executors.length, 2)
  const contractDone = Math.max(...calls.filter((c) => c.label.startsWith('review:W0.07')).map((c) => c.end))
  for (const e of executors) assert.ok(e.start > contractDone, `${e.label} стартовал до приёмки контракта`)
  assert.equal(calls.filter((c) => c.kind === 'review' && c.label.startsWith('review:W0.07')).length, 2)
})

test('по умолчанию WS не ждёт контракт: зависимость задаётся только явно', async () => {
  const { calls } = await run(baseArgs([ws('W0.07', 4, { kind: 'contract' }), ws('W0.16', 8)]))
  const contract = calls.find((c) => c.label === 'contract:W0.07')
  const early = calls.find((c) => c.label === 'ws:W0.16')
  assert.ok(early.start < contract.end, 'W0.16 ждал контракт, хотя от него не зависит')
})

test('needsContract: false — WS стартует, не дожидаясь контракта', async () => {
  const { calls } = await run(
    baseArgs([ws('W0.07', 4, { kind: 'contract' }), ws('W0.16', 8, { needsContract: false })]),
  )
  const contract = calls.find((c) => c.label === 'contract:W0.07')
  const early = calls.find((c) => c.label === 'ws:W0.16')
  assert.ok(early.start < contract.end)
})

const rejectContract = (call) =>
  call.label.startsWith('review:W0.07')
    ? { ws: 'W0.07', blocking: ['нет примеров'], nonBlocking: [], tddOrderOk: true, verdict: 'request-changes' }
    : defaultBehavior(call)

test('контракт не принят (эскалация) — зависящие WS не запускаются и попадают в skipped', async () => {
  const { out, calls } = await run(
    baseArgs([ws('W0.07', 4, { kind: 'contract' }), ws('W0.09', 5, { dependsOn: ['W0.07'] }), ws('W0.16', 8)]),
    rejectContract,
  )
  assert.equal(calls.filter((c) => c.label === 'ws:W0.09').length, 0)
  assert.deepEqual(out.skipped, ['W0.09'])
  assert.ok(out.results.some((r) => r.ws.id === 'W0.16'), 'независимый WS не должен пропускаться')
})

test('зависимость по цепочке: WS, зависящий от пропущенного, тоже пропускается', async () => {
  const { out, calls } = await run(
    baseArgs([
      ws('W0.07', 4, { kind: 'contract' }),
      ws('W0.09', 5, { needsContract: true }),
      ws('W0.13', 6, { dependsOn: ['W0.09'] }),
    ]),
    rejectContract,
  )
  assert.equal(calls.filter((c) => c.kind === 'ws').length, 0)
  assert.deepEqual(out.skipped, ['W0.09', 'W0.13'])
})

test('dependsOn: неизвестный ID, сам на себя или цикл — ошибка', async () => {
  await assert.rejects(run(baseArgs([ws('W0.09', 5, { dependsOn: ['W0.99'] })])), /W0\.99/)
  await assert.rejects(run(baseArgs([ws('W0.09', 5, { dependsOn: ['W0.09'] })])), /W0\.09/)
  await assert.rejects(
    run(baseArgs([ws('W0.09', 5, { dependsOn: ['W0.13'] }), ws('W0.13', 6, { dependsOn: ['W0.09'] })])),
    /цикл/,
  )
})

// Точные args из плана v2 §8: блок ```text … Workflow({ … args: { … } }) … ```.
function planSection8Args() {
  const plan = readFileSync(resolve(HERE, '..', 'v2', '00-parallel-plan.md'), 'utf8')
  const sec = plan.slice(plan.indexOf('## 8.'))
  const block = sec.slice(sec.indexOf('```text') + 7, sec.indexOf('```', sec.indexOf('```text') + 7))
  const at = block.indexOf('args:')
  const open = block.indexOf('{', at)
  let depth = 0
  for (let i = open; i < block.length; i++) {
    if (block[i] === '{') depth++
    if (block[i] === '}') depth--
    if (depth === 0) return new Function(`return (${block.slice(open, i + 1)})`)()
  }
  throw new Error('args в §8 не найдены')
}

test('args плана v2 §8: подволна 0b не ждёт W0.07, и отказ контракта никого не пропускает', async () => {
  const args = planSection8Args()
  assert.equal(args.subwave, '0b')
  assert.equal(args.ws.length, 8)
  const { out, calls } = await run(args, rejectContract)
  assert.deepEqual(out.skipped, [])
  const contract = calls.find((c) => c.label === 'contract:W0.07')
  const executors = calls.filter((c) => c.kind === 'ws')
  assert.deepEqual(executors.map((c) => c.label).sort(), ['ws:W0.02', 'ws:W0.04', 'ws:W0.05', 'ws:W0.06', 'ws:W0.10', 'ws:W0.11', 'ws:W0.16'])
  for (const e of executors) assert.ok(e.start < contract.end, `${e.label} ждал контракт W0.07`)
  assert.equal(out.results.length, 8)
})

const pages = (n, p) => Array.from({ length: n }, (_, i) => `${p}${i + 1}`)

test('проверяющих одновременно не больше verifyConcurrency по всем WS сразу', async () => {
  const { maxActive, calls } = await run(
    baseArgs([ws('W1.20', 1, { pages: pages(5, 'a') }), ws('W1.23', 2, { pages: pages(5, 'b') })], { verifyConcurrency: 3 }),
  )
  assert.equal(calls.filter((c) => c.kind === 'verify').length, 10)
  assert.equal(maxActive.verify, 3)
})

test('verifyConcurrency больше 6 урезается до 6', async () => {
  const { maxActive } = await run(
    baseArgs([ws('W1.20', 1, { pages: pages(5, 'a') }), ws('W1.23', 2, { pages: pages(5, 'b') })], { verifyConcurrency: 10 }),
  )
  assert.equal(maxActive.verify, 6)
})

test('порт проверяющего уникален среди одновременно работающих (6100 + полоса проверки)', async () => {
  const { calls } = await run(baseArgs([ws('W1.20', 1, { pages: pages(6, 'a') })], { verifyConcurrency: 6 }))
  const verifies = calls.filter((c) => c.kind === 'verify')
  for (const a of verifies)
    for (const b of verifies) {
      if (a === b || a.end < b.start || b.end < a.start) continue
      const pa = a.prompt.match(/127\.0\.0\.1:(61\d\d)/)[1]
      const pb = b.prompt.match(/127\.0\.0\.1:(61\d\d)/)[1]
      assert.notEqual(pa, pb, `${a.label} и ${b.label} делят порт ${pa}`)
    }
})

test('порт проверяющего не зависит от порядка завершения агентов (кэш промптов при resume)', async () => {
  const args = baseArgs([ws('W1.20', 1, { pages: pages(4, 'a') }), ws('W1.23', 2, { pages: pages(3, 'b') })], { verifyConcurrency: 2 })
  const portsOf = (calls) =>
    Object.fromEntries(calls.filter((c) => c.kind === 'verify').map((c) => [c.label, c.prompt.match(/127\.0\.0\.1:(61\d\d)/)[1]]))
  const a = await run(args)
  // Первые проверяющие завершаются последними: порядок освобождения слотов обратный.
  const slow = async (call) => {
    if (call.kind === 'verify') {
      const n = Number(call.label.split(':')[2].slice(1))
      for (let i = 0; i < (5 - n) * 3; i++) await new Promise((r) => setTimeout(r, 1))
    }
    return defaultBehavior(call)
  }
  const b = await run(args, slow)
  assert.deepEqual(portsOf(b.calls), portsOf(a.calls))
  for (const c of b.calls.filter((x) => x.kind === 'verify')) {
    const same = b.calls.filter((x) => x.kind === 'verify' && x.label === c.label)
    assert.equal(same.length, 1)
  }
  assert.ok(b.maxActive.verify <= 2)
})

test('после возврата только по ревью страницы проверяются заново (код изменился)', async () => {
  let n = 0
  const behavior = (call) =>
    call.kind === 'review' && n++ === 0
      ? { ws: 'W1.23', blocking: ['лог с телефоном'], nonBlocking: [], tddOrderOk: true, verdict: 'request-changes' }
      : defaultBehavior(call)
  const { calls } = await run(baseArgs([ws('W1.23', 2, { pages: ['users', 'roles'] })]), behavior)
  assert.equal(calls.filter((c) => c.kind === 'fix').length, 1)
  const verifies = calls.filter((c) => c.kind === 'verify').map((c) => c.label).sort()
  assert.deepEqual(verifies, ['verify:W1.23:roles:mock', 'verify:W1.23:roles:mock#2', 'verify:W1.23:users:mock', 'verify:W1.23:users:mock#2'])
})

test('этап ≥ 1: страница проверяется в режимах mock и stand', async () => {
  const { calls } = await run(baseArgs([ws('W1.24', 3, { pages: ['modules'] })], { stage: 1, subwave: '1c' }))
  const labels = calls.filter((c) => c.kind === 'verify').map((c) => c.label).sort()
  assert.deepEqual(labels, ['verify:W1.24:modules:mock', 'verify:W1.24:modules:stand'])
})

test('возврат: вердикт return → продолжатель на той же ветке, затем повторная проверка', async () => {
  let n = 0
  const behavior = (call) => {
    if (call.kind === 'verify' && n++ === 0)
      return { ...defaultBehavior(call), verdict: 'return', discrepancies: ['подпись «Назначить роль» не дословна'] }
    return defaultBehavior(call)
  }
  const { out, calls } = await run(baseArgs([ws('W1.23', 2, { pages: ['users'] })]), behavior)
  const fixes = calls.filter((c) => c.kind === 'fix')
  assert.equal(fixes.length, 1)
  assert.equal(fixes[0].opts.phase, 'Возврат')
  assert.match(fixes[0].prompt, /ws\/W1\.23/)
  assert.match(fixes[0].prompt, /подпись «Назначить роль» не дословна/)
  assert.equal(calls.filter((c) => c.kind === 'verify').length, 2)
  const r = out.results.find((x) => x.ws.id === 'W1.23')
  assert.equal(r.escalated, false)
  assert.equal(r.review, 'approve')
  assert.equal(r.iterations, 1)
})

test('возврат по ревью request-changes тоже запускает продолжателя', async () => {
  let n = 0
  const behavior = (call) =>
    call.kind === 'review' && n++ === 0
      ? { ws: 'W0.11', blocking: ['нет теста PD-53'], nonBlocking: [], tddOrderOk: true, verdict: 'request-changes' }
      : defaultBehavior(call)
  const { calls } = await run(baseArgs([ws('W0.11', 6)]), behavior)
  const fixes = calls.filter((c) => c.kind === 'fix')
  assert.equal(fixes.length, 1)
  assert.match(fixes[0].prompt, /нет теста PD-53/)
})

test('не больше 3 возвратов, затем эскалация интегратору (даже если просили больше)', async () => {
  const behavior = (call) =>
    call.kind === 'verify' ? { ...defaultBehavior(call), verdict: 'return', discrepancies: ['иконка'] } : defaultBehavior(call)
  const { out, calls } = await run(baseArgs([ws('W1.25', 4, { pages: ['tenants'] })], { maxReturnIterations: 5 }), behavior)
  assert.equal(calls.filter((c) => c.kind === 'fix').length, 3)
  assert.equal(calls.filter((c) => c.kind === 'verify').length, 4)
  const r = out.results.find((x) => x.ws.id === 'W1.25')
  assert.equal(r.escalated, true)
  assert.match(calls.find((c) => c.kind === 'integrate').prompt, /W1\.25/)
})

test('схема отчёта требует stage, step, stories, contractPr, isolationRows, mode; вердикт — mode и stage', async () => {
  const { calls } = await run(baseArgs([ws('W1.24', 3, { pages: ['modules'] })], { stage: 1, subwave: '1c' }))
  const rep = calls.find((c) => c.kind === 'ws').opts.schema
  for (const f of ['ws', 'branch', 'reportPath', 'done', 'testRunsOk', 'stage', 'step', 'stories', 'contractPr', 'isolationRows', 'mode'])
    assert.ok(rep.required.includes(f), `REPORT_SCHEMA без ${f}`)
  const ver = calls.find((c) => c.kind === 'verify').opts.schema
  for (const f of ['page', 'verdict', 'mode', 'stage']) assert.ok(ver.required.includes(f), `VERDICT_SCHEMA без ${f}`)
  assert.deepEqual(ver.properties.mode.enum, ['mock', 'stand'])
})

test('промпт исполнителя: порты слота, compose-проект, бриф, план v2, снимок эталона', async () => {
  const { calls } = await run(baseArgs([ws('W0.06', 3, { kind: 'infra' })]))
  const p = calls.find((c) => c.label === 'ws:W0.06').prompt
  // Порты 61xx выдаются проверяющим по слоту проверки (лимитёр), а не исполнителю: исполнитель их не занимает.
  for (const s of ['5203', '6101–6106', '7203', '127.0.0.1:8103', 'COMPOSE_PROJECT_NAME=ortus-s3', 'docs/plan/v2/ws/W0.06.md', PLAN, 'design-stage-1', 'ws/W0.06', 'git switch --detach', 'docs/plan/v2/reports/W0.06.md'])
    assert.ok(p.includes(s), `в промпте нет «${s}»`)
  assert.equal(calls.find((c) => c.label === 'ws:W0.06').opts.isolation, 'worktree')
})

test('интегратор: тег stage-<N>-<WS>, план v2, v2/status.md; критик пишет критику этапа', async () => {
  const { calls } = await run(baseArgs([ws('W0.04', 1)]))
  const integ = calls.find((c) => c.kind === 'integrate').prompt
  assert.ok(integ.includes('stage-0-'), 'нет тега stage-0-')
  assert.ok(integ.includes(PLAN))
  assert.ok(integ.includes('docs/plan/v2/status.md'))
  assert.ok(integ.includes('renumber-decisions.mjs --check'))
  const critic = calls.find((c) => c.kind === 'critic').prompt
  assert.ok(critic.includes('docs/plan/v2/critique/stage-0-0b.md'))
})

test('результат содержит stage, subwave, results, skipped, integration, gaps', async () => {
  const { out } = await run(baseArgs([ws('W0.04', 1)]))
  for (const k of ['stage', 'subwave', 'results', 'skipped', 'integration', 'gaps']) assert.ok(k in out, `нет ${k}`)
  assert.equal(out.results[0].report.ws, report('W0.04').ws)
})
