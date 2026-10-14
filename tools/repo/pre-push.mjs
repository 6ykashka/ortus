// Хук pre-push (W0.03): после `pnpm run test` решает, нужен ли e2e-smoke (`--grep @smoke`).
// verification-protocol.md §6: smoke — только для изменённых страниц. Харнесс e2e — W0.05.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PLAYWRIGHT_CONFIG = 'frontend/apps/web/playwright.config.ts';
const PAGE_SOURCES = [
  'frontend/apps/web/src/',
  'frontend/packages/ui/src/',
  'frontend/packages/tokens/',
  'frontend/packages/texts/src/',
];

/** @param {{changed: string[], hasPlaywright: boolean}} input */
export function decide({ changed, hasPlaywright }) {
  if (!changed.some((f) => PAGE_SOURCES.some((p) => f.startsWith(p)))) {
    return { runSmoke: false, message: 'smoke пропущен: нет изменений страниц' };
  }
  if (!hasPlaywright) {
    return { runSmoke: false, message: `smoke пропущен: нет ${PLAYWRIGHT_CONFIG}` };
  }
  return { runSmoke: true, message: 'smoke: изменены страницы' };
}

function changedFiles() {
  for (const base of ['@{upstream}', 'main']) {
    const r = spawnSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' });
    if (r.status === 0) return r.stdout.split('\n').filter(Boolean);
  }
  return [];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = decide({ changed: changedFiles(), hasPlaywright: existsSync(PLAYWRIGHT_CONFIG) });
  console.log(r.message);
  if (r.runSmoke) {
    const s = spawnSync(
      'pnpm',
      // --pass-with-no-tests: до первых @smoke-тестов (W0.09) Playwright иначе падает «No tests found».
      [
        '--filter',
        '@ortus/web',
        'exec',
        'playwright',
        'test',
        '--grep',
        '@smoke',
        '--pass-with-no-tests',
      ],
      {
        stdio: 'inherit',
        shell: process.platform === 'win32',
      },
    );
    process.exit(s.status ?? 1);
  }
}
