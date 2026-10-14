// Шаблон Workflow-скрипта (Claude Code → инструмент Workflow) для одной подволны этапа плана v2.
// План: docs/plan/v2/00-parallel-plan.md (§3 модель выполнения, §4 реестр, §8 запуск). Протоколы:
// docs/plan/orchestration.md, tdd-protocol.md, verification-protocol.md.
//
// Запуск (образец — план v2 §8):
//   Workflow({ scriptPath: 'docs/plan/workflow.template.js', args: {
//     stage: 0, subwave: '0b', plan: 'docs/plan/v2/00-parallel-plan.md',
//     reference: { dir: 'design', tag: 'design-stage-1', port: 4173 },
//     ws: [ { id: 'W0.07', slot: 4, kind: 'contract', brief: 'docs/plan/v2/ws/W0.07.md', pages: [], reviewers: 2 },
//           { id: 'W0.16', slot: 8, kind: 'quality', brief: 'docs/plan/v2/ws/W0.16.md', pages: [] } ],
//     verifyConcurrency: 6, maxReturnIterations: 3 } })
//
// Поля ws: id (W<этап>.<nn>), slot (1…10, уникален в подволне: порты §3.6), kind ('contract' — стюард;
// прочие: infra, domain, backend, frontend, ui-kit, quality, process), brief, pages (ключи страниц),
// reviewers (1 или 2), step (шаг плана 27), stories (S1-xx…), modes (['mock'] или ['mock','stand']),
// dependsOn (ID WS этой же подволны, которые должны быть приняты до старта; колонка «Зависит от» §4),
// needsContract (true — то же, что dependsOn на все WS вида contract подволны).
//
// Порядок: WS вида contract идут по одному, последовательно (один стюард на этап, фаза «Контракт»);
// остальные WS стартуют сразу, если у них нет зависимостей, иначе — после приёмки зависимостей.
// По умолчанию зависимостей нет: фаза «Контракт» не барьер для подволны. Зависимости вне подволны
// закрыты её стартом и в dependsOn не пишутся. Если зависимость не принята (эскалация или пропуск),
// WS не запускается и попадает в skipped. Каждый WS: исполнение → проверка страниц → ревью →
// возврат ≤ 3; затем интегратор → критик.
// Возврат: в API скрипта нет SendMessage, поэтому возврат выполняет агент-продолжатель
// той же ветки ws/<id> (orchestration.md §4). После любого возврата все страницы WS проверяются заново.
// Порт проверяющего — 6100 + полоса проверки; полоса вычисляется из слота WS и номера проверки,
// поэтому промпты не зависят от порядка завершения агентов (resume берёт их из кэша).
// Скрипт — чистый JavaScript без Date.now()/Math.random(); все пути — от корня репозитория.

export const meta = {
  name: 'ortus-stage',
  description: 'Подволна этапа Ортус (план v2): контракт → исполнители → проверка страниц (≤ 6) → ревью → возврат ≤ 3 → интеграция → критик',
  whenToUse: 'Запуск подволны этапа по docs/plan/v2/00-parallel-plan.md §8',
  phases: [
    { title: 'Контракт', detail: 'стюард контракта этапа: контрактные PR по очереди шагов, до исполнителей' },
    { title: 'Исполнение', detail: 'один агент на WS, в своём git worktree, строго по tdd-protocol.md' },
    { title: 'Проверка страниц', detail: 'независимый агент на страницу и режим (mock/stand), не больше 6 одновременно' },
    { title: 'Ревью', detail: 'requesting-code-review; 2 ревьюера для authz, миграций, финансов и контракта' },
    { title: 'Возврат', detail: 'продолжатель той же ветки исправляет замечания; не больше 3 итераций, затем эскалация' },
    { title: 'Интеграция', detail: 'ребейз по DAG этапа, полный CI, слияние, тег stage-N-WS, v2/status.md' },
    { title: 'Критика', detail: 'сверка с историями и инвентарём экранов этапа' },
  ],
}

// ── Аргументы ────────────────────────────────────────────────────────────────
const A = args || {}
const WS = A.ws || []
if (!WS.length) throw new Error('args.ws пуст: передайте список WS подволны')
if (A.stage === undefined || A.stage === null) throw new Error('args.stage не задан: номер этапа 0…8')
const STAGE = A.stage
const SUBWAVE = A.subwave || `${STAGE}`
const PLAN = A.plan || 'docs/plan/v2/00-parallel-plan.md'
const REF = { dir: 'design', tag: `design-stage-${STAGE}`, port: 4173, ...(A.reference || {}) }
const VERIFY_CONCURRENCY = Math.max(1, Math.min(6, A.verifyConcurrency || 6))
const MAX_RETURNS = Math.max(0, Math.min(3, A.maxReturnIterations === undefined ? 3 : A.maxReturnIterations))
const MAX_EXECUTORS = 10

if (WS.length > MAX_EXECUTORS) throw new Error(`в подволне ${WS.length} WS, допустимо не больше ${MAX_EXECUTORS}`)
const seenIds = new Set()
const seenSlots = new Set()
for (const w of WS) {
  if (!w.id || !w.brief) throw new Error(`у WS нет id или brief: ${JSON.stringify(w)}`)
  if (seenIds.has(w.id)) throw new Error(`WS ${w.id} указан дважды`)
  seenIds.add(w.id)
  if (!(w.slot >= 1 && w.slot <= MAX_EXECUTORS)) throw new Error(`WS ${w.id}: слот должен быть 1…${MAX_EXECUTORS}`)
  if (seenSlots.has(w.slot)) throw new Error(`слот ${w.slot} занят двумя WS (порты §3.6 плана v2)`)
  seenSlots.add(w.slot)
}

// ── Зависимости внутри подволны ──────────────────────────────────────────────
const byId = new Map(WS.map((w) => [w.id, w]))
const contractWs = WS.filter((w) => w.kind === 'contract')
const depsOf = (w) => {
  const d = new Set(w.dependsOn || [])
  if (w.needsContract === true && w.kind !== 'contract') for (const c of contractWs) d.add(c.id)
  return [...d]
}
// Стюард один: WS вида contract идут по очереди, каждый ждёт завершения предыдущего.
const prevContractOf = (w) => {
  const i = contractWs.indexOf(w)
  return i > 0 ? contractWs[i - 1] : null
}
for (const w of WS) {
  if (w.dependsOn !== undefined && !Array.isArray(w.dependsOn)) throw new Error(`WS ${w.id}: dependsOn должен быть массивом ID`)
  for (const id of depsOf(w)) {
    if (id === w.id) throw new Error(`WS ${w.id} зависит сам от себя`)
    if (!byId.has(id)) throw new Error(`WS ${w.id}: зависимость ${id} не в этой подволне (зависимости вне подволны закрыты её стартом — уберите из dependsOn)`)
  }
}
{
  const state = {}
  const visit = (w, path) => {
    if (state[w.id] === 'done') return
    if (state[w.id] === 'open') throw new Error(`цикл зависимостей WS: ${[...path, w.id].join(' → ')}`)
    state[w.id] = 'open'
    const prev = prevContractOf(w)
    for (const d of [...depsOf(w).map((id) => byId.get(id)), ...(prev ? [prev] : [])]) visit(d, [...path, w.id])
    state[w.id] = 'done'
  }
  for (const w of WS) visit(w, [])
}

// ── Общие правила для всех агентов ───────────────────────────────────────────
const RULES = `План: ${PLAN} (этап ${STAGE}, подволна ${SUBWAVE}; правила — §3, решения по умолчанию — §2 и §7). Протоколы: docs/plan/tdd-protocol.md, docs/plan/verification-protocol.md, docs/plan/orchestration.md. Эталон — ${REF.dir}/ (неприкосновенен), снимок этапа — git-тег ${REF.tag}, превью: node tools/design-preview.js ${REF.dir} ${REF.port}. Подписи — дословно из эталона. Решения: D-NN — комплект и план 27, PD-NN — план реализации (docs/plan/decisions.md); отклонение от эталона — только через решение и allowlist (виды out-of-stage, no-reference). Среда: Windows, PowerShell 5.1 (нет && и ||), коммиты по Conventional Commits через git commit -F (UTF-8 без BOM), pnpm install в каждом worktree, integration-тесты только через testcontainers. Новые зависимости — с пином версии и отметкой для интегратора.`

const ports = (slot) => ({
  vite: 5200 + slot,
  storybook: 7200 + slot,
  api: `127.0.0.1:${8100 + slot}`,
  compose: `ortus-s${slot}`,
})

const modesOf = (ws) => ws.modes || (STAGE >= 1 ? ['mock', 'stand'] : ['mock'])
const branchOf = (ws) => `ws/${ws.id}`
const reportPathOf = (ws) => `docs/plan/v2/reports/${ws.id}.md`

// ── Схемы ────────────────────────────────────────────────────────────────────
const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    ws: { type: 'string' },
    branch: { type: 'string' },
    reportPath: { type: 'string', description: 'docs/plan/v2/reports/<WS>.md' },
    done: { type: 'boolean' },
    pagesDelivered: { type: 'array', items: { type: 'string' } },
    fixmeLeft: { type: 'array', items: { type: 'string' } },
    contractsChanged: { type: 'array', items: { type: 'string' } },
    testRunsOk: { type: 'boolean' },
    stage: { type: 'number', description: 'этап плана v2 (0…8)' },
    step: { type: 'string', description: 'шаг плана 27, например 1.4; для процесса — «—»' },
    stories: { type: 'array', items: { type: 'string' }, description: 'ID историй: S1-11, S2-17…' },
    contractPr: { type: 'string', description: 'ветка или коммит контрактного PR шага; пустая строка — контракт не нужен' },
    isolationRows: { type: 'array', items: { type: 'string' }, description: 'строки матрицы изоляции: файл и имя теста' },
    mode: { type: 'string', enum: ['mock', 'stand', 'none'], description: 'в каком режиме зелёные e2e; none — страниц нет' },
    commits: { type: 'array', items: { type: 'string' }, description: '«hash subject»' },
  },
  required: ['ws', 'branch', 'reportPath', 'done', 'pagesDelivered', 'fixmeLeft', 'contractsChanged', 'testRunsOk', 'stage', 'step', 'stories', 'contractPr', 'isolationRows', 'mode'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    page: { type: 'string' },
    mode: { type: 'string', enum: ['mock', 'stand'] },
    stage: { type: 'number' },
    e2eGreen: { type: 'boolean' },
    visualMatch: { type: 'boolean' },
    mcpWalkDone: { type: 'boolean' },
    a11yOk: { type: 'boolean' },
    discrepancies: { type: 'array', items: { type: 'string' } },
    evidenceDir: { type: 'string' },
    verdict: { type: 'string', enum: ['accept', 'return'] },
  },
  required: ['page', 'mode', 'stage', 'e2eGreen', 'visualMatch', 'mcpWalkDone', 'a11yOk', 'discrepancies', 'evidenceDir', 'verdict'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    ws: { type: 'string' },
    blocking: { type: 'array', items: { type: 'string' } },
    nonBlocking: { type: 'array', items: { type: 'string' } },
    tddOrderOk: { type: 'boolean', description: 'коммиты test: предшествуют feat: для каждой единицы' },
    verdict: { type: 'string', enum: ['approve', 'request-changes'] },
  },
  required: ['ws', 'blocking', 'nonBlocking', 'tddOrderOk', 'verdict'],
}

// ── Промпты ──────────────────────────────────────────────────────────────────
const STEWARD = `Ты — стюард контракта этапа ${STAGE}: единственный, кто пишет в api/** (OpenAPI по тегам paths/<tag>.yaml, permissions.yaml, errors.yaml) и выдаёт номера миграций из блока этапа (план v2 §3.5). Контрактный PR шага включает OpenAPI, права, ошибки, миграцию с номером, примеры и make gen с проверкой дрейфа; контракт только аддитивный. Контрактные PR — по одному, в порядке шагов.`

const executePrompt = (ws) => {
  const p = ports(ws.slot)
  const head = ws.kind === 'contract' ? `${STEWARD}\n` : ''
  return `${head}Ты — исполнитель рабочего потока ${ws.id} (вид ${ws.kind || '—'}${ws.step ? `, шаг ${ws.step}` : ''}${ws.stories && ws.stories.length ? `, истории ${ws.stories.join(', ')}` : ''}) этапа ${STAGE}, подволна ${SUBWAVE}, проект Ортус CRM. ${RULES}
Бриф: ${ws.brief} — прочитай полностью вместе со входами; карточка — ${PLAN} §4. Если брифа нет, сначала напиши его по orchestration.md §1 (11 разделов) и закоммить.
Ты в своём git worktree: git switch -c ${branchOf(ws)} main. Пиши только в каталоги из колонки «Владеет» карточки, в свой бриф и в свой отчёт.
Порты слота ${ws.slot}: Vite ${p.vite}, Storybook ${p.storybook}, API HTTP_ADDR=${p.api} (прокси Vite /api — из env), MCP .playwright-mcp/${p.vite}/; COMPOSE_PROJECT_NAME=${p.compose}, compose останови по завершении. Порты 6101–6106 — только у проверяющих, не занимай их.
Работай строго по tdd-protocol.md: e2e-скелет страниц (${(ws.pages || []).join(', ') || 'страниц нет'}) в test.fixme, строки матрицы изоляции — красными до хендлера, затем red → green → refactor по единицам; red-коммит отдельно. Режимы e2e: ${modesOf(ws).join(' и ')}.
Перед завершением для каждой страницы выполни verification-protocol.md §1–§4 (проходка Playwright MCP, снимки в docs/plan/evidence/<page-key>/). Отчёт — ${reportPathOf(ws)} по orchestration.md §5, с дословным выводом прогонов. В самом конце: git switch --detach, чтобы освободить ветку ${branchOf(ws)}.
Нельзя «на потом»: если что-то нельзя сделать из-за среды или решения, запиши блокер с точной причиной в отчёт и сделай остальное.`
}

const verifyPrompt = (check, ws, report, lane) => {
  const port = 6100 + lane
  return `Ты — независимый проверяющий страницы «${check.page}» в режиме ${check.mode} (WS ${ws.id}, этап ${STAGE}). Ты не видел работу исполнителя: у тебя есть только его отчёт ${report.reportPath} и бриф ${ws.brief}. ${RULES}
Ты в своём git worktree: git switch --detach ${report.branch || branchOf(ws)}; pnpm install. Подними приложение на 127.0.0.1:${port} с E2E_FRESH_SERVER=1 в режиме ${check.mode}${check.mode === 'stand' ? ` (стенд compose интегратора или свой с COMPOSE_PROJECT_NAME=ortus-v${lane})` : ' (MSW-сценарный сервер на сиде прототипа)'}; MCP — .playwright-mcp/${port}/ с --isolated.
Выполни verification-protocol.md заново: (1) e2e страницы на mobile-390 и desktop-1440, приложи вывод; (2) пиксельная и структурная сверка со снимком эталона ${REF.tag} на 127.0.0.1:${REF.port}; (3) проходка Playwright MCP по §4 — дерево доступности против инвентаря из анализа, сценарии, негативные проверки, три ширины, консоль, сеть; (4) axe. Отличия, внесённые в allowlist с PD-/D-ID (в том числе out-of-stage и no-reference), не считаются расхождением. Ищи расхождения по §7 придирчиво. Снимки — docs/plan/evidence/${check.page}/verify/${check.mode}/. Вердикт accept — только если все четыре проверки пройдены и расхождений нет; в поле mode — ${check.mode}, stage — ${STAGE}.`
}

const reviewPrompt = (ws, report, verdicts, i, n) => `Ты — ревьюер WS ${ws.id} (этап ${STAGE}). Используй скил requesting-code-review как чек-лист. Входы: бриф ${ws.brief}, отчёт ${report.reportPath}, вердикты проверяющих: ${JSON.stringify(verdicts)}. ${RULES}
Смотри ветку ${report.branch || branchOf(ws)} через git diff main...${report.branch || branchOf(ws)} (без checkout). Проверь: порядок коммитов test: → feat: по каждой единице; строки изоляции красные до хендлера; ссылку на контрактный PR (${report.contractPr || 'нет'}) и аддитивность контракта; дословность подписей; скилы golang-* и vercel-react-best-practices; отсутствие прямых вызовов api-client из компонентов; логи без запрещённых данных; миграции expand/contract и номер из блока этапа; границы файлов карточки. Блокирующие замечания — только подтверждённые цитатой кода.${n > 1 ? `\nТы ревьюер №${i + 1} из ${n}; ревьюер №2 смотрит прежде всего authz, миграции, финансы и контракт.` : ''}`

const fixPrompt = (ws, report, iteration, returned, reviews) => `Ты продолжаешь WS ${ws.id} (этап ${STAGE}) после возврата №${iteration} из ${MAX_RETURNS}. ${RULES}
Бриф ${ws.brief}, прошлый отчёт ${report.reportPath}. Ты в своём git worktree: git switch ${report.branch || branchOf(ws)} (ветка исполнителя, продолжай её, не создавай новую).
Расхождения проверяющих: ${JSON.stringify(returned.map((v) => ({ page: v.page, mode: v.mode, discrepancies: v.discrepancies })))}
Блокирующие замечания ревью: ${JSON.stringify(reviews.flatMap((r) => r.blocking || []))}
Исправь по tdd-protocol.md (сначала тест, воспроизводящий расхождение, — отдельным коммитом), прогони проверки, допиши в отчёт раздел «Возврат ${iteration}» с дословными хвостами прогонов. Смысловые несогласия с проверяющим не «исправляй», а запиши в отчёт как вопрос интегратору. В конце: git switch --detach.`

const integratePrompt = (results, skipped) => `Ты — интегратор этапа ${STAGE}, подволна ${SUBWAVE}. Результаты WS: ${JSON.stringify(results.map((r) => ({ ws: r.ws.id, branch: r.report && r.report.branch, review: r.review, escalated: r.escalated, iterations: r.iterations, verdicts: r.verdicts })))}. Не запущены (зависимость в подволне не принята): ${JSON.stringify(skipped)}. ${RULES}
Для каждого WS с review === 'approve' и без escalated в порядке DAG этапа (${PLAN} §5 и колонка «Зависит от» §4; контрактные WS — первыми): git rebase main, разреши только механические конфликты (смысловые — верни WS с описанием), прогони pnpm lint, pnpm typecheck, pnpm test, go -C backend test ./..., node --test "docs/plan/scripts/*.test.mjs" и node docs/plan/scripts/renumber-decisions.mjs --check, затем слей squash в main с тегом stage-${STAGE}-<WS> (например stage-${STAGE}-${results.length ? results[0].ws.id : 'W0.00'}). Новые зависимости (pnpm-lock.yaml, go.mod) — одним коммитом зависимостей. WS с escalated: true разбери сам: прими, верни или эскалируй человеку с причиной.
После всех WS: полный CI, pnpm e2e на всех проектах${STAGE >= 1 ? ', pnpm e2e:full на стенде (режим stand)' : ''}, визуальная сверка страниц подволны. Обнови свою строку и строки WS в docs/plan/v2/status.md. Если подволна последняя — проверь критерий выхода этапа (${PLAN} §4, «Выход из этапа ${STAGE}»). Верни список влитых WS, возвращённых с причинами и вывод полного прогона.`

const criticPrompt = (integration) => `Ты — критик полноты этапа ${STAGE}, подволна ${SUBWAVE}. Прочитай ${PLAN} (карточки и критерий выхода этапа ${STAGE}), docs/plan/v2/status.md, отчёты docs/plan/v2/reports/*.md, истории этапа (13-backlog и план 27) и инвентарь экранов этапа (docs/plan/analysis/, docs/plan/v2/analysis/A-prototype-delta.md). Результат интеграции: ${JSON.stringify(integration).slice(0, 4000)}. Составь список: (а) экраны, диалоги и состояния этапа без реализации или без e2e/MCP-проверки; (б) истории и AC этапа без тестов; (в) контракты, изменённые вне контрактного PR; (г) записи allowlist без PD-/D-ID или с просроченным out-of-stage. Запиши в docs/plan/v2/critique/stage-${STAGE}-${SUBWAVE}.md и верни пропуски массивом строк.`

// ── Лимит проверяющих: общий для всех WS подволны ─────────────────────────────
// VERIFY_CONCURRENCY полос; на полосе одновременно работает один проверяющий, полоса задаёт порт
// 6100 + полоса. Полоса вычисляется детерминированно из слота WS и номера проверки, а не из порядка
// освобождения: промпт проверяющего одинаков при любом порядке завершения агентов, и resume
// берёт уже выполненные проверки из кэша.
const laneTail = Array.from({ length: VERIFY_CONCURRENCY }, () => Promise.resolve())
const laneOf = (ws, index) => ((ws.slot - 1 + index) % VERIFY_CONCURRENCY) + 1
const onLane = (lane, task) => {
  const run = laneTail[lane - 1].then(() => task(lane))
  laneTail[lane - 1] = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
// chunked: задачи { lane, task: (lane) => Promise } идут по своим полосам; порядок результатов сохраняется.
const chunked = (items) => parallel(items.map(({ lane, task }) => () => onLane(lane, task)))

// ── Один WS: исполнение → проверка → ревью → возврат ≤ MAX_RETURNS ─────────────
async function runWs(ws, execPhase) {
  const kind = ws.kind === 'contract' ? 'contract' : 'ws'
  let report = await agent(executePrompt(ws), { label: `${kind}:${ws.id}`, phase: execPhase, schema: REPORT_SCHEMA, isolation: 'worktree' })
  if (!report) return { ws, report: null, verdicts: [], review: 'missing', reviews: [], iterations: 0, escalated: true }

  const checks = (ws.pages || []).flatMap((page) => modesOf(ws).map((mode) => ({ page, mode })))
  const verdictByKey = {}
  const keyOf = (c) => `${c.page}:${c.mode}`
  let iterations = 0
  for (;;) {
    // Каждый круг проверяет все страницы WS: продолжатель менял код, принятая раньше страница могла сломаться.
    const suffix = iterations ? `#${iterations + 1}` : ''
    const fresh = await chunked(
      checks.map((c, i) => ({
        lane: laneOf(ws, i),
        task: (lane) =>
          agent(verifyPrompt(c, ws, report, lane), { label: `verify:${ws.id}:${c.page}:${c.mode}${suffix}`, phase: 'Проверка страниц', schema: VERDICT_SCHEMA }),
      })),
    )
    checks.forEach((c, i) => {
      verdictByKey[keyOf(c)] = fresh[i] || { page: c.page, mode: c.mode, verdict: 'return', discrepancies: ['проверяющий не вернул вердикт: проверить заново'] }
    })
    const verdicts = checks.map((c) => verdictByKey[keyOf(c)])

    const n = Math.max(1, Math.min(2, ws.reviewers || 1))
    const reviews = (
      await parallel(
        Array.from({ length: n }, (_, i) => () =>
          agent(reviewPrompt(ws, report, verdicts, i, n), { label: `review:${ws.id}${n > 1 ? `#${i + 1}` : ''}${suffix ? `~${iterations + 1}` : ''}`, phase: 'Ревью', schema: REVIEW_SCHEMA }),
        ),
      )
    ).filter(Boolean)
    const review = reviews.length === n && reviews.every((x) => x.verdict === 'approve') ? 'approve' : 'request-changes'
    const returnedChecks = checks.filter((c) => verdictByKey[keyOf(c)].verdict !== 'accept')

    if (!returnedChecks.length && review === 'approve') return { ws, report, verdicts, review, reviews, iterations, escalated: false }
    if (iterations >= MAX_RETURNS) {
      log(`${ws.id}: ${MAX_RETURNS} возврата исчерпаны — эскалация интегратору`)
      return { ws, report, verdicts, review, reviews, iterations, escalated: true }
    }
    iterations++
    const next = await agent(fixPrompt(ws, report, iterations, returnedChecks.map((c) => verdictByKey[keyOf(c)]), reviews), {
      label: `fix:${ws.id}#${iterations}`,
      phase: 'Возврат',
      schema: REPORT_SCHEMA,
      isolation: 'worktree',
    })
    if (next) report = next
  }
}

// ── Ход подволны ──────────────────────────────────────────────────────────────
// Каждый WS ждёт только свои зависимости (и предыдущий контрактный WS — стюард один).
const accepted = (r) => !!r && !r.skipped && r.review === 'approve' && !r.escalated
const runs = new Map()
function start(w) {
  if (runs.has(w.id)) return runs.get(w.id)
  const run = (async () => {
    const prev = prevContractOf(w)
    if (prev) await start(prev)
    const deps = depsOf(w)
    const depResults = await Promise.all(deps.map((id) => start(byId.get(id))))
    const blockedBy = deps.filter((id, i) => !accepted(depResults[i]))
    if (blockedBy.length) {
      log(`${w.id} не запущен: не приняты ${blockedBy.join(', ')}`)
      return { ws: w, skipped: true, blockedBy }
    }
    try {
      return await runWs(w, w.kind === 'contract' ? 'Контракт' : 'Исполнение')
    } catch (e) {
      log(`${w.id}: сбой оркестрации — ${e && e.message ? e.message : e}`)
      return { ws: w, report: null, verdicts: [], review: 'missing', reviews: [], iterations: 0, escalated: true }
    }
  })()
  runs.set(w.id, run)
  return run
}

phase(contractWs.length ? 'Контракт' : 'Исполнение')
const all = await Promise.all(WS.map((w) => start(w)))
const settled = all.filter((r) => r && !r.skipped)
const skippedInfo = all.filter((r) => r && r.skipped).map((r) => ({ ws: r.ws.id, blockedBy: r.blockedBy }))
const skipped = skippedInfo.map((s) => s.ws)
log(`WS завершено: ${settled.length}/${WS.length}; approve: ${settled.filter(accepted).length}; эскалаций: ${settled.filter((r) => r.escalated).length}; пропущено: ${skipped.length}`)

phase('Интеграция')
const integration = await agent(integratePrompt(settled, skippedInfo), { label: 'integrate', phase: 'Интеграция' })

phase('Критика')
const critique = await agent(criticPrompt(integration), {
  label: 'critic',
  phase: 'Критика',
  schema: { type: 'object', properties: { gaps: { type: 'array', items: { type: 'string' } } }, required: ['gaps'] },
})

return { stage: STAGE, subwave: SUBWAVE, results: settled, skipped, integration, gaps: critique ? critique.gaps : [] }
