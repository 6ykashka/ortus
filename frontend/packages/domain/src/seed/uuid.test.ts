// Детерминированные UUID сида (PD-30): v5, пространство NameSpaceURL, имя «ortus:<область>:<id>».
// Область `platform` — control DB, `t-alta`/`t-lotos` — данные организации (правило W0.06,
// backend/cmd/seed/ids.go). Векторы — из TestSeedIDGoldenVectors W0.06.
import { describe, expect, it } from 'vitest';
import { NAMESPACE_URL, seedUuid, sha1Hex } from './uuid.ts';

describe('sha1Hex: SHA-1 по FIPS 180 (без node:crypto — пакет идёт в браузер)', () => {
  it.each([
    ['', 'da39a3ee5e6b4b0d3255bfef95601890afd80709'],
    ['abc', 'a9993e364706816aba3e25717850c26c9cd0d89d'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
    ],
    ['The quick brown fox jumps over the lazy dog', '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12'],
  ])('«%s»', (s, want) => {
    expect(sha1Hex(new TextEncoder().encode(s))).toBe(want);
  });

  it('миллион «a» — несколько блоков', () => {
    expect(sha1Hex(new TextEncoder().encode('a'.repeat(1_000_000)))).toBe(
      '34aa973cd4c4daa4f61eeb2bdbad27316534016f',
    );
  });
});

describe('seedUuid: совпадает с Go-сидом W0.06', () => {
  it('пространство имён — RFC 4122 URL', () => {
    expect(NAMESPACE_URL).toBe('6ba7b811-9dad-11d1-80b4-00c04fd430c8');
  });

  it.each([
    ['platform', 't-alta', 'f04f636e-b66d-509e-ae10-9c27a18e3baa'],
    ['platform', 't-lotos', 'e4f2195f-f5a3-5f61-98be-f6ed76ea565a'],
    ['platform', 'acc-1', '0281a55e-725e-53b1-920f-4189ab46e08a'],
    ['t-alta', 'm-owner', 'b8df06ec-317e-5f46-b54c-e76603e41b5b'],
    ['t-lotos', 'm-owner', '12d3a0fa-563f-5206-8f97-b955588350fa'],
    ['t-alta', 'f-msk-sever', '6de355d2-b019-5bb6-b66a-ddae6a13fb65'],
  ])('%s · %s', (scope, id, want) => {
    expect(seedUuid(scope, id)).toBe(want);
  });

  it('версия 5 и вариант RFC 4122; кириллица в id кодируется UTF-8', () => {
    const u = seedUuid('t-alta', 'Р-208');
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(u).not.toBe(seedUuid('t-alta', 'P-208'));
  });
});
