// node act.mjs click <role> <name> [n]   — клик по роли и подписи из свежего снимка (n-е совпадение, с 0)
// node act.mjs snap [file]               — снимок дерева (только yaml)
// node act.mjs key <Key>                 — нажатие клавиши
import { writeFileSync } from 'node:fs';

const call = async (name, args = {}) => {
  const r = await fetch('http://127.0.0.1:9171/', { method: 'POST', body: JSON.stringify({ name, args }) });
  return r.text();
};
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'snap') {
  const s = await call('browser_snapshot');
  if (rest[0]) writeFileSync(rest[0], s);
  process.stdout.write(s);
} else if (cmd === 'shot') {
  process.stdout.write((await call('browser_take_screenshot', { filename: rest[0], fullPage: false })).slice(0, 300));
} else if (cmd === 'nav') {
  process.stdout.write((await call('browser_navigate', { url: rest[0] })).split('### Snapshot')[0]);
} else if (cmd === 'size') {
  process.stdout.write((await call('browser_resize', { width: Number(rest[0]), height: Number(rest[1]) })).slice(0, 200));
} else if (cmd === 'select') {
  // select <combobox name> <value>
  const s = await call('browser_snapshot');
  const re = new RegExp(`combobox "${rest[0]}"[^\\n]*\\[ref=(\\w+)\\]`);
  const ref = re.exec(s)?.[1];
  process.stdout.write((await call('browser_select_option', { element: rest[0], target: ref, ref, values: [rest[1]] })).slice(0, 300));
} else if (cmd === 'refpanel') {
  await new Promise((r) => setTimeout(r, 2500));
  process.stdout.write(await call('browser_evaluate', { function: "() => { const p = document.querySelector('[aria-label=\"Панель демонстрации\"]'); if (p) p.style.display = 'none'; return !!p; }" }));
} else if (cmd === 'key') {
  process.stdout.write((await call('browser_press_key', { key: rest[0] })).slice(0, 600));
} else if (cmd === 'click') {
  const [role, name, n = '0'] = rest;
  const s = await call('browser_snapshot');
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`- '?${role} "${esc}"[^\\n]*\\[ref=(\\w+)\\]`, 'g');
  const all = [...s.matchAll(re)];
  if (!all[Number(n)]) {
    console.log(`НЕТ ${role} «${name}» в снимке`);
    process.exit(1);
  }
  const out = await call('browser_click', { element: `${role} «${name}»`, target: all[Number(n)][1], ref: all[Number(n)][1] });
  process.stdout.write(out.split('### Snapshot')[0]);
}
