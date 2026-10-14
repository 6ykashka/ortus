// Сгенерировано scripts/build.mjs из design/docs/design-system/tokens.json и prototype.json.
// Не править руками: corepack pnpm --filter @ortus/tokens gen

export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';

export const color = {
  canvas: '#E6E9E3',
  surface: '#F2F3EF',
  card: '#FFFFFF',
  raised: '#F8F9F6',
  line: '#DCE2D9',
  lineControl: '#CDD5CB',
  divider: '#E8ECE5',
  text: '#1C2A26',
  textLabel: '#3A4844',
  textMuted: '#5C6964',
  accent: '#1F6B52',
  accentHover: '#185A44',
  accentSoft: '#E3EFE7',
  onAccent: '#FFFFFF',
  chrome: '#22302C',
  focus: '#1F6B52',
  accentTint: '#F1F7F3',
  dangerHover: '#8A302A',
  scrim: 'rgba(28,42,38,.36)',
} as const;

export const tone = {
  ok: { bg: '#E3EFE7', fg: '#1F6B52', border: '#B9D6C4' },
  info: { bg: '#E7EEF6', fg: '#2B5479', border: '#C3D3E6' },
  warn: { bg: '#FAF1DC', fg: '#7A5214', border: '#EBD7A6' },
  danger: { bg: '#FBEAE7', fg: '#A13A33', border: '#F0C9C3' },
  neutral: { bg: '#ECEFEA', fg: '#4C5955', border: '#D5DBD2' },
} as const satisfies Record<Tone, { bg: string; fg: string; border: string }>;

export const fontFamily = {
  sans: "'Golos Text', system-ui, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
} as const;

export const fontSize = {
  xs: 12,
  sm: 13,
  md: 14,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
} as const;

export const lineHeight = {
  tight: 1.2,
  base: 1.45,
} as const;

export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  pill: 999,
  sheet: '16px 16px 0 0',
} as const;

export const shadow = {
  popover: '0 16px 40px rgba(28,42,38,.18)',
  dialog: '0 24px 64px rgba(28,42,38,.24)',
  sticky: '0 -8px 24px rgba(28,42,38,.08)',
} as const;

export const sizes = {
  control: 44,
  controlMobile: 48,
  controlCompact: 32,
  icon: 20,
  header: 58,
  controlBanner: 36,
} as const;

export const breakpoints = {
  rail: 640,
  sidebar: 1080,
} as const;

export const motion = {
  fast: 120,
  base: 200,
} as const;

export const iconSet = 'Material Symbols Rounded';

/** Переменные-алиасы рендера прототипа (PD-28) → строка эталона. */
export const prototype = {
  '--ox-accent-tint': 'Ортус CRM.dc.html:17',
  '--ox-danger-hover': 'Дизайн-система.dc.html:187',
  '--ox-scrim': 'Дизайн-система.dc.html:383',
  '--ox-radius-sheet': 'Ортус CRM.dc.html:3957',
  '--ox-control-banner': 'Дизайн-система.dc.html:275',
} as const;

/** `cssVar('accent')` → `var(--ox-accent)`. */
export const cssVar = (name: string): string => `var(--ox-${name})`;
