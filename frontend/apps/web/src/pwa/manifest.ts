// W2.24 · Манифест PWA (S2-15, ADR-0002, 18-branding «Знак: иконка PWA»): приложение устанавливается на телефон
// водителя и открывается без адресной строки. Название — заголовок index.html «Ортус CRM»; цвета — акцент оболочки по
// умолчанию (#1F6B52, brand.ts) и фон рабочей области (--ox-surface). Экрана в эталоне нет (no-reference).
export const MANIFEST_PATH = '/manifest.webmanifest';
export const SW_PATH = '/sw.js';

/** Акцент Ортуса по умолчанию (оформление организации — W4.62; шапка окна PWA его не знает). */
export const THEME_COLOR = '#1F6B52';
/** Фон заставки запуска — фон рабочей области оболочки. */
export const BACKGROUND_COLOR = '#F2F3EF';

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: 'image/png';
  purpose: 'any' | 'maskable';
}

export const ICON_FILES: readonly { src: string; size: number; maskable: boolean }[] = [
  { src: '/pwa/icon-192.png', size: 192, maskable: false },
  { src: '/pwa/icon-512.png', size: 512, maskable: false },
  { src: '/pwa/maskable-512.png', size: 512, maskable: true },
];

export const MANIFEST = {
  name: 'Ортус CRM',
  short_name: 'Ортус',
  lang: 'ru',
  dir: 'ltr',
  id: '/',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  theme_color: THEME_COLOR,
  background_color: BACKGROUND_COLOR,
  icons: ICON_FILES.map((i): ManifestIcon => ({
    src: i.src,
    sizes: `${String(i.size)}x${String(i.size)}`,
    type: 'image/png',
    purpose: i.maskable ? 'maskable' : 'any',
  })),
} as const;
