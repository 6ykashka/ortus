import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { Banner } from '../Banner';

describe('Banner (Дизайн-система.dc.html:275–278): состояние всего раздела', () => {
  it('по умолчанию role="status", заголовок и текст читаются вместе', () => {
    render(
      <Banner
        tone="info"
        icon="hourglass_top"
        title="Пробный период — осталось 3 дня."
        text="После окончания 7 дней льготного периода, затем только чтение. Данные не удаляются."
      />,
    );
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(
      'Пробный период — осталось 3 дня. После окончания 7 дней льготного периода, затем только чтение. Данные не удаляются.',
    );
    expect(screen.getByText('Пробный период — осталось 3 дня.').tagName).toBe('STRONG');
    expect(banner).toHaveAttribute('data-tone', 'info');
  });

  it('danger — блокирующий: role="alert"; роль можно переопределить', () => {
    render(
      <>
        <Banner tone="danger" title="Хранилище заполнено: 5,0 из 5 ГиБ." />
        <Banner tone="warn" role="alert" title="Нет связи." />
      </>,
    );
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('иконка тона по умолчанию скрыта от AT; своя иконка заменяет её', () => {
    const { container } = render(
      <>
        <Banner tone="warn" title="Нет связи." />
        <Banner tone="neutral" icon="history" title="Логистика отключена · только чтение." />
      </>,
    );
    const icons = [...container.querySelectorAll('.material-symbols-rounded')];
    expect(icons.map((i) => i.textContent)).toEqual(['warning', 'history']);
    for (const icon of icons) expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('действие — кнопка с глаголом, нажатие вызывает onPress', async () => {
    const user = userEvent.setup();
    const onPress = vi.fn();
    render(
      <Banner
        tone="danger"
        title="Хранилище заполнено: 5,0 из 5 ГиБ."
        action={{ label: 'Увеличить место', onPress }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Увеличить место' }));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('axe: 0 нарушений serious/critical', async () => {
    const { container } = render(
      <div>
        <Banner
          tone="info"
          title="Пробный период — осталось 3 дня."
          action={{ label: 'Продлить', onPress: () => undefined }}
        />
        <Banner
          tone="warn"
          icon="cloud_off"
          title="Нет связи."
          text="Фото сохраняются на устройстве."
        />
        <Banner tone="neutral" title="Логистика отключена · только чтение." />
        <Banner tone="danger" title="Хранилище заполнено." />
        <Banner tone="ok" title="Связь восстановлена." />
      </div>,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});
