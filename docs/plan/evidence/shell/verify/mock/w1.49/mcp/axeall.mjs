// axe по персонажам × ширинам в реализации (через axe.mjs логику).
import { execFileSync } from 'node:child_process';

const AX = process.argv[2];
const call = async (name, args = {}) => {
  const r = await fetch('http://127.0.0.1:9117/', { method: 'POST', body: JSON.stringify({ name, args }) });
  return r.text();
};
const ax = (label) => process.stdout.write(execFileSync('node', ['axe.mjs', label, AX], { encoding: 'utf8' }));
const clickByName = async (role, name) => {
  const s = await call('browser_snapshot');
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`- '?${role} "${esc}[^"]*"[^\\n]*\\[ref=(\\w+)\\]`).exec(s);
  if (!m) return false;
  await call('browser_click', { element: name, target: m[1], ref: m[1] });
  return true;
};
for (const p of ['owner', 'operator', 'manager', 'driver', 'therapist', 'foreman', 'therapist@t-lotos']) {
  await call('browser_resize', { width: 1440, height: 900 });
  await call('browser_navigate', { url: `http://127.0.0.1:6101/?persona=${encodeURIComponent(p)}` });
  await new Promise((r) => setTimeout(r, 2000));
  for (const [w, h] of [[1440, 900], [768, 1024], [390, 844]]) {
    await call('browser_resize', { width: w, height: h });
    await new Promise((r) => setTimeout(r, 500));
    ax(`${p} ${w}`);
  }
  await call('browser_resize', { width: 1440, height: 900 });
  if (await clickByName('button', 'Профиль')) ax(`${p} 1440 профиль`);
  await call('browser_press_key', { key: 'Escape' });
  if (p !== 'operator' && (await clickByName('button', 'Уведомления'))) ax(`${p} 1440 уведомления`);
  await call('browser_press_key', { key: 'Escape' });
  await call('browser_resize', { width: 390, height: 844 });
  if (await clickByName('button', 'Ещё')) ax(`${p} 390 лист`);
  await call('browser_press_key', { key: 'Escape' });
}
