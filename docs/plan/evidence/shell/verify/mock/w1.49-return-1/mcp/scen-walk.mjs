import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const EV = process.argv[2];
const A = 'http://127.0.0.1:6101';
const call = async (name, args = {}) => (await fetch('http://127.0.0.1:9171/', { method: 'POST', body: JSON.stringify({ name, args }) })).text();
const res = (t) => { const m = /### Result\n([\s\S]*?)\n###/.exec(t); return m ? m[1] : t.slice(0, 400); };
const ev = async (f) => res(await call('browser_evaluate', { function: f }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = async (file) => { const s = await call('browser_snapshot'); if (file) writeFileSync(join(EV, file), s); return s; };
const click = async (role, name, n = 0) => {
  const s = await call('browser_snapshot');
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const all = [...s.matchAll(new RegExp(`- '?${role} "${esc}"[^\\n]*\\[ref=(\\w+)\\]`, 'g'))];
  if (!all[n]) return `НЕТ ${role} «${name}»`;
  await call('browser_click', { element: `${role} «${name}»`, target: all[n][1], ref: all[n][1] });
  return `клик ${role} «${name}»`;
};
const scen = (body) => ev(`async () => { const h = {'Content-Type':'application/json','Idempotency-Key': crypto.randomUUID()}; const c = /(?:^|;\\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1]; if (c) h['X-CSRF-Token'] = decodeURIComponent(c); const r = await fetch('/api/v1/dev/scenario', {method:'POST', credentials:'include', headers:h, body: ${JSON.stringify(JSON.stringify(body))}}); return r.status; }`);
const go = async (url, w = 1440, h = 900) => { await call('browser_resize', { width: w, height: h }); await call('browser_navigate', { url }); await sleep(2000); };
const out = [];
const log = (l) => { out.push(l); console.log(l); };
const grep = (s, re) => s.split('\n').filter((l) => re.test(l)).map((l) => l.trim()).join(' / ');

// 1. Выйти: владелец, сеть и консоль после logout
await go(`${A}/?persona=owner`);
await call('browser_console_messages', {}); // сброс не гарантирован — фиксируем отметку
const mark = await ev('() => performance.now()');
log('1 ' + (await click('button', 'Профиль')));
const prof = await snap('snap-owner-profile.md');
log('  профиль: ' + grep(prof, /dialog "Профиль"|Выйти|Владелец|Дарья/));
log('  ' + (await click('button', 'Выйти')));
await sleep(2500);
log('  url: ' + (await ev('() => location.pathname')));
const net = await call('browser_network_requests', {});
writeFileSync(join(EV, 'network-logout.md'), net);
const after = net.split('\n').filter((l) => /\/api\//.test(l));
const iLogout = after.findIndex((l) => /auth\/logout/.test(l));
log('  после logout запросов API: ' + JSON.stringify(after.slice(iLogout + 1)));
log('  401 в сети: ' + after.filter((l) => /401/.test(l)).length);
const con = await call('browser_console_messages', {});
writeFileSync(join(EV, 'console-logout.md'), con);
log('  консоль (ошибки/предупреждения): ' + con.split('\n').filter((l) => /\[(ERROR|WARNING|error|warning)\]/i.test(l)).join(' | '));
await snap('snap-after-logout.md');

// 2. Массажист «Лотоса» 390 — лист «Все разделы»
await go(`${A}/?persona=therapist%40t-lotos`, 390, 844);
log('2 ' + (await click('button', 'Ещё')));
await sleep(500);
const sheet = await snap('snap-therapist-lotos-390-sheet.md');
log('  лист: ' + grep(sheet, /dialog|button "/).slice(0, 600));
await call('browser_take_screenshot', { filename: 'impl-therapist-lotos-390-sheet.png' });
await call('browser_press_key', { key: 'Escape' });
log('  фокус после Escape: ' + (await ev('() => document.activeElement.getAttribute("aria-label") || document.activeElement.textContent.trim()')));

// 3. Массажист «Альты» — прямой URL /cash
await go(`${A}/?persona=therapist`);
const tid = await ev('() => location.pathname.split("/")[2]');
await go(`${A}/t/${JSON.parse(tid)}/cash`);
const gate = await snap('snap-therapist-cash-gate.md');
log('3 /cash: ' + grep(gate, /heading|paragraph|Нет доступа/).slice(0, 500));
await call('browser_take_screenshot', { filename: 'impl-therapist-cash-gate-1440.png' });

// 4. Escape в «Профиль» → фокус
await go(`${A}/?persona=driver`);
log('4 ' + (await click('button', 'Профиль')));
const dp = await snap('snap-driver-profile.md');
log('  профиль водителя: ' + grep(dp, /dialog|Водитель|Ролей|Назначения|Выйти/));
await call('browser_press_key', { key: 'Escape' });
log('  фокус: ' + (await ev('() => { const e = document.activeElement; return e.getAttribute("aria-label") + " " + getComputedStyle(e).outlineStyle; }')));

// 5. Кадр загрузки и ошибка загрузки
await go(`${A}/?persona=owner`);
log('5 scen loading ' + (await scen({ scenario: 'getMyContext=loading' })));
await call('browser_navigate', { url: `${A}/` }); await sleep(1500);
const ld = await snap('snap-loading-1440.md');
log('  загрузка: ' + grep(ld, /status|Загруж|изолир|navigation/).slice(0, 400));
await call('browser_take_screenshot', { filename: 'impl-loading-1440.png' });
log('  scen offline ' + (await scen({ scenario: 'getMyContext=offline' })));
await call('browser_navigate', { url: `${A}/` }); await sleep(3000);
const er = await snap('snap-error-offline.md');
log('  ошибка: ' + grep(er, /alert|Не удалось|Повтор|button/).slice(0, 400));
await call('browser_take_screenshot', { filename: 'impl-error-offline-1440.png' });
log('  reset ' + (await scen({ reset: true, scenario: null })));

// 6. storage-full у владельца и у массажиста
await go(`${A}/?persona=owner`);
log('6 storage-full ' + (await scen({ preset: 'storage-full' })));
await call('browser_navigate', { url: `${A}/` }); await sleep(2000);
log('  владелец: ' + grep(await snap('snap-owner-storage.md'), /Место организации|button "Открыть|alert|status/).slice(0, 400));
await go(`${A}/?persona=therapist`);
log('  массажист: ' + grep(await snap('snap-therapist-storage.md'), /Место организации|alert|status/).slice(0, 400));
await go(`${A}/?persona=owner`);
log('  reset ' + (await scen({ reset: true, scenario: null })));

// 7. trial-ended
log('7 trial-ended ' + (await scen({ preset: 'trial-ended' })));
await call('browser_navigate', { url: `${A}/` }); await sleep(2000);
log('  владелец: ' + grep(await snap('snap-owner-trial.md'), /Пробный|alert|status|Демо/).slice(0, 400));
log('  reset ' + (await scen({ reset: true, scenario: null })));

// 8. 404
await go(`${A}/?persona=owner`);
const t2 = JSON.parse(await ev('() => location.pathname.split("/")[2]'));
await call('browser_navigate', { url: `${A}/t/${t2}/no-such-page` }); await sleep(1500);
log('8 404 в оболочке: ' + grep(await snap('snap-404-in-shell.md'), /heading|link|Страница/).slice(0, 300));
await call('browser_navigate', { url: `${A}/t/00000000-0000-4000-8000-000000000000/home` }); await sleep(1500);
log('  чужая организация: ' + grep(await snap('snap-404-foreign.md'), /heading|link|Страница/).slice(0, 300));
await call('browser_navigate', { url: `${A}/whatever` }); await sleep(1500);
log('  неизвестный путь: ' + grep(await snap('snap-404-unknown.md'), /heading|link|Страница/).slice(0, 300));

// 9. Нужен вход: без сессии
await call('browser_navigate', { url: `${A}/auth/login` }); await sleep(1000);
await ev(`async () => { const c = /(?:^|;\\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1]; const h = {'Idempotency-Key': crypto.randomUUID()}; if (c) h['X-CSRF-Token'] = decodeURIComponent(c); const r = await fetch('/api/v1/auth/logout', {method:'POST', credentials:'include', headers:h}); return r.status; }`);
await call('browser_navigate', { url: `${A}/t/${t2}/home` }); await sleep(2000);
log('9 без сессии: ' + (await ev('() => location.pathname')) + ' ' + grep(await snap('snap-need-login.md'), /heading|button|link|Нужен/).slice(0, 300));

// 10. Офлайн в оболочке (context offline)
await go(`${A}/?persona=driver`);
await call('browser_evaluate', { function: '() => { window.dispatchEvent(new Event("offline")); return navigator.onLine; }' });
await sleep(800);
log('10 offline-событие: ' + grep(await snap('snap-driver-offline.md'), /Нет связи|status|alert/).slice(0, 400));

const cons = await call('browser_console_messages', {});
writeFileSync(join(EV, 'console-all.md'), cons);
const nets = await call('browser_network_requests', {});
writeFileSync(join(EV, 'network-all.md'), nets);
log('хосты сети: ' + JSON.stringify([...new Set([...nets.matchAll(/https?:\/\/([^/\s\]]+)/g)].map((m) => m[1]))]));
log('realtime-tickets в сети: ' + (nets.match(/realtime-tickets/g) || []).length);
writeFileSync(join(EV, 'scenarios.md'), out.join('\n') + '\n');