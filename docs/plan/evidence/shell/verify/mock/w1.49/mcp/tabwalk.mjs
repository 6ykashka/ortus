// node tabwalk.mjs <n> — n нажатий Tab через MCP, после каждого — фокус и кольцо.
const call = async (name, args = {}) => {
  const r = await fetch('http://127.0.0.1:9117/', { method: 'POST', body: JSON.stringify({ name, args }) });
  return r.text();
};
const n = Number(process.argv[2] ?? 20);
const fn = `() => { const e = document.activeElement; const s = getComputedStyle(e); return (e.getAttribute('aria-label') || e.textContent.trim().replace(/^[a-z_]+/, '')).slice(0,40) + ' | ' + e.tagName.toLowerCase() + ' | ' + s.outlineStyle + ' ' + s.outlineWidth; }`;
for (let i = 0; i < n; i++) {
  await call('browser_press_key', { key: 'Tab' });
  const t = await call('browser_evaluate', { function: fn });
  const m = /### Result\n([\s\S]*?)\n###/.exec(t);
  console.log(`${i + 1}. ${m ? m[1] : t.slice(0, 100)}`);
}
