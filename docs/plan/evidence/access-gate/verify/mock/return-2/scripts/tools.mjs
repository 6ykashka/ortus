import { start } from './mcp.mjs';
const m = start();
await m.init();
const t = await m.request('tools/list', {});
for (const x of t.tools) console.log(x.name, JSON.stringify(Object.keys(x.inputSchema?.properties ?? {})));
m.close();
process.exit(0);
