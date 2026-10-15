// Типы выжимки контракта `contract.gen.json` (генерирует scripts/contract.mjs, W0.13).

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Операция бандла с признаками шлюза cmd/api (`catalog.Operation` W0.09). */
export interface OperationInfo {
  id: string;
  method: HttpMethod;
  path: string;
  tag: string;
  /** Тег этапа 1 (ядро и Auth): у операции есть примеры и хендлер W0.13. */
  stage1: boolean;
  /** Операция тегов Fleet, Earnings, Home на экране этапа 2 (W2.00): хендлер src/msw/fleet/, примеры, кейсы. */
  stage2: boolean;
  permissions: string[];
  mode: 'all' | 'any';
  scope: string;
  /** `security: []` — без сессии. */
  public: boolean;
  /** Не GET/HEAD: CSRF, Origin, только чтение. */
  mutating: boolean;
  ifMatch: boolean;
  idempotent: boolean;
  /** Объявленные статусы ответа. */
  statuses: number[];
  success: number;
  successBody: boolean;
  /** Ответ успеха несёт ETag (строгий, `"rev-N"`). */
  etag: boolean;
  fieldPermissions?: Record<string, string>;
  /** Схема тела запроса: ссылки раскрыты, только проверяемые ключевые слова. */
  request?: JsonSchema;
}

/** Подмножество JSON Schema 2020-12 тел запросов контракта. */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  enum?: unknown[];
  const?: unknown;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  format?: string;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  minProperties?: number;
}

export interface ErrorInfo {
  status: number;
  title: string;
  retryable: boolean;
}

export interface ActionInfo {
  key: string;
  /** Модуль каталога (`core.members`, `logistics`, `platform`…). */
  module: string;
  level?: string;
  label: string;
  scopes: string[];
  sensitivity?: string;
  ownerOnly?: boolean;
}

export interface CatalogModule {
  label: string;
  dependsOn: string[];
  system: boolean;
  actions: string[];
}

export interface RoleTemplate {
  label: string;
  kind?: string;
  defaultScope?: string;
  workFunction?: string;
  actions: string[];
  optionalRestricted: string[];
}

export interface PermissionCatalog {
  actions: ActionInfo[];
  modules: Record<string, CatalogModule>;
  roleTemplates: Record<string, RoleTemplate>;
  /** Ключ прототипа → канонические ключи (`[]` — права нет). */
  renames: Record<string, string[]>;
}

export interface Contract {
  version: string;
  operations: OperationInfo[];
  errors: Record<string, ErrorInfo>;
  permissions: PermissionCatalog;
  /** operationId → имя примера → тело (операции этапов 1 и 2). */
  examples: Record<string, Record<string, unknown>>;
  /** Область → id прототипа → UUID v5 (`api/openapi/examples/seed-ids.yaml`). */
  seedIds: Record<string, Record<string, string>>;
}
