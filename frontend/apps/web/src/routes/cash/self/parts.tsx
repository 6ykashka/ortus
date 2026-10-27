// W5.33 · Части страницы «Мой подотчёт» по рендеру эталона (PD-28): символ Material, чип срока, ошибка диалога,
// помощники ошибок команд и ввода суммы.
import { ProblemError } from '@ortus/api-client';
import type { ReactElement } from 'react';

import { problemText } from '../../../shell/run.tsx';
import type { Chip as ChipModel } from './model.ts';

/** Лигатура Material Symbols любого кегля эталона (Icon @ortus/ui — только шкала 15–32). */
export function Sym({ name, size }: { name: string; size: number }): ReactElement {
  return (
    <span className="material-symbols-rounded" aria-hidden="true" style={{ fontSize: size }}>
      {name}
    </span>
  );
}

export function Chip({ chip }: { chip: ChipModel }): ReactElement {
  return (
    <span className="ox-cs-chip" data-tone={chip.tone}>
      <Sym name={chip.icon} size={15} />
      {chip.text}
    </span>
  );
}

/** Ошибка внутри диалога (эталон :510): красная плашка, `role="alert"`. */
export function DialogError({ text }: { text: string }): ReactElement {
  return (
    <div role="alert" className="ox-cs-err">
      <Sym name="error" size={18} />
      <span>{text}</span>
    </div>
  );
}

/** Текст ошибки команды: первое нарушение валидации, подробность сервера или текст по коду. */
export function problemMessage(e: unknown): string {
  if (e instanceof ProblemError) {
    const violation = e.problem?.violations?.[0]?.message;
    if (e.code === 'validation_failed' && violation) return violation;
    if (e.problem?.detail) return e.problem.detail;
  }
  return problemText(e);
}

/** Коды, которые показывает диалог (тоста нет). */
export const DIALOG_CODES = [
  'validation_failed',
  'insufficient_funds',
  'invalid_transition',
  'conflict',
  'duplicate_receipt',
] as const;

/** Копейки → ввод суммы в рублях без лишних нулей: 40000 → «400», 126050 → «1260,5». */
export const minorToInput = (minor: number): string => String(minor / 100).replace('.', ',');
