// W1.23 · Фокус после закрытия диалога, когда кнопки-источника больше нет (возврат 16.10 №3, WCAG 2.4.3,
// verification-protocol §1.3). React Aria возвращает фокус на кнопку, которая открыла диалог, в кадре после
// размонтирования диалога; если кнопка исчезла (получатель стал владельцем, группа удалена, диалог открыт по
// адресу), фокус остаётся на body и Escape уже ничего не закрывает. Помощники ждут, пока диалог уйдёт из DOM, и
// ещё три кадра (возврат React Aria успевает), а затем, если фокус потерян, ставят его на запасную цель.
import type { RefObject } from 'react';

/** Фокус потерян: на body или нигде. */
const lost = (): boolean => !document.activeElement || document.activeElement === document.body;

/** Сколько кадров ждать ухода диалога из DOM (защита от вечного ожидания). */
const MAX_FRAMES = 120;
/** Кадров после ухода диалога: возврат фокуса React Aria — через один кадр. */
const SETTLE_FRAMES = 3;

/** Выполнить `fn`, когда `from` (диалог) ушёл из DOM и прошло ещё несколько кадров; возвращает отмену. */
function afterRestore(fn: () => void, from?: Element | null): () => void {
  let id = 0;
  let frames = 0;
  let settled = 0;
  const tick = () => {
    frames += 1;
    if (from?.isConnected && frames < MAX_FRAMES) {
      id = requestAnimationFrame(tick);
      return;
    }
    settled += 1;
    if (settled < SETTLE_FRAMES) {
      id = requestAnimationFrame(tick);
      return;
    }
    fn();
  };
  id = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(id);
}

/** Диалог, в котором сейчас фокус (закрывается он сам или вложенный в него). */
const focusedDialog = (): Element | null =>
  document.activeElement?.closest('[role="dialog"], [role="alertdialog"]') ?? null;

/**
 * Вложенный диалог закрыт: если кнопки-источника `source` больше нет или фокус не в диалоге элемента `target` —
 * перевести фокус на `target`.
 */
export function refocusInside(
  target: RefObject<HTMLElement | null>,
  source: HTMLElement | null,
): () => void {
  return afterRestore(() => {
    const el = target.current;
    const scope = el?.closest('[role="dialog"]');
    const outside = lost() || !scope?.contains(document.activeElement);
    if (el && (outside || !source?.isConnected)) el.focus();
  });
}

/** Диалог страницы закрывается: если после этого фокус потерян — перевести на `pick()` (запасная цель). */
export function refocusIfLost(pick: () => HTMLElement | null | undefined): () => void {
  return afterRestore(() => {
    if (lost()) pick()?.focus();
  }, focusedDialog());
}
