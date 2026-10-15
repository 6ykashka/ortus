import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { VisuallyHidden } from '../VisuallyHidden';

describe('VisuallyHidden: текст для чтения с экрана без пиксельного следа (PD-29)', () => {
  it('текст в дереве доступности и скрыт приёмом clip', () => {
    render(
      <button type="button">
        <span aria-hidden="true">≡</span>
        <VisuallyHidden>Рабочее место логиста</VisuallyHidden>
      </button>,
    );
    expect(screen.getByRole('button', { name: 'Рабочее место логиста' })).toBeInTheDocument();
    const hidden = screen.getByText('Рабочее место логиста');
    expect(hidden.tagName).toBe('SPAN');
    expect(hidden).toHaveAttribute('data-visually-hidden');
    expect(hidden.style.position).toBe('absolute');
    expect(hidden.style.width).toBe('1px');
    expect(hidden.style.overflow).toBe('hidden');
  });

  it('axe: без нарушений serious/critical', async () => {
    const { container } = render(<VisuallyHidden>Область просмотра</VisuallyHidden>);
    expect(await seriousViolations(container)).toEqual([]);
  });
});
