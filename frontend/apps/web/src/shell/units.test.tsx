// W1.20 · Охранные тесты единиц оболочки: формула акцента (brandVars :2330, 01-shell.md §17.1), подписи всех
// пунктов и групп манифестов есть в словаре, отказ «вне области» для объекта и действие владельца в гейте.
import { GROUP_ORDER, MANIFESTS } from '@ortus/domain/nav';
import { gate } from '@ortus/texts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccessGate, PageDenied } from './AccessGate.tsx';
import { applyBrand, brandVars } from './brand.ts';
import { moduleName, navLabel } from './labels.ts';

afterEach(() => cleanup());

describe('акцент организации (applyBrand)', () => {
  it('формула эталона: #1F6B52 → hover #195843, soft #E0EAE7, tint #EFF5F3', () => {
    expect(brandVars('#1F6B52')).toEqual({
      accent: '#1F6B52',
      hover: '#195843',
      soft: '#E0EAE7',
      tint: '#EFF5F3',
    });
  });

  it('«Лотос» #7A3E79 без коррекции контраста; неверный цвет — акцент по умолчанию', () => {
    expect(brandVars('#7A3E79')).toEqual({
      accent: '#7A3E79',
      hover: '#643363',
      soft: '#ECE4EC',
      tint: '#F6F1F6',
    });
    expect(brandVars('red').accent).toBe('#1F6B52');
    expect(brandVars(null).accent).toBe('#1F6B52');
  });

  it('светлый акцент затемняется до контраста 4,5:1 с белым', () => {
    expect(brandVars('#9FD8B8').accent).not.toBe('#9FD8B8');
  });

  it('ставит --ox-accent* на :root', () => {
    const root = document.createElement('div');
    applyBrand('#2B5479', root);
    expect(root.style.getPropertyValue('--ox-accent')).toBe('#2B5479');
    expect(root.style.getPropertyValue('--ox-accent-soft')).toBe(brandVars('#2B5479').soft);
  });
});

describe('подписи меню из словаря', () => {
  it('у каждого пункта, пункта «только чтение» и группы манифестов есть подпись', () => {
    const keys = MANIFESTS.flatMap((m) => [
      ...m.pages.flatMap((p) => Object.values(p.nav ?? {}).map((n) => n.label)),
      ...(m.readonlyItem ? [m.readonlyItem.label] : []),
    ]);
    for (const k of [...keys, ...GROUP_ORDER.map((g) => `groups.${g}` as const)]) {
      expect(navLabel(k), k).toBeTruthy();
    }
    expect(() => navLabel('items.nope')).toThrow();
  });

  it('имя модуля домена для заголовка гейта', () => {
    expect(moduleName('logistics')).toBe('Логистика');
    expect(moduleName('forms')).toBe('Формы');
    expect(moduleName('unknown')).toBe('unknown');
  });
});

describe('AccessGate', () => {
  it('объект вне области назначения: «Нет доступа к объекту»', () => {
    render(<PageDenied />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(gate.reason.noScope.label);
    expect(screen.getByText(gate.reason.noScope.text)).toBeTruthy();
    expect(screen.getByText(gate.chips.noPermission)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('владельцу при неподключённом модуле — «Открыть «Модули и место»»', () => {
    const onOpen = vi.fn();
    render(
      <AccessGate
        access={{
          kind: 'deny',
          reason: 'module_off',
          branch: 'B',
          chip: 'moduleOff',
          title: 'moduleOff',
          domainModule: 'logistics',
          label: 'items.fleet',
          owner: true,
        }}
        onOpenModules={onOpen}
      />,
    );
    expect(screen.getByText(gate.b.textOwner)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: gate.actions.openModules }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('владельцу без права — без действия', () => {
    render(
      <AccessGate
        access={{
          kind: 'deny',
          reason: 'no_permission',
          branch: 'A',
          chip: 'noPermission',
          title: 'noPermission',
          domainModule: 'forms',
          label: 'items.forms',
          owner: true,
        }}
        onOpenModules={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Нет доступа к разделу «Формы»',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
