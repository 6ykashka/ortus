// Персонажи × ширины через MCP: снимок дерева, снимок экрана, раскладка (боковая/рейл/нижняя, прокрутка, цели).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EV = process.argv[2];
const personas = process.argv[3].split(',');
const call = async (name, args = {}) => {
  const r = await fetch('http://127.0.0.1:9117/', { method: 'POST', body: JSON.stringify({ name, args }) });
  return r.text();
};
const layout = `() => { const side = document.querySelector('nav[aria-label="Основная навигация"]'); const bottom = document.querySelector('nav[aria-label="Навигация"]');
  const vis = (e) => !!e && !!e.getClientRects().length && getComputedStyle(e).display !== 'none';
  return JSON.stringify({ url: location.pathname, side: vis(side) ? getComputedStyle(side).width : 'нет', bottom: vis(bottom) ? [...bottom.querySelectorAll('button')].map(b => b.textContent.replace(/^[a-z_]+/, '').trim() + '/' + Math.round(b.getBoundingClientRect().height)).join(', ') : 'нет',
    menu: vis(side) ? [...side.querySelectorAll('button')].map(b => b.title || b.textContent.trim()).join(', ') : '', hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    scope: document.querySelector('header .ox-org-scope')?.textContent ?? document.querySelector('header select')?.getAttribute('aria-label'), h1: document.querySelector('h1')?.textContent,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--ox-accent').trim(), small: [...document.querySelectorAll('header button, nav button')].filter(b => vis(b) && b.getBoundingClientRect().height < 36).map(b => b.textContent.trim()) }); }`;
const out = [];
for (const p of personas) {
  await call('browser_resize', { width: 1440, height: 900 });
  await call('browser_navigate', { url: `http://127.0.0.1:6101/?persona=${encodeURIComponent(p)}` });
  await new Promise((r) => setTimeout(r, 2000));
  for (const [w, h] of [[1440, 900], [768, 1024], [390, 844]]) {
    await call('browser_resize', { width: w, height: h });
    await new Promise((r) => setTimeout(r, 600));
    const snap = await call('browser_snapshot');
    writeFileSync(join(EV, `snap-${p.replace('@', '-')}-${w}.md`), snap);
    await call('browser_take_screenshot', { filename: `impl-${p.replace('@', '-')}-${w}.png` });
    const l = await call('browser_evaluate', { function: layout });
    const m = /### Result\n"([\s\S]*?)"\n/.exec(l);
    const line = `${p} ${w}: ${m ? JSON.parse(`"${m[1]}"`) : l.slice(0, 300)}`;
    out.push(line);
    console.log(line);
  }
}
writeFileSync(join(EV, `widths-${personas.join('_').replace(/@/g, '-')}.md`), out.join('\n') + '\n');
