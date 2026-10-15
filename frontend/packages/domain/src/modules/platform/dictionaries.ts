// Справочники платформы 14.10: статусы организации (models.js:151–156) и оформление по умолчанию
// (mock-data.js:10; хранится в control DB, нужно до входа и оператору — docs/18).
import type { ToneKey } from '../../core/types/common.ts';
import type { Brand, TenantStatus } from './types.ts';

export interface TenantStateLabel {
  label: string;
  tone: ToneKey;
  icon: string;
}

export const TENANT_STATE: Readonly<Record<TenantStatus, TenantStateLabel>> = {
  trial: { label: 'Пробный период', tone: 'info', icon: 'hourglass_top' },
  active: { label: 'Действует', tone: 'ok', icon: 'check_circle' },
  restricted: { label: 'Ограничен', tone: 'warn', icon: 'lock_clock' },
  suspended: { label: 'Приостановлен', tone: 'danger', icon: 'pause_circle' },
};

export const BRAND_DEFAULT: Readonly<Brand> = {
  short: '',
  accent: '#1F6B52',
  logo: null,
  mark: null,
  terms: {},
  items: {},
  order: [],
  poweredBy: true,
  version: 1,
  updatedAt: null,
  updatedBy: null,
};
