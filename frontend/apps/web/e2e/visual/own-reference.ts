// W2.94 · Собственный сервер эталона (tools/design-preview.js --offline --ref <тег>) для visual-спеков,
// чьего макета нет в снимке общего эталона (в CI он на design-stage-1, Q-W2.70-15).
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

import { referenceUrl } from '@ortus/e2e-kit';

export interface OwnReference {
  readonly url: string;
  /** Гасит сервер и ждёт завершения процесса. */
  stop(): Promise<void>;
}

export interface OwnReferenceOptions {
  repoRoot: string;
  /** Git-ссылка снимка эталона (тег design-…). */
  ref: string;
  /** Файл макета: по нему проверяется готовность сервера. */
  probeFile: string;
  /** Исполняемый файл node; по умолчанию текущий. */
  execPath?: string;
  /** Ожидание готовности, мс. */
  timeoutMs?: number;
}

const STDERR_TAIL = 800;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

/** Запускает design-preview на свободном порту и ждёт, пока probeFile не ответит. */
export async function startOwnReference(o: OwnReferenceOptions): Promise<OwnReference> {
  const port = await freePort();
  const child = spawn(
    o.execPath ?? process.execPath,
    ['tools/design-preview.js', 'design', String(port), '--offline', '--ref', o.ref],
    { cwd: o.repoRoot, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL);
  });
  let spawnError: Error | undefined;
  child.once('error', (e) => {
    spawnError = e;
  });
  const exited = new Promise<void>((resolve) => {
    child.once('close', () => resolve());
  });
  const kill = (): void => {
    child.kill();
  };
  process.once('exit', kill);
  const stop = async (): Promise<void> => {
    process.removeListener('exit', kill);
    if (child.exitCode === null && child.signalCode === null && !spawnError) {
      child.kill();
      await exited;
    }
  };

  const url = `http://127.0.0.1:${port}`;
  const probe = referenceUrl(url, o.probeFile);
  const deadline = Date.now() + (o.timeoutMs ?? 20_000);
  while (Date.now() < deadline) {
    if (spawnError) {
      process.removeListener('exit', kill);
      throw new Error(`design-preview --ref ${o.ref}: не удалось запустить: ${spawnError.message}`);
    }
    if (child.exitCode !== null) {
      process.removeListener('exit', kill);
      throw new Error(
        `design-preview --ref ${o.ref} завершился с кодом ${child.exitCode}: ${stderr.trim()}`,
      );
    }
    const ok = await fetch(probe).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return { url, stop };
    await new Promise((r) => setTimeout(r, 200));
  }
  await stop();
  throw new Error(
    `design-preview --ref ${o.ref}: ${probe} не отвечает за ${o.timeoutMs ?? 20_000} мс. ${stderr.trim()}`,
  );
}
