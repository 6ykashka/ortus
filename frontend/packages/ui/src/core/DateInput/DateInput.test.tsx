import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { Field } from '../Field';
import { DateInput } from '../DateInput';

describe('DateInput (Ортус CRM.dc.html:2215): нативный type="date", значение ISO', () => {
  it('type="date", значение и onChange с ISO-датой', () => {
    const onChange = vi.fn();
    render(
      <Field label="Действует до" hint="Необязательно">
        <DateInput value="2026-10-15" onChange={onChange} />
      </Field>,
    );
    const input = screen.getByLabelText('Действует до');
    expect(input).toHaveAttribute('type', 'date');
    expect(input).toHaveValue('2026-10-15');
    fireEvent.change(input, { target: { value: '2026-11-01' } });
    expect(onChange).toHaveBeenCalledWith('2026-11-01');
  });

  it('axe: без нарушений serious/critical', async () => {
    const { container } = render(
      <Field label="Действует до">
        <DateInput value="" onChange={() => undefined} />
      </Field>,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});
