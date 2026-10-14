// Заглушка цели make / скрипта pnpm (W0.03). Владелец цели заменяет строку скрипта в
// package.json (одна строка через интегратора). Код 2 — «не реализовано», чтобы CI не считал успехом.
const [target = '?', owner = '?'] = process.argv.slice(2);
console.error(`${target}: заглушка W0.03, реализует ${owner}`);
process.exit(2);
