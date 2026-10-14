// W0.07 · Полный валидатор OpenAPI 3.1 на бандле (14-engineering: «CI с полным валидатором
// OpenAPI»; README комплекта v0.2 «Что нужно сделать до первой строки кода», п.4).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { validateOpenApi } from './lib/validate.mjs';

describe('валидатор OpenAPI 3.1', () => {
  it('бандл проходит полный валидатор OpenAPI 3.1', async () => {
    const { valid, version, errors } = await validateOpenApi(bundle());
    assert.deepEqual(errors, []);
    assert.equal(version, '3.1');
    assert.equal(valid, true);
  });

  it('сломанный документ валидатор отвергает с указанием места', async () => {
    const broken = structuredClone(bundle());
    delete broken.info.title;
    broken.paths['/api/v1/me/context'].get.responses = 'нет ответов';
    const { valid, errors } = await validateOpenApi(broken);
    assert.equal(valid, false);
    assert.ok(errors.length > 0);
    assert.ok(
      errors.some((e) => e.includes('/info') || e.includes('/paths')),
      errors.join('\n'),
    );
  });
});
