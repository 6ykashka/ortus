// W0.09 · модель кодогенерации: что генерируется из бандла OpenAPI, errors.yaml и permissions.yaml.
// Чистые функции без ввода-вывода (тесты — tools/gen/codegen.test.mjs).

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

/** Каталог пакетов Go по тегам бандла: `backend/internal/api/<tag в нижнем регистре>/`. */
export function tagsOf(bundle) {
  return (bundle.tags ?? []).map(({ name }) => {
    const pkg = name.toLowerCase();
    const dir = `backend/internal/api/${pkg}`;
    return { tag: name, pkg, alias: `${pkg}api`, field: name, dir, file: `${dir}/${pkg}.gen.go` };
  });
}

/** Конфиг oapi-codegen для одного тега: модели, chi-сервер и strict server только операций тега. */
export function oapiConfig(t) {
  return [
    `package: ${t.pkg}`,
    'generate:',
    '  models: true',
    '  chi-server: true',
    '  strict-server: true',
    'output-options:',
    '  include-tags:',
    `    - ${t.tag}`,
    `output: ${t.file}`,
    '',
  ].join('\n');
}

/** Операции бандла для шлюза cmd/api, отсортированные по пути и методу. */
export function operationsOf(bundle) {
  const ops = [];
  for (const [path, item] of Object.entries(bundle.paths ?? {})) {
    for (const m of METHODS) {
      const op = item?.[m];
      if (!op?.operationId) continue;
      const method = m.toUpperCase();
      ops.push({
        id: op.operationId,
        tag: op.tags?.[0] ?? '',
        method,
        path,
        permissions: [...(op['x-permissions'] ?? [])],
        permissionsMode: op['x-permissions-mode'] ?? 'all',
        scope: op['x-scope'] ?? '',
        public: Array.isArray(op.security) && op.security.length === 0,
        mutating: !SAFE.has(method),
      });
    }
  }
  const key = (o) => `${o.path} ${o.method}`;
  return ops.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** Коды Problem.code из api/errors.yaml (раздел codes; client_states — не HTTP-ответы). */
export function problemsOf(errors) {
  return Object.entries(errors.codes ?? {}).map(([code, c]) => ({
    code,
    status: c.status,
    title: c.title,
  }));
}

/** Все действия каталога прав, кроме модуля platform (шаблон owner: «все tenant actions»). */
export function tenantActionsOf(permissions) {
  const out = new Set();
  for (const [mod, def] of Object.entries(permissions.modules ?? {})) {
    if (mod === 'platform') continue;
    for (const key of Object.keys(def.actions ?? {})) out.add(key);
  }
  return [...out].sort();
}
