// W0.14 · Общие помощники тестов словаря: пути, чтение эталона, обход дерева строк,
// извлечение тостов и сообщений ApiError эталона в границах этапов 0–2.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = join(PKG, '..', '..', '..');
export const DESIGN = join(ROOT, 'design');
export const MAIN_HTML = join(DESIGN, 'Ортус CRM.dc.html');
export const API_JS = join(DESIGN, 'ortus', 'api.js');
export const MODELS_JS = join(DESIGN, 'ortus', 'models.js');
// W4.32: модульный файл «Базы знаний» (М) и её справочники — источники дословности домена `knowledge`.
export const KB_HTML = join(DESIGN, 'База знаний.dc.html');
export const KNOWLEDGE_JS = join(DESIGN, 'ortus', 'knowledge.js');
// W4.22: модульный файл «Форм и опросов» — источник дословности домена `forms`.
// W4.23: модульный файл «Формы и опросы» — источник дословности домена `formsResults`.
export const FORMS_HTML = join(DESIGN, 'Формы и опросы.dc.html');
/** W2.73 · S2-20 «Машина для временного водителя» (D-35): макеты 1a–1g снимка 19.10b. */
export const S220_HTML = join(DESIGN, 'Временный водитель - варианты.dc.html');
export const DOCS_12 = join(DESIGN, 'docs', '12-errors-and-events.md');
export const ERRORS_YAML = join(ROOT, 'api', 'errors.yaml');

export const readText = (p) => readFileSync(p, 'utf8');
export const lines = (p) => readText(p).split('\n');
export const readJson = (p) => JSON.parse(readText(p));
export const fixture = (name) => readJson(join(PKG, 'test', 'fixtures', name));
export { existsSync };

/** Файлы доменов `src/*.ts` (без служебных `index`, `icu`, `types`). */
export const SERVICE_FILES = new Set(['index.ts', 'icu.ts', 'types.ts']);
export const domainFiles = () =>
  readdirSync(join(PKG, 'src'))
    .filter((f) => f.endsWith('.ts') && !SERVICE_FILES.has(f))
    .sort();

/** kebab-case имени файла → camelCase имени экспорта. */
export const camel = (file) =>
  file.replace(/\.ts$/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/** Все листья дерева: [путь, значение]. Массивы и не-строки — ошибка формы. */
export function leaves(tree, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.push([path, v]);
    else if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...leaves(v, path));
    else
      throw new TypeError(
        `${path}: лист должен быть строкой или объектом, получено ${JSON.stringify(v)}`,
      );
  }
  return out;
}

/** Номер строки (1-based), содержащей `needle`, начиная с `from`. */
export function lineOf(all, needle, from = 1) {
  for (let i = from - 1; i < all.length; i++) if (all[i].includes(needle)) return i + 1;
  throw new Error(`якорь не найден: ${needle}`);
}

/**
 * Диапазоны главного файла эталона, где живут тосты этапов 0–2: от `toast(text…)` до `calVM(`,
 * без `brandingVM` (оформление — этап 4.6). Якоря, а не номера строк: переживают сдвиги снимка.
 */
export function toastRanges(all) {
  const start = lineOf(all, "  toast(text, tone = 'ok') {");
  const end = lineOf(all, '  calVM(', start);
  const brStart = lineOf(all, '  brandingVM(', start);
  const brEnd = lineOf(all, '  usageVM(', brStart);
  return [
    [start, brStart - 1],
    [brEnd, end - 1],
  ];
}

const CYR = "[^'\\n]*[А-Яа-яЁё][^'\\n]*";
const RE_TOAST = /this\.toast\('([^'\n]+)'\s*,/g;
const RUN_HEAD = "this\\.run\\('[^']+'[^,]*,\\s*.*?,\\s*";
const RE_RUN = new RegExp(`${RUN_HEAD}'(${CYR})'\\s*[,)]`, 'g');
const RE_RUN_TERNARY = new RegExp(
  `${RUN_HEAD}[^,?]+\\?\\s*'(${CYR})'\\s*:\\s*'(${CYR})'\\s*\\)`,
  'g',
);

/**
 * Статические тосты: прямые `this.toast('…', tone)` и `okText` из `this.run(key, fn, '…')`
 * (в том числе `cond ? '…' : '…'`). Конкатенации — шаблоны, их проверяют табличные кейсы.
 */
export function extractToasts(all = lines(MAIN_HTML)) {
  const out = [];
  for (const [a, b] of toastRanges(all)) {
    for (let i = a - 1; i < b; i++) {
      for (const m of all[i].matchAll(RE_TOAST))
        out.push({ line: i + 1, kind: 'toast', text: m[1] });
      for (const m of all[i].matchAll(RE_RUN)) out.push({ line: i + 1, kind: 'run', text: m[1] });
      for (const m of all[i].matchAll(RE_RUN_TERNARY)) {
        out.push(
          { line: i + 1, kind: 'run', text: m[1] },
          { line: i + 1, kind: 'run', text: m[2] },
        );
      }
    }
  }
  return out;
}

/** Диапазоны `api.js` этапов 0–2 (без оформления, задач, форм, БЗ, SPA, ремонта). */
export function apiRanges(all) {
  const trip = lineOf(all, 'const trip = (id) =>');
  const net = lineOf(all, 'const assertNet = ()');
  const actor = lineOf(all, 'setActor(memberId, tenantId)', net);
  const brand = lineOf(all, 'saveBranding: (b) =>', actor);
  const mod = lineOf(all, 'setModule: (key, enabled) =>', brand);
  const forms = lineOf(all, 'publishForm: (formId, def) =>', mod);
  const upload = lineOf(all, 'async upload({ name', forms);
  const http = lineOf(all, 'if (!res.ok)', upload);
  return [
    [trip, trip + 1],
    [net, brand - 1],
    [mod, forms - 1],
    [upload, http - 1],
  ];
}

const RE_API = /new ApiError\('(\w+)', '([^'\n]*)'\s*[,)]/g;

/** Статические сообщения `new ApiError('<code>', '<текст>')` в диапазонах этапов 0–2. */
export function extractApiMessages(all = lines(API_JS)) {
  const out = [];
  for (const [a, b] of apiRanges(all)) {
    for (let i = a - 1; i < b; i++) {
      for (const m of all[i].matchAll(RE_API)) out.push({ line: i + 1, code: m[1], text: m[2] });
    }
  }
  return out;
}

/** Канонические коды реестра `docs/12` «Реестр кодов»: [{status, code}]. */
export function registryCodes(text = readText(DOCS_12)) {
  const out = [];
  const body = text.split('## Реестр кодов')[1]?.split('\n## ')[0] ?? '';
  for (const line of body.split('\n')) {
    const m = /^\| (\d{3}) \| ([^|]+) \|/.exec(line);
    if (!m) continue;
    for (const c of m[2].matchAll(/`([a-z_]+)`/g)) out.push({ status: Number(m[1]), code: c[1] });
  }
  return out;
}

/** Коды PD-34 (decisions.md), которых нет в реестре docs/12 v0.2. */
export const PD34_CODES = [
  { status: 409, code: 'seats_exhausted' },
  { status: 409, code: 'request_pending' },
  { status: 422, code: 'tier_below_usage' },
  { status: 501, code: 'not_implemented' },
];

/** Клиентские состояния без HTTP-ответа (docs/12 «Реестр кодов», PD-34). */
export const CLIENT_STATES = ['offline', 'timeout', 'upload_failed'];

/** Ключи раздела `codes:` и `client_states:` из `api/errors.yaml` (W0.07), если файл есть. */
export function errorsYaml() {
  if (!existsSync(ERRORS_YAML)) return null;
  const sect = (name) => {
    const t = readText(ERRORS_YAML).replace(/\r\n/g, '\n');
    const i = t.search(new RegExp(`^${name}:\\s*$`, 'm'));
    const j = t.search(new RegExp(`^  ${name}:\\s*$`, 'm'));
    const at = i >= 0 ? i : j;
    if (at < 0) return [];
    const indent = i >= 0 ? '  ' : '    ';
    const rest = t.slice(at).split('\n').slice(1);
    const keys = [];
    for (const l of rest) {
      if (l.trim() && !l.startsWith(indent)) break;
      const m = new RegExp(`^${indent}([a-z_]+):`).exec(l);
      if (m) keys.push(m[1]);
    }
    return keys;
  };
  return { codes: sect('codes'), clientStates: sect('client_states') };
}
