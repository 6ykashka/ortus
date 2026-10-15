// Аргументы Vite для скрипта dev: pnpm 9 передаёт разделитель «--» из `pnpm run dev -- <флаги>` буквально,
// а CLI Vite считает всё после «--» позиционными аргументами и теряет --mode, --host, --port.
export function viteArgs(argv: readonly string[]): string[] {
  return argv.filter((a) => a !== '--');
}
