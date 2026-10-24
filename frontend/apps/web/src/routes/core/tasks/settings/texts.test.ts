// W4.13 · Подписи вкладок «Участники», «Процесс», «Автоматизация» дословно из эталона design-2026-10-19
// «Задачи и проекты.dc.html» (:197–311, логика :439–489): каждая статическая подпись и каждый неподставляемый кусок
// шаблона есть в модульном файле или в справочниках ortus/models.js. Без эталона — только TEXT_NO_REFERENCE (PD-60).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TEXT_NO_REFERENCE, TS } from './texts.ts';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const ROOT = '../../../../../../../../design/';
const REFERENCE = [
  read(`${ROOT}Задачи и проекты.dc.html`),
  read(`${ROOT}ortus/models.js`),
  read(`${ROOT}ortus/api.js`),
].join('\n');

function leaves(tree: unknown, path = 'TS'): [string, string][] {
  if (typeof tree === 'string') return [[path, tree]];
  if (tree && typeof tree === 'object') {
    return Object.entries(tree).flatMap(([k, v]) => leaves(v, `${path}.${k}`));
  }
  return [];
}

/** Подпись или шаблон: каждый кусок между {подстановками} длиннее 2 знаков — дословно в эталоне. */
const inReference = (t: string): boolean =>
  t
    .split(/\{[a-z]+\}/i)
    .map((x) => x.trim())
    .filter((x) => x.length > 2)
    .every((x) => REFERENCE.includes(x));

describe('texts вкладок проекта: дословно из эталона', () => {
  const all = leaves(TS);

  it('словарь не пустой', () => expect(all.length).toBeGreaterThan(60));

  it('каждая подпись — из эталона, иначе в TEXT_NO_REFERENCE', () => {
    expect(
      all.filter(([p, v]) => !inReference(v) && !TEXT_NO_REFERENCE.includes(p)).map(([p]) => p),
    ).toEqual([]);
  });

  it('TEXT_NO_REFERENCE — существующие пути словаря; «Закрытый» — без «и владелец бизнеса» (TP-03)', () => {
    const paths = new Map(all);
    expect(TEXT_NO_REFERENCE.filter((p) => !paths.has(p))).toEqual([]);
    expect(REFERENCE).toContain('Только участники проекта и владелец бизнеса');
    expect(TS.access.desc.closed).toBe('Только участники проекта');
  });

  it('ключевые подписи эталона', () => {
    expect(TS.tabs).toEqual({
      board: 'Доска',
      people: 'Участники',
      workflow: 'Процесс',
      automation: 'Автоматизация',
    });
    expect(TS.access.levels).toEqual({
      open: 'Открытый',
      limited: 'Ограниченный',
      closed: 'Закрытый',
    });
    expect(TS.people.note).toBe(
      'Роль в проекте — это назначение роли с областью «проект»; оно видно и в «Пользователях и ролях». Унаследованный доступ (замок) меняется только там.',
    );
    expect(TS.workflow.panel.whoNote).toBe('Ничего не выбрано — любой с правом «Менять статус».');
    expect(TS.automation.note).toBe(
      'Правило работает от вашего имени: при каждом запуске проверяется ваше право менять задачи в проекте. Изменения, сделанные правилом, другие правила не запускают.',
    );
  });
});
