import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { Switch } from '../Switch';

function Harness({ onChange }: { onChange: (v: boolean) => void }) {
  const [on, setOn] = useState(true);
  return (
    <Switch
      checked={on}
      label="Логистика"
      onChange={(v) => {
        setOn(v);
        onChange(v);
      }}
    />
  );
}

describe('Switch (Дизайн-система.dc.html:233–234; Ортус CRM.dc.html:359): role="switch"', () => {
  it('видимая подпись — имя переключателя; клик выключает', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Логистика' });
    expect(sw).toBeChecked();
    expect(screen.getByText('Логистика')).toBeVisible();
    await userEvent.setup().click(sw);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(sw).not.toBeChecked();
  });

  it('пробел переключает', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('switch', { name: 'Логистика' })).toHaveFocus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('labelHidden: подпись только для чтения с экрана, строки нет', () => {
    render(
      <Switch
        checked
        labelHidden
        label="Доступ роли к модулю «Логистика»"
        onChange={() => undefined}
      />,
    );
    const sw = screen.getByRole('switch', { name: 'Доступ роли к модулю «Логистика»' });
    expect(sw.closest('label')).not.toHaveAttribute('data-row');
  });

  it('включён и недоступен одновременно (02 §12 п.17)', async () => {
    const onChange = vi.fn();
    render(<Switch checked disabled label="Склад" onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Склад' });
    expect(sw).toBeChecked();
    expect(sw).toBeDisabled();
    await userEvent.setup().click(sw);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('описание связано с переключателем', () => {
    render(
      <Switch
        checked={false}
        label="Склад"
        description="Модуль не подключён"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole('switch', { name: 'Склад' })).toHaveAccessibleDescription(
      'Модуль не подключён',
    );
  });

  it('axe: без нарушений serious/critical', async () => {
    const { container } = render(
      <>
        <Switch checked label="Логистика" onChange={() => undefined} />
        <Switch checked={false} label="Склад" onChange={() => undefined} />
      </>,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});
