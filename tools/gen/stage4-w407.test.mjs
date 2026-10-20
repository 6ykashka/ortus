// W4.07 · Контрактный PR 6 этапа 4: billing и branding (control DB). Места и тарифная сетка (версии, ступени, сроки),
// заявки на тариф владельца и решение оператора, «Использование» для оператора, каталог аккаунтов и операторы платформы,
// оформление организации (название, логотип и знак, акцент, термины, меню). Источники — design/docs/17-users-and-billing.md,
// 18-branding.md, db/control_0002_billing.sql, control_0003_branding.sql; эталон 19.10 (billingVM, plansVM, requestsVM,
// usageVM, accountsVM, platformOrgVM, brandingVM). Только добавления. Бриф docs/plan/v2/ws/W4.07.md §2.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { checkExamples, loadExamples } from './lib/examples.mjs';
import { operationsById } from './lib/inventory.mjs';
import { abs, ERRORS_PATH, SCREENS_PATH, SOURCE_0_1 } from './lib/paths.mjs';
import { flattenActions, loadCatalog } from './lib/permissions.mjs';
import { checkAgainstSource, loadDeltas } from './lib/source-diff.mjs';
import { readYaml } from './lib/yaml-io.mjs';

const doc = bundle();
const source = readYaml(SOURCE_0_1);
const ops = operationsById(doc);
const schemas = doc.components.schemas;
const name = (ref) => ref?.split('/').pop();
const deltas = loadDeltas();
const w407 = deltas.filter((d) => /W4\.07/.test(d.source));

/** Новые операции W4.07: [operationId, метод, путь, тег, право, x-scope, успех, ошибки примеров]. */
const OPS = [
  // Billing — владелец организации.
  [
    'getTenantPriceBook',
    'get',
    '/api/v1/tenants/{tenantId}/price-book',
    'Billing',
    'billing.read',
    'tenant-owner-or-billing-manager',
    '200',
    ['forbidden_action'],
  ],
  [
    'listSubscriptionChangeRequests',
    'get',
    '/api/v1/tenants/{tenantId}/subscription/change-requests',
    'Billing',
    'billing.read',
    'tenant-owner-or-billing-manager',
    '200',
    ['forbidden_action'],
  ],
  [
    'createSubscriptionChangeRequest',
    'post',
    '/api/v1/tenants/{tenantId}/subscription/change-requests',
    'Billing',
    'billing.manage',
    'tenant-owner',
    '201',
    ['request_pending', 'tier_below_usage'],
  ],
  [
    'cancelSubscriptionChangeRequest',
    'post',
    '/api/v1/tenants/{tenantId}/subscription/change-requests/{changeRequestId}/cancel',
    'Billing',
    'billing.manage',
    'tenant-owner',
    '200',
    ['invalid_transition'],
  ],
  // Platform — оператор.
  [
    'listPlatformSubscriptionRequests',
    'get',
    '/api/v1/platform/subscription-requests',
    'Platform',
    'platform.billing.read',
    'platform',
    '200',
    ['not_found'],
  ],
  [
    'decidePlatformSubscriptionRequest',
    'post',
    '/api/v1/platform/subscription-requests/{changeRequestId}/decision',
    'Platform',
    'platform.billing.manage',
    'platform',
    '200',
    ['validation_failed', 'invalid_transition'],
  ],
  [
    'listPriceBookVersions',
    'get',
    '/api/v1/platform/price-book/versions',
    'Platform',
    'platform.billing.read',
    'platform',
    '200',
    ['not_found'],
  ],
  [
    'publishPriceBookVersion',
    'post',
    '/api/v1/platform/price-book/versions',
    'Platform',
    'platform.pricing.manage',
    'platform',
    '201',
    ['validation_failed', 'invalid_transition'],
  ],
  [
    'cancelPriceBookVersion',
    'post',
    '/api/v1/platform/price-book/versions/{version}/cancel',
    'Platform',
    'platform.pricing.manage',
    'platform',
    '200',
    ['invalid_transition'],
  ],
  [
    'getPlatformUsage',
    'get',
    '/api/v1/platform/usage',
    'Platform',
    'platform.tenants.read',
    'platform',
    '200',
    ['not_found'],
  ],
  [
    'getPlatformUser',
    'get',
    '/api/v1/platform/users/{accountId}',
    'Platform',
    'platform.users.read',
    'platform',
    '200',
    ['not_found'],
  ],
  [
    'lockPlatformUser',
    'post',
    '/api/v1/platform/users/{accountId}/lock',
    'Platform',
    'platform.users.manage',
    'platform',
    '200',
    ['validation_failed', 'invalid_transition'],
  ],
  [
    'unlockPlatformUser',
    'post',
    '/api/v1/platform/users/{accountId}/unlock',
    'Platform',
    'platform.users.manage',
    'platform',
    '200',
    ['invalid_transition'],
  ],
  [
    'resetPlatformUserMfa',
    'post',
    '/api/v1/platform/users/{accountId}/mfa-reset',
    'Platform',
    'platform.users.manage',
    'platform',
    '200',
    ['invalid_transition'],
  ],
  [
    'listPlatformOperators',
    'get',
    '/api/v1/platform/operators',
    'Platform',
    'platform.users.read',
    'platform',
    '200',
    ['not_found'],
  ],
  [
    'invitePlatformOperator',
    'post',
    '/api/v1/platform/operators',
    'Platform',
    'platform.operators.manage',
    'platform',
    '201',
    ['validation_failed'],
  ],
  [
    'updatePlatformOperator',
    'patch',
    '/api/v1/platform/operators/{operatorId}',
    'Platform',
    'platform.operators.manage',
    'platform',
    '200',
    ['last_owner_required', 'validation_failed'],
  ],
  // Branding — владелец организации.
  [
    'getTenantBranding',
    'get',
    '/api/v1/tenants/{tenantId}/branding',
    'Branding',
    'branding.manage',
    'tenant-owner',
    '200',
    ['forbidden_action'],
  ],
  [
    'updateTenantBranding',
    'put',
    '/api/v1/tenants/{tenantId}/branding',
    'Branding',
    'branding.manage',
    'tenant-owner',
    '200',
    ['validation_failed', 'revision_mismatch'],
  ],
  [
    'uploadBrandingAsset',
    'post',
    '/api/v1/tenants/{tenantId}/branding/assets',
    'Branding',
    'branding.manage',
    'tenant-owner',
    '201',
    ['validation_failed', 'payload_too_large'],
  ],
];

const header = (o, status, h) => o.responses[status]?.headers?.[h];
const deref = (x) => (x?.$ref ? doc.components.parameters[name(x.$ref)] : x);
const params = (o) => (o.parameters ?? []).map((p) => deref(p)?.name);

describe('контракт W4.07: операции billing и branding', () => {
  it('20 новых операций — путь, метод, тег, право, x-scope', () => {
    for (const [id, method, path, tag, perm, scope] of OPS) {
      const o = ops.get(id);
      assert.ok(o, `нет операции ${id}`);
      assert.equal(o.method, method, id);
      assert.equal(o.path, path, id);
      assert.equal(o.tag, tag, id);
      assert.deepEqual(o.op['x-permissions'], [perm], id);
      assert.equal(o.op['x-scope'], scope, id);
      assert.ok(o.op.description?.length > 80, `${id}: правила в описании`);
    }
  });

  it('изменяющие — Idempotency-Key, CSRF, Origin; команды над версией — If-Match', () => {
    for (const [id, method] of OPS) {
      if (method === 'get') continue;
      const o = ops.get(id).op;
      for (const p of ['Idempotency-Key', 'X-CSRF-Token', 'Origin']) {
        assert.ok(params(o).includes(p), `${id}: ${p}`);
      }
      assert.equal(o['x-csrf-required-for-cookie'], true, id);
    }
    for (const id of ['updateTenantBranding', 'updatePlatformOperator']) {
      assert.ok(params(ops.get(id).op).includes('If-Match'), `${id}: If-Match`);
      assert.ok(ops.get(id).op.responses['412'], `${id}: 412`);
      assert.ok(ops.get(id).op.responses['428'], `${id}: 428`);
    }
    assert.ok(ops.get('uploadBrandingAsset').op.responses['413'], 'uploadBrandingAsset: 413');
  });

  it('ответы успеха — статус, ETag у версионных, Cache-Control private, no-store', () => {
    for (const [id, , , , , , ok] of OPS) {
      const o = ops.get(id).op;
      assert.ok(o.responses[ok], `${id}: ${ok}`);
      assert.equal(header(o, ok, 'Cache-Control')?.schema?.const, 'private, no-store', id);
    }
    for (const id of ['getTenantBranding', 'updateTenantBranding', 'updatePlatformOperator']) {
      assert.ok(header(ops.get(id).op, '200', 'ETag'), `${id}: ETag`);
    }
  });

  it('право branding.manage — owner_only на всю организацию; новых ключей платформы нет', () => {
    const catalog = loadCatalog();
    const actions = flattenActions(catalog);
    const b = actions.get('branding.manage');
    assert.ok(b, 'branding.manage');
    assert.equal(b.owner_only, true);
    assert.deepEqual(b.scopes, ['tenant']);
    assert.ok(catalog.modules['core.modules'].actions['branding.manage']);
    for (const k of [
      'platform.billing.read',
      'platform.billing.manage',
      'platform.pricing.manage',
      'platform.users.read',
      'platform.users.manage',
      'platform.operators.manage',
      'platform.tenants.read',
    ]) {
      assert.ok(actions.has(k), k);
    }
    assert.ok(actions.size >= 124);
  });

  it('коды ошибок — существующие: request_pending, tier_below_usage, seats_exhausted', () => {
    const codes = readYaml(ERRORS_PATH).codes;
    assert.equal(codes.request_pending.status, 409);
    assert.equal(codes.tier_below_usage.status, 422);
    assert.equal(codes.seats_exhausted.status, 409);
    const create = ops.get('createSubscriptionChangeRequest').op.description;
    for (const w of ['request_pending', 'tier_below_usage', 'one pending', 'quote']) {
      assert.ok(create.includes(w), `createSubscriptionChangeRequest: ${w}`);
    }
  });
});

describe('контракт W4.07: схемы', () => {
  it('Subscription + тариф, срок, версия цен, суммы и места (необязательные поля 0.1-схемы)', () => {
    const s = schemas.Subscription;
    for (const p of [
      'tierCode',
      'tierName',
      'termMonths',
      'priceVersion',
      'monthlyAmount',
      'periodAmount',
      'seats',
    ]) {
      assert.ok(s.properties[p], `Subscription.${p}`);
      assert.ok(!s.required.includes(p), `Subscription.${p} необязательно`);
    }
    assert.deepEqual(s.required, source.components.schemas.Subscription.required);
    assert.deepEqual(s.properties.termMonths.enum, [1, 4, 8, 12]);
    assert.equal(name(s.properties.seats.$ref), 'SeatUsage');
    const seats = schemas.SeatUsage;
    assert.deepEqual(seats.required, ['limit', 'used', 'active', 'invited', 'available']);
    assert.deepEqual(seats.properties.limit.type, ['integer', 'null']);
    assert.match(seats.description, /invited/);
    assert.match(seats.description, /without an account/);
  });

  it('тарифная сетка: версия, ступени, сроки; безлимит — без лимита и без цены', () => {
    const v = schemas.PriceBookVersion;
    for (const p of ['version', 'state', 'effectiveFrom', 'note', 'currency', 'tiers', 'terms']) {
      assert.ok(v.required.includes(p), `PriceBookVersion.${p}`);
    }
    assert.deepEqual(v.properties.state.enum, ['current', 'scheduled', 'archived', 'cancelled']);
    const t = schemas.PriceTier;
    assert.deepEqual(t.required, ['code', 'name', 'seatsLimit', 'monthAmountMinor']);
    assert.deepEqual(t.properties.seatsLimit.type, ['integer', 'null']);
    assert.match(t.description, /unlimited/i);
    const term = schemas.PriceTerm;
    assert.deepEqual(term.properties.months.enum, [1, 4, 8, 12]);
    assert.equal(term.properties.discountPercent.maximum, 49);
    const c = schemas.PriceBookVersionCreate;
    assert.deepEqual(c.required, ['effectiveFrom', 'note', 'tiers', 'terms']);
    assert.equal(c.properties.effectiveFrom.format, 'date');
    const pub = ops.get('publishPriceBookVersion').op.description;
    for (const w of ['scheduled', 'immutable', '409 invalid_transition', 'violations', 'last']) {
      assert.ok(pub.includes(w), `publishPriceBookVersion: ${w}`);
    }
  });

  it('заявка на тариф: номер SR-N, расчёт, статусы, срок применения, причина отказа', () => {
    const r = schemas.SubscriptionChangeRequest;
    for (const p of [
      'id',
      'number',
      'tenantId',
      'toTierCode',
      'termMonths',
      'priceVersion',
      'seatsUsed',
      'status',
      'requestedAt',
      'revision',
    ]) {
      assert.ok(r.required.includes(p), `SubscriptionChangeRequest.${p}`);
    }
    assert.deepEqual(r.properties.status.enum, ['pending', 'approved', 'rejected', 'cancelled']);
    assert.equal(r.properties.number.pattern, '^SR-[1-9][0-9]{0,8}$');
    assert.equal(
      name(r.properties.quote.anyOf?.[0]?.$ref ?? r.properties.quote.$ref),
      'SubscriptionQuote',
    );
    const d = schemas.SubscriptionRequestDecision;
    assert.deepEqual(d.properties.decision.enum, ['approve', 'reject']);
    const decide = ops.get('decidePlatformSubscriptionRequest').op.description;
    for (const w of [
      'note',
      'reject',
      'downgrade',
      'effectiveAt',
      'platform_audit',
      'context.changed',
    ]) {
      assert.ok(decide.includes(w), `decidePlatformSubscriptionRequest: ${w}`);
    }
  });

  it('«Использование»: сводка, сигналы с порогами, модули, строки организаций', () => {
    const u = schemas.PlatformUsage;
    assert.deepEqual(u.required, ['measuredAt', 'summary', 'signals', 'modules', 'tenants']);
    assert.deepEqual(schemas.PlatformUsageSignal.properties.kind.enum, [
      'seats_full',
      'seats_low',
      'storage_high',
      'trial_ending',
      'trial_expired',
      'suspended',
      'inactive',
    ]);
    assert.deepEqual(schemas.PlatformUsageSignal.properties.level.enum, ['high', 'medium', 'low']);
    const d = ops.get('getPlatformUsage').op.description;
    for (const w of ['85%', '75%', '95%', '14 days', '7 days', 'metadata']) {
      assert.ok(d.includes(w), `getPlatformUsage: ${w}`);
    }
  });

  it('каталог аккаунтов: участия, второй фактор, блокировка с причиной; фильтры списка', () => {
    const u = schemas.PlatformUser;
    for (const p of ['mfaEnabled', 'lockReason', 'lockedAt', 'memberships']) {
      assert.ok(u.properties[p], `PlatformUser.${p}`);
    }
    assert.deepEqual(u.required, source.components.schemas.PlatformUser.required);
    assert.deepEqual(schemas.PlatformUserMembership.properties.status.enum, [
      'active',
      'invited',
      'suspended',
      'ended',
    ]);
    const list = ops.get('listPlatformUsers').op;
    for (const p of ['q', 'tenantId', 'filter'])
      assert.ok(params(list).includes(p), `listPlatformUsers ${p}`);
    assert.equal(name(schemas.PlatformUserPage.properties.counts?.$ref), 'PlatformUserCounts');
    assert.deepEqual(schemas.PlatformUserLock.required, ['reason']);
    assert.equal(schemas.PlatformUserLock.properties.reason.minLength, 5);
  });

  it('операторы: роли owner/admin/billing/support, ≥ 2 активных владельца, себя не менять', () => {
    const o = schemas.PlatformOperator;
    assert.deepEqual(o.properties.role.enum, ['owner', 'admin', 'billing', 'support']);
    assert.deepEqual(o.properties.status.enum, ['invited', 'active', 'disabled']);
    const d = ops.get('updatePlatformOperator').op.description;
    for (const w of [
      'last_owner_required',
      'two active owners',
      'own',
      'second factor',
      'support grants',
    ]) {
      assert.ok(d.includes(w), `updatePlatformOperator: ${w}`);
    }
    assert.match(ops.get('invitePlatformOperator').op.description, /owner/);
  });

  it('Tenant (оператор): места, участники, тариф, знак — необязательные поля 0.1-схемы', () => {
    const t = schemas.Tenant;
    for (const p of ['seats', 'memberCount', 'tierCode', 'brand']) {
      assert.ok(t.properties[p], `Tenant.${p}`);
      assert.ok(!t.required.includes(p));
    }
    assert.deepEqual(t.required, source.components.schemas.Tenant.required);
    assert.equal(name(t.properties.brand.$ref), 'TenantBrandMark');
  });

  it('оформление: версия, акцент выбранный и применяемый, файлы, термины четырёх форм, меню', () => {
    const b = schemas.Branding;
    for (const p of [
      'version',
      'displayName',
      'shortName',
      'accentHex',
      'accentUsed',
      'accentVariants',
      'terms',
      'menu',
      'poweredBy',
    ]) {
      assert.ok(b.required.includes(p), `Branding.${p}`);
    }
    // Файлы и автор версии — необязательные (нет файла — поле отсутствует; кодогенерация без nullable-объектов).
    for (const p of ['logo', 'mark', 'updatedAt', 'updatedBy']) {
      assert.ok(b.properties[p] && !b.required.includes(p), `Branding.${p} необязательно`);
    }
    assert.equal(name(b.properties.logo.$ref), 'BrandingAsset');
    assert.equal(b.properties.accentHex.pattern, '^#[0-9A-Fa-f]{6}$');
    assert.deepEqual(Object.keys(schemas.BrandingTerms.properties), [
      'shift',
      'vehicle',
      'trip',
      'visit',
      'object',
    ]);
    assert.deepEqual(schemas.BrandingTerm.required, ['one', 'plural', 'few', 'many']);
    assert.equal(schemas.BrandingTerm.properties.one.maxLength, 40);
    const u = schemas.BrandingUpdate;
    assert.deepEqual(u.required, [
      'displayName',
      'shortName',
      'accentHex',
      'logoAssetId',
      'markAssetId',
      'terms',
      'menu',
      'poweredBy',
    ]);
    assert.equal(u.properties.displayName.maxLength, 60);
    assert.equal(u.properties.shortName.maxLength, 16);
    const up = ops.get('updateTenantBranding').op.description;
    for (const w of [
      '4.5',
      '4%',
      'home',
      'modules',
      'users',
      'billing',
      'branding',
      'context.changed',
      'platform_audit',
      'tenants.display_name',
    ]) {
      assert.ok(up.includes(w), `updateTenantBranding: ${w}`);
    }
    assert.deepEqual(schemas.BrandingAssetUpload.properties.contentType.enum, [
      'image/png',
      'image/svg+xml',
      'image/jpeg',
      'image/webp',
    ]);
    assert.match(ops.get('uploadBrandingAsset').op.description, /1 MiB/);
    assert.match(ops.get('uploadBrandingAsset').op.description, /sanitiz/);
    // Возврат 2: в контексте — тема без автора версии (BrandingTheme).
    assert.equal(name(schemas.TenantContext.properties.branding?.$ref), 'BrandingTheme');
    assert.ok(!schemas.TenantContext.required.includes('branding'));
  });
});

describe('контракт W4.07: аддитивность, примеры, экраны, журнал, версия', () => {
  it('отличия от 0.1 объявлены дельтами W4.07; новые пути — add', () => {
    assert.deepEqual(checkAgainstSource(doc, source, deltas).errors, []);
    const pointers = new Set(w407.map((d) => d.pointer));
    const paths = new Set(OPS.map(([, , p]) => p));
    for (const p of paths) {
      assert.ok(
        pointers.has(`/paths/${p.replaceAll('~', '~0').replaceAll('/', '~1')}`),
        `дельта пути ${p}`,
      );
    }
    for (const p of ['tierCode', 'seats', 'monthlyAmount']) {
      assert.ok(
        pointers.has(`/components/schemas/Subscription/properties/${p}`),
        `Subscription.${p}`,
      );
    }
    assert.ok(pointers.has('/components/schemas/TenantContext/properties/branding'));
    assert.match(deltas.find((x) => x.pointer === '/info/version').source, /W4\.07/);
    assert.match(deltas.find((x) => x.pointer === '/tags').source, /W4\.07/);
  });

  it('новый тег Branding объявлен', () => {
    assert.ok(doc.tags.some((t) => t.name === 'Branding'));
  });

  it('примеры: успех и ошибки каждой новой операции, все валидны', () => {
    const examples = loadExamples();
    assert.deepEqual(checkExamples(doc, examples), []);
    for (const [id, , , , , , , errors] of OPS) {
      const ex = examples.get(id);
      assert.ok(ex?.get('ok'), `${id}/ok`);
      for (const e of errors) assert.ok(ex.get(e), `${id}/${e}`);
    }
  });

  it('экраны этапа 4.6: подписка, оформление, тарифная сетка, заявки, использование, пользователи', () => {
    const screens = readYaml(SCREENS_PATH).screens;
    const want = {
      'company-billing': [
        'getTenantSubscription',
        'getTenantPriceBook',
        'listSubscriptionChangeRequests',
        'createSubscriptionChangeRequest',
        'cancelSubscriptionChangeRequest',
      ],
      'company-branding': ['getTenantBranding', 'updateTenantBranding', 'uploadBrandingAsset'],
      'platform-pricing': [
        'listPriceBookVersions',
        'publishPriceBookVersion',
        'cancelPriceBookVersion',
      ],
      'platform-requests': [
        'listPlatformSubscriptionRequests',
        'decidePlatformSubscriptionRequest',
      ],
      'platform-usage': ['getPlatformUsage'],
      'platform-users': [
        'listPlatformUsers',
        'getPlatformUser',
        'lockPlatformUser',
        'unlockPlatformUser',
        'resetPlatformUserMfa',
        'listPlatformOperators',
        'invitePlatformOperator',
        'updatePlatformOperator',
      ],
    };
    for (const [key, list] of Object.entries(want)) {
      const s = screens[key];
      assert.ok(s, key);
      assert.equal(s.stage, 4, key);
      assert.match(s.reference, /design-2026-10-19/, key);
      for (const op of list) assert.ok(s.operations.includes(op), `${key}: ${op}`);
    }
  });

  it('журнал и README: раздел W4.07, миграции control 0007–0008 выданы W4.07', () => {
    const log = readFileSync(abs('api/CHANGELOG.md'), 'utf8');
    assert.match(log, /^## 0\.\d+\.\d+-stage4 — W4\.07/m);
    const readme = readFileSync(abs('api/README.md'), 'utf8');
    assert.match(readme, /## Этап 4, W4\.07/);
    assert.match(
      readme,
      /\|\s*control\s*\|\s*0007\s*\|\s*`0007_billing_requests_price_book\.sql`[^|]*\|\s*W4\.07/,
    );
    assert.match(
      readme,
      /\|\s*control\s*\|\s*0008\s*\|\s*`0008_branding_assets\.sql`[^|]*\|\s*W4\.07/,
    );
    assert.match(readme, /`branding`/);
  });

  it('версия контракта — 0.N.x-stage4, N ≥ 7', () => {
    const m = /^0\.(\d+)\.\d+-stage4$/.exec(doc.info.version);
    assert.ok(m, doc.info.version);
    assert.ok(Number(m[1]) >= 7, doc.info.version);
  });
});

// Возврат 1 (ревью W4.07): поля W4.07 в ответах прежних операций — примеры, по которым работает mock (PD-43).
describe('контракт W4.07, возврат 1: оформление в контексте, места и знак организации, условия подписки', () => {
  const examples = loadExamples();
  const get = (op, name) => examples.get(op)?.get(name);

  it('getMyContext и selectTenant: у каждой организации — действующее оформление', () => {
    const bodies = [
      ...['owner', 'owner-lotos', 'manager', 'driver', 'therapist', 'foreman'].map((p) => [
        `getMyContext/${p}`,
        get('getMyContext', p),
      ]),
      ['selectTenant/ok', get('selectTenant', 'ok')],
    ];
    for (const [key, me] of bodies) {
      assert.ok(me?.tenants?.length, key);
      for (const t of me.tenants) {
        assert.ok(t.branding, `${key}: ${t.name} без branding`);
        assert.equal(t.branding.displayName, t.name, `${key}: displayName = name`);
      }
    }
    // Возврат 2: тема — действующее оформление без updatedAt и updatedBy.
    const theme = (b) => {
      const out = { ...b };
      delete out.updatedAt;
      delete out.updatedBy;
      return out;
    };
    const lotos = get('getMyContext', 'owner-lotos').tenants.find((t) => t.name === 'SPA «Лотос»');
    assert.deepEqual(lotos.branding, theme(get('getTenantBranding', 'ok')));
    const alta = get('getMyContext', 'owner').tenants.find((t) => t.name === 'Альта Групп');
    assert.deepEqual(alta.branding, theme(get('getTenantBranding', 'standard')));
  });

  it('Tenant оператора: места, участники, тариф и знак во всех примерах организации', () => {
    const tenants = [
      ...get('listPlatformTenants', 'ok').items.map((t) => ['listPlatformTenants/ok', t]),
      ...[
        'getPlatformTenant',
        'createPlatformTenant',
        'updatePlatformTenant',
        'suspendPlatformTenant',
        'resumePlatformTenant',
      ].map((op) => [`${op}/ok`, get(op, 'ok')]),
    ];
    for (const [key, t] of tenants) {
      for (const p of ['seats', 'memberCount', 'tierCode', 'brand']) {
        assert.ok(t[p] !== undefined, `${key}: ${t.name} без ${p}`);
      }
      assert.match(t.brand.accentUsed, /^#[0-9A-F]{6}$/, key);
    }
    const usage = new Map(get('getPlatformUsage', 'ok').tenants.map((t) => [t.tenantId, t]));
    for (const t of get('listPlatformTenants', 'ok').items) {
      const u = usage.get(t.id);
      assert.ok(u, t.name);
      assert.deepEqual(
        { seats: t.seats, memberCount: t.memberCount, tierCode: t.tierCode, brand: t.brand },
        { seats: u.seats, memberCount: u.memberCount, tierCode: u.tierCode, brand: u.brand },
        `${t.name}: как в «Использовании»`,
      );
    }
  });

  it('getPlatformSubscription: тариф, версия цен и места; оплаченный период — срок и суммы', () => {
    const ok = get('getPlatformSubscription', 'ok');
    for (const p of ['tierCode', 'tierName', 'priceVersion', 'seats'])
      assert.ok(ok?.[p], `ok.${p}`);
    assert.deepEqual(ok, get('getTenantSubscription', 'ok'));
    const paid = get('getPlatformSubscription', 'seats');
    assert.ok(paid, 'getPlatformSubscription/seats');
    assert.deepEqual(paid, get('getTenantSubscription', 'seats'));
    for (const p of ['termMonths', 'monthlyAmount', 'periodAmount'])
      assert.ok(paid[p], `seats.${p}`);
  });

  it('заявка на тариф — в любом состоянии, кроме закрытой; отмена и список — тоже', () => {
    for (const id of [
      'createSubscriptionChangeRequest',
      'cancelSubscriptionChangeRequest',
      'listSubscriptionChangeRequests',
    ]) {
      assert.match(
        ops.get(id).op.description,
        /Allowed in trial, active, grace, read_only and suspended tenants/,
        id,
      );
    }
    assert.match(
      ops.get('cancelSubscriptionChangeRequest').op.description,
      /subscription\.change_request_cancelled/,
    );
  });

  it('SVG оформления: санитайзер по allowlist, запрет javascript:/data: и <style>, отдача с CSP sandbox', () => {
    const d = ops.get('uploadBrandingAsset').op.description;
    for (const w of [
      'allowlist',
      'javascript:',
      'data:',
      'style',
      'iframe',
      'DOCTYPE',
      'unsafe_svg',
      'image/svg+xml',
      'nosniff',
      'Content-Security-Policy',
      'sandbox',
    ]) {
      assert.ok(d.includes(w), `uploadBrandingAsset: ${w}`);
    }
  });

  it('412 оформления — текст «Данные изменились» (реестр ошибок), отличия от эталона — в журнале', () => {
    assert.match(get('updateTenantBranding', 'revision_mismatch').detail, /^Данные изменились\./);
    const log = readFileSync(abs('api/CHANGELOG.md'), 'utf8');
    const w407 = log.slice(log.indexOf('— W4.07'), log.indexOf('## 0.6.2-stage2'));
    assert.match(w407, /### Отличия от эталона/);
    for (const w of [
      'DELETE /platform/price-book/versions/scheduled',
      'Вход уже заблокирован',
      'Второй фактор не настроен',
      'Знак — квадрат не меньше 512×512',
      'В SVG не должно быть скриптов и внешних ссылок',
      'Эта почта уже используется в организации клиента',
    ]) {
      assert.ok(w407.includes(w), `CHANGELOG W4.07: ${w}`);
    }
  });
});

// Возврат 2 (ревью W4.07): текст 412 в описании, тема в контексте без автора, роли операторов, версия после W4.02.
describe('контракт W4.07, возврат 2: 412, тема в контексте, роли операторов', () => {
  const examples = loadExamples();
  const get = (op, n) => examples.get(op)?.get(n);

  it('412 updateTenantBranding — тот же текст, что в примере и в mock', () => {
    const d = ops.get('updateTenantBranding').op.description;
    assert.ok(d.includes('«Данные изменились. Обновите оформление и повторите.»'), d);
    assert.ok(!d.includes('Оформление уже изменили'), d);
    assert.match(get('updateTenantBranding', 'revision_mismatch').detail, /^Данные изменились\./);
  });

  it('TenantContext.branding — BrandingTheme: тема без автора и момента сохранения', () => {
    const t = schemas.BrandingTheme;
    assert.ok(t, 'BrandingTheme');
    assert.equal(t.additionalProperties, false);
    const keys = Object.keys(t.properties);
    for (const k of ['updatedAt', 'updatedBy']) assert.ok(!keys.includes(k), `BrandingTheme.${k}`);
    const full = Object.keys(schemas.Branding.properties).filter(
      (k) => !['updatedAt', 'updatedBy'].includes(k),
    );
    assert.deepEqual(keys, full);
    assert.deepEqual(t.required, schemas.Branding.required);
    assert.ok(w407.some((d) => d.pointer === '/components/schemas/BrandingTheme'));
    for (const p of ['owner', 'owner-lotos', 'manager', 'driver', 'therapist', 'foreman']) {
      for (const tenant of get('getMyContext', p).tenants) {
        assert.ok(!('updatedBy' in tenant.branding), `getMyContext/${p}: ${tenant.name}`);
        assert.ok(!('updatedAt' in tenant.branding), `getMyContext/${p}: ${tenant.name}`);
      }
    }
  });

  it('права платформы по ролям операторов — в описании PlatformOperator.role и в журнале', () => {
    const d = schemas.PlatformOperator.properties.role.description;
    for (const w of [
      'platform.users.manage',
      'platform.billing.read',
      'platform.billing.manage',
      'platform.pricing.manage',
      'platform.operators.manage',
      '403 forbidden_action',
    ]) {
      assert.ok(d.includes(w), `PlatformOperator.role: ${w}`);
    }
    const log = readFileSync(abs('api/CHANGELOG.md'), 'utf8');
    const w407log = log.slice(log.indexOf('— W4.07'), log.indexOf('## 0.7.0-stage4'));
    assert.match(w407log, /Возврат 2/);
  });

  it('версия — следующий минор после 0.7.0-stage4 (W4.02); цепочка версий в source-delta', () => {
    const m = /^0\.(\d+)\.\d+-stage4$/.exec(doc.info.version);
    assert.ok(m && Number(m[1]) >= 8, doc.info.version);
    const v = deltas.find((x) => x.pointer === '/info/version');
    // Интегратор: W2.71 (0.7.1-stage4) влит раньше — между 0.7.0-stage4 и 0.8.0-stage4 допустимы патч-версии.
    assert.match(
      v.reason,
      /0\.7\.0-stage4 \(W4\.02[^)]*\)( → 0\.7\.\d+-stage4 \([^)]*\))* → 0\.8\.0-stage4 \(W4\.07/,
    );
  });
});
