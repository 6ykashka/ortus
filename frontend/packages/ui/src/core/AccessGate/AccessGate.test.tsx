import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { AccessGate } from '../AccessGate';

describe('AccessGate (Ортус CRM.dc.html:195–202, gateVM :3053–3081): три разных отказа', () => {
  it('module_off: чип, h1, текст и единственное действие', async () => {
    const onPress = vi.fn();
    render(
      <AccessGate
        reason="module_off"
        title="«Логистика» не подключена организацией"
        text="Подключите модуль в разделе «Модули и место», затем назначьте роли сотрудникам."
        action={{ label: 'Открыть «Модули и место»', onPress }}
      />,
    );
    expect(screen.getByText('Модуль не подключён')).toHaveAttribute('data-chip');
    expect(
      screen.getByRole('heading', { level: 1, name: '«Логистика» не подключена организацией' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Подключите модуль в разделе «Модули и место», затем назначьте роли сотрудникам.',
      ),
    ).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Открыть «Модули и место»' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('no_permission без действия: чип «Нет права» warn, кнопок нет', () => {
    const { container } = render(
      <AccessGate
        reason="no_permission"
        title="Нет доступа к разделу «Данные»"
        text="Ни одна ваша роль не разрешает его просматривать. Владелец бизнеса может добавить действие в роль."
      />,
    );
    const chip = screen.getByText('Нет права');
    expect(chip).toHaveAttribute('data-tone', 'warn');
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.firstElementChild).toHaveAttribute('data-reason', 'no_permission');
  });

  it('module_readonly: чип «Модуль отключён»', () => {
    render(<AccessGate reason="module_readonly" title="«Логистика» не подключена организацией" />);
    expect(screen.getByText('Модуль отключён')).toHaveAttribute('data-tone', 'neutral');
  });

  it('без title и text — заголовок и объяснение причины по умолчанию', () => {
    render(<AccessGate reason="no_scope" />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Нет доступа к объекту' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Право есть, но объект находится вне области назначения.'),
    ).toBeVisible();
  });

  it('moduleName без title — «{name}» не подключён организацией', () => {
    render(<AccessGate reason="module_off" moduleName="Данные" />);
    expect(
      screen.getByRole('heading', { level: 1, name: '«Данные» не подключён организацией' }),
    ).toBeInTheDocument();
  });

  it('axe: без нарушений serious/critical', async () => {
    const { container } = render(
      <AccessGate
        reason="module_off"
        title="«Логистика» не подключена организацией"
        text="Подключить модуль может владелец бизнеса."
        action={{ label: 'Демо: открыть как владелец', onPress: () => undefined }}
      />,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});
