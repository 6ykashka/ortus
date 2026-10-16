// node axe.mjs <label> <outfile-append> — axe-core 4.13.0 (как @axe-core/playwright e2e-kit) в текущей странице MCP.
// Правила по умолчанию + target-size (wcag22aa). Печатает serious/critical и прочие нарушения.
import { appendFileSync, readFileSync } from 'node:fs';

const [label, out] = process.argv.slice(2);
const src = readFileSync(
  'C:/Users/sys00/AppData/Local/Temp/claude/D--work-test26042026-Kirill-3-0/eea2efcc-b4c3-42f8-8c6b-aa1fcfc0db2f/scratchpad/v-W1.49-1/node_modules/.pnpm/axe-core@4.13.0/node_modules/axe-core/axe.min.js',
  'utf8',
);
const fn = `async () => { if (!window.axe) { const s = document.createElement('script'); s.textContent = ${JSON.stringify(src)}; document.head.appendChild(s); }
  const def = await axe.run(document, {});
  const t = await axe.run(document, { runOnly: { type: 'rule', values: ['target-size'] } });
  const f = (r) => r.violations.map(v => v.impact + ' ' + v.id + ' [' + v.nodes.map(n => n.target.join(' ')).slice(0,4).join(' | ') + ']');
  return JSON.stringify({ def: f(def), target: f(t) }); }`;
const r = await fetch('http://127.0.0.1:9117/', {
  method: 'POST',
  body: JSON.stringify({ name: 'browser_evaluate', args: { function: fn } }),
});
const t = await r.text();
const m = /### Result\n"([\s\S]*?)"\n/.exec(t);
const res = m ? JSON.parse(JSON.parse(`"${m[1]}"`)) : { error: t.slice(0, 500) };
const line = `${label}: default=${JSON.stringify(res.def)} target-size=${JSON.stringify(res.target)}${res.error ? ' ERR ' + res.error : ''}`;
console.log(line);
if (out) appendFileSync(out, line + '\n');
