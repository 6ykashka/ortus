// Публичный экспорт «Документов · ядро»: имена не пересекаются с соседними модулями пилота.
import { describe, expect, it } from 'vitest';
import * as docs from './index.ts';

describe('экспорт docs/core', () => {
  it('функции, справочники и модуль', async () => {
    for (const name of [
      'docAccess',
      'docRights',
      'finSees',
      'protEdit',
      'engineCfg',
      'docPeople',
      'docShareImpact',
      'docMoveImpact',
      'docWaits',
      'docStatus',
      'stepWaiting',
      'fieldVals',
      'fillTokens',
      'docsSeed',
      'installDocs',
      'docsView',
      'docsCoreModule',
      'createDocsCoreModule',
      'docsHook',
      'addWorkDays',
      'shaOf',
      'DOC_LEVELS',
      'DOC_ROLES',
      'DOC_TEMPLATES',
    ]) {
      expect(docs, name).toHaveProperty(name);
    }
  });

  it('общие имена эталона с префиксом: нет голых entryLabel и unitName', () => {
    expect(docs).toHaveProperty('docEntryLabel');
    expect(docs).toHaveProperty('docUnitName');
    expect(docs).not.toHaveProperty('entryLabel');
    expect(docs).not.toHaveProperty('unitName');
  });

  it('экспорт не пересекается с модулями пилота', async () => {
    const others = await import('../../index.ts');
    const mine = Object.keys(docs);
    const clash = mine.filter((k) => k in others && !k.startsWith('doc'));
    expect(clash).toEqual([]);
  });
});
