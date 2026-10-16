const call = async (name, args = {}) => (await fetch('http://127.0.0.1:9171/', { method: 'POST', body: JSON.stringify({ name, args }) })).text();
const res = (t) => { const m = /### Result\n([\s\S]*?)\n###/.exec(t); return m ? m[1] : t.slice(0, 300); };
const geo = `() => { const b = document.querySelector('.ox-org-switch'); if (!b) return 'нет переключателя'; const r = b.getBoundingClientRect(); const h = document.querySelector('header').getBoundingClientRect();
 const name = b.querySelector('.ox-org-name').getBoundingClientRect(); const sc = document.querySelector('.ox-org-scope'); const scr = sc && sc.getBoundingClientRect();
 const x = r.left + r.width/2; const pts = [r.top+1, r.top+r.height/2, r.bottom-1].map(y => { const e = document.elementFromPoint(x, y); return b.contains(e) ? 'switch' : (e && (e.className || e.tagName)); });
 const outside = [r.top - 2, r.bottom + 2].map(y => { const e = document.elementFromPoint(x, y); return e && (e.className || e.tagName); });
 const s = getComputedStyle(b);
 return JSON.stringify({ vw: innerWidth, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], header: [Math.round(h.top), Math.round(h.height)], name: [Math.round(name.top), Math.round(name.height)], scope: scr ? [Math.round(scr.top), Math.round(scr.height), sc.textContent] : null, hits: pts, outside, scrollW: document.documentElement.scrollWidth, cursor: s.cursor }); }`;
await call('browser_resize', { width: 1440, height: 900 });
await call('browser_navigate', { url: 'http://127.0.0.1:6101/?persona=therapist' });
await new Promise((r) => setTimeout(r, 2500));
for (const [w, h] of [[1440, 900], [768, 1024], [390, 844]]) {
  await call('browser_resize', { width: w, height: h });
  await new Promise((r) => setTimeout(r, 600));
  console.log(`${w}: ${res(await call('browser_evaluate', { function: geo }))}`);
}
// фокус с клавиатуры: Tab до переключателя, кольцо, снимок
await call('browser_resize', { width: 390, height: 844 });
await call('browser_navigate', { url: 'http://127.0.0.1:6101/?persona=therapist' });
await new Promise((r) => setTimeout(r, 2500));
const fn = `() => { const e = document.activeElement; const s = getComputedStyle(e); return (e.getAttribute('aria-label') || e.textContent.trim()).slice(0,50) + ' | ' + s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor + ' off ' + s.outlineOffset; }`;
for (let i = 0; i < 4; i++) {
  await call('browser_press_key', { key: 'Tab' });
  const f = res(await call('browser_evaluate', { function: fn }));
  console.log(`Tab ${i + 1}: ${f}`);
  if (f.includes('сменить бизнес')) { await call('browser_take_screenshot', { filename: 'impl-therapist-390-switcher-focus.png' }); break; }
}
await call('browser_press_key', { key: 'Enter' });
await new Promise((r) => setTimeout(r, 400));
const snap = await call('browser_snapshot');
console.log(snap.split('\n').filter((l) => /Бизнесы|сменить бизнес|Лотос|Альта/.test(l)).join('\n'));
await call('browser_take_screenshot', { filename: 'impl-therapist-390-switcher-open.png' });
await call('browser_press_key', { key: 'Escape' });
console.log('после Escape: ' + res(await call('browser_evaluate', { function: fn })));