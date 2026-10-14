// Детерминированные id поверх общего счётчика организации `db.seq` (B §5.2 `ids.ts`).
// Эталон собирает id как `prefix + (base + db.seq++)`: `'e' + seq`, `'R-' + (1040 + seq)`,
// `'T-' + (60 + seq)`, `key + '-' + (100 + seq)`, `'kb-' + seq`. Случайных id в домене нет.

export interface SeqHolder {
  seq: number;
}

export interface IdGen {
  /** Следующий id: `prefix + (base + seq)`, счётчик растёт на 1. */
  next(prefix: string, base?: number): string;
  /** Текущее значение счётчика без изменения. */
  peek(): number;
}

export function createIdGen(holder: SeqHolder | (() => SeqHolder)): IdGen {
  const get = typeof holder === 'function' ? holder : () => holder;
  return {
    next(prefix, base = 0) {
      const h = get();
      const n = h.seq;
      h.seq = n + 1;
      return prefix + String(base + n);
    },
    peek: () => get().seq,
  };
}
