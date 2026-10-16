import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const EV = process.argv[2];
const call = async (name, args = {}) => (await fetch('http://127.0.0.1:9171/', { method: 'POST', body: JSON.stringify({ name, args }) })).text();
const res = (t) => { const m = /### Result\n([\s\S]*?)\n###/.exec(t); return m ? m[1] : t.slice(0, 300); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 1440: фокус переключателя
await call('browser_resize', { width: 1440, height: 900 });
await call('browser_navigate', { url: 'http://127.0.0.1:6101/?persona=therapist' });
await sleep(2500);
const fn = `() => { const e = document.activeElement; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return (e.getAttribute('aria-label') || e.textContent.trim()).slice(0,40) + ' top=' + r.top + ' outline ' + s.outlineWidth + ' off ' + s.outlineOffset + ' → верх кольца y=' + (r.top - parseFloat(s.outlineOffset) - parseFloat(s.outlineWidth)); }`;
for (let i = 0; i < 4; i++) {
  await call('browser_press_key', { key: 'Tab' });
  const f = res(await call('browser_evaluate', { function: fn }));
  console.log(`1440 Tab ${i + 1}: ${f}`);
  if (f.includes('сменить бизнес')) { await call('browser_take_screenshot', { filename: 'impl-therapist-1440-switcher-focus.png' }); break; }
}
await call('browser_press_key', { key: 'Enter' });
await sleep(400);
console.log(execFileSync('node', ['axe.mjs', 'therapist 1440 поповер «Бизнесы»', join(EV, 'axe.md')], { encoding: 'utf8' }));
await call('browser_press_key', { key: 'Escape' });
// эталон: массажист «Лотоса» 1440 — дерево
await call('browser_navigate', { url: 'http://127.0.0.1:4117/%D0%9E%D1%80%D1%82%D1%83%D1%81%20CRM.dc.html' });
await sleep(4000);
const s0 = await call('browser_snapshot');
const opts = [...s0.matchAll(/option "([^"]*Массажист[^"]*)"/g)].map((m) => m[1]);
console.log('опции персонажа эталона: ' + JSON.stringify(opts));
writeFileSync(join(EV, 'ref-snap-initial.md'), s0);