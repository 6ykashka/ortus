// Реестр кодов ошибок api/errors.yaml → схема ProblemCode (W0.07, бриф §4.3).
// Схема генерируется в api/openapi/components/errors/schemas.yaml: руками её не правят,
// источник истины — api/errors.yaml.
import { ERRORS_PATH, OPENAPI_DIR } from './paths.mjs';
import { readYaml, renderYaml } from './yaml-io.mjs';

export const PROBLEM_CODE_FILE = `${OPENAPI_DIR}/components/errors/schemas.yaml`;

export function loadRegistry(path = ERRORS_PATH) {
  return readYaml(path);
}

export function problemCodeSchema(registry) {
  return {
    ProblemCode: {
      type: 'string',
      description:
        'Canonical Problem.code (registry api/errors.yaml, docs/12-errors-and-events.md v0.2 14.10). ' +
        'Clients pick UI text by code; unknown codes fall back to the generic text of the HTTP status.',
      enum: Object.keys(registry.codes),
    },
  };
}

export async function renderProblemCode(registry) {
  return renderYaml(
    problemCodeSchema(registry),
    PROBLEM_CODE_FILE,
    'Сгенерировано из api/errors.yaml: node tools/gen/contract.mjs (W0.07). Руками не править.',
  );
}

/** Проверки реестра, которые не зависят от бандла. */
export function checkRegistry(registry) {
  const errors = [];
  const codes = registry.codes ?? {};
  const clientStates = registry.client_states ?? {};
  for (const [c, e] of Object.entries(codes)) {
    if (!/^[a-z][a-z0-9_]*$/.test(c)) errors.push(`${c}: не snake_case`);
    if (!(e.status >= 400 && e.status <= 599)) errors.push(`${c}: статус ${e.status} вне 4xx/5xx`);
    for (const f of ['title', 'ui', 'source']) if (!e[f]) errors.push(`${c}: нет поля ${f}`);
    if (typeof e.retryable !== 'boolean') errors.push(`${c}: retryable не boolean`);
    if (c in clientStates) errors.push(`${c}: и HTTP-код, и клиентское состояние`);
    errors.push(...checkReasons(c, e.reasons));
  }
  const known = new Set([...Object.keys(codes), ...Object.keys(clientStates)]);
  for (const [p, t] of Object.entries(registry.prototype_codes ?? {})) {
    for (const x of [t].flat())
      if (!known.has(x)) errors.push(`prototype_codes.${p} → ${x}: нет в реестре`);
  }
  for (const [a, t] of Object.entries(registry.openapi_0_1_aliases ?? {})) {
    if (!codes[t]) errors.push(`openapi_0_1_aliases.${a} → ${t}: нет в реестре`);
  }
  return errors;
}

/** Problem.reason (W4.02, 0.7.0-stage4): тот же шаблон, что в схеме Problem. */
export const REASON_RE = /^[a-z][a-z0-9_]{1,63}$/;

/** Причины кода `codes.<code>.reasons`: snake_case, у каждой title и source (ui — по желанию). */
function checkReasons(code, reasons = {}) {
  const errors = [];
  for (const [r, e] of Object.entries(reasons ?? {})) {
    const at = `${code}.reasons.${r}`;
    if (!REASON_RE.test(r)) errors.push(`${at}: не snake_case`);
    for (const f of ['title', 'source']) if (!e?.[f]) errors.push(`${at}: нет поля ${f}`);
  }
  return errors;
}

/** Бандл согласован с реестром: enum ProblemCode = codes, Problem.code → ProblemCode. */
export function checkBundleProblem(doc, registry) {
  const errors = [];
  const s = doc.components?.schemas ?? {};
  const actual = JSON.stringify(s.ProblemCode?.enum ?? null);
  if (actual !== JSON.stringify(Object.keys(registry.codes))) {
    errors.push('enum ProblemCode в бандле не равен api/errors.yaml');
  }
  if (s.Problem?.properties?.code?.$ref !== '#/components/schemas/ProblemCode') {
    errors.push('Problem.code не ссылается на ProblemCode');
  }
  return errors;
}
