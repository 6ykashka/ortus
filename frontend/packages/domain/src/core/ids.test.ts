import { describe, expect, it } from 'vitest';
import { createIdGen } from './ids.ts';

describe('IdGen поверх общего db.seq', () => {
  it('повторяет схемы эталона: e<seq>, R-(1040+seq), T-(60+seq), KEY-(100+seq)', () => {
    const db = { seq: 100 };
    const ids = createIdGen(db);
    expect(ids.next('e')).toBe('e100');
    expect(ids.next('R-', 1040)).toBe('R-1141');
    expect(ids.next('T-', 60)).toBe('T-162');
    expect(ids.next('LOG-', 100)).toBe('LOG-203');
    expect(db.seq).toBe(104);
    expect(ids.peek()).toBe(104);
  });

  it('читает текущую БД через функцию: смена организации меняет счётчик', () => {
    const alta = { seq: 100 };
    const lotos = { seq: 500 };
    let cur = alta;
    const ids = createIdGen(() => cur);
    expect(ids.next('kb-')).toBe('kb-100');
    cur = lotos;
    expect(ids.next('kb-')).toBe('kb-500');
    expect(alta.seq).toBe(101);
    expect(lotos.seq).toBe(501);
  });

  it('два генератора на одной БД не выдают одинаковых id', () => {
    const db = { seq: 1 };
    const a = createIdGen(db);
    const b = createIdGen(() => db);
    const got = [a.next('x'), b.next('x'), a.next('x'), b.next('x')];
    expect(new Set(got).size).toBe(4);
  });
});
