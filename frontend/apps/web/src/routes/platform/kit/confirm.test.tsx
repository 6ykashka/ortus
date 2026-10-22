// W4.61 · Диалог opConfirm (kit/confirm.tsx; opConfirm :2800–2802, modalVM :3970–3981 эталона design-2026-10-19):
// Escape и подложка закрывают, фокус-ловушка по Tab и Shift+Tab, возврат фокуса на открывшую кнопку (PD-29),
// «Выполняем…» и блокировка кнопок во время команды, отказ команды оставляет диалог открытым, успех — закрывает.
// Возврат 1: у компонента не было своего red-коммита (он пришёл в 145a7b44 вместе с заглушкой модели «Заявок»).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { type ConfirmSpec, useConfirm } from './confirm.tsx';

afterEach(() => cleanup());

const SPEC: ConfirmSpec = {
  title: 'Отменить версию v3?',
  text: 'Она ещё не начала действовать.',
  items: [
    { icon: 'undo', tone: 'info', text: 'Цены v2 продолжат действовать без даты окончания' },
    { icon: 'history', tone: 'neutral', text: 'Отмена записывается в журнал' },
  ],
  confirmLabel: 'Отменить версию',
  tone: 'danger',
};

interface Deferred {
  promise: Promise<unknown>;
  resolve: () => void;
  reject: (e: unknown) => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((ok, fail) => {
    resolve = () => ok(undefined);
    reject = fail;
  });
  return { promise, resolve, reject };
}

function Harness({ action }: { action: () => Promise<unknown> }): ReactElement {
  const confirm = useConfirm();
  return (
    <div className="ox-frame">
      <button type="button" onClick={() => confirm.ask(SPEC, action)}>
        Открыть
      </button>
      {confirm.node}
    </div>
  );
}

function open(action: () => Promise<unknown> = () => Promise.resolve()): HTMLElement {
  render(<Harness action={action} />);
  const opener = screen.getByRole('button', { name: 'Открыть' });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

const dialog = () => screen.queryByRole('dialog', { name: 'Отменить версию v3?' });
const tab = (shiftKey = false) =>
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: 'Tab',
    shiftKey,
  });

describe('kit/confirm — диалог opConfirm', () => {
  it('заголовок, текст, «Последствия», «Отмена» и опасное действие; фокус на диалоге', () => {
    open();
    const d = dialog();
    expect(d).not.toBeNull();
    expect(d?.getAttribute('aria-modal')).toBe('true');
    expect(d?.textContent).toContain('Она ещё не начала действовать.');
    expect(d?.textContent).toContain('Последствия');
    expect([...(d?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual([
      'undoЦены v2 продолжат действовать без даты окончания',
      'historyОтмена записывается в журнал',
    ]);
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeTruthy();
    const ok = screen.getByRole('button', { name: 'Отменить версию' });
    expect(ok.dataset.danger).toBe('true');
    expect(document.activeElement).toBe(d);
  });

  it('Escape закрывает диалог, фокус возвращается на открывшую кнопку', () => {
    const opener = open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('«Отмена» и щелчок по подложке закрывают диалог', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(dialog()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    const backdrop = dialog()?.parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(dialog()).toBeNull();
  });

  it('ловушка фокуса: Tab с последней кнопки — на первую, Shift+Tab с первой — на последнюю', () => {
    open();
    const cancel = screen.getByRole('button', { name: 'Отмена' });
    const ok = screen.getByRole('button', { name: 'Отменить версию' });
    ok.focus();
    tab();
    expect(document.activeElement).toBe(cancel);
    tab(true);
    expect(document.activeElement).toBe(ok);
  });

  it('фокус вне диалога: Tab возвращает его на первую кнопку, Shift+Tab — на последнюю', () => {
    const opener = open();
    opener.focus();
    tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Отмена' }));
    opener.focus();
    tab(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Отменить версию' }));
  });

  it('во время команды — «Выполняем…», кнопки закрыты, Escape не закрывает; успех закрывает', async () => {
    const d = deferred();
    const opener = open(() => d.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Отменить версию' }));
    const busy = screen.getByRole('button', { name: 'Выполняем…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Отмена' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(dialog()?.getAttribute('aria-busy')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dialog()).not.toBeNull();
    await act(async () => {
      d.resolve();
      await d.promise;
    });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('отказ команды оставляет диалог открытым: кнопки снова доступны, фокус на действии', async () => {
    const d = deferred();
    open(() => d.promise);
    const action = screen.getByRole('button', { name: 'Отменить версию' });
    action.focus();
    fireEvent.click(action);
    // Браузер снимает фокус с кнопки, которая стала disabled: он уходит на body.
    (document.activeElement as HTMLElement).blur();
    await act(async () => {
      d.reject(new Error('отказ'));
      await d.promise.catch(() => undefined);
    });
    expect(dialog()).not.toBeNull();
    const ok = screen.getByRole('button', { name: 'Отменить версию' }) as HTMLButtonElement;
    expect(ok.disabled).toBe(false);
    expect(dialog()?.hasAttribute('aria-busy')).toBe(false);
    expect(document.activeElement).toBe(ok);
  });
});
