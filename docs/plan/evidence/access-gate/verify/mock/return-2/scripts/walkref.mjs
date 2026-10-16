// Reference (design-stage-1 on 4119): driver and foreman gate, snapshot + screenshots at 1440/768/390.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { start, snapPart, ref } from './mcp.mjs';

const EV = process.env.EV;
const OUT = process.env.MCP_OUT;
const URL = 'http://127.0.0.1:4119/' + encodeURIComponent('Ортус CRM.dc.html');
const m = start();
await m.init();
const out = [];
const note = (s) => { out.push(s); console.log(s); };
try {
  for (const persona of (process.env.PERSONAS ?? 'driver,foreman').split(',')) {
    await m.call('browser_resize', { width: 1440, height: 900 });
    await m.call('browser_navigate', { url: URL });
    await m.call('browser_wait_for', { time: 8 });
    let s = await m.call('browser_snapshot', {});
    let sel; try { sel = ref(s, 'combobox', 'Персонаж'); } catch (e) { writeFileSync(join(EV, 'ref-nopanel.snapshot.yml'), snapPart(s), 'utf8'); throw e; }
    await m.call('browser_select_option', { element: 'Персонаж', target: sel, values: [persona] });
    await m.call('browser_wait_for', { time: 4 });
    await m.call('browser_evaluate', {
      function: `() => { const p = document.querySelector('[aria-label="Панель демонстрации"]'); if (p) p.style.display = 'none'; return !!p; }`,
    });
    for (const [w, h] of [[1440, 900], [768, 1024], [390, 844]]) {
      await m.call('browser_resize', { width: w, height: h });
      await m.call('browser_wait_for', { time: 1 });
      s = await m.call('browser_snapshot', {});
      writeFileSync(join(EV, `ref-${persona}-${w}.snapshot.yml`), snapPart(s), 'utf8');
      await m.call('browser_take_screenshot', { filename: join(OUT, `ref-${persona}-${w}.png`) });
    }
    const st = await m.call('browser_evaluate', {
      function: `() => { const h = [...document.querySelectorAll('h1')].find(x => /подключ/.test(x.textContent)); if (!h) return 'no gate'; const g = h.parentElement;
        const cs = (e) => { const c = getComputedStyle(e); return { font: c.fontSize + '/' + c.lineHeight + ' ' + c.fontWeight, color: c.color, bg: c.backgroundColor, border: c.border, radius: c.borderRadius, pad: c.padding, gap: c.gap, w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), maxW: c.maxWidth, tw: c.textWrap || c.textWrapStyle, ls: c.letterSpacing }; };
        return JSON.stringify({ card: cs(g), circle: cs(g.children[0]), chip: cs(g.children[1]), h1: cs(h), p: cs(g.querySelector('p')), btn: g.querySelector('button')?.textContent }); }`,
    });
    note(`Ref ${persona} 390 styles: ` + (/### Result\n([^\n]*)/.exec(st)?.[1] ?? st));
  }
} catch (e) {
  note('ERROR ' + e.message);
} finally {
  writeFileSync(join(EV, 'walk-ref.md'), out.join('\n\n'), 'utf8');
  m.save('walk-ref.log.txt');
  m.close();
  process.exit(0);
}
