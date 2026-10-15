import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { Skeleton } from '../Skeleton';

describe('Skeleton (Дизайн-система.dc.html:401–405; Ортус CRM.dc.html:183–188)', () => {
  it('по умолчанию: контейнер aria-busy, три полосы aria-hidden, без роли', () => {
    const { container } = render(<Skeleton />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('aria-busy', 'true');
    expect(root).not.toHaveAttribute('role');
    const bars = root.querySelectorAll('[data-bar]');
    expect(bars).toHaveLength(3);
    for (const bar of bars) expect(bar).toHaveAttribute('aria-hidden', 'true');
  });

  it('lines задаёт число полос', () => {
    const { container } = render(<Skeleton lines={5} />);
    expect(container.querySelectorAll('[data-bar]')).toHaveLength(5);
  });

  it('shape block и circle — одна фигура нужного вида', () => {
    const { container, rerender } = render(<Skeleton shape="block" />);
    expect(container.querySelectorAll('[data-bar]')).toHaveLength(1);
    expect(container.querySelector('[data-bar]')).toHaveAttribute('data-shape', 'block');
    rerender(<Skeleton shape="circle" />);
    expect(container.querySelector('[data-bar]')).toHaveAttribute('data-shape', 'circle');
  });

  it('label: role="status" «Загрузка» и видимый текст (Ортус CRM.dc.html:183–188)', () => {
    render(<Skeleton lines={4} label="Загружаем рабочее пространство…" />);
    const status = screen.getByRole('status', { name: 'Загрузка' });
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('Загружаем рабочее пространство…');
  });

  it('axe: без нарушений serious/critical', async () => {
    const { container } = render(
      <>
        <Skeleton />
        <Skeleton label="Загружаем рабочее пространство…" />
      </>,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});
