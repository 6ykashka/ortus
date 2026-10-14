import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = () => readFileSync(fileURLToPath(new URL('../base.css', import.meta.url)), 'utf8');
const squash = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

describe('base.css — глобальные правила прототипа (Ортус CRM.dc.html:18–25) через --ox-*', () => {
  it.each([
    [
      'html, body',
      'html, body { margin: 0; background: var(--ox-canvas); color: var(--ox-text); font-family: var(--ox-font-sans); -webkit-font-smoothing: antialiased; }',
    ],
    ['box-sizing', '* { box-sizing: border-box; }'],
    ['контролы', 'button, input, select, textarea { font: inherit; color: inherit; }'],
    ['недоступная кнопка', 'button:disabled { opacity: 0.45; cursor: not-allowed; }'],
    [
      'фокус акцентом',
      ':focus-visible { outline: 2px solid var(--ox-accent); outline-offset: 2px; }',
    ],
    ['ссылки', 'a { color: var(--ox-accent); }'],
    ['наведение на ссылку', 'a:hover { color: var(--ox-accent-hover); }'],
  ])('%s', (_name, rule) => {
    expect(squash(css())).toContain(rule);
  });

  it('пульс скелетона ox-pulse: 0.5 → 1 → 0.5', () => {
    expect(squash(css())).toContain(
      '@keyframes ox-pulse { 0% { opacity: 0.5; } 50% { opacity: 1; } 100% { opacity: 0.5; } }',
    );
  });

  it('нет литералов цвета — только переменные токенов', () => {
    expect(squash(css())).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
});
