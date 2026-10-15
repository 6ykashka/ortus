import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ScopeOption } from '../../types';
import { seriousViolations } from '../../test/axe';
import { ScopeSelect } from '../ScopeSelect';

const options: ScopeOption[] = [
  { value: 'all', label: 'Все подразделения', kind: 'tenant' },
  { value: 'msk', label: 'Москва · весь регион', kind: 'region' },
  { value: 'msk-l1', label: 'Москва / Логистика 1', kind: 'firm' },
];

describe('ScopeSelect (Ортус CRM.dc.html:110): «Область просмотра»', () => {
  it('combobox с подписью по умолчанию, опции и выбор', async () => {
    const onChange = vi.fn();
    render(<ScopeSelect value="all" options={options} onChange={onChange} />);
    const select = screen.getByRole('combobox', { name: 'Область просмотра' });
    expect(select).toHaveValue('all');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Все подразделения',
      'Москва · весь регион',
      'Москва / Логистика 1',
    ]);
    await userEvent.setup().selectOptions(select, 'msk-l1');
    expect(onChange).toHaveBeenCalledWith('msk-l1');
  });

  it('вид области — data-kind у опции; подпись переопределяется', () => {
    render(
      <ScopeSelect value="msk" options={options} onChange={() => undefined} label="Область" />,
    );
    expect(screen.getByRole('combobox', { name: 'Область' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Москва · весь регион' })).toHaveAttribute(
      'data-kind',
      'region',
    );
  });

  it('axe: без нарушений serious/critical', async () => {
    const { container } = render(
      <ScopeSelect value="all" options={options} onChange={() => undefined} />,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});
