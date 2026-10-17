### Result
300. [GET] http://127.0.0.1:5213/api/v1/me/context => [200] 
310. [GET] http://127.0.0.1:5213/api/v1/platform/tenants?limit=200 => [200] 
311. [GET] http://127.0.0.1:5213/api/v1/platform/audit-events?limit=6 => [200] 
312. [GET] http://127.0.0.1:5213/api/v1/platform/tenants/f04f636e-b66d-509e-ae10-9c27a18e3baa/subscription => [429] 
313. [GET] http://127.0.0.1:5213/api/v1/platform/tenants/e4f2195f-f5a3-5f61-98be-f6ed76ea565a/subscription => [429] 
314. [GET] http://127.0.0.1:5213/api/v1/platform/tenants/3f3853d6-1917-5dfd-8abb-d53f181d6df0/subscription => [429] 
315. [GET] http://127.0.0.1:5213/api/v1/platform/tenants/abdf3e10-8013-5327-af36-1bf84b2b72e7/subscription => [429] 
316. [GET] http://127.0.0.1:5213/api/v1/platform/tenants/f04f636e-b66d-509e-ae10-9c27a18e3baa => [200] 
317. [POST] http://127.0.0.1:5213/api/v1/dev/scenario => [200] 
318. [GET] http://127.0.0.1:5213/api/v1/platform/tenants/f04f636e-b66d-509e-ae10-9c27a18e3baa/subscription => [200] 
319. [GET] http://127.0.0.1:5213/api/v1/platform/tenants/e4f2195f-f5a3-5f61-98be-f6ed76ea565a/subscription => [200] 
320. [GET] http://127.0.0.1:5213/api/v1/platform/tenants/3f3853d6-1917-5dfd-8abb-d53f181d6df0/subscription => [200] 
321. [GET] http://127.0.0.1:5213/api/v1/platform/tenants/abdf3e10-8013-5327-af36-1bf84b2b72e7/subscription => [200] 

Note: 308 static requests not shown, run with "static" option to see them.