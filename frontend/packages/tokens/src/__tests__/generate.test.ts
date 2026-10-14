import { describe, expect, it } from 'vitest';
import { collect, cssValue, cssVarName, generateCss } from '../../scripts/generate.mjs';

describe('имена CSS-переменных по правилам tokens.css 0.2', () => {
  it.each([
    [['color', 'canvas'], '--ox-canvas'],
    [['color', 'line-control'], '--ox-line-control'],
    [['color', 'tone', 'ok', 'bg'], '--ox-ok-bg'],
    [['color', 'tone', 'neutral', 'border'], '--ox-neutral-border'],
    [['font', 'family', 'sans'], '--ox-font-sans'],
    [['font', 'size', '2xl'], '--ox-fs-2xl'],
    [['font', 'line-height', 'base'], '--ox-lh-base'],
    [['font', 'weight', 'semibold'], '--ox-fw-semibold'],
    [['space', '10'], '--ox-space-10'],
    [['radius', 'pill'], '--ox-radius-pill'],
    [['shadow', 'dialog'], '--ox-shadow-dialog'],
    [['size', 'control-mobile'], '--ox-control-mobile'],
    [['size', 'header'], '--ox-header'],
    [['breakpoint', 'rail'], '--ox-bp-rail'],
    [['motion', 'fast'], '--ox-motion-fast'],
    [['icon', 'set'], '--ox-icon-set'],
  ])('%j → %s', (path, name) => {
    expect(cssVarName(path)).toBe(name);
  });

  it('неизвестная группа токенов — ошибка, а не молчаливое имя', () => {
    expect(() => cssVarName(['z-index', 'modal'])).toThrow(/z-index/);
  });
});

describe('значения CSS', () => {
  it('массив шрифтов — список через запятую, имена с пробелом в одинарных кавычках', () => {
    expect(cssValue(['Golos Text', 'system-ui', 'sans-serif'])).toBe(
      "'Golos Text', system-ui, sans-serif",
    );
  });

  it('hex — в нижнем регистре, как печатает Prettier', () => {
    expect(cssValue('#E6E9E3')).toBe('#e6e9e3');
  });

  it('rgba — с пробелами после запятых и ведущим нулём', () => {
    expect(cssValue('0 16px 40px rgba(28,42,38,.18)')).toBe('0 16px 40px rgba(28, 42, 38, 0.18)');
  });

  it('числа и размеры — как есть', () => {
    expect(cssValue(1.45)).toBe('1.45');
    expect(cssValue(600)).toBe('600');
    expect(cssValue('16px 16px 0 0')).toBe('16px 16px 0 0');
    expect(cssValue('Material Symbols Rounded')).toBe("'Material Symbols Rounded'");
  });
});

describe('обход дерева', () => {
  it('собирает листья с $value, пропуская $type и $description', () => {
    const leaves = collect({
      $description: 'x',
      color: {
        $type: 'color',
        canvas: { $value: '#E6E9E3', $description: 'Фон' },
        tone: { ok: { bg: { $value: '#E3EFE7' } } },
      },
    });
    expect(leaves.map((l) => [l.path.join('.'), l.value])).toEqual([
      ['color.canvas', '#E6E9E3'],
      ['color.tone.ok.bg', '#E3EFE7'],
    ]);
    expect(leaves[0]?.description).toBe('Фон');
  });
});

describe('generateCss', () => {
  const base = {
    color: { canvas: { $value: '#E6E9E3' }, focus: { $value: '#1F6B52' } },
    motion: { fast: { $value: '120ms' }, base: { $value: '200ms' } },
  };
  const prototype = {
    color: {
      'accent-tint': {
        $value: '#F1F7F3',
        $extensions: { 'ortus.prototype': { ref: 'Ортус CRM.dc.html:17', decision: 'PD-28' } },
      },
    },
  };
  const css = generateCss(base, prototype);

  it('базовые переменные — в :root', () => {
    expect(css).toContain('  --ox-canvas: #e6e9e3;\n');
    expect(css).toContain('  --ox-motion-base: 200ms;\n');
  });

  it('prototype-алиас — со ссылкой на строку эталона', () => {
    expect(css).toContain('  --ox-accent-tint: #f1f7f3; /* Ортус CRM.dc.html:17 · PD-28 */\n');
  });

  it('хвост дословно по tokens.css:47–51: reduced-motion → 0ms и :focus-visible через --ox-focus', () => {
    expect(css).toContain(
      '@media (prefers-reduced-motion: reduce) {\n  :root {\n    --ox-motion-fast: 0ms;\n    --ox-motion-base: 0ms;\n  }\n}\n',
    );
    expect(css).toContain(
      ':focus-visible {\n  outline: 2px solid var(--ox-focus);\n  outline-offset: 2px;\n}\n',
    );
  });
});
