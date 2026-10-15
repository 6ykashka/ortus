// Скрипт dev @ortus/web (W0.09): `vite` с аргументами без разделителя «--» (см. src/app/dev-server.ts).
// Харнесс W0.05: `corepack pnpm --filter @ortus/web run dev -- --mode e2e --host 127.0.0.1 --port <5200+slot>`.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { viteArgs } from '../src/app/dev-server.ts';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const vite = join(app, 'node_modules', 'vite', 'bin', 'vite.js');
const child = spawn(process.execPath, [vite, ...viteArgs(process.argv.slice(2))], {
  cwd: app,
  stdio: 'inherit',
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
