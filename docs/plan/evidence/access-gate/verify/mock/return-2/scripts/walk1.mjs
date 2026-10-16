// Walk 1: driver gate (branch B), three widths, keyboard, console, network.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { start, snapPart } from './mcp.mjs';

const EV = process.env.EV;
const APP = 'http://127.0.0.1:6103';
const m = start();
await m.init();
const out = [];
const note = (s) => { out.push(s); console.log(s); };
try {
  await m.call('browser_resize', { width: 1440, height: 900 });
  await m.call('browser_navigate', { url: `${APP}/?persona=driver` });
  await m.call('browser_wait_for', { text: 'не подключена организацией' });
  let s = await m.call('browser_snapshot', {});
  writeFileSync(join(EV, 'driver-1440.snapshot.yml'), snapPart(s), 'utf8');
  note('URL: ' + (/Page URL: (\S+)/.exec(s)?.[1] ?? '?'));
  note('Title: ' + (/Page Title: (.*)/.exec(s)?.[1] ?? '?'));
  await m.call('browser_take_screenshot', { filename: join(process.env.MCP_OUT, 'driver-1440.png') });

  // computed styles of the gate card
  const st = await m.call('browser_evaluate', {
    function: `() => { const g = document.querySelector('.ox-gate'); if (!g) return 'no gate';
      const cs = (e) => { const c = getComputedStyle(e); return { font: c.fontSize + '/' + c.lineHeight + ' ' + c.fontWeight, color: c.color, bg: c.backgroundColor, border: c.border, radius: c.borderRadius, pad: c.padding, gap: c.gap, w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), maxW: c.maxWidth, tw: c.textWrap || c.textWrapStyle, ls: c.letterSpacing }; };
      return JSON.stringify({ card: cs(g), circle: cs(g.children[0]), chip: cs(g.children[1]), h1: cs(g.querySelector('h1')), p: cs(g.querySelector('p')),
        mainLabel: document.querySelector('main')?.getAttribute('aria-labelledby') ?? document.querySelector('main')?.getAttribute('aria-label'),
        h1count: document.querySelectorAll('h1').length, docTitle: document.title }); }`,
  });
  note('Styles 1440: ' + st);

  // keyboard: Tab order through interactive elements, focus visible
  const tabs = [];
  for (let i = 0; i < 25; i++) {
    await m.call('browser_press_key', { key: 'Tab' });
    const f = await m.call('browser_evaluate', {
      function: `() => { const e = document.activeElement; if (!e) return 'none'; const c = getComputedStyle(e);
        return (e.tagName + '|' + (e.getAttribute('aria-label') || e.textContent.trim().slice(0, 40)) + '|outline=' + c.outlineStyle + ' ' + c.outlineWidth + '|shadow=' + (c.boxShadow !== 'none')); }`,
    });
    tabs.push(/### Result\n([^\n]*)/.exec(f)?.[1] ?? f.slice(0, 200));
  }
  note('Tab order 1440:\n  ' + tabs.join('\n  '));

  for (const [w, h] of [[768, 1024], [390, 844]]) {
    await m.call('browser_resize', { width: w, height: h });
    await m.call('browser_wait_for', { time: 1 });
    s = await m.call('browser_snapshot', {});
    writeFileSync(join(EV, `driver-${w}.snapshot.yml`), snapPart(s), 'utf8');
    await m.call('browser_take_screenshot', { filename: join(process.env.MCP_OUT, `driver-${w}.png`) });
    const lay = await m.call('browser_evaluate', {
      function: `() => JSON.stringify({ scrollW: document.scrollingElement.scrollWidth, vw: innerWidth,
        gateW: Math.round(document.querySelector('.ox-gate')?.getBoundingClientRect().width ?? 0),
        bottomNav: [...document.querySelectorAll('nav')].map(n => (n.getAttribute('aria-label') || '') + ':' + getComputedStyle(n).display),
        smallTargets: [...document.querySelectorAll('button, a')].filter(e => e.offsetParent && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 44).map(e => (e.getAttribute('aria-label') || e.textContent.trim()).slice(0,30) + ':' + Math.round(e.getBoundingClientRect().height)) })`,
    });
    note(`Layout ${w}: ` + (/### Result\n([^\n]*)/.exec(lay)?.[1] ?? lay));
  }
  note('Console:\n' + (await m.call('browser_console_messages', { level: 'debug' })));
  note('Network:\n' + (await m.call('browser_network_requests', { static: false })));
} catch (e) {
  note('ERROR ' + e.message);
} finally {
  writeFileSync(join(EV, 'walk1-driver.md'), out.join('\n\n'), 'utf8');
  m.save('walk1-driver.log.txt');
  m.close();
  process.exit(0);
}
