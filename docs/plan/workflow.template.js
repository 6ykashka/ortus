// Шаблон Workflow-скрипта (Claude Code → инструмент Workflow) для выполнения одной волны плана.
// Запуск: Workflow({ scriptPath: 'docs/plan/workflow.template.js', args: { wave: 2, ws: [...] } })
// args.ws — массив объектов { id: 'WS-21', slug: 'company-pages', brief: 'docs/plan/ws/WS-21-company-pages.md',
//                               pages: ['modules', 'users', 'billing', 'branding'], reviewers: 1 }
// Скрипт — чистый JavaScript без Date.now()/Math.random(); все пути — относительно корня репозитория.

export const meta = {
  name: 'ortus-wave',
  description: 'Выполнить волну рабочих потоков Ортус: исполнитель → проверка страниц (e2e + Playwright MCP) → ревью → интеграция → критик',
  phases: [
    { title: 'Исполнение', detail: 'один агент на WS, в своём git worktree, строго по tdd-protocol.md' },
    { title: 'Проверка страниц', detail: 'независимый агент на каждую страницу: e2e, визуальная сверка, Playwright MCP' },
    { title: 'Ревью', detail: 'requesting-code-review; 2 ревьюера для authz/миграций/финансов' },
    { title: 'Интеграция', detail: 'ребейз, полный CI, слияние, status.md' },
    { title: 'Критика', detail: 'сверка с инвентарём экранов и реестром требований' },
  ],
}

const WAVE = args && args.wave
const WS = (args && args.ws) || []
if (!WS.length) throw new Error('args.ws пуст: передайте список WS волны')

const RULES = `Обязательные документы: docs/plan/00-master-plan.md, docs/plan/tdd-protocol.md, docs/plan/verification-protocol.md, docs/plan/orchestration.md. Эталон — design/ (неприкосновенен), локальный превью: node tools/design-preview.js design 4173. Все подписи — дословно из прототипа. Любое отклонение от прототипа — только через docs/plan/decisions.md.`

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    ws: { type: 'string' },
    branch: { type: 'string' },
    reportPath: { type: 'string', description: 'docs/plan/reports/<WS>.md' },
    done: { type: 'boolean' },
    pagesDelivered: { type: 'array', items: { type: 'string' } },
    fixmeLeft: { type: 'array', items: { type: 'string' } },
    contractsChanged: { type: 'array', items: { type: 'string' } },
    testRunsOk: { type: 'boolean' },
  },
  required: ['ws', 'branch', 'reportPath', 'done', 'pagesDelivered', 'fixmeLeft', 'contractsChanged', 'testRunsOk'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    page: { type: 'string' },
    e2eGreen: { type: 'boolean' },
    visualMatch: { type: 'boolean' },
    mcpWalkDone: { type: 'boolean' },
    a11yOk: { type: 'boolean' },
    discrepancies: { type: 'array', items: { type: 'string' } },
    evidenceDir: { type: 'string' },
    verdict: { type: 'string', enum: ['accept', 'return'] },
  },
  required: ['page', 'e2eGreen', 'visualMatch', 'mcpWalkDone', 'a11yOk', 'discrepancies', 'evidenceDir', 'verdict'],
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

const executePrompt = (ws) => `Ты — исполнитель рабочего потока ${ws.id} (${ws.slug}) волны ${WAVE} проекта Ортус CRM.
Прочитай бриф ${ws.brief} полностью и все документы из его раздела «Входы». ${RULES}
Работай в своём git worktree на ветке ws/${ws.id.toLowerCase()}-${ws.slug} от main. Выполняй строго по tdd-protocol.md: сначала e2e-скелет страниц (${(ws.pages || []).join(', ') || 'нет страниц'}) в test.fixme, затем Red → Green → Refactor по единицам, коммиты по Conventional Commits.
Перед завершением выполни verification-protocol.md §1–§4 для каждой страницы, включая проходку через Playwright MCP (инструменты mcp__playwright__* через ToolSearch), сложи снимки в docs/plan/evidence/<page-key>/.
Напиши отчёт в docs/plan/reports/${ws.id}.md по формату orchestration.md §5 с дословным выводом прогонов тестов. Не меняй файлы вне границ брифа и не трогай design/. Если заблокирован — опиши блокер в отчёте, не обходи его.`

const verifyPrompt = (page, ws, report) => `Ты — независимый проверяющий страницы «${page}» (WS ${ws.id}). Ты НЕ видел работу исполнителя; у тебя есть только его отчёт ${report.reportPath} и бриф ${ws.brief}. ${RULES}
Перейди в worktree ветки ${report.branch}. Выполни verification-protocol.md заново: (1) запусти e2e для страницы на проектах mobile-390 и desktop-1440 и приложи вывод; (2) запусти визуальную сверку с эталоном на 127.0.0.1:4173 (подними tools/design-preview.js, если не поднят); (3) сделай проходку через Playwright MCP по §4 — сверь дерево доступности с инвентарём элементов из docs/plan/analysis/*.md, пройди сценарии и негативные проверки, три ширины, консоль, сеть; (4) axe. Ищи расхождения с эталоном по §7 придирчиво: подписи, иконки, порядок, состояния, тосты, диалоги. Положи снимки в docs/plan/evidence/${page}/verify/. Верни вердикт: accept только если всё четыре проверки пройдены и расхождений нет.`

const reviewPrompt = (ws, report, verdicts) => `Ты — ревьюер WS ${ws.id}. Используй скил requesting-code-review как чек-лист. Входы: бриф ${ws.brief}, отчёт ${report.reportPath}, вердикты проверяющих: ${JSON.stringify(verdicts)}. ${RULES}
Проверь в worktree ветки ${report.branch}: порядок коммитов test: → feat: по каждой единице; дословность подписей; соблюдение скилов golang-* и vercel-react-best-practices/heroui-react (см. docs/plan/analysis/12-prior-project-and-skills.md); отсутствие прямых вызовов api-client из компонентов; логи без запрещённых данных; миграции expand/contract; негативные тесты изоляции для каждого нового эндпоинта. Блокирующие замечания — только подтверждённые цитатой кода.`

const integratePrompt = (results) => `Ты — интегратор волны ${WAVE}. Результаты WS: ${JSON.stringify(results.map((r) => ({ ws: r.ws.id, branch: r.report && r.report.branch, verdicts: r.verdicts, review: r.review })))}. ${RULES}
Для каждого WS с review.verdict === 'approve' и всеми вердиктами 'accept' в порядке DAG из docs/plan/00-master-plan.md §6: git rebase main, разреши только механические конфликты (смысловые — верни WS с описанием), прогони npm run lint, npm run typecheck, npm run test, go -C backend test ./..., затем слей squash в main с тегом wave-${WAVE}-<ws>. После всех WS: npm run e2e на всех проектах и визуальная сверка. Обнови docs/plan/status.md. Верни список влитых WS, возвращённых WS с причинами, и вывод полного прогона.`

const criticPrompt = (integration) => `Ты — критик полноты волны ${WAVE}. Прочитай docs/plan/00-master-plan.md, docs/plan/status.md, docs/plan/analysis/00-coverage-critique.md, docs/plan/analysis/08-requirements.md и отчёты docs/plan/reports/*.md. Результат интеграции: ${JSON.stringify(integration).slice(0, 4000)}. Составь список: (а) экраны/диалоги/состояния из инвентаря, которые должны были войти в волну, но не реализованы или реализованы без e2e/MCP-проверки; (б) требования и AC, затронутые волной, без тестов; (в) контракты, изменённые без согласования. Запиши в docs/plan/critique/wave-${WAVE}.md и верни краткий список пропусков как массив строк.`

phase('Исполнение')
const results = await pipeline(
  WS,
  (ws) => agent(executePrompt(ws), { label: `ws:${ws.id}`, phase: 'Исполнение', schema: REPORT_SCHEMA, isolation: 'worktree' }).then((report) => ({ ws, report })),
  async (r) => {
    if (!r || !r.report) return r
    const verdicts = await parallel((r.ws.pages || []).map((page) => () => agent(verifyPrompt(page, r.ws, r.report), { label: `verify:${page}`, phase: 'Проверка страниц', schema: VERDICT_SCHEMA })))
    return { ...r, verdicts: verdicts.filter(Boolean) }
  },
  async (r) => {
    if (!r || !r.report) return r
    const n = Math.max(1, r.ws.reviewers || 1)
    const reviews = await parallel(Array.from({ length: n }, (_, i) => () => agent(reviewPrompt(r.ws, r.report, r.verdicts) + (n > 1 ? `\nТы ревьюер №${i + 1} из ${n}; ревьюер №2 смотрит прежде всего authz, миграции и финансы.` : ''), { label: `review:${r.ws.id}${n > 1 ? '#' + (i + 1) : ''}`, phase: 'Ревью', schema: REVIEW_SCHEMA })))
    const ok = reviews.filter(Boolean)
    return { ...r, review: ok.every((x) => x.verdict === 'approve') ? 'approve' : 'request-changes', reviews: ok }
  },
)

const settled = results.filter(Boolean)
log(`WS завершено: ${settled.length}/${WS.length}; approve: ${settled.filter((r) => r.review === 'approve').length}`)

phase('Интеграция')
const integration = await agent(integratePrompt(settled), { label: 'integrate', phase: 'Интеграция' })

phase('Критика')
const critique = await agent(criticPrompt(integration), { label: 'critic', phase: 'Критика', schema: { type: 'object', properties: { gaps: { type: 'array', items: { type: 'string' } } }, required: ['gaps'] } })

return { wave: WAVE, results: settled, integration, gaps: critique ? critique.gaps : [] }
