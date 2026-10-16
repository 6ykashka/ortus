// node scen.mjs '<json body>' — POST /api/v1/dev/scenario из страницы (CSRF, Idempotency-Key), как shell.helpers.ts.
const body = process.argv[2];
const fn = `async () => { const h = {'Content-Type':'application/json','Idempotency-Key': crypto.randomUUID()}; const c = /(?:^|;\\s*)ortus_csrf=([^;]+)/.exec(document.cookie)?.[1]; if (c) h['X-CSRF-Token'] = decodeURIComponent(c); const r = await fetch('/api/v1/dev/scenario', {method:'POST', credentials:'include', headers:h, body: ${JSON.stringify(body)}}); return r.status + ' ' + (await r.text()).slice(0,200); }`;
const r = await fetch('http://127.0.0.1:9117/', {
  method: 'POST',
  body: JSON.stringify({ name: 'browser_evaluate', args: { function: fn } }),
});
process.stdout.write((await r.text()).split('### Ran')[0]);
