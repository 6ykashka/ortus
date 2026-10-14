import { describe, expect, it } from 'vitest';
import * as tokens from '../index';

describe('TS-вывод @ortus/tokens', () => {
  it('цвета — исходные значения tokens.json, ключи camelCase', () => {
    expect(tokens.color.accent).toBe('#1F6B52');
    expect(tokens.color.lineControl).toBe('#CDD5CB');
    expect(tokens.color.accentTint).toBe('#F1F7F3');
  });

  it('тона', () => {
    expect(tokens.tone.ok).toEqual({ bg: '#E3EFE7', fg: '#1F6B52', border: '#B9D6C4' });
    expect(Object.keys(tokens.tone)).toEqual(['ok', 'info', 'warn', 'danger', 'neutral']);
  });

  it('шрифты — строки как в CSS', () => {
    expect(tokens.fontFamily.sans).toBe("'Golos Text', system-ui, sans-serif");
    expect(tokens.fontFamily.mono).toBe("'IBM Plex Mono', ui-monospace, monospace");
    expect(tokens.iconSet).toBe('Material Symbols Rounded');
  });

  it('размеры — числа в px, движение — в мс', () => {
    expect(tokens.sizes.control).toBe(44);
    expect(tokens.sizes.controlMobile).toBe(48);
    expect(tokens.sizes.controlCompact).toBe(32);
    expect(tokens.sizes.icon).toBe(20);
    expect(tokens.sizes.header).toBe(58);
    expect(tokens.sizes.controlBanner).toBe(36);
    expect(tokens.breakpoints).toEqual({ rail: 640, sidebar: 1080 });
    expect(tokens.motion).toEqual({ fast: 120, base: 200 });
    expect(tokens.space[4]).toBe(16);
    expect(tokens.radius.md).toBe(8);
    expect(tokens.radius.sheet).toBe('16px 16px 0 0');
    expect(tokens.fontSize['2xl']).toBe(24);
    expect(tokens.fontWeight.semibold).toBe(600);
    expect(tokens.lineHeight.base).toBe(1.45);
  });

  it('cssVar и список алиасов прототипа', () => {
    expect(tokens.cssVar('accent-tint')).toBe('var(--ox-accent-tint)');
    expect(tokens.prototype['--ox-danger-hover']).toBe('Дизайн-система.dc.html:187');
  });
});
