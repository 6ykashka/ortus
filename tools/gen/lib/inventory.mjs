// Инвентарь операций OpenAPI: путь, метод, operationId, тег.
export const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** @returns {{path: string, method: string, operationId: string, tag: string, op: object}[]} */
export function listOperations(doc) {
  const out = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = item?.[method];
      if (!op) continue;
      out.push({ path, method, operationId: op.operationId, tag: op.tags?.[0], op });
    }
  }
  return out;
}

/** Операции по operationId. */
export function operationsById(doc) {
  return new Map(listOperations(doc).map((o) => [o.operationId, o]));
}
