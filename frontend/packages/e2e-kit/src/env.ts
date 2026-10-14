// Окружение харнесса: порты по слоту исполнителя (план v2 §3.6) и режимы mock/stand (§3.7).
// Единственное место, где из переменных окружения получаются порты и адреса: spec-файлы
// литералов портов не содержат.

export type HarnessMode = 'mock' | 'stand';
export type HarnessRole = 'executor' | 'verifier';
type EnvSource = Readonly<Record<string, string | undefined>>;

export interface SlotPorts {
  vite: number;
  verifier: number;
  storybook: number;
  api: number;
  ownReference: number;
}

export interface HarnessEnv {
  slot: number;
  role: HarnessRole;
  mode: HarnessMode;
  appPort: number;
  appURL: string;
  apiURL: string;
  storybookPort: number;
  referencePort: number;
  referenceURL: string;
  referenceDir: string;
  referenceRef: string | undefined;
  mcpOutputDir: string;
  freshServer: boolean;
  startApp: boolean;
  stage: number;
  allowHosts: string[];
  ci: boolean;
}

/** Эталон текущего этапа (общий) и предыдущего этапа (план v2 §3.6). */
export const SHARED_REFERENCE_PORT = 4173;
export const PREVIOUS_REFERENCE_PORT = 4174;
export const MAX_SLOT = 10;

const LOCAL = '127.0.0.1';

function intVar(
  name: string,
  raw: string | undefined,
  min: number,
  max: number,
): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name}=${raw}: ожидается целое ${min}…${max}`);
  }
  return n;
}

function oneOf<T extends string>(
  name: string,
  raw: string | undefined,
  values: readonly T[],
  def: T,
): T {
  if (raw === undefined || raw === '') return def;
  if ((values as readonly string[]).includes(raw)) return raw as T;
  throw new Error(`${name}=${raw}: ожидается одно из ${values.join(', ')}`);
}

const flag = (raw: string | undefined): boolean => raw === '1' || raw === 'true';

/** Порты слота: Vite 5200+, проверяющий 6100+, Storybook 7200+, API 8100+, свой эталон 4100+. */
export function portsForSlot(slot: number): SlotPorts {
  if (!Number.isInteger(slot) || slot < 0 || slot > MAX_SLOT) {
    throw new Error(`ORTUS_SLOT=${slot}: ожидается целое 0…${MAX_SLOT}`);
  }
  return {
    vite: 5200 + slot,
    verifier: 6100 + slot,
    storybook: 7200 + slot,
    api: 8100 + slot,
    ownReference: 4100 + slot,
  };
}

const hostOf = (url: string): string => new URL(url).host;

/** Разбирает переменные окружения харнесса (бриф W0.05 §4.1). */
export function resolveHarnessEnv(env: EnvSource = process.env): HarnessEnv {
  const slot = intVar('ORTUS_SLOT', env.ORTUS_SLOT, 0, MAX_SLOT) ?? 0;
  const ports = portsForSlot(slot);
  const role = oneOf<HarnessRole>('E2E_ROLE', env.E2E_ROLE, ['executor', 'verifier'], 'executor');
  const mode = oneOf<HarnessMode>('E2E_MODE', env.E2E_MODE, ['mock', 'stand'], 'mock');

  const appPort =
    intVar('PORT', env.PORT, 1, 65535) ?? (role === 'verifier' ? ports.verifier : ports.vite);
  const baseURL = env.E2E_BASE_URL?.trim();
  const appURL = baseURL ? baseURL.replace(/\/+$/, '') : `http://${LOCAL}:${appPort}`;
  const apiURL = `http://${env.HTTP_ADDR?.trim() || `${LOCAL}:${ports.api}`}`;

  const referencePort =
    intVar('REFERENCE_PORT', env.REFERENCE_PORT, 1, 65535) ??
    (flag(env.E2E_OWN_REFERENCE) ? ports.ownReference : SHARED_REFERENCE_PORT);
  const referenceURL = `http://${LOCAL}:${referencePort}`;

  const extra = (env.E2E_ALLOW_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const allowHosts = [
    ...new Set([
      `${LOCAL}:${appPort}`,
      `localhost:${appPort}`,
      hostOf(appURL),
      `${LOCAL}:${referencePort}`,
      `localhost:${referencePort}`,
      hostOf(apiURL),
      ...extra,
    ]),
  ];

  return {
    slot,
    role,
    mode,
    appPort,
    appURL,
    apiURL,
    storybookPort: ports.storybook,
    referencePort,
    referenceURL,
    referenceDir: env.REFERENCE_DIR?.trim() || 'design',
    referenceRef: env.REFERENCE_REF?.trim() || undefined,
    mcpOutputDir: `.playwright-mcp/${appPort}`,
    freshServer: role === 'verifier' || flag(env.E2E_FRESH_SERVER),
    startApp: !baseURL,
    stage: intVar('ORTUS_STAGE', env.ORTUS_STAGE, 0, 99) ?? 0,
    allowHosts,
    ci: flag(env.CI),
  };
}
