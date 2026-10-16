// W1.20 · Акцент организации (applyBrand :2928–2933, brandVars :2324–2330; 01-shell.md §17.1): эталон после
// загрузки перезаписывает --ox-accent* формулой (контраст ≥ 4,5:1, hover +18 % чёрного, soft/tint 86/93 %
// белого). Данных оформления в этапе 1 нет (W4.62) — акцент по умолчанию #1F6B52, как у «Альты» и оператора.
const DEFAULT_ACCENT = '#1F6B52';

const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (r: number[]): string =>
  `#${r
    .map((x) =>
      Math.max(0, Math.min(255, Math.round(x)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
const lum = (h: string): number => {
  const [r = 0, g = 0, b = 0] = rgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrastWhite = (h: string): number => 1.05 / (lum(h) + 0.05);
const mix = (h: string, w: string, t: number): string => {
  const a = rgb(h);
  const b = rgb(w);
  return hex(a.map((x, i) => x + ((b[i] ?? 0) - x) * t));
};

export interface BrandVars {
  accent: string;
  hover: string;
  soft: string;
  tint: string;
}

export function brandVars(accent: string | null | undefined): BrandVars {
  let a = (
    /^#[0-9a-f]{6}$/i.test(accent ?? '') ? (accent as string) : DEFAULT_ACCENT
  ).toUpperCase();
  for (let n = 0; contrastWhite(a) < 4.5 && n < 60; n++) a = mix(a, '#000000', 0.04);
  return {
    accent: a,
    hover: mix(a, '#000000', 0.18),
    soft: mix(a, '#FFFFFF', 0.86),
    tint: mix(a, '#FFFFFF', 0.93),
  };
}

let applied = '';

/** Ставит --ox-accent* на :root (повтор того же акцента не трогает style). */
export function applyBrand(
  accent: string | null | undefined,
  root = document.documentElement,
): void {
  const v = brandVars(accent);
  if (applied === v.accent && root.style.getPropertyValue('--ox-accent')) return;
  applied = v.accent;
  root.style.setProperty('--ox-accent', v.accent);
  root.style.setProperty('--ox-accent-hover', v.hover);
  root.style.setProperty('--ox-accent-soft', v.soft);
  root.style.setProperty('--ox-accent-tint', v.tint);
}
