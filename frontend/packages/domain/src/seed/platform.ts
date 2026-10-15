// Control DB сида (`seed()` эталона: baseSeed().platform → fillAccounts → seedBrands).
import { applyBrands, fillAccounts, platformSeed } from '../modules/platform/seed.ts';
import type { Platform } from '../modules/platform/types.ts';

export function createPlatform(): Platform {
  const P = platformSeed();
  fillAccounts(P);
  applyBrands(P);
  return P;
}
