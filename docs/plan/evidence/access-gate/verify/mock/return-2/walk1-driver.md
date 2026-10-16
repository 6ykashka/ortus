URL: http://127.0.0.1:6103/t/f04f636e-b66d-509e-ae10-9c27a18e3baa/today

Title: Ортус CRM

Styles 1440: ### Result
"{\"card\":{\"font\":\"14px/20.3px 400\",\"color\":\"rgb(28, 42, 38)\",\"bg\":\"rgb(255, 255, 255)\",\"border\":\"1px solid rgb(220, 226, 217)\",\"radius\":\"12px\",\"pad\":\"40px 24px\",\"gap\":\"12px\",\"w\":624,\"h\":265,\"maxW\":\"none\",\"tw\":\"wrap\",\"ls\":\"normal\"},\"circle\":{\"font\":\"14px/20.3px 400\",\"color\":\"rgb(76, 89, 85)\",\"bg\":\"rgb(236, 239, 234)\",\"border\":\"0px none rgb(76, 89, 85)\",\"radius\":\"50%\",\"pad\":\"0px\",\"gap\":\"normal\",\"w\":56,\"h\":56,\"maxW\":\"none\",\"tw\":\"wrap\",\"ls\":\"normal\"},\"chip\":{\"font\":\"12px/17.4px 600\",\"color\":\"rgb(76, 89, 85)\",\"bg\":\"rgb(236, 239, 234)\",\"border\":\"0px none rgb(76, 89, 85)\",\"radius\":\"999px\",\"pad\":\"2px 10px\",\"gap\":\"4px\",\"w\":152,\"h\":21,\"maxW\":\"none\",\"tw\":\"wrap\",\"ls\":\"normal\"},\"h1\":{\"font\":\"20px/29px 600\",\"color\":\"rgb(28, 42, 38)\",\"bg\":\"rgba(0, 0, 0, 0)\",\"border\":\"0px none rgb(28, 42, 38)\",\"radius\":\"0px\",\"pad\":\"0px\",\"gap\":\"normal\",\"w\":420,\"h\":29,\"maxW\":\"none\",\"tw\":\"balance\",\"ls\":\"-0.2px\"},\"p\":{\"font\":\"14px/20.3px 400\",\"color\":\"rgb(92, 105, 100)\",\"bg\":\"rgba(0, 0, 0, 0)\",\"border\":\"0px none rgb(92, 105, 100)\",\"radius\":\"0px\",\"pad\":\"0px\",\"gap\":\"normal\",\"w\":480,\"h\":41,\"maxW\":\"480px\",\"tw\":\"pretty\",\"ls\":\"normal\"},\"mainLabel\":null,\"h1count\":1,\"docTitle\":\"Ортус CRM\"}"
### Ran Playwright code
```js
await page.evaluate('() => { const g = document.querySelector(\'.ox-gate\'); if (!g) return \'no gate\';\n      const cs = (e) => { const c = getComputedStyle(e); return { font: c.fontSize + \'/\' + c.lineHeight + \' \' + c.fontWeight, color: c.color, bg: c.backgroundColor, border: c.border, radius: c.borderRadius, pad: c.padding, gap: c.gap, w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), maxW: c.maxWidth, tw: c.textWrap || c.textWrapStyle, ls: c.letterSpacing }; };\n      return JSON.stringify({ card: cs(g), circle: cs(g.children[0]), chip: cs(g.children[1]), h1: cs(g.querySelector(\'h1\')), p: cs(g.querySelector(\'p\')),\n        mainLabel: document.querySelector(\'main\')?.getAttribute(\'aria-labelledby\') ?? document.querySelector(\'main\')?.getAttribute(\'aria-label\'),\n        h1count: document.querySelectorAll(\'h1\').length, docTitle: document.title }); }');
```

Tab order 1440:
  "A|К содержимому|outline=solid 2px|shadow=false"
  "BUTTON|Уведомления|outline=solid 2px|shadow=false"
  "BUTTON|Профиль|outline=solid 2px|shadow=false"
  "BUTTON|todayСегодня|outline=solid 2px|shadow=false"
  "BUTTON|local_shippingАвтомобили|outline=solid 2px|shadow=false"
  "BUTTON|account_balance_walletПодотчёт|outline=solid 2px|shadow=false"
  "BUTTON|forumЧаты|outline=solid 2px|shadow=false"
  "BUTTON|menu_bookБаза знаний|outline=solid 2px|shadow=false"
  "BUTTON|descriptionДокументы|outline=solid 2px|shadow=false"
  "BODY|К содержимомуоортуспространство бизнесаd|outline=none 3px|shadow=false"
  "A|К содержимому|outline=solid 2px|shadow=false"
  "BUTTON|Уведомления|outline=solid 2px|shadow=false"
  "BUTTON|Профиль|outline=solid 2px|shadow=false"
  "BUTTON|todayСегодня|outline=solid 2px|shadow=false"
  "BUTTON|local_shippingАвтомобили|outline=solid 2px|shadow=false"
  "BUTTON|account_balance_walletПодотчёт|outline=solid 2px|shadow=false"
  "BUTTON|forumЧаты|outline=solid 2px|shadow=false"
  "BUTTON|menu_bookБаза знаний|outline=solid 2px|shadow=false"
  "BUTTON|descriptionДокументы|outline=solid 2px|shadow=false"
  "BODY|К содержимомуоортуспространство бизнесаd|outline=none 3px|shadow=false"
  "A|К содержимому|outline=solid 2px|shadow=false"
  "BUTTON|Уведомления|outline=solid 2px|shadow=false"
  "BUTTON|Профиль|outline=solid 2px|shadow=false"
  "BUTTON|todayСегодня|outline=solid 2px|shadow=false"
  "BUTTON|local_shippingАвтомобили|outline=solid 2px|shadow=false"

Layout 768: "{\"scrollW\":768,\"vw\":768,\"gateW\":624,\"bottomNav\":[\"Основная навигация:flex\",\"Навигация:none\"],\"smallTargets\":[\"К содержимому:36\",\"Уведомления:40\",\"Профиль:36\",\"todayСегодня:40\",\"local_shippingАвтомобили:40\",\"account_balance_walletПодотчёт:40\",\"forumЧаты:40\",\"menu_bookБаза знаний:40\",\"descriptionДокументы:40\"]}"

Layout 390: "{\"scrollW\":390,\"vw\":390,\"gateW\":362,\"bottomNav\":[\"Основная навигация:none\",\"Навигация:flex\"],\"smallTargets\":[\"К содержимому:36\",\"Уведомления:40\",\"Профиль:36\"]}"

Console:
### Result
Total messages: 4 (Errors: 1, Warnings: 0)

[DEBUG] [vite] connecting... @ http://127.0.0.1:6103/@vite/client:934
[DEBUG] [vite] connected. @ http://127.0.0.1:6103/@vite/client:1047
[INFO] %cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold @ http://127.0.0.1:6103/node_modules/.vite/deps/react-dom_client.js?v=91f9714d:15804
[ERROR] Failed to load resource: the server responded with a status of 404 (Not Found) @ http://127.0.0.1:6103/favicon.ico:0

Network:
### Result
5. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/7D8B79A2-8974-4D7B-A76A-F4F29624C06BQHbE00gYofKFnIcIYHgbFlthI_hWN_UaDw4cf_RPdxpspbbs-lFAJhMkFHHUzojpe6QNgVmfRcsWbxv7ECRkbQ/init?data=eyJ1cmwiOiJodHRwOi8vMTI3LjAuMC4xOjYxMDMvP3BlcnNvbmE9ZHJpdmVyIiwicGx1Z2lucyI6IndzbSZ3bnQmY2EmdnMmdWEmYWJuJmFibl9zaGFkb3cmY2ImeGhyX2NvbnRlbnQiLCJkYXRhIjp7ImRhdGEiOlt7InBsdWdpbiI6IndzbSIsInBhcmFtZXRlcnMiOiJ7XCJyZWZlcnJlclwiOlwiXCIsXCJzdHViSWRcIjpcIlwifSJ9LHsicGx1Z2luIjoid250IiwicGFyYW1ldGVycyI6IntcInJlZmVycmVyXCI6XCJcIn0ifSx7InBsdWdpbiI6InVhIiwicGFyYW1ldGVycyI6Int9In0seyJwbHVnaW4iOiJhYm4iLCJwYXJhbWV0ZXJzIjoie1wiaXNDc3NVcmxJbmplY3RlZFwiOmZhbHNlfSJ9LHsicGx1Z2luIjoiYWJuX3NoYWRvdyIsInBhcmFtZXRlcnMiOiJ7XCJpc0Nzc1VybEluamVjdGVkXCI6ZmFsc2V9In0seyJwbHVnaW4iOiJ4aHJfY29udGVudCIsInBhcmFtZXRlcnMiOiJ7XCJyZWZlcnJlclwiOlwiXCJ9In1dfSwiaXNUb3BMZXZlbCI6dHJ1ZSwicGFnZVN0YXJ0VGltZSI6MCwibmF2aWdhdGlvblN0YXJ0VGltZSI6MTc5MjA2NTQwOTQ2N30%3D&nocache=1b778&tm=2026-10-15T11%3A56%3A53.875Z => [200] OK
34. [POST] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/to/wsm.sessionActivated?tm=2026-10-15T11%3A56%3A54.614Z => [200] OK
219. [POST] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/to/abn.statInfo?tm=2026-10-15T11%3A56%3A55.175Z => [200] OK
294. [POST] http://127.0.0.1:6103/api/v1/dev/login => [200] 
295. [GET] http://127.0.0.1:6103/api/v1/me/context => [200] 
299. [GET] http://127.0.0.1:6103/api/v1/me/notifications/summary => [200] 
300. [POST] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/to/wsm.onHashChange?tm=2026-10-15T11%3A56%3A55.624Z => [200] OK
301. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=168e3&tm=2026-10-15T11%3A56%3A56.620Z => [200] OK
302. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=15473&tm=2026-10-15T11%3A56%3A57.124Z => [200] OK
303. [POST] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/to/dp.onGetFields?tm=2026-10-15T11%3A56%3A57.233Z => [200] OK
304. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=1442e&tm=2026-10-15T11%3A56%3A57.636Z => [200] OK
305. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=1dbdd&tm=2026-10-15T11%3A56%3A58.150Z => [200] OK
306. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=13ddf&tm=2026-10-15T11%3A56%3A58.662Z => [200] OK
307. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=1d31e&tm=2026-10-15T11%3A56%3A59.176Z => [200] OK
308. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=1e70a&tm=2026-10-15T11%3A56%3A59.681Z => [200] OK
309. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=1b948&tm=2026-10-15T11%3A57%3A00.183Z => [200] OK
310. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=191f4&tm=2026-10-15T11%3A57%3A00.699Z => [200] OK
311. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=1deae&tm=2026-10-15T11%3A57%3A01.201Z => [200] OK
312. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=1680e&tm=2026-10-15T11%3A57%3A01.703Z => [200] OK
313. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=1c2e2&tm=2026-10-15T11%3A57%3A02.211Z => [200] OK
314. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=14fe4&tm=2026-10-15T11%3A57%3A02.720Z => [200] OK
315. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=15b53&tm=2026-10-15T11%3A57%3A03.237Z => [200] OK
316. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=122ec&tm=2026-10-15T11%3A57%3A03.740Z => [200] OK
317. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=1c633&tm=2026-10-15T11%3A57%3A04.243Z => [200] OK
318. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=1f24b&tm=2026-10-15T11%3A57%3A04.759Z => [200] OK
319. [POST] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/to/wsm.sessionDeactivated?tm=2026-10-15T11%3A57%3A06.213Z => [200] OK
320. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=17bb8&tm=2026-10-15T11%3A57%3A06.762Z => [200] OK
321. [POST] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/to/wsm.sessionActivated?tm=2026-10-15T11%3A57%3A06.771Z => [200] OK
322. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=19a9f&tm=2026-10-15T11%3A57%3A08.771Z => [200] OK
323. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=172bc&tm=2026-10-15T11%3A57%3A10.778Z => [200] OK
324. [POST] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/to/wsm.sessionDeactivated?tm=2026-10-15T11%3A57%3A12.613Z => [200] OK
325. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=13d18&tm=2026-10-15T11%3A57%3A12.787Z => [200] OK
326. [POST] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/to/wsm.sessionActivated?tm=2026-10-15T11%3A57%3A13.683Z => [200] OK
327. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=10655&tm=2026-10-15T11%3A57%3A14.796Z => [200] OK
328. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=17653&tm=2026-10-15T11%3A57%3A16.805Z => [200] OK
329. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=1b8b4&tm=2026-10-15T11%3A57%3A18.813Z => [200] OK
330. [GET] http://gc.kis.v2.scr.kaspersky-labs.com/E8617EFB-8FB7-4FBE-9F88-0B777176C00E/3ADA35E0-09AF-4D5B-9BF0-818EE5686326/from?get&nocache=1a579&tm=2026-10-15T11%3A57%3A20.825Z => [200] OK

Note: 293 static requests not shown, run with "static" option to see them.