import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const EV = process.argv[2];
const call = async (name, args = {}) => (await fetch('http://127.0.0.1:9171/', { method: 'POST', body: JSON.stringify({ name, args }) })).text();
const res = (t) => { const m = /### Result\n([\s\S]*?)\n###/.exec(t); return m ? m[1] : t.slice(0, 300); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vals = res(await call('browser_evaluate', { function: `() => JSON.stringify([...document.querySelectorAll('select option')].filter(o => /Массажист/.test(o.textContent)).map(o => o.value))` }));
console.log('values: ' + vals);
const v = JSON.parse(JSON.parse(vals)).find((x) => /lotos/i.test(x));
const s = await call('browser_snapshot');
const ref = /combobox "([^"]*)"[^\n]*\[ref=(\w+)\]/.exec(s.split('\n').find((l) => /combobox/.test(l) && /Персонаж|Роль|Кто/.test(l)) || '');
console.log('combobox: ' + (ref && ref[1]) + ' value ' + v);
await call('browser_select_option', { element: ref[1], target: ref[2], ref: ref[2], values: [v] });
await sleep(2500);
await call('browser_evaluate', { function: `() => { const p = document.querySelector('[aria-label="Панель демонстрации"]'); if (p) p.style.display = 'none'; return !!p; }` });
for (const [w, h] of [[1440, 900], [390, 844]]) {
  await call('browser_resize', { width: w, height: h });
  await sleep(1200);
  const sn = await call('browser_snapshot');
  writeFileSync(join(EV, `ref-snap-therapist-lotos-${w}.md`), sn);
  await call('browser_take_screenshot', { filename: `ref-therapist-lotos-${w}.png` });
  console.log(w + ': ' + sn.split('\n').filter((l) => /button "|navigation|heading/.test(l)).map((l) => l.trim().replace(/ \[ref=\w+\]| \[cursor=pointer\]/g, '')).join(' / ').slice(0, 900));
}