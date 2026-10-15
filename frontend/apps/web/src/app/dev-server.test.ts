// Скрипт dev: харнесс W0.05 запускает `pnpm --filter @ortus/web run dev -- --mode e2e --port <5200+slot>`;
// pnpm 9 передаёт «--» в команду буквально, и Vite игнорирует всё после него (порт 5173 вместо порта слота).
import { describe, expect, it } from 'vitest';

import { viteArgs } from './dev-server.ts';

describe('viteArgs', () => {
  it('убирает разделитель «--», переданный pnpm, и сохраняет флаги Vite', () => {
    expect(
      viteArgs(['--', '--mode', 'e2e', '--host', '127.0.0.1', '--port', '5213', '--strictPort']),
    ).toEqual(['--mode', 'e2e', '--host', '127.0.0.1', '--port', '5213', '--strictPort']);
  });

  it('без разделителя — аргументы как есть', () => {
    expect(viteArgs(['--port', '5213'])).toEqual(['--port', '5213']);
  });
});
