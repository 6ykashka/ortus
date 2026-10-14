import { render, screen } from '@testing-library/react';
import { createElement, type ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import { OWNERS, UNITS } from '../contract';
import * as ui from '../index';

const components = ui as unknown as Record<string, ComponentType<Record<string, unknown>>>;
const stubUnits = UNITS.filter((u) => u !== 'AppShell' && OWNERS[u] !== 'W0.10');

describe('заглушки номенклатуры 14.10 (красный тест потребителя падает по роли и тексту)', () => {
  it('нереализованных единиц больше 30, у каждой — владелец', () => {
    expect(stubUnits.length).toBeGreaterThan(30);
    for (const u of stubUnits) expect(OWNERS[u]).toMatch(/^W\d\.\d{2}$/);
  });

  it.each(stubUnits)('%s: data-stub и data-owner, дети видны, текстовые пропсы — нет', (unit) => {
    const Comp = components[unit];
    expect(Comp).toBeTypeOf('function');
    const { container } = render(
      createElement(Comp as ComponentType<Record<string, unknown>>, {
        title: 'Заголовок-проба',
        label: 'Подпись-проба',
        text: 'Текст-проба',
        children: createElement('span', null, 'Дети-проба'),
      }),
    );
    const el = container.querySelector(`[data-stub="${unit}"]`);
    expect(el).not.toBeNull();
    expect(el?.getAttribute('data-owner')).toBe(OWNERS[unit]);
    expect(screen.getByText('Дети-проба')).toBeInTheDocument();
    expect(screen.queryByText('Заголовок-проба')).toBeNull();
    expect(screen.queryByText('Подпись-проба')).toBeNull();
    expect(screen.queryByText('Текст-проба')).toBeNull();
  });
});
