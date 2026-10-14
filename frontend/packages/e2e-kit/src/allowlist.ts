// Allowlist расхождений реализации с эталоном (D-50) с видами плана v2 §3.7:
//   out-of-stage — пункт меню, источник «Главной» или шаг «Пути проверки» из будущего этапа,
//                  обязателен срок снятия `expires: stage-N`;
//   no-reference — экрана нет в прототипе (B-6), обязательна ссылка на решение.
// Файл на ключ страницы: frontend/apps/web/e2e/visual/allowlist/<key>.md. Запись — одна строка:
//   - kind: label · target: button:… · mode: mock · reason: … · decision: PD-54 · owner: W1.20[ · expires: stage-5]
// Модуль без зависимостей и только со стираемым синтаксисом TS: его импортирует tools/allowlist-lint.js.

export const ALLOW_KINDS = [
  'pixel',
  'label',
  'order',
  'state',
  'no-reference',
  'out-of-stage',
] as const;
export type AllowKind = (typeof ALLOW_KINDS)[number];
export const ALLOW_MODES = ['mock', 'stand', 'both'] as const;
export type AllowMode = (typeof ALLOW_MODES)[number];

export interface AllowEntry {
  kind: AllowKind;
  target: string;
  mode: AllowMode;
  reason: string;
  decision: string;
  owner: string;
  /** Этап, к закрытию которого запись снимается (`expires: stage-N`). */
  expires: number | undefined;
  file: string | undefined;
  line: number;
}

export interface AllowError {
  file?: string | undefined;
  line: number;
  level: 'error' | 'warning';
  message: string;
}

const REQUIRED = ['kind', 'target', 'mode', 'reason', 'decision', 'owner'] as const;
const KNOWN = new Set<string>([...REQUIRED, 'expires']);
const ENTRY_RE = /^\s*-\s+kind:\s/;
/** Разделитель полей — « · » перед `имя:`; « · » внутри подписи (`Владелец · Дарья`) не режет. */
const FIELD_SPLIT_RE = / · (?=[a-z][a-z-]*:\s)/;
const DECISION_RE = /^(PD|D|RS|Q|B)-\d+\b/;
const OWNER_RE = /^W\d+\.\d{2}$/;
const EXPIRES_RE = /^stage-(\d+)$/;

const isKind = (v: string): v is AllowKind => (ALLOW_KINDS as readonly string[]).includes(v);
const isMode = (v: string): v is AllowMode => (ALLOW_MODES as readonly string[]).includes(v);

function parseLine(raw: string): { fields: Map<string, string>; problems: string[] } {
  const fields = new Map<string, string>();
  const problems: string[] = [];
  const body = raw.replace(/^\s*-\s+/, '');
  for (const part of body.split(FIELD_SPLIT_RE)) {
    const idx = part.indexOf(':');
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!KNOWN.has(name)) problems.push(`неизвестное поле «${name}»`);
    else if (fields.has(name)) problems.push(`поле «${name}» повторяется`);
    else fields.set(name, value);
  }
  return { fields, problems };
}

function validate(fields: Map<string, string>): string[] {
  const problems: string[] = [];
  for (const name of REQUIRED) {
    if (!fields.get(name)) problems.push(`нет обязательного поля «${name}»`);
  }
  const kind = fields.get('kind');
  if (kind && !isKind(kind))
    problems.push(`kind «${kind}»: ожидается одно из ${ALLOW_KINDS.join(', ')}`);
  const mode = fields.get('mode');
  if (mode && !isMode(mode)) problems.push(`mode «${mode}»: ожидается mock, stand или both`);
  const decision = fields.get('decision');
  if (decision && !DECISION_RE.test(decision)) {
    problems.push(`decision «${decision}»: ожидается PD-NN, D-NN, RS-NN, Q-NN или B-N`);
  }
  const owner = fields.get('owner');
  if (owner && !OWNER_RE.test(owner)) problems.push(`owner «${owner}»: ожидается ID WS вида W1.20`);
  const expires = fields.get('expires');
  if (expires !== undefined && !EXPIRES_RE.test(expires)) {
    problems.push(`expires «${expires}»: ожидается stage-N`);
  }
  return problems;
}

/** Разбирает файл allowlist: записи и ошибки формата с номерами строк. */
export function parseAllowlist(
  text: string,
  file?: string,
): { entries: AllowEntry[]; errors: AllowError[] } {
  const entries: AllowEntry[] = [];
  const errors: AllowError[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (!ENTRY_RE.test(raw)) return;
    const line = i + 1;
    const { fields, problems } = parseLine(raw);
    problems.push(...validate(fields));
    if (problems.length > 0) {
      errors.push({ file, line, level: 'error', message: problems.join('; ') });
      return;
    }
    const expires = fields.get('expires');
    entries.push({
      kind: fields.get('kind') as AllowKind,
      target: fields.get('target') as string,
      mode: fields.get('mode') as AllowMode,
      reason: fields.get('reason') as string,
      decision: fields.get('decision') as string,
      owner: fields.get('owner') as string,
      expires: expires === undefined ? undefined : Number(EXPIRES_RE.exec(expires)?.[1]),
      file,
      line,
    });
  });
  return { entries, errors };
}

/** Смысловые проверки: срок out-of-stage относительно текущего этапа, дубликаты. */
export function lintAllowlist(entries: readonly AllowEntry[], o: { stage: number }): AllowError[] {
  const out: AllowError[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const at = { file: e.file, line: e.line };
    if (e.kind === 'out-of-stage') {
      if (e.expires === undefined) {
        out.push({
          ...at,
          level: 'error',
          message: 'out-of-stage без срока снятия «expires: stage-N»',
        });
      } else if (o.stage > e.expires) {
        out.push({
          ...at,
          level: 'error',
          message: `срок снятия истёк: expires stage-${e.expires}, текущий этап ${o.stage}`,
        });
      } else if (o.stage === e.expires) {
        out.push({
          ...at,
          level: 'warning',
          message: `снять до закрытия этапа: expires stage-${e.expires}`,
        });
      }
    }
    const key = `${e.kind}\u0000${e.target}\u0000${e.mode}`;
    if (seen.has(key)) {
      out.push({
        ...at,
        level: 'warning',
        message: `дубликат записи ${e.kind} «${e.target}» (${e.mode})`,
      });
    }
    seen.add(key);
  }
  return out;
}

const appliesTo = (e: AllowEntry, mode: 'mock' | 'stand'): boolean =>
  e.mode === 'both' || e.mode === mode;

/** Убирает из структурной сверки цели, разрешённые записями label/out-of-stage своего режима. */
export function applyAllowlist(
  labels: readonly string[],
  entries: readonly AllowEntry[],
  mode: 'mock' | 'stand',
): string[] {
  const skip = new Set(
    entries
      .filter((e) => (e.kind === 'label' || e.kind === 'out-of-stage') && appliesTo(e, mode))
      .map((e) => e.target),
  );
  return labels.filter((l) => !skip.has(l));
}

export function formatAllowError(e: AllowError): string {
  const level = e.level === 'error' ? 'ошибка' : 'предупреждение';
  return `${e.file ?? '<allowlist>'}:${e.line}: ${level}: ${e.message}`;
}
