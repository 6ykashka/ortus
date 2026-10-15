// Сценарии сервера (W0.13, PD-31): `X-Test-Scenario: [<operationId>=]<сценарий>[, …]` или постоянный сценарий
// (`POST /api/v1/dev/scenario`). Сценарий — код Problem реестра, `empty`, `offline`, `loading`, `delay=<мс>`.
// Без `<operationId>=` сценарий относится ко всем операциям. Неизвестное игнорируется.
import { contract, type OperationInfo } from '../contract/index.ts';

export type Directive =
  | { kind: 'code'; code: string }
  | { kind: 'empty' }
  | { kind: 'offline' }
  | { kind: 'loading' }
  | { kind: 'delay'; ms: number };

export interface ScenarioItem {
  op?: string;
  directive: Directive;
}

const OPS = new Set(contract.operations.map((o) => o.id));
const MAX_DELAY_MS = 60_000;

function directive(raw: string): Directive | undefined {
  if (raw === 'empty' || raw === 'offline' || raw === 'loading') return { kind: raw };
  const delay = /^delay=(\d{1,6})$/.exec(raw);
  if (delay) return { kind: 'delay', ms: Math.min(Number(delay[1]), MAX_DELAY_MS) };
  if (raw in contract.errors) return { kind: 'code', code: raw };
  return undefined;
}

/** Разбор спецификации: элементы через запятую или точку с запятой. */
export function parseScenario(spec: string): ScenarioItem[] {
  const out: ScenarioItem[] = [];
  for (const part of spec.split(/[,;]/)) {
    const item = part.trim();
    if (!item) continue;
    const eq = item.indexOf('=');
    const head = eq > 0 ? item.slice(0, eq) : '';
    const scoped = OPS.has(head);
    if (eq > 0 && !scoped && /^[a-z][A-Za-z0-9]*$/.test(head) && /[A-Z]/.test(head)) continue;
    const d = directive(scoped ? item.slice(eq + 1) : item);
    if (!d) continue;
    out.push(scoped ? { op: head, directive: d } : { directive: d });
  }
  return out;
}

/** Применим ли сценарий к операции: код — если операция объявляет его статус; empty — к чтению списка. */
export function applies(d: Directive, op: OperationInfo): boolean {
  switch (d.kind) {
    case 'code': {
      const status = contract.errors[d.code]?.status;
      return status !== undefined && op.statuses.includes(status);
    }
    case 'empty':
      return op.method === 'GET' && op.successBody;
    default:
      return true;
  }
}

/** Сценарии операции `op` из спецификации. */
export const directivesFor = (items: readonly ScenarioItem[], op: OperationInfo): Directive[] =>
  items
    .filter((i) => (!i.op || i.op === op.id) && applies(i.directive, op))
    .map((i) => i.directive);
