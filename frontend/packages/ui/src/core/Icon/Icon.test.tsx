import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon } from '../Icon';

describe('Icon — лигатура Material Symbols Rounded', () => {
  it('скрыта от вспомогательных технологий, класс шрифта и кегль', () => {
    const { container } = render(<Icon name="route" size={22} />);
    const icon = container.firstElementChild;
    expect(icon).toHaveClass('material-symbols-rounded');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveTextContent('route');
    expect(icon).toHaveStyle({ fontSize: '22px' });
  });

  it('по умолчанию 20 px (tokens.json size.icon); fill — заливка активного пункта', () => {
    const { container } = render(<Icon name="home" fill />);
    const icon = container.firstElementChild as HTMLElement;
    expect(icon).toHaveStyle({ fontSize: '20px' });
    expect(icon.style.fontVariationSettings).toBe("'FILL' 1");
  });
});
