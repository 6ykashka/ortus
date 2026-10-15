import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { Radio } from '../Radio';

describe('Radio вне группы: состояние из checked (types/core.ts)', () => {
  it('одиночное радио рисуется плиткой и отмечено по checked', () => {
    render(<Radio value="q2" label="½" checked />);
    expect(screen.getByRole('radio', { name: '½' })).toBeChecked();
  });

  it('без checked — не отмечено', () => {
    render(<Radio value="q1" label="¼" />);
    expect(screen.getByRole('radio', { name: '¼' })).not.toBeChecked();
  });

  it('axe: без нарушений serious/critical', async () => {
    const { container } = render(<Radio value="q2" label="½" checked />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});
