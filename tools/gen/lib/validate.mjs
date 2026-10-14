// Полный валидатор OpenAPI 3.1 (JSON Schema спецификации OAS, @seriousme/openapi-schema-validator).
import { Validator } from '@seriousme/openapi-schema-validator';

const describe = (e) =>
  typeof e === 'string'
    ? e
    : `${e.instancePath || '/'} ${e.message ?? ''}${e.params ? ' ' + JSON.stringify(e.params) : ''}`.trim();

/**
 * @returns {Promise<{valid: boolean, version: string|undefined, errors: string[]}>}
 */
export async function validateOpenApi(doc) {
  const validator = new Validator();
  const res = await validator.validate(structuredClone(doc));
  const raw = res.valid ? [] : Array.isArray(res.errors) ? res.errors : [res.errors];
  return { valid: res.valid, version: validator.version, errors: raw.map(describe) };
}
