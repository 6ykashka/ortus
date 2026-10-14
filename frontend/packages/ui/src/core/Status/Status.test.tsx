import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seriousViolations } from '../../test/axe';
import { Status } from '../Status';

describe('Status (Дизайн-система.dc.html:254–261): иконка + текст + цвет', () => {
  it('текст виден, тон в data-tone, иконка скрыта от AT', () => {
    render(
      <Status tone="warn" icon="pending">
        Ожидает приёмки
      </Status>,
    );
    const pill = screen.getByText('Ожидает приёмки');
    expect(pill).toHaveAttribute('data-tone', 'warn');
    const icon = pill.querySelector('.material-symbols-rounded');
    expect(icon).toHaveTextContent('pending');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('без иконки — только текст', () => {
    render(<Status tone="ok">Принят</Status>);
    expect(screen.getByText('Принят').querySelector('.material-symbols-rounded')).toBeNull();
  });

  it('axe: пять тонов без нарушений serious/critical', async () => {
    const { container } = render(
      <div>
        <Status tone="neutral" icon="event">
          Запланирован
        </Status>
        <Status tone="info" icon="route">
          В рейсе
        </Status>
        <Status tone="warn" icon="undo">
          На доработке
        </Status>
        <Status tone="danger" icon="report">
          Дефект на проверке
        </Status>
        <Status tone="ok" icon="verified">
          Принят
        </Status>
      </div>,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});
