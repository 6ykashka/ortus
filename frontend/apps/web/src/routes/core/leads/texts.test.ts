// W4.13 · Подписи старой доски «Заявки» дословно из эталона design-2026-10-19 «Ортус CRM.dc.html» (:1600–1705,
// tasksVM :4443–4504): каждая статическая подпись и каждый неподставляемый кусок шаблона есть в главном файле.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TL } from './texts.ts';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const REFERENCE = read('../../../../../../../design/Ортус CRM.dc.html');

function leaves(tree: unknown, path = 'TL'): [string, string][] {
  if (typeof tree === 'string') return [[path, tree]];
  if (tree && typeof tree === 'object') {
    return Object.entries(tree).flatMap(([k, v]) => leaves(v, `${path}.${k}`));
  }
  return [];
}

const inReference = (t: string): boolean =>
  t
    .split(/\{[a-z]+\}/i)
    .map((x) => x.trim())
    .filter((x) => x.length > 2)
    .every((x) => REFERENCE.includes(x));

describe('texts «Заявок»: дословно из эталона', () => {
  const all = leaves(TL);

  it('словарь не пустой', () => expect(all.length).toBeGreaterThan(30));

  it('каждая подпись — из главного файла эталона', () => {
    expect(all.filter(([, v]) => !inReference(v)).map(([p]) => p)).toEqual([]);
  });

  it('ключевые подписи эталона', () => {
    expect(TL.back).toBe('Все проекты');
    expect(TL.note).toBe(
      'Заявки — проект модуля «Задачи» со своими этапами: те же исполнители, сроки, чек-листы, комментарии и уведомления. Этап «Объект» создаёт объект в «Ремонт и стройка».',
    );
    expect(TL.footer).toBe(
      'Статус меняется только разрешёнными переходами процесса. «Готово» недоступно, пока в чек-листе есть невыполненные пункты. Перетаскивание в канбане появится позже как дополнение к кнопкам.',
    );
    expect(TL.readOnly).toBe('Нет права «Изменять» в модуле «Задачи»');
  });
});
