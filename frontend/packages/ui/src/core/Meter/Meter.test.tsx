import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { Meter } from '../Meter';

describe('Meter (Ортус CRM.dc.html:263): «Занятое место»', () => {
  it('role="meter" с границами и значением, заливка в процентах', () => {
    render(<Meter value={46.2} max={50} label="Занятое место" />);
    const meter = screen.getByRole('meter', { name: 'Занятое место' });
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '50');
    expect(meter).toHaveAttribute('aria-valuenow', '46.2');
    expect(meter).not.toHaveAttribute('data-over');
    const fill = meter.querySelector('[data-fill]') as HTMLElement;
    expect(fill.style.width).toBe('92.4%');
  });

  it('сверх лимита: заливка 100 % и data-over (danger)', () => {
    render(<Meter value={46.2} max={25} label="Занятое место" />);
    const meter = screen.getByRole('meter', { name: 'Занятое место' });
    expect(meter).toHaveAttribute('data-over');
    expect((meter.querySelector('[data-fill]') as HTMLElement).style.width).toBe('100%');
  });

  it('ровно на лимите — тоже danger (usedGb >= quotaGb, 01 §11 #5)', () => {
    render(<Meter value={50} max={50} label="Занятое место" />);
    expect(screen.getByRole('meter')).toHaveAttribute('data-over');
  });

  it('tone задаёт цвет заливки, text — aria-valuetext', () => {
    render(<Meter value={3} max={10} label="Места" tone="warn" text="3 из 10 мест" />);
    const meter = screen.getByRole('meter', { name: 'Места' });
    expect(meter).toHaveAttribute('data-tone', 'warn');
    expect(meter).toHaveAttribute('aria-valuetext', '3 из 10 мест');
  });

  it('axe: без нарушений serious/critical', async () => {
    const { container } = render(<Meter value={46.2} max={50} label="Занятое место" />);
    expect(await seriousViolations(container)).toEqual([]);
  });
});
