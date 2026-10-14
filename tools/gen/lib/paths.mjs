// Пути конвейера контракта (W0.07). Все пути — абсолютные, от корня репозитория.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const abs = (rel) => join(ROOT, rel);

/** Исходник OpenAPI 0.1 (эталон design/, не меняется). */
export const SOURCE_0_1 = abs('design/docs/v0.1/ortus-openapi-v0.1.yaml');

export const OPENAPI_DIR = abs('api/openapi');
export const ROOT_SPEC = abs('api/openapi/ortus.yaml');
export const DELTA_PATH = abs('api/openapi/source-delta.yaml');
export const EXAMPLES_DIR = abs('api/openapi/examples');
export const SEED_IDS_PATH = abs('api/openapi/examples/seed-ids.yaml');
export const SCREENS_PATH = abs('api/openapi/screens.yaml');
export const BUNDLE_PATH = abs('api/dist/ortus.bundle.yaml');
export const ERRORS_PATH = abs('api/errors.yaml');
export const PERMISSIONS_PATH = abs('api/permissions.yaml');
export const SPECTRAL_RULESET = abs('api/.spectral.yaml');
export const FIXTURES_DIR = abs('tools/gen/fixtures');
