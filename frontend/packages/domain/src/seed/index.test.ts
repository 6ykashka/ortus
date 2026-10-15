// Экспорт-лист точки входа `@ortus/domain/seed`. Расширяется только добавлением в список.
// Эталон для тестов паритета (`reference.ts`) в точку входа не входит.
import { describe, expect, it } from 'vitest';

describe('экспорт-лист @ortus/domain/seed', () => {
  it('сборка сида, организации, UUID и снимок', async () => {
    const pkg = await import('./index.ts');
    expect(Object.keys(pkg).sort()).toEqual(
      [
        'createSeed',
        'FUTURE_STAGE_HOOKS',
        'createPlatform',
        'createAlta',
        'createLotos',
        'NAMESPACE_URL',
        'seedUuid',
        'sha1Hex',
        'buildSnapshot',
      ].sort(),
    );
  });
});
