import { render, screen } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import { OWNERS, UNITS, type Unit } from '../contract';
import * as ui from '../index';

const SRC = join(import.meta.dirname, '..');
const components = ui as unknown as Record<string, ComponentType<Record<string, unknown>>>;

/** Каталог единицы: `src/core/<Name>` или `src/domain/<Name>`. */
function unitIndex(unit: Unit): string | undefined {
  return ['core', 'domain']
    .map((group) => join(SRC, group, unit, 'index.ts'))
    .find((file) => existsSync(file));
}

/** Заглушка — каталог, в `index.ts` которого стоит маркер `@stub Owner: W…` (CLAUDE.md). */
function isStub(unit: Unit): boolean {
  const file = unitIndex(unit);
  return file !== undefined && /@stub Owner: W\d\.\d{2}\b/.test(readFileSync(file, 'utf8'));
}

const stubUnits = UNITS.filter((u) => u !== 'AppShell' && isStub(u));

describe('заглушки номенклатуры 14.10 (красный тест потребителя падает по роли и тексту)', () => {
  it('маркер заглушки называет владельца из OWNERS', () => {
    for (const u of stubUnits) {
      const text = readFileSync(unitIndex(u) as string, 'utf8');
      expect(text).toContain(`@stub Owner: ${OWNERS[u]}`);
    }
  });

  it('у каждой единицы, кроме AppShell (только тип), есть каталог с index.ts', () => {
    const missing = UNITS.filter((u) => u !== 'AppShell' && unitIndex(u) === undefined);
    expect(missing).toEqual([]);
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
