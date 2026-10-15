// Control DB платформы (mock-data.js 14.10:9–19, 92–144): организации, тарифная сетка, заявки,
// общий каталог аккаунтов, операторы, журнал. Один объект на все организации (api.js:44–45).

export type TenantStatus = 'trial' | 'active' | 'restricted' | 'suspended';

export interface TermForms {
  one: string;
  plural: string;
  few: string;
  many: string;
}

export interface Brand {
  name?: string;
  short: string;
  accent: string;
  logo: string | null;
  mark: string | null;
  terms: Record<string, Partial<TermForms>>;
  items: Record<string, unknown>;
  order: string[];
  poweredBy: boolean;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface TenantPlan {
  tier: string;
  term: number;
  paidUntil: string | null;
  version: number;
}

export interface Tenant {
  id: string;
  name: string;
  owner: string;
  status: TenantStatus;
  trialEnds: string | null;
  trialDaysLeft: number | null;
  quotaGb: number;
  usedGb: number;
  members: number;
  modules: string[];
  plan: TenantPlan;
  seatsLimit: number | null;
  seatsUsed: number;
  brand?: Brand;
}

export interface Tier {
  id: string;
  name: string;
  seats: number | null;
  month: number | null;
}

export interface Term {
  months: number;
  off: number;
}

export interface PriceVersion {
  v: number;
  from: string;
  to: string | null;
  note: string;
  by: string;
  tiers: Tier[];
  terms: Term[];
}

export interface PriceBook {
  current: number;
  versions: PriceVersion[];
}

export interface SeatRequest {
  id: string;
  tenantId: string;
  from: string;
  to: string;
  term: number;
  used: number;
  by: string;
  at: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  comment: string;
  decidedBy?: string;
  decidedAt?: string;
  decision?: string;
}

export interface Membership {
  tenantId: string;
  status: 'active' | 'invited' | 'suspended' | 'ended';
  owner?: boolean;
}

export interface Account {
  id: string;
  name: string;
  email: string;
  status: 'active' | 'pending' | 'locked';
  mfa: boolean;
  lastLogin: string | null;
  lockReason?: string;
  memberships: Membership[];
}

export interface Operator {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'billing' | 'support' | 'admin';
  status: 'active' | 'invited' | 'disabled';
  mfa: string | null;
  lastLogin: string | null;
  me?: boolean;
  disabledNote?: string;
}

export interface AuditEntry {
  at: string;
  text: string;
  by: string;
}

export interface Platform {
  tenants: Tenant[];
  priceBook: PriceBook;
  requests: SeatRequest[];
  accounts: Account[];
  operators: Operator[];
  audit: AuditEntry[];
}

/** Проекция платформы для участника организации: без каталога аккаунтов, операторов и журнала. */
export type TenantPlatformView = Omit<Platform, 'accounts' | 'operators' | 'audit'>;

export interface PlatformSlices {
  platform?: Platform;
}

declare module '../../core/types/entities-core.ts' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ModuleSlices extends PlatformSlices {}
}
