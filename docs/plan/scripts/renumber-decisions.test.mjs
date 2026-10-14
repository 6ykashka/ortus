// Тесты перенумерации решений плана: D-13…D-52 → PD-13…PD-52 (W0.00).
// Запуск: node --test "docs/plan/scripts/*.test.mjs" (каталог без glob на Windows даёт MODULE_NOT_FOUND)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renumber, MAPPING, targetFiles } from './renumber-decisions.mjs'

test('решения плана D-13, D-24, D-52 получают префикс PD-', () => {
  assert.equal(renumber('см. D-13, D-24 и D-52.').text, 'см. PD-13, PD-24 и PD-52.')
})

test('решения комплекта D-01…D-12 не меняются', () => {
  const src = 'D-01…D-12, D-03, D-05 и D-08, D-10, D-12'
  assert.equal(renumber(src).text, src)
})

test('диапазон D-13…D-24 становится PD-13…PD-24', () => {
  assert.equal(renumber('решения D-13…D-24 и D-25…D-52').text, 'решения PD-13…PD-24 и PD-25…PD-52')
})

test('повторный прогон ничего не меняет (идемпотентность)', () => {
  const once = renumber('D-15, `D-44`, (D-41)').text
  const twice = renumber(once)
  assert.equal(once, 'PD-15, `PD-44`, (PD-41)')
  assert.equal(twice.text, once)
  assert.equal(twice.count, 0)
})

test('чужие идентификаторы не трогаются: D-ID, D-130, XD-13, AD-13, D-1', () => {
  const src = 'обязательный D-ID/Q-ID; D-130; XD-13; AD-13; D-1; WD-13'
  assert.equal(renumber(src).text, src)
})

test('кандидат D-53 из WS-14 становится PD-61 (PD-53…PD-60 заняты планом v2 §7)', () => {
  assert.equal(renumber('кандидат решения «D-53: deep link»').text, 'кандидат решения «PD-61: deep link»')
  assert.equal(MAPPING.get('D-53'), 'PD-61')
})

test('значение атрибута data-a11y-extra="D-29" переименовывается', () => {
  assert.equal(renumber('`data-a11y-extra="D-29"`').text, '`data-a11y-extra="PD-29"`')
})

test('счётчик замен считает каждое упоминание', () => {
  assert.equal(renumber('D-13 D-13 D-14 D-01').count, 3)
})

test('блок <!-- renumber:off --> … <!-- renumber:on --> не меняется (ссылки на комплект и «было»)', () => {
  const src = [
    'D-15 до блока',
    '<!-- renumber:off -->',
    'D-01…D-28 комплекта и кандидаты D-29…D-34; было D-13…D-52',
    '<!-- renumber:on -->',
    'D-44 после блока',
  ].join('\n')
  const { text, count } = renumber(src)
  assert.equal(count, 2)
  assert.equal(
    text,
    [
      'PD-15 до блока',
      '<!-- renumber:off -->',
      'D-01…D-28 комплекта и кандидаты D-29…D-34; было D-13…D-52',
      '<!-- renumber:on -->',
      'PD-44 после блока',
    ].join('\n'),
  )
})

test('незакрытый блок renumber:off защищает текст до конца файла', () => {
  const src = 'D-15\n<!-- renumber:off -->\nD-16'
  assert.equal(renumber(src).text, 'PD-15\n<!-- renumber:off -->\nD-16')
})

test('таблица соответствия: 40 решений + кандидат, номер сохраняется', () => {
  assert.equal(MAPPING.size, 41)
  for (let n = 13; n <= 52; n++) assert.equal(MAPPING.get(`D-${n}`), `PD-${n}`)
})

test('область: протоколы, журнал, ws, drafts, analysis; без docs/plan/v2', () => {
  const files = targetFiles().map((f) => f.replace(/\\/g, '/'))
  for (const must of [
    'docs/plan/decisions.md',
    'docs/plan/00-master-plan.md',
    'docs/plan/README.md',
    'docs/plan/orchestration.md',
    'docs/plan/tdd-protocol.md',
    'docs/plan/verification-protocol.md',
    'docs/plan/workflow.template.js',
    'docs/plan/status.md',
    'docs/plan/ws/WS-14-modals-people.md',
    'docs/plan/drafts/draft-A.md',
    'docs/plan/analysis/09-data-permissions-errors.md',
  ]) assert.ok(files.includes(must), `нет ${must}`)
  assert.ok(!files.some((f) => f.includes('/v2/')), 'docs/plan/v2 не должен попадать в область')
  assert.ok(!files.some((f) => f.includes('/scripts/')), 'скрипты не переписываются')
})
