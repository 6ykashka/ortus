// W7.25 возврат 1 · useWidth подписывается, даже если элемент монтируется позже первого рендера (скелет загрузки).
import { act, render, screen } from '@testing-library/react';
import { type ReactElement, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWidth } from './list.tsx';

type Cb = (e: { contentRect: { width: number } }[]) => void;
const observers: { cb: Cb; els: Element[] }[] = [];

class FakeRO {
  private rec: { cb: Cb; els: Element[] };
  constructor(cb: Cb) {
    this.rec = { cb, els: [] };
    observers.push(this.rec);
  }
  observe(el: Element): void {
    this.rec.els.push(el);
  }
  disconnect(): void {
    this.rec.els = [];
  }
  unobserve(): void {}
}

function Probe(p: { ready: boolean }): ReactElement {
  const [ref, w] = useWidth();
  if (!p.ready) return <p>loading</p>;
  return (
    <div ref={ref} data-testid="box" data-w={w < 640 ? 'phone' : w < 900 ? 'tablet' : 'wide'} />
  );
}

function Host(): ReactElement {
  const [ready, setReady] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setReady(true)}>
        go
      </button>
      <Probe ready={ready} />
    </>
  );
}

const push = (width: number): void => {
  act(() => {
    for (const o of observers) if (o.els.length) o.cb([{ contentRect: { width } }]);
  });
};

describe('useWidth', () => {
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal('ResizeObserver', FakeRO);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('элемент появился после первого рендера — ширина всё равно отслеживается', () => {
    render(<Host />);
    act(() => screen.getByText('go').click());
    expect(observers.some((o) => o.els.length > 0)).toBe(true);
    push(390);
    expect(screen.getByTestId('box').getAttribute('data-w')).toBe('phone');
    push(768);
    expect(screen.getByTestId('box').getAttribute('data-w')).toBe('tablet');
    push(1440);
    expect(screen.getByTestId('box').getAttribute('data-w')).toBe('wide');
  });
});
