// W1.23 · Подписи «Пользователей и ролей» без эталона: идентификаторы решений и вопросов плана (PD-53, Q-…)
// в видимый текст не попадают (возврат 16.10 №1).
import { describe, expect, it } from 'vitest';

import { PEOPLE_TEXT } from './texts.ts';

const strings = (v: unknown): string[] =>
  typeof v === 'string'
    ? [v]
    : v && typeof v === 'object'
      ? Object.values(v as Record<string, unknown>).flatMap(strings)
      : [];

describe('PEOPLE_TEXT', () => {
  it('без ID решений и вопросов плана', () => {
    expect(strings(PEOPLE_TEXT).filter((s) => /\b(PD|RS|Q|D|B)-\d+/.test(s))).toEqual([]);
  });

  // Возврат 16.10 №2 (minor): подписи вариантов «Области» приглашения и «через группу» — в текстах, не в коде.
  it('подписи областей приглашения и основания «через группу»', () => {
    expect(PEOPLE_TEXT.scope.regionAll).toBe('{region} · весь регион');
    expect(PEOPLE_TEXT.scope.regionFirm).toBe('{region} / {firm}');
    expect(PEOPLE_TEXT.viaGroup).toBe('группу «{group}»');
    expect(PEOPLE_TEXT.explain.subtitle).toBe('{name} · {action}');
  });
});
