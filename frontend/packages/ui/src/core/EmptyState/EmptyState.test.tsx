import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { EmptyState } from '../EmptyState';

describe('EmptyState (Дизайн-система.dc.html:396–400): иконка, заголовок, текст, действие', () => {
  it('«Нет смен на проверке» с текстом и скрытой иконкой', () => {
    const { container } = render(
      <EmptyState
        icon="inbox"
        title="Нет смен на проверке"
        text="Когда водитель сдаст машину, смена появится здесь."
      />,
    );
    expect(screen.getByText('Нет смен на проверке')).toBeVisible();
    expect(screen.getByText('Когда водитель сдаст машину, смена появится здесь.')).toBeVisible();
    expect(container.querySelector('.material-symbols-rounded')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('действие — одна кнопка; пунктир — data-dashed', async () => {
    const onPress = vi.fn();
    const { container } = render(
      <EmptyState
        icon="verified"
        title="Смена принята"
        action={{ label: 'Начать новую демо-смену', onPress }}
        dashed
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Начать новую демо-смену' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(container.firstElementChild).toHaveAttribute('data-dashed');
  });

  it('axe: без нарушений serious/critical', async () => {
    const { container } = render(
      <EmptyState
        icon="inbox"
        title="Нет смен на проверке"
        text="Когда водитель сдаст машину, смена появится здесь."
        action={{ label: 'Обновить список', onPress: () => undefined }}
      />,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});
