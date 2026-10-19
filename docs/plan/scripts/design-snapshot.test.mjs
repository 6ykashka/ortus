// Проверки снимка эталона design/ (полный экспорт 19.10, W4.00; главный файл — итерация 14.10) и анализов 01–04 (W0.02).
// Запуск: node --test "docs/plan/scripts/*.test.mjs"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const DESIGN = join(ROOT, 'design')
const ANALYSIS = join(ROOT, 'docs/plan/analysis')
const MAIN = join(DESIGN, 'Ортус CRM.dc.html')
const MANIFEST = join(DESIGN, 'MANIFEST.md')
const ANALYSES = ['01-shell.md', '02-company.md', '03-logistics.md', '04-platform.md']

const read = (p) => readFileSync(p, 'utf8')
const readIf = (p) => (existsSync(p) ? read(p) : '')
const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
const rel = (p) => relative(DESIGN, p).split('\\').join('/')
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const mainLines = () => read(MAIN).split('\n')

// Таблица «Файлы» манифеста: | `путь` | 19.10, 14.10 или 03.10 | байт | sha256 | в экспорте 19.10: да/нет |
function manifestRows() {
  const rows = new Map()
  for (const m of readIf(MANIFEST).matchAll(
    /^\| `([^`]+)` \| (19\.10|14\.10|03\.10) \| (\d+) \| ([0-9a-f]{64}) \| (да|нет) \|/gm,
  )) {
    rows.set(m[1], { from: m[2], size: Number(m[3]), sha: m[4], exported: m[5] === 'да' })
  }
  return rows
}
const dcImports = () => [...read(MAIN).matchAll(/<dc-import name="([^"]+)"/g)].map((m) => m[1] + '.dc.html')
const docFrames = () =>
  [...read(join(DESIGN, 'Документация.dc.html')).matchAll(/path: '([^']+\.dc\.html)'/g)].map((m) => m[1])
// Макеты-варианты полного экспорта 19.10 (MANIFEST.md экспорта, «Макеты-варианты»).
const VARIANTS = ['Задачи', 'Обращения', 'База знаний', 'Документы', 'Чаты', 'Касса', 'Объекты'].map(
  (n) => n + ' - варианты.dc.html',
)
function section(text, title) {
  const i = text.search(new RegExp('^#{2,3} ' + title, 'm'))
  if (i < 0) return ''
  const rest = text.slice(text.indexOf('\n', i) + 1)
  const j = rest.search(/^#{1,2} /m)
  return j < 0 ? rest : rest.slice(0, j)
}

test('манифест: каждый файл design/ указан с верным размером и SHA-256, лишних строк нет', () => {
  assert.ok(existsSync(MANIFEST), 'нет design/MANIFEST.md')
  const rows = manifestRows()
  const files = walk(DESIGN).map(rel).filter((p) => p !== 'MANIFEST.md')
  const missing = files.filter((p) => !rows.has(p))
  assert.deepEqual(missing, [], 'файлы без строки в манифесте')
  const extra = [...rows.keys()].filter((p) => !files.includes(p))
  assert.deepEqual(extra, [], 'строки манифеста без файла')
  const bad = files.filter((p) => {
    const r = rows.get(p)
    const abs = join(DESIGN, p)
    return statSync(abs).size !== r.size || sha256(abs) !== r.sha
  })
  assert.deepEqual(bad, [], 'размер или SHA-256 не совпадает с манифестом')
})

test('HTML эталона без служебных блоков data-omelette-injected', () => {
  const dirty = walk(DESIGN)
    .filter((p) => p.endsWith('.html'))
    .filter((p) => read(p).includes('data-omelette-injected'))
    .map(rel)
  assert.deepEqual(dirty, [])
})

test('состав 14.10: 8 dc-import, 10 файлов ortus/, docs/20…27', () => {
  const names = [...read(MAIN).matchAll(/<dc-import name="([^"]+)"/g)].map((m) => m[1])
  assert.equal(names.length, 8, 'ожидается 8 встроенных модулей: ' + names.join(', '))
  const ortus = readdirSync(join(DESIGN, 'ortus')).sort()
  assert.deepEqual(ortus, [
    'api.js', 'cash.js', 'chats.js', 'documents.js', 'extra-data.js',
    'knowledge.js', 'mock-data.js', 'models.js', 'roadmap.js', 'service.js',
  ])
  const docs = readdirSync(join(DESIGN, 'docs'))
  for (const n of [20, 21, 22, 23, 24, 25, 26, 27]) {
    assert.ok(docs.some((f) => f.startsWith(n + '-') && f.endsWith('.md')), `нет docs/${n}-*.md`)
  }
})

test('снимок 19.10 полный (B-1 закрыт): все dc-import, фреймы Документации и варианты есть в design/', () => {
  const absent = [...new Set([...dcImports(), ...docFrames(), ...VARIANTS])].filter((f) => !existsSync(join(DESIGN, f)))
  assert.deepEqual(absent, [], 'нет в design/')
  const text = readIf(MANIFEST)
  assert.match(text, /^# .*19\.10\.2026/m, 'заголовок манифеста — снимок 19.10.2026')
  assert.match(text, /\*\*полный\*\*/, 'статус снимка «полный»')
  assert.match(text, /B-1 закрыт/, 'нет отметки «B-1 закрыт»')
  assert.equal(section(text, 'Не хватает'), '', 'раздел «Не хватает» должен уйти вместе с B-1')
  const rows = manifestRows()
  assert.deepEqual(rows.get('Ремонт и стройка.dc.html')?.from, '19.10', '«Ремонт и стройка» — версия 19.10')
  const stale = [...dcImports(), ...VARIANTS].filter((f) => rows.get(f)?.from !== '19.10' || !rows.get(f)?.exported)
  assert.deepEqual(stale, [], 'модули и варианты должны быть из экспорта 19.10')
})

test('манифест: файлы вне экспорта 19.10 сохранены и отмечены «удалить — по слову пользователя»', () => {
  const rows = manifestRows()
  const outside = [...rows].filter(([, r]) => !r.exported).map(([p]) => p)
  for (const p of ['.thumbnail', 'Ortus CRM.dc.html']) assert.ok(outside.includes(p), p + ' не отмечен «нет» в экспорте')
  for (const d of ['uploads/', 'screenshots/']) {
    assert.ok(outside.some((p) => p.startsWith(d)), d + ' не отмечен «нет» в экспорте')
    assert.ok([...rows].filter(([p]) => p.startsWith(d)).every(([, r]) => !r.exported), d + ' не входит в экспорт')
  }
  const wrong = [...rows].filter(([, r]) => r.exported !== (r.from === '19.10')).map(([p]) => p)
  assert.deepEqual(wrong, [], 'итерация 19.10 ⇔ файл из экспорта 19.10')
  const sec = section(readIf(MANIFEST), 'Вне экспорта 19\\.10')
  assert.ok(sec, 'нет раздела «Вне экспорта 19.10»')
  assert.match(sec, /удалить — по слову пользователя/)
})

test('манифест: таблица «файл → как подключается → этап плана» из манифеста экспорта', () => {
  const sec = section(readIf(MANIFEST), 'Как подключается')
  assert.ok(sec, 'нет раздела «Как подключается»')
  assert.match(sec, /MANIFEST\.md/, 'нет ссылки на манифест экспорта')
  for (const f of dcImports()) {
    const name = f.replace(/\.dc\.html$/, '')
    assert.match(sec, new RegExp('^\\| `' + f + '` \\| `dc-import name="' + name + '"`[^|]*\\| \\d', 'm'), f)
  }
  assert.match(sec, /^\| `support\.js` \|/m)
  for (const f of VARIANTS) assert.match(sec, new RegExp('^\\| `' + f + '` \\| `docs/\\d\\d-', 'm'), f)
})

test('манифест: раздел «Изменения против 15.10» называет новые и изменённые файлы', () => {
  const sec = section(readIf(MANIFEST), 'Изменения против 15\\.10')
  assert.ok(sec, 'нет раздела «Изменения против 15.10»')
  const fresh = [...dcImports(), ...VARIANTS.filter((f) => !f.startsWith('Объекты')), 'README.md']
  assert.deepEqual(fresh.filter((f) => !sec.includes('`' + f + '`')), [])
})

test('Документация.dc.html ссылается только на существующие docs/…', () => {
  const paths = [...read(join(DESIGN, 'Документация.dc.html')).matchAll(/path: '(docs\/[^']+)'/g)].map((m) => m[1])
  assert.ok(paths.length >= 40, 'ожидается ≥ 40 документов, найдено ' + paths.length)
  assert.deepEqual(paths.filter((p) => !existsSync(join(DESIGN, p))), [])
})

// Строка-якорь должна определять идентификатор, а не просто содержать его подстрокой:
// `ident(` в начале строки (метод), `const|let|var|function ident`, `ident:` / `ident =`.
function isDefinitionLine(line, ident) {
  const id = ident.replace(/\(.*$/, '').split('.').pop().replace(/[$]/g, '\\$&')
  const def = new RegExp(
    '^\\s*(?:export\\s+)?(?:async\\s+)?(?:(?:const|let|var|function)\\s+)?' + id + '\\s*(?:\\(|=(?!=)|:)',
  )
  return def.test(line)
}

test('isDefinitionLine: определение, а не подстрока', () => {
  const yes = [
    ['    go(p, page) {', 'go'],
    ['  const pg = { modules: false };', 'pg'],
    ['export function can(db, memberId, mod, verb, unitId) {', 'can'],
    ['export const moduleOn = (db, key) => true;', 'moduleOn'],
    ['function view() {', 'view'],
    ['  setModule: (key, enabled) => cmd(() => {', 'setModule'],
    ['const assertLogisticsFor = (t, verb) => {', 'assertLogisticsFor'],
    ['    renderVals() {', 'M.renderVals'],
  ]
  const no = [
    ['    const category = cat.go;', 'go'],
    ['    this.go(persona, page);', 'go'],
    ['  if (pg.fleet) return x;', 'pg'],
    ['  return M.can(db, mid, "x");', 'can'],
    ['  const preview = view;', 'view'],
    ['  // setModule вызывается ниже', 'setModule'],
    ['  const canEdit = true;', 'can'],
  ]
  assert.deepEqual(yes.filter(([l, id]) => !isDefinitionLine(l, id)), [], 'определения не распознаны')
  assert.deepEqual(no.filter(([l, id]) => isDefinitionLine(l, id)), [], 'подстрока принята за определение')
})

// «Якоря снимка 14.10»: | `идентификатор` | `:N` или `файл.js:N` |
function anchors(text) {
  const sec = section(text, 'Якоря снимка 14\\.10')
  return [...sec.matchAll(/^\| `([^`]+)` \| `([\w.\-]*):(\d+)` \|/gm)].map((m) => ({
    ident: m[1],
    file: m[2] || null,
    line: Number(m[3]),
  }))
}

for (const name of ANALYSES) {
  test(`${name}: якоря снимка 14.10 указывают на строки с идентификатором`, () => {
    const text = read(join(ANALYSIS, name))
    const list = anchors(text)
    assert.ok(list.length >= 5, 'нужно ≥ 5 якорей, найдено ' + list.length)
    const bad = list.filter(({ ident, file, line }) => {
      const src = file ? join(DESIGN, 'ortus', file) : MAIN
      if (!existsSync(src)) return true
      const l = read(src).split('\n')[line - 1] || ''
      return !isDefinitionLine(l, ident)
    })
    assert.deepEqual(bad, [])
  })

  test(`${name}: ссылки на строки в заголовках только в обратных кавычках`, () => {
    const bare = read(join(ANALYSIS, name))
      .split('\n')
      .filter((l) => /^#{2,4} /.test(l))
      .filter((l) => {
        const rest = l.replace(/^#{2,4} [\d.]+\s*/, '').replace(/`[^`]*`/g, '')
        return /\bhtml:\d/.test(rest) || /(?<![\w.§:-])\d{2,5}–\d{1,5}(?![\w.])/.test(rest)
      })
    assert.deepEqual(bare, [], 'ссылки «N–M» / «html:N» вне `…` не проверяются тестами заголовков и границ')
  })

  test(`${name}: заголовки «\`ident\` (\`:N–M\`)» попадают в главный файл 14.10`, () => {
    const L = mainLines()
    const text = read(join(ANALYSIS, name))
    const bad = []
    for (const line of text.split('\n')) {
      if (!/^#{2,4} /.test(line)) continue
      const spans = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1])
      const idents = []
      const ranges = []
      for (const s of spans) {
        if (/^[A-Za-z_$][\w$.]*(\(.*\))?$/.test(s) && !/\.(js|md|html|yaml|sql|css)$/.test(s)) {
          idents.push(s.replace(/\(.*$/, '').split('.').pop())
          continue
        }
        for (const m of s.matchAll(/(?:^|[\s,(])(?<![\w.]):(\d+)(?:–(\d+))?((?:,\s*\d+(?:–\d+)?)*)/g)) {
          ranges.push([+m[1], +(m[2] || m[1])])
          for (const c of (m[3] || '').matchAll(/(\d+)(?:–(\d+))?/g)) ranges.push([+c[1], +(c[2] || c[1])])
        }
      }
      if (!idents.length || !ranges.length) continue
      const hit = idents.some((id) =>
        ranges.some(([a, b]) => L.slice(Math.max(0, a - 3), b + 2).some((x) => x.includes(id))),
      )
      if (!hit) bad.push(line)
    }
    assert.deepEqual(bad, [])
  })

  test(`${name}: ссылки \`:N\` не выходят за длину главного файла 14.10`, () => {
    const n = mainLines().length
    const text = read(join(ANALYSIS, name))
    const over = []
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      for (const r of m[1].matchAll(/(?:^|[\s(,[])(?<![\w.]):(\d{1,5})(?:–(\d{1,5}))?(?![\w%])/g)) {
        if (+r[1] > n || +(r[2] || 0) > n) over.push(m[1])
      }
    }
    assert.deepEqual(over, [])
  })
}

test('01-shell: меню по D-23, AccessGate в режиме чтения, «Главная» как реестр источников', () => {
  const t = read(join(ANALYSIS, '01-shell.md'))
  for (const s of ['Снимок эталона: 14.10.2026', 'Отключены · только чтение', 'D-23', 'module_readonly', 'реестр источников', 'CORE_ITEMS', 'Подотчёт', 'repairSupply', 'repairCatalog', 'RO_TEXT', "type: 'account'"]) {
    assert.ok(t.includes(s), '01-shell.md не содержит: ' + s)
  }
})

test('02-company: области «Касса» и «Проект», блок кассы в роли, диалог отключения', () => {
  const t = read(join(ANALYSIS, '02-company.md'))
  for (const s of ['Снимок эталона: 14.10.2026', 'Касса · остаток и лимиты', 'cash.balance.read', 'cash.advance.self', "type: 'account'", "type: 'project'", 'menu_open', 'r-pm', 'PD-53']) {
    assert.ok(t.includes(s), '02-company.md не содержит: ' + s)
  }
})

test('03-logistics: предложения в «Кассу», меню при отключённой логистике', () => {
  const t = read(join(ANALYSIS, '03-logistics.md'))
  for (const s of ['Снимок эталона: 14.10.2026', 'cashPostProposal', 'Отключены · только чтение', 'D-23', 'r-exec']) {
    assert.ok(t.includes(s), '03-logistics.md не содержит: ' + s)
  }
})

test('04-platform: снимок 14.10 без функциональных изменений', () => {
  const t = read(join(ANALYSIS, '04-platform.md'))
  for (const s of ['Снимок эталона: 14.10.2026', 'функциональных изменений нет']) {
    assert.ok(t.includes(s), '04-platform.md не содержит: ' + s)
  }
})

test('design-requests.md: 7 экранов B-6 с видом no-reference', () => {
  const p = join(ROOT, 'docs/plan/v2/design-requests.md')
  assert.ok(existsSync(p), 'нет docs/plan/v2/design-requests.md')
  const t = read(p).toLowerCase()
  for (const s of ['oidc', 'принятие приглашения', 'переключатель бизнеса', 'входящие', 'хранилище', 'импорт csv', 'очередь блокирующих дефектов', 'no-reference', 'b-6']) {
    assert.ok(t.includes(s), 'design-requests.md не содержит: ' + s)
  }
})

test('tools/README.md: дата и состав снимка 14.10', () => {
  const t = read(join(ROOT, 'tools/README.md'))
  assert.ok(t.includes('14.10.2026'), 'нет даты снимка 14.10.2026')
  assert.ok(t.includes('design/MANIFEST.md'), 'нет ссылки на design/MANIFEST.md')
  assert.doesNotMatch(t, /^Не хватает[^\n]*7 модульных/m, 'строка «Не хватает…» устарела после B-1')
  assert.match(t, /19\.10\.2026[^\n]*B-1 закрыт|B-1 закрыт[^\n]*19\.10\.2026/, 'нет отметки о полном экспорте 19.10')
})

// Обход старой поломки design-preview.js (копия .cjs + абсолютный путь) после W0.05 не работает:
// скрипт стал ESM и принимает относительный путь. Манифест уходит в замороженный тег design-stage-1.
const STALE_PREVIEW = [/\.cjs\b/, /require is not defined/, /абсолютн\S* пут/i, /<абсолютный путь>/]

test('MANIFEST «Как открыть»: актуальная команда design-preview.js (W0.05), без обхода .cjs', () => {
  const how = section(readIf(MANIFEST), 'Как открыть')
  assert.ok(how, 'нет раздела «Как открыть»')
  assert.match(how, /node tools\/design-preview\.js design 4173(?!\d)/)
  assert.match(how, /--offline/)
  assert.match(how, /--ref design-stage-1/)
  assert.match(how, /--ref design-2026-10-19/)
  assert.deepEqual(STALE_PREVIEW.filter((re) => re.test(how)).map(String), [])
})

test('tools/README.md: без устаревшего обхода design-preview.js', () => {
  const t = read(join(ROOT, 'tools/README.md'))
  assert.deepEqual(STALE_PREVIEW.filter((re) => re.test(t)).map(String), [])
})
