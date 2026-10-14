// Локальный сервер эталона design/ (кириллические пути, ES-модули, MIME) — W0.05.
//
//   node tools/design-preview.js <dir> <port> [--offline] [--ref <git-ref>] [--vendor <dir>] [--fonts <dir>]
//
// Без флагов файлы отдаются байт-в-байт. С --offline ответы .dc.html переписываются в памяти
// (файлы не меняются): React/ReactDOM UMD 18.3.1 из tools/vendor/ подключаются до support.js
// (loadReactUmd в support.js:1838 тогда ничего не грузит с unpkg), Google Fonts заменяются
// на /__fonts/fonts.css (шрифты токенов W0.10). window.__resources не задаётся: иначе boot()
// пропустит повторный fetch шаблона (support.js:158) и путь рендера разойдётся с онлайн-версией.
// С --ref файлы берутся из git-ссылки (снимок этапа design-stage-N, PD-57), а не из рабочей копии.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOLS = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TOOLS, '..');

export const DEFAULT_PORT = 4173;
export const VENDOR_PREFIX = '/__vendor/';
export const FONTS_PREFIX = '/__fonts/';
export const FONTS_CSS = `${FONTS_PREFIX}fonts.css`;
const DEFAULT_VENDOR_DIR = join(TOOLS, 'vendor');
const DEFAULT_FONTS_DIR = join(ROOT, 'frontend', 'packages', 'tokens', 'fonts');
const EMPTY_FONTS_CSS =
  '/* design-preview --offline: шрифтов токенов ещё нет (frontend/packages/tokens/fonts — W0.10); системные шрифты */\n';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const SUPPORT_TAG = '<script src="./support.js"></script>';
const VENDOR_TAGS =
  `<script src="${VENDOR_PREFIX}react.production.min.js"></script>` +
  `<script src="${VENDOR_PREFIX}react-dom.production.min.js"></script>`;
const PRECONNECT_RE =
  /[ \t]*<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com"[^>]*>\r?\n?/g;
const FONTS_LINK_RE = /href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*"/g;

/** Переписывает .dc.html для офлайн-режима (чистая функция). */
export function rewriteDcHtml(html) {
  return html
    .replace(SUPPORT_TAG, VENDOR_TAGS + SUPPORT_TAG)
    .replace(PRECONNECT_RE, '')
    .replace(FONTS_LINK_RE, `href="${FONTS_CSS}"`);
}

/** Разбирает аргументы командной строки. */
export function parseArgs(argv) {
  const positional = [];
  const opts = { offline: false, ref: undefined, vendorDir: undefined, fontsDir: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--offline') opts.offline = true;
    else if (a === '--ref') opts.ref = argv[(i += 1)];
    else if (a === '--vendor') opts.vendorDir = argv[(i += 1)];
    else if (a === '--fonts') opts.fontsDir = argv[(i += 1)];
    else if (a.startsWith('--')) throw new Error(`design-preview: неизвестный флаг ${a}`);
    else positional.push(a);
  }
  const [dir = 'design', port] = positional;
  return { dir, port: port ? Number(port) : DEFAULT_PORT, ...opts };
}

/** Путь внутри base или null, если запрос выходит за корень. */
function inside(base, rel) {
  const root = resolve(base);
  const file = resolve(root, `.${rel}`);
  return file === root || file.startsWith(root + sep) ? file : null;
}

function readWorkingCopy(file) {
  try {
    return statSync(file).isFile() ? readFileSync(file) : null;
  } catch {
    return null;
  }
}

/** Источник файлов эталона: рабочая копия или git-ссылка. */
function createSource(dir, ref) {
  const root = resolve(dir);
  if (!ref) return (rel) => readWorkingCopy(inside(root, rel));
  const cache = new Map();
  return (rel) => {
    if (!inside(root, rel)) return null;
    if (!cache.has(rel)) {
      let buf;
      try {
        buf = execFileSync('git', ['show', `${ref}:./${rel.slice(1)}`], {
          cwd: root,
          maxBuffer: 64 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch {
        buf = null;
      }
      cache.set(rel, buf);
    }
    return cache.get(rel);
  };
}

/**
 * HTTP-сервер эталона (не слушает порт: вызывающий делает listen).
 * @param {{ dir: string, offline?: boolean, ref?: string, vendorDir?: string, fontsDir?: string }} o
 */
export function createPreviewServer(o) {
  const source = createSource(o.dir, o.ref);
  const vendorDir = o.vendorDir ?? DEFAULT_VENDOR_DIR;
  const fontsDir = o.fontsDir ?? DEFAULT_FONTS_DIR;

  const send = (res, status, type, body) => {
    res.writeHead(status, {
      'content-type': type,
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    res.end(body);
  };
  const mime = (p) => MIME[extname(p).toLowerCase()] ?? 'application/octet-stream';

  function serveVirtual(rel) {
    if (rel.startsWith(VENDOR_PREFIX)) {
      const file = inside(vendorDir, rel.slice(VENDOR_PREFIX.length - 1));
      return file ? { body: readWorkingCopy(file), file } : { forbidden: true };
    }
    if (rel.startsWith(FONTS_PREFIX)) {
      const file = inside(fontsDir, rel.slice(FONTS_PREFIX.length - 1));
      if (!file) return { forbidden: true };
      const body = readWorkingCopy(file);
      if (!body && rel === FONTS_CSS) return { body: Buffer.from(EMPTY_FONTS_CSS), file };
      return { body, file };
    }
    return null;
  }

  return createServer((req, res) => {
    let rel;
    try {
      // Без new URL(): он схлопывает «..» и прячет попытку выйти за корень.
      rel = decodeURIComponent((req.url ?? '/').split(/[?#]/)[0]);
    } catch {
      return send(res, 400, 'text/plain; charset=utf-8', 'bad request');
    }
    if (rel === '/') rel = '/index.html';

    const virtual = o.offline ? serveVirtual(rel) : null;
    if (virtual?.forbidden) return send(res, 403, 'text/plain; charset=utf-8', 'forbidden');
    if (virtual) {
      if (!virtual.body) return send(res, 404, 'text/plain; charset=utf-8', `not found: ${rel}`);
      return send(res, 200, mime(virtual.file), virtual.body);
    }

    if (!inside(o.dir, rel)) return send(res, 403, 'text/plain; charset=utf-8', 'forbidden');
    const body = source(rel);
    if (!body && rel === '/favicon.ico') {
      // Браузер и MCP просят иконку сами; 404 засоряет консоль проходки.
      res.writeHead(204, { 'cache-control': 'no-store' });
      return res.end();
    }
    if (!body) return send(res, 404, 'text/plain; charset=utf-8', `not found: ${rel}`);
    if (o.offline && rel.endsWith('.dc.html')) {
      return send(res, 200, mime(rel), rewriteDcHtml(body.toString('utf8')));
    }
    return send(res, 200, mime(rel), body);
  });
}

function main(argv) {
  const args = parseArgs(argv);
  if (!existsSync(args.dir)) throw new Error(`design-preview: нет каталога ${args.dir}`);
  const server = createPreviewServer(args);
  server.listen(args.port, '127.0.0.1', () => {
    const mode = [args.offline && 'offline', args.ref && `ref ${args.ref}`].filter(Boolean);
    const suffix = mode.length ? ` (${mode.join(', ')})` : '';
    console.log(`serving ${args.dir} on http://127.0.0.1:${args.port}/${suffix}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
