// Экспорт-лист модуля «База знаний» (`modules/knowledge/index.ts`). Интегратор подключает его одной
// строкой в `modules/index.ts`; имена (и значения, и типы) не пересекаются с общим барелем и с
// экспортом «Форм» W4.20 (снимок `forms-exports.test-util.ts`). Расширяется добавлением.
// Два `export *` ниже — та же проверка на уровне `tsc` (TS2308 при совпадении имени).
import { describe, expect, it } from 'vitest';
import { exportedNames } from './exports.test-util.ts';

export * from '../index.ts';
export * from './index.ts';

const at = (file: string): URL => new URL(file, import.meta.url);

const KNOWLEDGE_EXPORTS = [
  // модуль и сид
  'knowledgeModule',
  'createKnowledgeModule',
  'knowledgeHook',
  'knowledgeSeed',
  'migrateKnowledgeV2',
  // справочники
  'KB_ROLES',
  'KB_ROLE_ORDER',
  'KB_ROLE_CAPS',
  'KB_ACCESS',
  'KB_MODES',
  'KB_KINDS',
  'KB_STATUS',
  'KB_ICONS',
  'KB_COLORS',
  'KB_TEMPLATES',
  'KB_SECTION',
  'KB_MAX_DEPTH',
  'KB_BODY_MAX',
  'KB_RUNS_KEPT',
  'KB_REQUEST_DAYS',
  // дерево и подписи
  'kbNodeOf',
  'kbPath',
  'kbKids',
  'kbSubtree',
  'kbTop',
  'kbDepth',
  'kbHeight',
  'kbDval',
  'kbUnitName',
  'kbAreaLabel',
  'kbEntryLabel',
  // доступ и влияние
  'isKbOwner',
  'kbSpaceGrant',
  'kbEntryHas',
  'kbEntryPeople',
  'kbAccess',
  'kbReach',
  'kbEntryReach',
  'kbSpaceMy',
  'kbLeads',
  'kbImpact',
  'kbMoveImpact',
  // разделы, команды, проекция
  'kbNode',
  'kbEditors',
  'kbMakeSection',
  'KB_OBJ_42',
  'knowledgeCommands',
  'KB_METHODS',
  'KB_DELAYS',
  'kbView',
];

describe('экспорт-лист modules/knowledge', () => {
  it('модуль и его функции, ничего лишнего', async () => {
    const pkg = await import('./index.ts');
    expect(Object.keys(pkg).sort()).toEqual([...KNOWLEDGE_EXPORTS].sort());
    expect(KNOWLEDGE_EXPORTS).toHaveLength(50);
  });

  it('значения не пересекаются с @ortus/domain/modules (кроме самих себя после подключения)', async () => {
    const [pkg, modules] = await Promise.all([import('./index.ts'), import('../index.ts')]);
    const own = pkg as Record<string, unknown>;
    const taken = modules as Record<string, unknown>;
    expect(Object.keys(own).filter((k) => k in taken && taken[k] !== own[k])).toEqual([]);
  });

  it('имена типов и значений не пересекаются с барелем модулей и с «Формами» W4.20', async () => {
    const [kb, barrel, forms, modules] = await Promise.all([
      exportedNames(at('./index.ts')),
      exportedNames(at('../index.ts'), ['./knowledge/index.ts']),
      exportedNames(at('./forms-exports.test-util.ts')),
      import('../index.ts'),
    ]);
    // разбор исходника видит все значения, которые видит рантайм, и сверх них — типы; значения самой
    // базы знаний в рантайме барели есть (она подключена), а разбор в неё не спускается
    const others = Object.keys(modules).filter((k) => !KNOWLEDGE_EXPORTS.includes(k));
    expect(kb).toEqual(expect.arrayContaining(KNOWLEDGE_EXPORTS));
    expect(barrel).toEqual(expect.arrayContaining(others));
    expect(barrel.length).toBeGreaterThan(others.length);
    expect(kb.filter((n) => barrel.includes(n))).toEqual([]);
    expect(kb.filter((n) => forms.includes(n))).toEqual([]);
  });
});
