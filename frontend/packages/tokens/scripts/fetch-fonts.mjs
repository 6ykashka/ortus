// Локальные шрифты (PD-21): однократная загрузка из npm-пакетов по запиненным версиям через jsDelivr,
// запись fonts/*.woff2, лицензий, manifest.json (sha256) и fonts.css.
//   node scripts/fetch-fonts.mjs           — скачать, записать файлы и манифест
//   node scripts/fetch-fonts.mjs --verify  — только сверить sha256 файлов с манифестом (без сети)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FONTS_DIR = fileURLToPath(new URL('../fonts/', import.meta.url));
const CDN = 'https://cdn.jsdelivr.net/npm';

const GOLOS = '@fontsource-variable/golos-text@5.3.0';
const PLEX = '@fontsource/ibm-plex-mono@5.3.0';
const SYMBOLS = 'material-symbols@0.48.0';

/** Подмножества fontsource 5.x: кириллица и латиница (вьетнамский не нужен). */
const SUBSETS = [
  ['cyrillic-ext', 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F'],
  ['cyrillic', 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116'],
  [
    'latin-ext',
    'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  ],
  [
    'latin',
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  ],
];

const LICENSES = [
  { file: 'LICENSE-GolosText.txt', url: `${CDN}/${GOLOS}/LICENSE` },
  { file: 'LICENSE-IBMPlexMono.txt', url: `${CDN}/${PLEX}/LICENSE` },
  { file: 'LICENSE-MaterialSymbols.txt', url: `${CDN}/${SYMBOLS}/LICENSE` },
];

const FACES = [
  ...SUBSETS.map(([subset, range]) => ({
    file: `golos-text-${subset}-wght-normal.woff2`,
    url: `${CDN}/${GOLOS}/files/golos-text-${subset}-wght-normal.woff2`,
    family: 'Golos Text',
    weight: '400 900',
    display: 'swap',
    range,
    license: 'LICENSE-GolosText.txt',
  })),
  ...['400', '500'].flatMap((weight) =>
    SUBSETS.map(([subset, range]) => ({
      file: `ibm-plex-mono-${subset}-${weight}-normal.woff2`,
      url: `${CDN}/${PLEX}/files/ibm-plex-mono-${subset}-${weight}-normal.woff2`,
      family: 'IBM Plex Mono',
      weight,
      display: 'swap',
      range,
      license: 'LICENSE-IBMPlexMono.txt',
    })),
  ),
  {
    file: 'material-symbols-rounded.woff2',
    url: `${CDN}/${SYMBOLS}/material-symbols-rounded.woff2`,
    family: 'Material Symbols Rounded',
    weight: '100 700',
    display: 'block',
    license: 'LICENSE-MaterialSymbols.txt',
  },
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function fontsCss() {
  const faces = FACES.map((f) =>
    [
      '@font-face {',
      `  font-family: '${f.family}';`,
      '  font-style: normal;',
      `  font-weight: ${f.weight};`,
      `  font-display: ${f.display};`,
      `  src: url('./${f.file}') format('woff2');`,
      ...(f.range ? [`  unicode-range: ${f.range};`] : []),
      '}',
      '',
    ].join('\n'),
  );
  return [
    '/* Локальные шрифты Ортус (PD-21). Сгенерировано scripts/fetch-fonts.mjs — не править руками.',
    '   Golos Text и IBM Plex Mono — SIL OFL 1.1; Material Symbols Rounded — Apache 2.0. */',
    '',
    ...faces,
    '/* Иконки: лигатуры Material Symbols, оси по умолчанию opsz 24, wght 400, FILL 0, GRAD 0',
    "   (tokens.json icon.set). FILL 1 — только активный пункт меню: font-variation-settings: 'FILL' 1. */",
    '.material-symbols-rounded {',
    "  font-family: 'Material Symbols Rounded';",
    '  font-weight: normal;',
    '  font-style: normal;',
    '  font-size: 24px;',
    '  line-height: 1;',
    '  letter-spacing: normal;',
    '  text-transform: none;',
    '  display: inline-block;',
    '  white-space: nowrap;',
    '  word-wrap: normal;',
    '  direction: ltr;',
    "  font-feature-settings: 'liga';",
    '  -webkit-font-smoothing: antialiased;',
    '  -moz-osx-font-smoothing: grayscale;',
    '  text-rendering: optimizeLegibility;',
    '}',
    '',
  ].join('\n');
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

if (process.argv.includes('--verify')) {
  const manifest = JSON.parse(readFileSync(FONTS_DIR + 'manifest.json', 'utf8'));
  const bad = manifest.filter((f) => sha256(readFileSync(FONTS_DIR + f.file)) !== f.sha256);
  for (const f of bad) console.error(`sha256 не совпадает: ${f.file}`);
  process.exit(bad.length > 0 ? 1 : 0);
}

for (const lic of LICENSES) {
  writeFileSync(FONTS_DIR + lic.file, await download(lic.url));
}
const manifest = [];
for (const f of FACES) {
  const buf = await download(f.url);
  writeFileSync(FONTS_DIR + f.file, buf);
  manifest.push({
    file: f.file,
    family: f.family,
    weight: f.weight,
    url: f.url,
    sha256: sha256(buf),
    license: f.license,
  });
  console.log(`${f.file}: ${buf.length} байт`);
}
writeFileSync(FONTS_DIR + 'manifest.json', JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(FONTS_DIR + 'fonts.css', fontsCss());
